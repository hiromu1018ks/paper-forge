package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	redis "github.com/redis/go-redis/v9"

	"github.com/yourusername/paper-forge/internal/config"
	"github.com/yourusername/paper-forge/internal/jobs"
	"github.com/yourusername/paper-forge/internal/pdf"
)

type pdfJobScheduler struct {
	manager *jobs.Manager
}

func (s *pdfJobScheduler) Schedule(ctx context.Context, op pdf.OperationType, jobID string) error {
	_, err := s.manager.Enqueue(ctx, &jobs.TaskPayload{
		JobID:     jobID,
		Operation: op,
	})
	return err
}

func setupJobs(cfg *config.Config, pdfService *pdf.Service) (*jobs.Manager, error) {
	opt, err := redis.ParseURL(cfg.QueueRedisURL)
	if err != nil {
		return nil, err
	}

	redisClient := redis.NewClient(opt)
	ttlMinutes := cfg.JobExpireMinutes
	if ttlMinutes <= 0 {
		ttlMinutes = 10
	}
	store := jobs.NewStore(redisClient, time.Duration(ttlMinutes)*time.Minute)
	manager, err := jobs.NewManager(cfg, pdfService, store, log.Default())
	if err != nil {
		return nil, err
	}
	return manager, nil
}

func jobStatusHandler(manager *jobs.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		jobID := c.Param("id")
		if strings.TrimSpace(jobID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": "jobId を指定してください。",
			})
			return
		}

		record, err := manager.GetRecord(c.Request.Context(), jobID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":    "INTERNAL_ERROR",
				"message": "ジョブ情報の取得に失敗しました。",
			})
			return
		}
		if record == nil {
			c.JSON(http.StatusNotFound, gin.H{
				"code":    "JOB_NOT_FOUND",
				"message": "指定されたジョブは存在しません。",
			})
			return
		}

		payload := gin.H{
			"jobId":     record.JobID,
			"operation": record.Operation,
			"status":    record.Status,
			"progress": gin.H{
				"percent": record.Progress.Percent,
				"stage":   record.Progress.Stage,
				"message": record.Progress.Message,
			},
			"updatedAt": record.UpdatedAt,
		}
		if record.DownloadURL != "" {
			payload["downloadUrl"] = record.DownloadURL
		}
		if record.Meta != nil {
			payload["meta"] = record.Meta
		}
		if record.Error != nil {
			payload["error"] = record.Error
		}

		c.JSON(http.StatusOK, payload)
	}
}

func jobDownloadHandler(pdfService *pdf.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		jobID := c.Param("id")
		if strings.TrimSpace(jobID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":    "INVALID_INPUT",
				"message": "jobId を指定してください。",
			})
			return
		}

		result, file, err := pdfService.OpenResultFile(jobID)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				c.JSON(http.StatusNotFound, gin.H{
					"code":    "JOB_RESULT_NOT_FOUND",
					"message": "ジョブの成果物が見つかりませんでした。",
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":    "INTERNAL_ERROR",
				"message": "ジョブの成果物取得に失敗しました。",
			})
			return
		}
		defer file.Close()

		contentType := "application/octet-stream"
		switch result.ResultKind {
		case pdf.ResultKindPDF:
			contentType = "application/pdf"
		case pdf.ResultKindZIP:
			contentType = "application/zip"
		}

		encodedName := url.PathEscape(result.OutputFilename)
		c.Header("Content-Type", contentType)
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", result.OutputFilename, encodedName))
		c.Header("Cache-Control", "no-store")
		c.Header("X-Job-Id", result.JobID)
		c.DataFromReader(http.StatusOK, result.OutputSize, contentType, file, nil)
	}
}
