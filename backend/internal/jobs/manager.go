package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"

	"github.com/hibiken/asynq"

	"github.com/yourusername/paper-forge/internal/config"
	"github.com/yourusername/paper-forge/internal/pdf"
)

const (
	taskTypePDF = "pdf:process"
)

// Manager はジョブの投入と状態管理を担います。
type Manager struct {
	cfg        *config.Config
	client     *asynq.Client
	server     *asynq.Server
	mux        *asynq.ServeMux
	store      *Store
	pdfService *pdf.Service
	logger     *log.Logger
}

// TaskPayload はPDF操作ジョブのペイロードです。
type TaskPayload struct {
	JobID     string            `json:"jobId"`
	Operation pdf.OperationType `json:"operation"`
}

// NewManager は Manager を初期化します。
func NewManager(cfg *config.Config, pdfService *pdf.Service, store *Store, logger *log.Logger) (*Manager, error) {
	if cfg == nil {
		return nil, errors.New("config is nil")
	}
	if pdfService == nil {
		return nil, errors.New("pdfService is nil")
	}
	if store == nil {
		return nil, errors.New("store is nil")
	}
	opt, err := asynq.ParseRedisURI(cfg.QueueRedisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse redis url: %w", err)
	}

	client := asynq.NewClient(opt)
	server := asynq.NewServer(
		opt,
		asynq.Config{
			Concurrency: 4,
			Queues: map[string]int{
				"pdf": 1,
			},
		},
	)

	mux := asynq.NewServeMux()
	manager := &Manager{
		cfg:        cfg,
		client:     client,
		server:     server,
		mux:        mux,
		store:      store,
		pdfService: pdfService,
		logger:     logger,
	}
	mux.HandleFunc(taskTypePDF, manager.handlePDFTask)
	return manager, nil
}

// StartWorkers は Asynq サーバーをバックグラウンドで起動します。
func (m *Manager) StartWorkers() {
	go func() {
		if err := m.server.Run(m.mux); err != nil && err != asynq.ErrServerClosed {
			if m.logger != nil {
				m.logger.Printf("asynq server stopped with error: %v", err)
			} else {
				log.Printf("asynq server stopped with error: %v", err)
			}
		}
	}()
}

// Shutdown はサーバーとクライアントを閉じます。
func (m *Manager) Shutdown(ctx context.Context) error {
	m.server.Shutdown()
	m.client.Close()
	return nil
}

// Enqueue はジョブをキューに投入します。
func (m *Manager) Enqueue(ctx context.Context, payload *TaskPayload) (string, error) {
	if payload == nil {
		return "", fmt.Errorf("payload is nil")
	}
	if payload.JobID == "" {
		return "", fmt.Errorf("payload.JobID is required")
	}

	record := &Record{
		JobID:     payload.JobID,
		Operation: string(payload.Operation),
		Status:    StatusQueued,
		Progress: ProgressInfo{
			Percent: 0,
			Stage:   "queued",
		},
	}
	if err := m.store.Upsert(ctx, record); err != nil {
		return "", err
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	task := asynq.NewTask(taskTypePDF, body, asynq.Queue("pdf"))
	info, err := m.client.EnqueueContext(ctx, task, asynq.MaxRetry(1))
	if err != nil {
		return "", err
	}
	return info.ID, nil
}

// UpdateProgress は進捗を保存します。
func (m *Manager) UpdateProgress(ctx context.Context, jobID string, percent int, stage string) {
	if err := m.store.UpdateProgress(ctx, jobID, ProgressInfo{
		Percent: percent,
		Stage:   stage,
	}); err != nil && m.logger != nil {
		m.logger.Printf("failed to update progress job=%s: %v", jobID, err)
	}
}

// GetRecord はジョブ情報を取得します。
func (m *Manager) GetRecord(ctx context.Context, jobID string) (*Record, error) {
	return m.store.Get(ctx, jobID)
}

func (m *Manager) handlePDFTask(ctx context.Context, task *asynq.Task) error {
	var payload TaskPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return err
	}

	if payload.JobID == "" {
		return fmt.Errorf("missing jobId in payload")
	}

	if err := m.store.Upsert(ctx, &Record{
		JobID:     payload.JobID,
		Operation: string(payload.Operation),
		Status:    StatusRunning,
		Progress: ProgressInfo{
			Percent: 0,
			Stage:   "load",
		},
	}); err != nil {
		return err
	}

	result, err := m.pdfService.RunJob(ctx, payload.JobID, func(stage string, percent int) {
		_ = m.store.UpdateProgress(ctx, payload.JobID, ProgressInfo{
			Stage:   stage,
			Percent: percent,
		})
	})
	if err != nil {
		return m.failJobWithError(ctx, payload.JobID, err)
	}
	return m.finishJob(ctx, payload.JobID, result)
}

func (m *Manager) finishJob(ctx context.Context, jobID string, result *pdf.Result) error {
	if result == nil {
		return fmt.Errorf("result is nil")
	}
	downloadURL := m.buildDownloadURL(result)
	if err := m.store.MarkDone(ctx, jobID, downloadURL, result.Meta); err != nil {
		return err
	}
	return nil
}

func (m *Manager) failJob(ctx context.Context, jobID, code, message string) error {
	if err := m.store.MarkFailed(ctx, jobID, &ErrorInfo{
		Code:    code,
		Message: message,
	}); err != nil {
		return err
	}
	return nil
}

func (m *Manager) failJobWithError(ctx context.Context, jobID string, err error) error {
	var apiErr *pdf.Error
	if errors.As(err, &apiErr) {
		return m.failJob(ctx, jobID, apiErr.Code, apiErr.Message)
	}
	return m.failJob(ctx, jobID, "INTERNAL_ERROR", err.Error())
}

func (m *Manager) buildDownloadURL(result *pdf.Result) string {
	base := m.cfg.JobResultBaseURL
	if base == "" {
		return fmt.Sprintf("/api/jobs/%s/download", result.JobID)
	}
	return fmt.Sprintf("%s/%s/%s", strings.TrimRight(base, "/"), result.JobID, url.PathEscape(result.OutputFilename))
}
