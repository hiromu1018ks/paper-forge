package pdf

import (
	"context"
	"fmt"
)

// RunJob はジョブIDに対応するPDF処理を実行します。
func (s *Service) RunJob(ctx context.Context, jobID string, reporter ProgressReporter) (*Result, error) {
	if jobID == "" {
		return nil, fmt.Errorf("jobID is required")
	}
	ws := s.workspaceFor(jobID)
	manifest, err := loadManifest(ws.dir)
	if err != nil {
		_ = removeDir(ws.dir)
		return nil, err
	}
	if manifest.Operation == "" {
		_ = removeDir(ws.dir)
		return nil, fmt.Errorf("manifest missing operation")
	}

	stored := storedFilesFromManifest(ws.dir, manifest)
	if len(stored) == 0 {
		_ = removeDir(ws.dir)
		return nil, fmt.Errorf("manifest has no input files")
	}

	var (
		result *Result
		runErr error
	)

	switch manifest.Operation {
	case OperationMerge:
		state := &mergeState{ws: ws, storedFiles: stored}
		result, runErr = s.executeMerge(ctx, state, manifest.Order, reporter)
	case OperationReorder:
		state := &reorderState{ws: ws, file: stored[0]}
		result, runErr = s.executeReorder(ctx, state, manifest.Order, reporter)
	case OperationSplit:
		state := &splitState{
			ws:        ws,
			file:      stored[0],
			rangesRaw: manifest.Ranges,
		}
		result, runErr = s.executeSplit(ctx, state, reporter)
	case OperationOptimize:
		state := &optimizeState{
			ws:     ws,
			file:   stored[0],
			preset: manifest.Preset,
		}
		result, runErr = s.executeOptimize(ctx, state, reporter)
	default:
		_ = removeDir(ws.dir)
		return nil, fmt.Errorf("unsupported operation: %s", manifest.Operation)
	}

	if runErr != nil {
		if cleanupErr := removeDir(ws.dir); cleanupErr != nil {
			runErr = fmt.Errorf("%w (ワークスペースの削除にも失敗しました: %v)", runErr, cleanupErr)
		}
		return nil, runErr
	}

	return result, nil
}
