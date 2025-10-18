package pdf

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const optimizedFilename = "optimized.pdf"

// OptimizeMultipart は Ghostscript を利用してPDFを圧縮します。
func (s *Service) OptimizeMultipart(ctx context.Context, file *multipart.FileHeader, preset OptimizePreset) (_ *Result, err error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if file == nil {
		return nil, newError("INVALID_INPUT", "PDFファイルを選択してください。", nil)
	}

	preset, err = normalizePreset(preset)
	if err != nil {
		return nil, err
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	state, _, err := s.prepareOptimize(ctx, file, preset)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = removeDir(state.ws.dir)
		}
	}()

	result, execErr := s.executeOptimize(ctx, state, nil)
	if execErr != nil {
		return nil, execErr
	}
	return result, nil
}

type optimizeState struct {
	ws     workspace
	file   storedFile
	preset OptimizePreset
}

func (s *Service) prepareOptimize(ctx context.Context, file *multipart.FileHeader, preset OptimizePreset) (*optimizeState, *JobManifest, error) {
	ws, err := s.createWorkspace()
	if err != nil {
		return nil, nil, err
	}

	stored, err := s.storeMultipartFile(ctx, file, ws.inDir, 0)
	if err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, err
	}

	manifest := &JobManifest{
		JobID:     ws.jobID,
		Operation: OperationOptimize,
		Files:     toJobFiles([]storedFile{stored}),
		Preset:    preset,
		CreatedAt: s.now().UTC(),
	}
	if err := writeManifest(ws.dir, manifest); err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, fmt.Errorf("ジョブマニフェストの保存に失敗しました: %w", err)
	}

	return &optimizeState{ws: ws, file: stored, preset: preset}, manifest, nil
}

func (s *Service) executeOptimize(ctx context.Context, state *optimizeState, progress ProgressReporter) (*Result, error) {
	ws := state.ws
	stored := state.file

	reportProgress(progress, "process", 40)

	outputPath := filepath.Join(ws.outDir, optimizedFilename)
	if err := s.runGhostscript(ctx, stored.path, outputPath, state.preset); err != nil {
		return nil, err
	}

	reportProgress(progress, "write", 80)

	outInfo, err := os.Stat(outputPath)
	if err != nil {
		return nil, fmt.Errorf("圧縮後ファイルの確認に失敗しました: %w", err)
	}

	meta := &OptimizeMeta{
		OriginalSize: stored.size,
		OutputSize:   outInfo.Size(),
		SavedBytes:   stored.size - outInfo.Size(),
		SavedPercent: computeSavedPercent(stored.size, outInfo.Size()),
		Preset:       state.preset,
		Source: SourceFileMeta{
			Name:  stored.originalName,
			Size:  stored.size,
			Pages: stored.pages,
		},
	}

	metaPayload := struct {
		Type      OperationType `json:"type"`
		CreatedAt string        `json:"createdAt"`
		Preset    OptimizePreset
		Sizes     struct {
			Before int64   `json:"before"`
			After  int64   `json:"after"`
			Saved  int64   `json:"saved"`
			Ratio  float64 `json:"ratio"`
		} `json:"sizes"`
		Source SourceFileMeta `json:"source"`
	}{
		Type:      OperationOptimize,
		CreatedAt: s.now().UTC().Format(time.RFC3339),
		Preset:    state.preset,
	}
	metaPayload.Sizes.Before = stored.size
	metaPayload.Sizes.After = outInfo.Size()
	metaPayload.Sizes.Saved = meta.SavedBytes
	metaPayload.Sizes.Ratio = meta.SavedPercent
	metaPayload.Source = meta.Source

	metaPath := filepath.Join(ws.dir, "meta.json")
	if err := writeJSON(metaPath, metaPayload); err != nil {
		return nil, fmt.Errorf("メタデータの保存に失敗しました: %w", err)
	}

	expireMinutes := s.cfg.JobExpireMinutes
	if expireMinutes <= 0 {
		expireMinutes = defaultCleanupMin
	}
	time.AfterFunc(time.Duration(expireMinutes)*time.Minute, func() {
		_ = removeDir(ws.dir)
	})

	reportProgress(progress, "completed", 100)

	return &Result{
		JobID:          ws.jobID,
		Operation:      OperationOptimize,
		OutputPath:     outputPath,
		OutputFilename: optimizedFilename,
		OutputSize:     outInfo.Size(),
		ResultKind:     ResultKindPDF,
		Meta:           meta,
		jobDir:         ws.dir,
	}, nil
}

// PrepareOptimizeJob は非同期ジョブを準備します。
func (s *Service) PrepareOptimizeJob(ctx context.Context, file *multipart.FileHeader, preset OptimizePreset) (*JobManifest, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	preset, err := normalizePreset(preset)
	if err != nil {
		return nil, err
	}
	_, manifest, err := s.prepareOptimize(ctx, file, preset)
	if err != nil {
		return nil, err
	}
	return manifest, nil
}

func normalizePreset(p OptimizePreset) (OptimizePreset, error) {
	switch strings.ToLower(string(p)) {
	case "", string(OptimizePresetStandard):
		return OptimizePresetStandard, nil
	case string(OptimizePresetAggressive):
		return OptimizePresetAggressive, nil
	default:
		return "", newError("INVALID_INPUT", fmt.Sprintf("presetには standard または aggressive を指定してください (received: %s)", p), nil)
	}
}

func (s *Service) runGhostscript(ctx context.Context, inputPath, outputPath string, preset OptimizePreset) error {
	args := ghostscriptArgs(outputPath, inputPath, preset)

	cmd := exec.CommandContext(ctx, s.cfg.GhostscriptPath, args...)
	var stderr bytes.Buffer
	cmd.Stdout = &stderr
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return newError("UNSUPPORTED_PDF", fmt.Sprintf("Ghostscriptによる圧縮に失敗しました: %s", stderr.String()), err)
	}
	return nil
}

func ghostscriptArgs(outputPath, inputPath string, preset OptimizePreset) []string {
	setting := "/printer"
	if preset == OptimizePresetAggressive {
		setting = "/screen"
	}

	return []string{
		"-sDEVICE=pdfwrite",
		"-dCompatibilityLevel=1.5",
		"-dNOPAUSE",
		"-dQUIET",
		"-dBATCH",
		fmt.Sprintf("-dPDFSETTINGS=%s", setting),
		fmt.Sprintf("-sOutputFile=%s", outputPath),
		inputPath,
	}
}

func computeSavedPercent(before, after int64) float64 {
	if before == 0 {
		return 0
	}
	diff := float64(before-after) / float64(before) * 100
	return diff
}
