package pdf

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

type stubMergeService struct {
	result *MergeResult
	err    error
}

func (s *stubMergeService) MergeMultipart(ctx context.Context, files []*multipart.FileHeader, order []int) (*MergeResult, error) {
	return s.result, s.err
}

func TestParseOrderJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("order=%5B0%2C2%2C1%5D"))
	ctx.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	order, err := parseOrder(ctx)
	if err != nil {
		t.Fatalf("parseOrder returned error: %v", err)
	}
	expected := []int{0, 2, 1}
	if len(order) != len(expected) {
		t.Fatalf("unexpected order length: %#v", order)
	}
	for i, v := range expected {
		if order[i] != v {
			t.Fatalf("order[%d] = %d, want %d", i, order[i], v)
		}
	}
}

func TestParseOrderArray(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("order[]=0&order[]=1"))
	ctx.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	order, err := parseOrder(ctx)
	if err != nil {
		t.Fatalf("parseOrder returned error: %v", err)
	}
	if len(order) != 2 || order[0] != 0 || order[1] != 1 {
		t.Fatalf("unexpected order: %#v", order)
	}
}

func TestParseOrderInvalid(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("order=not-json"))
	ctx.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	if _, err := parseOrder(ctx); err == nil {
		t.Fatal("expected error for invalid order")
	}
}

func TestMergeHandlerSuccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tempDir := t.TempDir()
	jobDir := filepath.Join(tempDir, "job")
	if err := os.MkdirAll(jobDir, 0o755); err != nil {
		t.Fatalf("failed to create jobDir: %v", err)
	}

	outputPath := filepath.Join(jobDir, "merged.pdf")
	pdfData := []byte("%PDF-1.4\n% dummy pdf content\n")
	if err := os.WriteFile(outputPath, pdfData, 0o640); err != nil {
		t.Fatalf("failed to create output file: %v", err)
	}

	service := &stubMergeService{
		result: &MergeResult{
			JobID:          "job-123",
			OutputPath:     outputPath,
			OutputFilename: "merged.pdf",
			OutputSize:     int64(len(pdfData)),
			TotalPages:     2,
			Sources:        []SourceFileMeta{},
			jobDir:         jobDir,
		},
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fileWriter, err := writer.CreateFormFile("files[]", "input1.pdf")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	if _, err := io.Copy(fileWriter, bytes.NewReader([]byte("dummy"))); err != nil {
		t.Fatalf("failed to write dummy file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("failed to close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/pdf/merge", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	router := gin.New()
	router.POST("/api/pdf/merge", MergeHandler(service))

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", rec.Code, rec.Body.String())
	}

	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("unexpected content-type: %s", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd == "" {
		t.Fatal("expected Content-Disposition header")
	}
	if rec.Header().Get("X-Job-Id") != "job-123" {
		t.Fatalf("unexpected X-Job-Id header: %s", rec.Header().Get("X-Job-Id"))
	}

	if !bytes.Equal(rec.Body.Bytes(), pdfData) {
		t.Fatalf("unexpected response body: %q", rec.Body.Bytes())
	}

	if _, err := os.Stat(jobDir); !os.IsNotExist(err) {
		t.Fatalf("expected jobDir to be removed, stat err=%v", err)
	}
}

func TestMergeHandlerLimitExceeded(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := &stubMergeService{
		err: &Error{Code: "LIMIT_EXCEEDED", Message: "サイズ上限を超えています"},
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fileWriter, err := writer.CreateFormFile("files[]", "input1.pdf")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	if _, err := io.Copy(fileWriter, bytes.NewReader([]byte("dummy"))); err != nil {
		t.Fatalf("failed to write dummy file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("failed to close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/pdf/merge", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	router := gin.New()
	router.POST("/api/pdf/merge", MergeHandler(service))

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("unexpected status: %d", rec.Code)
	}

	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if payload["code"] != "LIMIT_EXCEEDED" {
		t.Fatalf("unexpected code: %s", payload["code"])
	}
}

func TestMergeHandlerInvalidOrder(t *testing.T) {
	gin.SetMode(gin.TestMode)
	service := &stubMergeService{}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fileWriter, err := writer.CreateFormFile("files[]", "input1.pdf")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	if _, err := io.Copy(fileWriter, bytes.NewReader([]byte("dummy"))); err != nil {
		t.Fatalf("failed to write dummy file: %v", err)
	}
	if err := writer.WriteField("order", "not-json"); err != nil {
		t.Fatalf("failed to write order field: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("failed to close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/pdf/merge", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	router := gin.New()
	router.POST("/api/pdf/merge", MergeHandler(service))

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
}
