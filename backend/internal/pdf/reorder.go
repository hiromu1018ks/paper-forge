package pdf

import (
	"context"
	"fmt"
	"mime/multipart"
	"os"
	"path/filepath"
	"strconv"
	"time"

	pdfapi "github.com/pdfcpu/pdfcpu/pkg/api"
)

const reorderFilename = "reordered.pdf"

// ReorderMultipart は単一PDFのページ順入替を実行します。
func (s *Service) ReorderMultipart(ctx context.Context, file *multipart.FileHeader, order []int) (_ *Result, err error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if file == nil {
		return nil, newError("INVALID_INPUT", "PDFファイルを選択してください。", nil)
	}
	if len(order) == 0 {
		return nil, newError("INVALID_INPUT", "ページの順序を指定してください。", nil)
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	state, _, err := s.prepareReorder(ctx, file, order)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = removeDir(state.ws.dir)
		}
	}()

	result, execErr := s.executeReorder(ctx, state, order, nil)
	if execErr != nil {
		return nil, execErr
	}
	return result, nil
}

type reorderState struct {
	ws   workspace
	file storedFile
}

func (s *Service) prepareReorder(ctx context.Context, file *multipart.FileHeader, order []int) (*reorderState, *JobManifest, error) {
	ws, err := s.createWorkspace()
	if err != nil {
		return nil, nil, err
	}

	stored, err := s.storeMultipartFile(ctx, file, ws.inDir, 0)
	if err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, err
	}

	if err := validateOrder(order, stored.pages); err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, err
	}

	manifest := &JobManifest{
		JobID:     ws.jobID,
		Operation: OperationReorder,
		Files:     toJobFiles([]storedFile{stored}),
		Order:     append([]int(nil), order...),
		CreatedAt: s.now().UTC(),
	}
	if err := writeManifest(ws.dir, manifest); err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, fmt.Errorf("ジョブマニフェストの保存に失敗しました: %w", err)
	}

	return &reorderState{ws: ws, file: stored}, manifest, nil
}

func (s *Service) executeReorder(ctx context.Context, state *reorderState, order []int, progress ProgressReporter) (*Result, error) {
	ws := state.ws
	stored := state.file

	selectedPages := make([]string, len(order))
	for i, idx := range order {
		selectedPages[i] = strconv.Itoa(idx + 1)
	}

	reportProgress(progress, "process", 40)
	outputPath := filepath.Join(ws.outDir, reorderFilename)
	if err := pdfapi.CollectFile(stored.path, outputPath, selectedPages, nil); err != nil {
		return nil, newError("UNSUPPORTED_PDF", "PDFのページ入替に失敗しました。ファイルが破損していないか確認してください。", err)
	}
	reportProgress(progress, "write", 80)

	outInfo, err := os.Stat(outputPath)
	if err != nil {
		return nil, fmt.Errorf("出力ファイルの確認に失敗しました: %w", err)
	}

	sourceMeta := SourceFileMeta{
		Name:  stored.originalName,
		Size:  stored.size,
		Pages: stored.pages,
	}

	meta := struct {
		Type      OperationType  `json:"type"`
		CreatedAt string         `json:"createdAt"`
		Source    SourceFileMeta `json:"source"`
		Order     []int          `json:"order"`
		Output    string         `json:"output"`
		Pages     int            `json:"pages"`
	}{
		Type:      OperationReorder,
		CreatedAt: s.now().UTC().Format(time.RFC3339),
		Source:    sourceMeta,
		Order:     append([]int(nil), order...),
		Output:    reorderFilename,
		Pages:     stored.pages,
	}

	metaPath := filepath.Join(ws.dir, "meta.json")
	if err := writeJSON(metaPath, meta); err != nil {
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
		Operation:      OperationReorder,
		OutputPath:     outputPath,
		OutputFilename: reorderFilename,
		OutputSize:     outInfo.Size(),
		ResultKind:     ResultKindPDF,
		Meta: &ReorderMeta{
			Original: sourceMeta,
			Order:    append([]int(nil), order...),
		},
		jobDir: ws.dir,
	}, nil
}

// PrepareReorderJob は非同期ジョブ用に入力を保存します。
func (s *Service) PrepareReorderJob(ctx context.Context, file *multipart.FileHeader, order []int) (*JobManifest, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	_, manifest, err := s.prepareReorder(ctx, file, order)
	if err != nil {
		return nil, err
	}
	return manifest, nil
}

func validateOrder(order []int, pageCount int) error {
	if len(order) != pageCount {
		return newError("INVALID_INPUT", "order配列の長さがページ数と一致していません。", nil)
	}

	seen := make([]bool, pageCount)
	for _, idx := range order {
		if idx < 0 || idx >= pageCount {
			return newError("INVALID_INPUT", "order配列に不正なページ番号が含まれています。", nil)
		}
		if seen[idx] {
			return newError("INVALID_INPUT", "order配列に重複した番号が含まれています。", nil)
		}
		seen[idx] = true
	}

	return nil
}
