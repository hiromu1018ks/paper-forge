package pdf

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	pdfapi "github.com/pdfcpu/pdfcpu/pkg/api"
)

const splitFilename = "split.zip"

// SplitMultipart は範囲指定によるPDF分割を行います。
func (s *Service) SplitMultipart(ctx context.Context, file *multipart.FileHeader, rangesExpr string) (_ *Result, err error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if file == nil {
		return nil, newError("INVALID_INPUT", "PDFファイルを選択してください。", nil)
	}
	rangesExpr = strings.TrimSpace(rangesExpr)
	if rangesExpr == "" {
		return nil, newError("INVALID_INPUT", "分割するページ範囲を指定してください。", nil)
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	state, _, err := s.prepareSplit(ctx, file, rangesExpr)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = removeDir(state.ws.dir)
		}
	}()

	result, execErr := s.executeSplit(ctx, state, nil)
	if execErr != nil {
		return nil, execErr
	}
	return result, nil
}

type splitState struct {
	ws        workspace
	file      storedFile
	ranges    []PageRange
	rangesRaw string
}

func (s *Service) prepareSplit(ctx context.Context, file *multipart.FileHeader, rangesExpr string) (*splitState, *JobManifest, error) {
	ws, err := s.createWorkspace()
	if err != nil {
		return nil, nil, err
	}
	stored, err := s.storeMultipartFile(ctx, file, ws.inDir, 0)
	if err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, err
	}

	rangesParsed, err := parsePageRanges(rangesExpr, stored.pages)
	if err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, err
	}

	manifest := &JobManifest{
		JobID:     ws.jobID,
		Operation: OperationSplit,
		Files:     toJobFiles([]storedFile{stored}),
		Ranges:    rangesExpr,
		CreatedAt: s.now().UTC(),
	}
	if err := writeManifest(ws.dir, manifest); err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, fmt.Errorf("ジョブマニフェストの保存に失敗しました: %w", err)
	}

	return &splitState{ws: ws, file: stored, ranges: rangesParsed, rangesRaw: rangesExpr}, manifest, nil
}

func (s *Service) executeSplit(ctx context.Context, state *splitState, progress ProgressReporter) (*Result, error) {
	ws := state.ws
	stored := state.file
	ranges := state.ranges
	if ranges == nil {
		parsed, err := parsePageRanges(state.rangesRaw, stored.pages)
		if err != nil {
			return nil, err
		}
		ranges = parsed
	}

	partsMeta := make([]SplitPart, 0, len(ranges))
	partPaths := make([]string, 0, len(ranges))

	for i, pr := range ranges {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		pageSelection := buildPageSelection(pr)
		partName := fmt.Sprintf("part-%02d.pdf", i+1)
		partPath := filepath.Join(ws.outDir, partName)

		reportProgress(progress, "process", 20+(60*(i+1))/len(ranges))

		if err := pdfapi.CollectFile(stored.path, partPath, pageSelection, nil); err != nil {
			return nil, newError("UNSUPPORTED_PDF", fmt.Sprintf("ページ範囲 %d の生成に失敗しました。", i+1), err)
		}

		info, statErr := os.Stat(partPath)
		if statErr != nil {
			return nil, fmt.Errorf("partファイルの確認に失敗しました: %w", statErr)
		}

		partsMeta = append(partsMeta, SplitPart{
			Filename: partName,
			FromPage: pr.Start,
			ToPage:   pr.End,
			Pages:    pr.End - pr.Start + 1,
			Size:     info.Size(),
		})
		partPaths = append(partPaths, partPath)
	}

	outputPath := filepath.Join(ws.outDir, splitFilename)
	if err := createZip(outputPath, partPaths); err != nil {
		return nil, err
	}
	reportProgress(progress, "write", 90)

	outInfo, err := os.Stat(outputPath)
	if err != nil {
		return nil, fmt.Errorf("zipファイルの確認に失敗しました: %w", err)
	}

	sourceMeta := SourceFileMeta{
		Name:  stored.originalName,
		Size:  stored.size,
		Pages: stored.pages,
	}

	meta := struct {
		Type      OperationType `json:"type"`
		CreatedAt string        `json:"createdAt"`
		Source    SourceFileMeta
		Ranges    []PageRange `json:"ranges"`
		Parts     []SplitPart `json:"parts"`
	}{
		Type:      OperationSplit,
		CreatedAt: s.now().UTC().Format(time.RFC3339),
		Source:    sourceMeta,
		Ranges:    ranges,
		Parts:     partsMeta,
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
		Operation:      OperationSplit,
		OutputPath:     outputPath,
		OutputFilename: splitFilename,
		OutputSize:     outInfo.Size(),
		ResultKind:     ResultKindZIP,
		Meta: &SplitMeta{
			Original: sourceMeta,
			Ranges:   ranges,
			Parts:    partsMeta,
		},
		jobDir: ws.dir,
	}, nil
}

// PrepareSplitJob は非同期ジョブ用に入力を保存します。
func (s *Service) PrepareSplitJob(ctx context.Context, file *multipart.FileHeader, rangesExpr string) (*JobManifest, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	_, manifest, err := s.prepareSplit(ctx, file, rangesExpr)
	if err != nil {
		return nil, err
	}
	return manifest, nil
}

// parsePageRanges 以下の関数は従来実装を再利用
func parsePageRanges(expr string, pageCount int) ([]PageRange, error) {
	segments := strings.Split(expr, ",")
	if len(segments) == 0 {
		return nil, newError("INVALID_INPUT", "範囲指定の形式が正しくありません。", nil)
	}

	ranges := make([]PageRange, 0, len(segments))
	usedPages := make(map[int]struct{})
	lastEnd := 0

	for i, seg := range segments {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			return nil, newError("INVALID_INPUT", "空の範囲指定が含まれています。", nil)
		}

		start, end, err := parseSingleRange(seg, pageCount)
		if err != nil {
			return nil, err
		}

		if start <= lastEnd {
			return nil, newError("INVALID_INPUT", "ページ範囲は昇順で指定してください。", nil)
		}
		lastEnd = end

		for p := start; p <= end; p++ {
			if _, exists := usedPages[p]; exists {
				return nil, newError("INVALID_INPUT", fmt.Sprintf("ページ %d が重複しています。", p), nil)
			}
			usedPages[p] = struct{}{}
		}

		ranges = append(ranges, PageRange{Start: start, End: end})

		if end == pageCount && i != len(segments)-1 {
			return nil, newError("INVALID_INPUT", "最終ページ指定の後に追加の範囲を指定することはできません。", nil)
		}
	}

	if len(usedPages) == 0 {
		return nil, newError("INVALID_INPUT", "有効なページ範囲が指定されていません。", nil)
	}

	return ranges, nil
}

func parseSingleRange(seg string, pageCount int) (int, int, error) {
	if strings.Contains(seg, "-") {
		parts := strings.SplitN(seg, "-", 2)
		if len(parts) != 2 {
			return 0, 0, newError("INVALID_INPUT", "範囲指定が正しくありません。", nil)
		}
		start, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			return 0, 0, newError("INVALID_INPUT", "範囲開始が整数ではありません。", nil)
		}
		var end int
		if strings.TrimSpace(parts[1]) == "" {
			end = pageCount
		} else {
			end, err = strconv.Atoi(strings.TrimSpace(parts[1]))
			if err != nil {
				return 0, 0, newError("INVALID_INPUT", "範囲終了が整数ではありません。", nil)
			}
		}

		if start < 1 || end < start || end > pageCount {
			return 0, 0, newError("INVALID_INPUT", "範囲指定がページ数の範囲外です。", nil)
		}
		return start, end, nil
	}

	page, err := strconv.Atoi(seg)
	if err != nil {
		return 0, 0, newError("INVALID_INPUT", "ページ番号が整数ではありません。", nil)
	}
	if page < 1 || page > pageCount {
		return 0, 0, newError("INVALID_INPUT", "ページ番号がページ数の範囲外です。", nil)
	}
	return page, page, nil
}

func buildPageSelection(pr PageRange) []string {
	pages := make([]string, 0, pr.End-pr.Start+1)
	for p := pr.Start; p <= pr.End; p++ {
		pages = append(pages, strconv.Itoa(p))
	}
	return pages
}

func createZip(outputPath string, files []string) error {
	outFile, err := os.OpenFile(outputPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return fmt.Errorf("zipファイルの作成に失敗しました: %w", err)
	}
	defer outFile.Close()

	zipWriter := zip.NewWriter(outFile)
	defer zipWriter.Close()

	sort.Strings(files)

	for _, path := range files {
		file, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("zip入力ファイルのオープンに失敗しました: %w", err)
		}

		info, err := file.Stat()
		if err != nil {
			file.Close()
			return fmt.Errorf("zip入力ファイルの情報取得に失敗しました: %w", err)
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			file.Close()
			return fmt.Errorf("zipヘッダーの生成に失敗しました: %w", err)
		}
		header.Name = filepath.Base(path)
		header.Method = zip.Deflate

		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			file.Close()
			return fmt.Errorf("zipヘッダーの書き込みに失敗しました: %w", err)
		}

		if _, err := io.Copy(writer, file); err != nil {
			file.Close()
			return fmt.Errorf("zipへの書き込みに失敗しました: %w", err)
		}
		file.Close()
	}

	return nil
}
