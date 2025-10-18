package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	jobKeyPrefix = "job:"
)

// Store はジョブ状態を Redis に保存します。
type Store struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewStore は Store を作成します。
func NewStore(rdb *redis.Client, ttl time.Duration) *Store {
	return &Store{
		rdb: rdb,
		ttl: ttl,
	}
}

// Get はジョブ情報を取得します。
func (s *Store) Get(ctx context.Context, jobID string) (*Record, error) {
	if jobID == "" {
		return nil, fmt.Errorf("jobID is required")
	}
	data, err := s.rdb.Get(ctx, jobKey(jobID)).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}
	var record Record
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, err
	}
	return &record, nil
}

// Upsert はジョブ情報を保存します（存在しない場合は作成）。
func (s *Store) Upsert(ctx context.Context, record *Record) error {
	if record == nil {
		return fmt.Errorf("record is nil")
	}
	now := time.Now().UTC()
	if record.CreatedAt.IsZero() {
		record.CreatedAt = now
	}
	record.UpdatedAt = now
	if record.ExpiresAt.IsZero() && s.ttl > 0 {
		record.ExpiresAt = record.CreatedAt.Add(s.ttl)
	}

	payload, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, jobKey(record.JobID), payload, s.ttl).Err()
}

// UpdateProgress は進捗を更新します。
func (s *Store) UpdateProgress(ctx context.Context, jobID string, progress ProgressInfo) error {
	return s.updatePartial(ctx, jobID, func(record *Record) {
		record.Progress = progress
	})
}

// MarkDone はジョブ完了時の情報を保存します。
func (s *Store) MarkDone(ctx context.Context, jobID string, downloadURL string, meta any) error {
	return s.updatePartial(ctx, jobID, func(record *Record) {
		record.Status = StatusSucceeded
		record.Progress = ProgressInfo{
			Percent: 100,
			Stage:   "completed",
		}
		record.DownloadURL = downloadURL
		record.Meta = meta
		record.Error = nil
	})
}

// MarkFailed はジョブ失敗時の情報を保存します。
func (s *Store) MarkFailed(ctx context.Context, jobID string, errInfo *ErrorInfo) error {
	return s.updatePartial(ctx, jobID, func(record *Record) {
		record.Status = StatusFailed
		if errInfo != nil {
			record.Error = errInfo
		}
	})
}

func (s *Store) updatePartial(ctx context.Context, jobID string, mutate func(*Record)) error {
	key := jobKey(jobID)
	for {
		tx := s.rdb.TxPipeline()
		data, err := s.rdb.Get(ctx, key).Bytes()
		if err != nil {
			if err == redis.Nil {
				return fmt.Errorf("job not found: %s", jobID)
			}
			return err
		}
		var record Record
		if err := json.Unmarshal(data, &record); err != nil {
			return err
		}
		mutate(&record)
		record.UpdatedAt = time.Now().UTC()
		payload, err := json.Marshal(&record)
		if err != nil {
			return err
		}
		tx.Set(ctx, key, payload, s.ttl)
		_, err = tx.Exec(ctx)
		if err == redis.TxFailedErr {
			continue
		}
		return err
	}
}

func jobKey(id string) string {
	return jobKeyPrefix + id
}
