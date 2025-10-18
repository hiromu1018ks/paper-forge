package pdf

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	manifest   *JobManifest
	prepareErr error
	result     *Result
	runErr     error
	runCalled  bool
	discardErr error
	discardIDs []string
}

func (s *stubMergeService) PrepareMergeJob(ctx context.Context, files []*multipart.FileHeader, order []int) (*JobManifest, error) {
	if s.prepareErr != nil {
		return nil, s.prepareErr
	}
	return s.manifest, nil
}

func (s *stubMergeService) RunJob(ctx context.Context, jobID string, reporter ProgressReporter) (*Result, error) {
	s.runCalled = true
	if s.runErr != nil {
		return nil, s.runErr
	}
	return s.result, nil
}

func (s *stubMergeService) DiscardJob(jobID string) error {
	s.discardIDs = append(s.discardIDs, jobID)
	if s.discardErr != nil {
		return s.discardErr
	}
	return nil
}

type stubScheduler struct {
	calls int
	jobID string
	op    OperationType
	err   error
}

func (s *stubScheduler) Schedule(ctx context.Context, op OperationType, jobID string) error {
	s.calls++
	s.jobID = jobID
	s.op = op
	return s.err
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
	jobDir := filepath.Join(tempDir, "job-123")
	outDir := filepath.Join(jobDir, "out")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatalf("failed to create outDir: %v", err)
	}

	outputPath := filepath.Join(outDir, "merged.pdf")
	pdfData := []byte("%PDF-1.4\n% dummy pdf content\n")
	if err := os.WriteFile(outputPath, pdfData, 0o640); err != nil {
		t.Fatalf("failed to create output file: %v", err)
	}

	service := &stubMergeService{
		manifest: &JobManifest{
			JobID:     "job-123",
			Operation: OperationMerge,
			Files: []JobFile{
				{StoredName: "00.pdf", OriginalName: "input1.pdf", Size: int64(len(pdfData)), Pages: 2},
			},
		},
		result: &Result{
			JobID:          "job-123",
			Operation:      OperationMerge,
			OutputPath:     outputPath,
			OutputFilename: "merged.pdf",
			OutputSize:     int64(len(pdfData)),
			ResultKind:     ResultKindPDF,
			jobDir:         jobDir,
		},
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fileWriter, err := writer.CreateFormFile("files[]", "input1.pdf")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	if _, err := io.Copy(fileWriter, bytes.NewReader(pdfData)); err != nil {
		t.Fatalf("failed to write dummy file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("failed to close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/pdf/merge", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	router := gin.New()
	opts := HandlerOptions{AsyncThresholdBytes: 1 << 40}
	router.POST("/api/pdf/merge", MergeHandler(service, opts))

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("unexpected content-type: %s", rec.Header().Get("Content-Type"))
	}
	if rec.Header().Get("X-Job-Id") != "job-123" {
		t.Fatalf("unexpected X-Job-Id: %s", rec.Header().Get("X-Job-Id"))
	}
	if !bytes.Equal(rec.Body.Bytes(), pdfData) {
		t.Fatalf("unexpected response body: %q", rec.Body.Bytes())
	}

	if _, err := os.Stat(jobDir); !os.IsNotExist(err) {
		t.Fatalf("expected jobDir to be cleaned up, stat err=%v", err)
	}
	if !service.runCalled {
		t.Fatalf("expected RunJob to be called")
	}
}

func TestMergeHandlerLimitExceeded(t *testing.T) {
	gin.SetMode(gin.TestMode)

	service := &stubMergeService{
		prepareErr: &Error{Code: "LIMIT_EXCEEDED", Message: "サイズ上限を超えています"},
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
	router.POST("/api/pdf/merge", MergeHandler(service, HandlerOptions{}))

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

func TestMergeHandlerAsync(t *testing.T) {
	gin.SetMode(gin.TestMode)

	manifest := &JobManifest{
		JobID:     "job-async",
		Operation: OperationMerge,
		Files:     []JobFile{{StoredName: "00.pdf", Size: 200, Pages: 10}},
	}

	service := &stubMergeService{manifest: manifest}
	scheduler := &stubScheduler{}

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
	opts := HandlerOptions{
		Scheduler:           scheduler,
		AsyncThresholdBytes: 100,
	}
	router.POST("/api/pdf/merge", MergeHandler(service, opts))

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("unexpected status: %d", rec.Code)
	}

	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if payload["jobId"] != "job-async" {
		t.Fatalf("unexpected jobId: %s", payload["jobId"])
	}
	if scheduler.calls != 1 || scheduler.jobID != "job-async" {
		t.Fatalf("scheduler not called correctly: %#v", scheduler)
	}
	if service.runCalled {
		t.Fatalf("RunJob should not be called for async path")
	}
}

func TestMergeHandlerAsyncScheduleFails(t *testing.T) {
	gin.SetMode(gin.TestMode)

	manifest := &JobManifest{
		JobID:     "job-async-fail",
		Operation: OperationMerge,
		Files:     []JobFile{{StoredName: "00.pdf", Size: 200, Pages: 10}},
	}

	service := &stubMergeService{manifest: manifest}
	scheduler := &stubScheduler{err: errors.New("scheduler offline")}

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
	opts := HandlerOptions{
		Scheduler:           scheduler,
		AsyncThresholdBytes: 100,
	}
	router.POST("/api/pdf/merge", MergeHandler(service, opts))

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
	if scheduler.calls != 1 {
		t.Fatalf("scheduler should be called once, got %d", scheduler.calls)
	}
	if len(service.discardIDs) != 1 || service.discardIDs[0] != "job-async-fail" {
		t.Fatalf("expected DiscardJob to be called for job-async-fail, got %#v", service.discardIDs)
	}
	if service.runCalled {
		t.Fatalf("RunJob should not be called when scheduling fails")
	}
}
