package pdf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// JobRunner はジョブを実行できるサービスが実装します。
type JobRunner interface {
	RunJob(ctx context.Context, jobID string, reporter ProgressReporter) (*Result, error)
	DiscardJob(jobID string) error
}

// MergeService は結合ジョブの準備と実行を提供します。
type MergeService interface {
	JobRunner
	PrepareMergeJob(ctx context.Context, files []*multipart.FileHeader, order []int) (*JobManifest, error)
}

// ReorderService はページ順入替ジョブの準備と実行を提供します。
type ReorderService interface {
	JobRunner
	PrepareReorderJob(ctx context.Context, file *multipart.FileHeader, order []int) (*JobManifest, error)
}

// SplitService は分割ジョブの準備と実行を提供します。
type SplitService interface {
	JobRunner
	PrepareSplitJob(ctx context.Context, file *multipart.FileHeader, rangesExpr string) (*JobManifest, error)
}

// OptimizeService は圧縮ジョブの準備と実行を提供します。
type OptimizeService interface {
	JobRunner
	PrepareOptimizeJob(ctx context.Context, file *multipart.FileHeader, preset OptimizePreset) (*JobManifest, error)
}

// JobScheduler はジョブを非同期キューに投入するためのインターフェースです。
type JobScheduler interface {
	Schedule(ctx context.Context, op OperationType, jobID string) error
}

// HandlerOptions は同期/非同期切り替えのための設定です。
type HandlerOptions struct {
	Scheduler           JobScheduler
	AsyncThresholdBytes int64
	AsyncThresholdPages int
}

// MergeHandler は POST /api/pdf/merge のハンドラーを返します。
func MergeHandler(svc MergeService, opts HandlerOptions) gin.HandlerFunc {
	return func(c *gin.Context) {
		form, err := c.MultipartForm()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": "multipart/form-data でPDFファイルを送信してください。",
			})
			return
		}
		defer form.RemoveAll()

		files := form.File["files[]"]
		if len(files) == 0 {
			files = form.File["files"]
		}
		if len(files) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": "アップロードされたPDFファイルが見つかりません。",
			})
			return
		}

		order, err := parseOrder(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": err.Error(),
			})
			return
		}

		manifest, err := svc.PrepareMergeJob(c.Request.Context(), files, order)
		if err != nil {
			respondWithError(c, err)
			return
		}

		if shouldProcessAsync(manifest, opts) {
			if err := opts.Scheduler.Schedule(c.Request.Context(), manifest.Operation, manifest.JobID); err != nil {
				if cleanupErr := svc.DiscardJob(manifest.JobID); cleanupErr != nil {
					err = fmt.Errorf("%w (cleanup failed: %v)", err, cleanupErr)
				}
				respondWithError(c, err)
				return
			}
			c.JSON(http.StatusAccepted, gin.H{"jobId": manifest.JobID})
			return
		}

		result, err := svc.RunJob(c.Request.Context(), manifest.JobID, nil)
		if err != nil {
			respondWithError(c, err)
			return
		}
		defer result.Cleanup()

		if err := streamResult(c, result, "結合結果の読み込みに失敗しました"); err != nil {
			respondWithError(c, err)
		}
	}
}

// ReorderHandler は POST /api/pdf/reorder のハンドラーを返します。
func ReorderHandler(svc ReorderService, opts HandlerOptions) gin.HandlerFunc {
	return func(c *gin.Context) {
		form, err := c.MultipartForm()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": "multipart/form-data でPDFファイルを送信してください。",
			})
			return
		}
		defer form.RemoveAll()

		file, err := extractSingleFile(form)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": err.Error(),
			})
			return
		}

		order, err := parseOrder(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": err.Error(),
			})
			return
		}

		manifest, err := svc.PrepareReorderJob(c.Request.Context(), file, order)
		if err != nil {
			respondWithError(c, err)
			return
		}

		if shouldProcessAsync(manifest, opts) {
			if err := opts.Scheduler.Schedule(c.Request.Context(), manifest.Operation, manifest.JobID); err != nil {
				if cleanupErr := svc.DiscardJob(manifest.JobID); cleanupErr != nil {
					err = fmt.Errorf("%w (cleanup failed: %v)", err, cleanupErr)
				}
				respondWithError(c, err)
				return
			}
			c.JSON(http.StatusAccepted, gin.H{"jobId": manifest.JobID})
			return
		}

		result, err := svc.RunJob(c.Request.Context(), manifest.JobID, nil)
		if err != nil {
			respondWithError(c, err)
			return
		}
		defer result.Cleanup()

		if err := streamResult(c, result, "ページ順入替結果の読み込みに失敗しました"); err != nil {
			respondWithError(c, err)
		}
	}
}

// SplitHandler は POST /api/pdf/split のハンドラーを返します。
func SplitHandler(svc SplitService, opts HandlerOptions) gin.HandlerFunc {
	return func(c *gin.Context) {
		form, err := c.MultipartForm()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": "multipart/form-data でPDFファイルを送信してください。",
			})
			return
		}
		defer form.RemoveAll()

		file, err := extractSingleFile(form)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": err.Error(),
			})
			return
		}

		rangesExpr := strings.TrimSpace(c.PostForm("ranges"))
		if rangesExpr == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": "分割するページ範囲を指定してください。",
			})
			return
		}

		manifest, err := svc.PrepareSplitJob(c.Request.Context(), file, rangesExpr)
		if err != nil {
			respondWithError(c, err)
			return
		}

		if shouldProcessAsync(manifest, opts) {
			if err := opts.Scheduler.Schedule(c.Request.Context(), manifest.Operation, manifest.JobID); err != nil {
				if cleanupErr := svc.DiscardJob(manifest.JobID); cleanupErr != nil {
					err = fmt.Errorf("%w (cleanup failed: %v)", err, cleanupErr)
				}
				respondWithError(c, err)
				return
			}
			c.JSON(http.StatusAccepted, gin.H{"jobId": manifest.JobID})
			return
		}

		result, err := svc.RunJob(c.Request.Context(), manifest.JobID, nil)
		if err != nil {
			respondWithError(c, err)
			return
		}
		defer result.Cleanup()

		if err := streamResult(c, result, "分割結果の読み込みに失敗しました"); err != nil {
			respondWithError(c, err)
		}
	}
}

// OptimizeHandler は POST /api/pdf/optimize のハンドラーを返します。
func OptimizeHandler(svc OptimizeService, opts HandlerOptions) gin.HandlerFunc {
	return func(c *gin.Context) {
		form, err := c.MultipartForm()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": "multipart/form-data でPDFファイルを送信してください。",
			})
			return
		}
		defer form.RemoveAll()

		file, err := extractSingleFile(form)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": err.Error(),
			})
			return
		}

		preset := OptimizePreset(strings.TrimSpace(c.PostForm("preset")))

		manifest, err := svc.PrepareOptimizeJob(c.Request.Context(), file, preset)
		if err != nil {
			respondWithError(c, err)
			return
		}

		if shouldProcessAsync(manifest, opts) {
			if err := opts.Scheduler.Schedule(c.Request.Context(), manifest.Operation, manifest.JobID); err != nil {
				if cleanupErr := svc.DiscardJob(manifest.JobID); cleanupErr != nil {
					err = fmt.Errorf("%w (cleanup failed: %v)", err, cleanupErr)
				}
				respondWithError(c, err)
				return
			}
			c.JSON(http.StatusAccepted, gin.H{"jobId": manifest.JobID})
			return
		}

		result, err := svc.RunJob(c.Request.Context(), manifest.JobID, nil)
		if err != nil {
			respondWithError(c, err)
			return
		}
		defer result.Cleanup()

		if err := streamResult(c, result, "圧縮結果の読み込みに失敗しました"); err != nil {
			respondWithError(c, err)
		}
	}
}

func shouldProcessAsync(manifest *JobManifest, opts HandlerOptions) bool {
	if manifest == nil || opts.Scheduler == nil {
		return false
	}

	if opts.AsyncThresholdBytes > 0 {
		var total int64
		for _, f := range manifest.Files {
			total += f.Size
		}
		if total > opts.AsyncThresholdBytes {
			return true
		}
	}

	if opts.AsyncThresholdPages > 0 {
		var total int
		for _, f := range manifest.Files {
			total += f.Pages
		}
		if total > opts.AsyncThresholdPages {
			return true
		}
	}

	return false
}

func parseOrder(c *gin.Context) ([]int, error) {
	raw := strings.TrimSpace(c.PostForm("order"))
	if raw != "" {
		var order []int
		if err := json.Unmarshal([]byte(raw), &order); err != nil {
			return nil, errors.New("order は JSON 形式の整数配列で指定してください。例: [0,1,2]")
		}
		return order, nil
	}

	if values := c.PostFormArray("order[]"); len(values) > 0 {
		order := make([]int, len(values))
		for i, v := range values {
			trimmed := strings.TrimSpace(v)
			if trimmed == "" {
				return nil, errors.New("order[] に空の値が含まれています。")
			}
			num, err := strconv.Atoi(trimmed)
			if err != nil {
				return nil, errors.New("order[] の値は整数で指定してください。")
			}
			order[i] = num
		}
		return order, nil
	}

	return nil, nil
}

func respondWithError(c *gin.Context, err error) {
	var apiErr *Error
	switch {
	case errors.As(err, &apiErr):
		status := http.StatusBadRequest
		if apiErr.Code == "LIMIT_EXCEEDED" {
			status = http.StatusRequestEntityTooLarge
		}
		c.JSON(status, gin.H{
			"code":    apiErr.Code,
			"message": apiErr.Message,
		})
	case errors.Is(err, context.Canceled):
		c.JSON(http.StatusRequestTimeout, gin.H{
			"code":    "REQUEST_CANCELED",
			"message": "リクエストがキャンセルされました。",
		})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "INTERNAL_ERROR",
			"message": "サーバー内部でエラーが発生しました。",
		})
	}
}

func extractSingleFile(form *multipart.Form) (*multipart.FileHeader, error) {
	if form == nil {
		return nil, errors.New("PDFファイルを選択してください。")
	}
	if file := form.File["file"]; len(file) > 0 {
		return file[0], nil
	}
	if file := form.File["file[]"]; len(file) > 0 {
		return file[0], nil
	}
	files := form.File["files"]
	if len(files) > 0 {
		return files[0], nil
	}
	if alt := form.File["files[]"]; len(alt) > 0 {
		return alt[0], nil
	}
	return nil, errors.New("PDFファイルを選択してください。")
}

func streamResult(c *gin.Context, result *Result, readErrMsg string) error {
	file, err := os.Open(result.OutputPath)
	if err != nil {
		return fmt.Errorf("%s: %w", readErrMsg, err)
	}
	defer file.Close()

	contentType := "application/octet-stream"
	switch result.ResultKind {
	case ResultKindPDF:
		contentType = "application/pdf"
	case ResultKindZIP:
		contentType = "application/zip"
	}

	encodedName := url.PathEscape(result.OutputFilename)
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", result.OutputFilename, encodedName))
	c.Header("Cache-Control", "no-store")
	c.Header("X-Job-Id", result.JobID)
	c.DataFromReader(http.StatusOK, result.OutputSize, contentType, file, nil)
	return nil
}
