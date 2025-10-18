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

// MergeService は PDF 結合サービスのインターフェースです。
type MergeService interface {
	MergeMultipart(ctx context.Context, files []*multipart.FileHeader, order []int) (*MergeResult, error)
}

// MergeHandler は POST /api/pdf/merge のハンドラーを返します。
func MergeHandler(svc MergeService) gin.HandlerFunc {
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

		result, err := svc.MergeMultipart(c.Request.Context(), files, order)
		if err != nil {
			respondWithError(c, err)
			return
		}
		defer result.Cleanup()

		file, err := os.Open(result.OutputPath)
		if err != nil {
			respondWithError(c, fmt.Errorf("結合結果の読み込みに失敗しました: %w", err))
			return
		}
		defer file.Close()

		encodedName := url.PathEscape(result.OutputFilename)
		c.Header("Content-Type", "application/pdf")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", result.OutputFilename, encodedName))
		c.Header("Cache-Control", "no-store")
		c.Header("X-Job-Id", result.JobID)
		c.DataFromReader(http.StatusOK, result.OutputSize, "application/pdf", file, nil)
	}
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
