package jobs

import "time"

// Status はジョブの実行状態を表します。
type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusSucceeded Status = "done"
	StatusFailed    Status = "error"
)

// ProgressInfo は進捗の補足情報を表します。
type ProgressInfo struct {
	Percent int    `json:"percent"`
	Stage   string `json:"stage,omitempty"`
	Message string `json:"message,omitempty"`
}

// ErrorInfo はジョブ失敗時のエラー情報を保持します。
type ErrorInfo struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Record はジョブの現在状態を表します。
type Record struct {
	JobID       string       `json:"jobId"`
	Operation   string       `json:"operation"`
	Status      Status       `json:"status"`
	Progress    ProgressInfo `json:"progress"`
	DownloadURL string       `json:"downloadUrl,omitempty"`
	Meta        any          `json:"meta,omitempty"`
	Error       *ErrorInfo   `json:"error,omitempty"`
	CreatedAt   time.Time    `json:"createdAt"`
	UpdatedAt   time.Time    `json:"updatedAt"`
	ExpiresAt   time.Time    `json:"expiresAt"`
}
