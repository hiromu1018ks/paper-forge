// Package pdf はPDF操作機能を提供します。
package pdf

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"github.com/google/uuid"
	pdfapi "github.com/pdfcpu/pdfcpu/pkg/api"

	"github.com/yourusername/paper-forge/internal/config"
)

const (
	// MaxUploadTotalBytes は1リクエストで受け取る合計ファイルサイズの上限です。
	MaxUploadTotalBytes int64 = 300 * 1024 * 1024 // 300MB

	maxUploadFiles    = 20
	outputFilename    = "merged.pdf"
	defaultCleanupMin = 10
)

// Service はPDF結合などの操作をまとめたサービスです。
type Service struct {
	cfg     *config.Config
	tmpRoot string
	now     func() time.Time
}

// NewService は Service を作成します。
func NewService(cfg *config.Config) *Service {
	root := filepath.Join(os.TempDir(), "app")
	return &Service{
		cfg:     cfg,
		tmpRoot: root,
		now:     time.Now,
	}
}

func (s *Service) createWorkspace() (workspace, error) {
	jobID := uuid.NewString()
	jobDir := filepath.Join(s.tmpRoot, jobID)
	inDir := filepath.Join(jobDir, "in")
	outDir := filepath.Join(jobDir, "out")

	if err := os.MkdirAll(inDir, 0o750); err != nil {
		return workspace{}, fmt.Errorf("入力ディレクトリの作成に失敗しました: %w", err)
	}
	if err := os.MkdirAll(outDir, 0o750); err != nil {
		return workspace{}, fmt.Errorf("出力ディレクトリの作成に失敗しました: %w", err)
	}
	return workspace{
		jobID:  jobID,
		dir:    jobDir,
		inDir:  inDir,
		outDir: outDir,
	}, nil
}

func (s *Service) workspaceFor(jobID string) workspace {
	jobDir := filepath.Join(s.tmpRoot, jobID)
	return workspace{
		jobID:  jobID,
		dir:    jobDir,
		inDir:  filepath.Join(jobDir, "in"),
		outDir: filepath.Join(jobDir, "out"),
	}
}

// SourceFileMeta は結合対象ファイルのメタ情報です。
type SourceFileMeta struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Pages int    `json:"pages"`
}

// Error はAPIレスポンス用のエラー情報を保持します。
type Error struct {
	Code    string
	Message string
	Err     error
}

// Error 実装。
func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

// Unwrap は元のエラーを返します。
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func newError(code, message string, err error) error {
	return &Error{
		Code:    code,
		Message: message,
		Err:     err,
	}
}

type storedFile struct {
	path         string
	originalName string
	size         int64
	pages        int
}

func validateMergeInputs(files []*multipart.FileHeader, order []int) error {
	if len(files) == 0 {
		return newError("INVALID_INPUT", "少なくとも1つのPDFファイルを選択してください。", nil)
	}
	if len(files) > maxUploadFiles {
		return newError("LIMIT_EXCEEDED", fmt.Sprintf("アップロードできるPDFは最大%d件までです。", maxUploadFiles), nil)
	}

	if len(order) > 0 {
		if len(order) != len(files) {
			return newError("INVALID_INPUT", "order配列の長さがファイル数と一致していません。", nil)
		}
		seen := make(map[int]struct{}, len(order))
		for _, idx := range order {
			if idx < 0 || idx >= len(files) {
				return newError("INVALID_INPUT", "order配列に不正な番号が含まれています。", nil)
			}
			if _, ok := seen[idx]; ok {
				return newError("INVALID_INPUT", "order配列に重複した番号が含まれています。", nil)
			}
			seen[idx] = struct{}{}
		}
	}

	return nil
}

// MergeMultipart は multipart/form-data 経由で受け取った PDF を結合します。
func (s *Service) MergeMultipart(ctx context.Context, files []*multipart.FileHeader, order []int) (_ *Result, err error) {
	if ctx == nil {
		ctx = context.Background()
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	if err := validateMergeInputs(files, order); err != nil {
		return nil, err
	}

	state, _, err := s.prepareMerge(ctx, files, order)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = removeDir(state.ws.dir)
		}
	}()

	result, execErr := s.executeMerge(ctx, state, order, nil)
	if execErr != nil {
		return nil, execErr
	}
	return result, nil
}

type mergeState struct {
	ws          workspace
	storedFiles []storedFile
}

func (s *Service) prepareMerge(ctx context.Context, files []*multipart.FileHeader, order []int) (*mergeState, *JobManifest, error) {
	ws, err := s.createWorkspace()
	if err != nil {
		return nil, nil, err
	}

	var (
		storedFiles []storedFile
		totalUpload int64
	)

	for i, fh := range files {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		sf, storeErr := s.storeMultipartFile(ctx, fh, ws.inDir, i)
		if storeErr != nil {
			_ = removeDir(ws.dir)
			return nil, nil, storeErr
		}

		totalUpload += sf.size
		if totalUpload > MaxUploadTotalBytes {
			_ = removeDir(ws.dir)
			return nil, nil, newError("LIMIT_EXCEEDED", "アップロードされたファイル全体のサイズが上限(300MB)を超えています。", nil)
		}

		storedFiles = append(storedFiles, sf)
	}

	manifest := &JobManifest{
		JobID:     ws.jobID,
		Operation: OperationMerge,
		Files:     toJobFiles(storedFiles),
		Order:     append([]int(nil), order...),
		CreatedAt: s.now().UTC(),
	}
	if err := writeManifest(ws.dir, manifest); err != nil {
		_ = removeDir(ws.dir)
		return nil, nil, fmt.Errorf("ジョブマニフェストの保存に失敗しました: %w", err)
	}

	return &mergeState{ws: ws, storedFiles: storedFiles}, manifest, nil
}

func (s *Service) executeMerge(ctx context.Context, state *mergeState, order []int, progress ProgressReporter) (*Result, error) {
	ws := state.ws
	storedFiles := state.storedFiles

	ordered := make([]storedFile, len(storedFiles))
	if len(order) == 0 {
		copy(ordered, storedFiles)
	} else {
		for i, idx := range order {
			ordered[i] = storedFiles[idx]
		}
	}

	inputPaths := make([]string, len(ordered))
	for i, sf := range ordered {
		inputPaths[i] = sf.path
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	outputPath := filepath.Join(ws.outDir, outputFilename)
	reportProgress(progress, "process", 40)
	if err := mergeCreateFileCompat(inputPaths, outputPath); err != nil {
		return nil, newError("UNSUPPORTED_PDF", "PDFの結合に失敗しました。ファイルが破損していないか確認してください。", err)
	}
	reportProgress(progress, "write", 80)

	outInfo, err := os.Stat(outputPath)
	if err != nil {
		return nil, fmt.Errorf("結合結果の確認に失敗しました: %w", err)
	}

	sources := make([]SourceFileMeta, len(ordered))
	totalPages := 0
	for i, sf := range ordered {
		sources[i] = SourceFileMeta{
			Name:  sf.originalName,
			Size:  sf.size,
			Pages: sf.pages,
		}
		totalPages += sf.pages
	}

	meta := struct {
		Type      string           `json:"type"`
		CreatedAt time.Time        `json:"createdAt"`
		Files     []SourceFileMeta `json:"files"`
		Pages     int              `json:"pages"`
		Size      int64            `json:"size"`
	}{
		Type:      "merge",
		CreatedAt: s.now().UTC(),
		Files:     sources,
		Pages:     totalPages,
		Size:      outInfo.Size(),
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

	result := &Result{
		JobID:          ws.jobID,
		Operation:      OperationMerge,
		OutputPath:     outputPath,
		OutputFilename: outputFilename,
		OutputSize:     outInfo.Size(),
		ResultKind:     ResultKindPDF,
		Meta: &MergeMeta{
			TotalPages: totalPages,
			Sources:    sources,
		},
		jobDir: ws.dir,
	}
	reportProgress(progress, "completed", 100)
	return result, nil
}

// PrepareMergeJob は非同期処理用に入力ファイルを保存し、マニフェストを返します。
func (s *Service) PrepareMergeJob(ctx context.Context, files []*multipart.FileHeader, order []int) (*JobManifest, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	if err := validateMergeInputs(files, order); err != nil {
		return nil, err
	}
	state, manifest, err := s.prepareMerge(ctx, files, order)
	if err != nil {
		return nil, err
	}
	// stateは将来の実行で使用されるため、ここではクリーンアップしない
	_ = state
	return manifest, nil
}

func (s *Service) storeMultipartFile(ctx context.Context, fh *multipart.FileHeader, dir string, index int) (storedFile, error) {
	if fh == nil {
		return storedFile{}, newError("INVALID_INPUT", fmt.Sprintf("files[%d] が空です。", index), nil)
	}

	if s.cfg.MaxFileSize > 0 && fh.Size > 0 && fh.Size > s.cfg.MaxFileSize {
		return storedFile{}, newError("LIMIT_EXCEEDED", fmt.Sprintf("%s のサイズが上限(%dMB)を超えています。", fh.Filename, s.cfg.MaxFileSize/(1024*1024)), nil)
	}

	if err := ctx.Err(); err != nil {
		return storedFile{}, err
	}

	src, err := fh.Open()
	if err != nil {
		return storedFile{}, fmt.Errorf("ファイルを開けませんでした(%s): %w", fh.Filename, err)
	}
	defer src.Close()

	tempPath := filepath.Join(dir, fmt.Sprintf("%02d.pdf", index))
	dst, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return storedFile{}, fmt.Errorf("一時ファイルを作成できませんでした: %w", err)
	}

	var totalWritten int64
	sniffBuf := make([]byte, 4096)
	n, readErr := src.Read(sniffBuf)
	if readErr != nil && readErr != io.EOF {
		dst.Close()
		return storedFile{}, fmt.Errorf("ファイルの読み取りに失敗しました(%s): %w", fh.Filename, readErr)
	}

	if n == 0 {
		dst.Close()
		return storedFile{}, newError("INVALID_INPUT", fmt.Sprintf("%s は空のPDFです。", fh.Filename), nil)
	}

	mime := mimetype.Detect(sniffBuf[:n])
	if mime == nil || !mime.Is("application/pdf") {
		dst.Close()
		return storedFile{}, newError("UNSUPPORTED_PDF", fmt.Sprintf("%s はPDF形式ではありません。", fh.Filename), nil)
	}

	written, err := dst.Write(sniffBuf[:n])
	if err != nil {
		dst.Close()
		return storedFile{}, fmt.Errorf("一時ファイルへの書き込みに失敗しました(%s): %w", fh.Filename, err)
	}
	totalWritten += int64(written)

	if readErr != io.EOF {
		copied, err := io.Copy(dst, src)
		if err != nil {
			dst.Close()
			return storedFile{}, fmt.Errorf("ファイルのコピーに失敗しました(%s): %w", fh.Filename, err)
		}
		totalWritten += copied
	}

	if err := dst.Close(); err != nil {
		return storedFile{}, fmt.Errorf("一時ファイルのクローズに失敗しました: %w", err)
	}

	if totalWritten == 0 {
		return storedFile{}, newError("INVALID_INPUT", fmt.Sprintf("%s は空のPDFです。", fh.Filename), nil)
	}

	if s.cfg.MaxFileSize > 0 && totalWritten > s.cfg.MaxFileSize {
		return storedFile{}, newError("LIMIT_EXCEEDED", fmt.Sprintf("%s のサイズが上限(%dMB)を超えています。", fh.Filename, s.cfg.MaxFileSize/(1024*1024)), nil)
	}

	pages, err := pdfapi.PageCountFile(tempPath)
	if err != nil {
		return storedFile{}, newError("UNSUPPORTED_PDF", fmt.Sprintf("%s のページ数を取得できませんでした。", fh.Filename), err)
	}

	if s.cfg.MaxPages > 0 && pages > s.cfg.MaxPages {
		return storedFile{}, newError("LIMIT_EXCEEDED", fmt.Sprintf("%s のページ数が上限(%dページ)を超えています。", fh.Filename, s.cfg.MaxPages), nil)
	}

	return storedFile{
		path:         tempPath,
		originalName: safeOriginalName(fh.Filename, index),
		size:         totalWritten,
		pages:        pages,
	}, nil
}

func safeOriginalName(name string, index int) string {
	base := filepath.Base(name)
	if base == "." || base == string(os.PathSeparator) || base == "" {
		return fmt.Sprintf("file-%02d.pdf", index+1)
	}
	return base
}

func writeJSON(path string, v any) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	defer file.Close()

	enc := json.NewEncoder(file)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// DiscardJob は指定したジョブのワークスペースを削除します。
func (s *Service) DiscardJob(jobID string) error {
	if s == nil {
		return nil
	}
	if strings.TrimSpace(jobID) == "" {
		return nil
	}
	ws := s.workspaceFor(jobID)
	return removeDir(ws.dir)
}

func removeDir(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	return os.RemoveAll(path)
}

// IsError は指定したコードのエラーかどうかを判定します。
func IsError(err error, code string) bool {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		return apiErr.Code == code
	}
	return false
}

// mergeCreateFileCompat は pdfcpu の MergeCreateFile のシグネチャ差異に対応します。
func mergeCreateFileCompat(inputs []string, output string) error {
	fn := reflect.ValueOf(pdfapi.MergeCreateFile)
	fnType := fn.Type()

	switch fnType.NumIn() {
	case 4:
		args := []reflect.Value{
			reflect.ValueOf(inputs),
			reflect.ValueOf(output),
			reflect.ValueOf(false),
			reflect.Zero(fnType.In(3)),
		}
		results := fn.Call(args)
		if len(results) == 1 && !results[0].IsNil() {
			return results[0].Interface().(error)
		}
		return nil
	case 3:
		args := []reflect.Value{
			reflect.ValueOf(inputs),
			reflect.ValueOf(output),
			reflect.Zero(fnType.In(2)),
		}
		results := fn.Call(args)
		if len(results) == 1 && !results[0].IsNil() {
			return results[0].Interface().(error)
		}
		return nil
	default:
		return fmt.Errorf("unsupported MergeCreateFile signature with %d parameters", fnType.NumIn())
	}
}
