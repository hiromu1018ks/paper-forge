package pdf

import (
	"sync"
)

// OperationType はPDF処理の種別を表します。
type OperationType string

const (
	OperationMerge    OperationType = "merge"
	OperationReorder  OperationType = "reorder"
	OperationSplit    OperationType = "split"
	OperationOptimize OperationType = "optimize"
)

// OptimizePreset は圧縮プリセットの種類を表します。
type OptimizePreset string

const (
	OptimizePresetStandard   OptimizePreset = "standard"
	OptimizePresetAggressive OptimizePreset = "aggressive"
)

// ResultKind は生成される成果物の種別を表します。
type ResultKind string

const (
	ResultKindPDF ResultKind = "pdf"
	ResultKindZIP ResultKind = "zip"
)

// Result はPDF処理の成果を表します。
type Result struct {
	JobID          string        `json:"jobId"`
	Operation      OperationType `json:"operation"`
	OutputPath     string        `json:"outputPath"`
	OutputFilename string        `json:"outputFilename"`
	OutputSize     int64         `json:"outputSize"`
	ResultKind     ResultKind    `json:"resultKind"`
	Meta           any           `json:"meta,omitempty"`

	jobDir      string
	cleanupOnce sync.Once
	cleanupErr  error
}

// Cleanup は作業ディレクトリを削除します。
func (r *Result) Cleanup() error {
	if r == nil {
		return nil
	}
	r.cleanupOnce.Do(func() {
		r.cleanupErr = removeDir(r.jobDir)
	})
	return r.cleanupErr
}

// MergeMeta は結合処理のメタデータです。
type MergeMeta struct {
	TotalPages int              `json:"totalPages"`
	Sources    []SourceFileMeta `json:"sources"`
}

// ReorderMeta はページ順入替処理のメタデータです。
type ReorderMeta struct {
	Original SourceFileMeta `json:"original"`
	Order    []int          `json:"order"`
}

// SplitMeta は分割処理のメタデータです。
type SplitMeta struct {
	Original SourceFileMeta `json:"original"`
	Ranges   []PageRange    `json:"ranges"`
	Parts    []SplitPart    `json:"parts"`
}

// PageRange は分割対象のページ範囲を表します（Start/Endは1-based, End>=Start）。
type PageRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// SplitPart は分割で生成された各PDFの情報です。
type SplitPart struct {
	Filename string `json:"filename"`
	FromPage int    `json:"fromPage"`
	ToPage   int    `json:"toPage"`
	Pages    int    `json:"pages"`
	Size     int64  `json:"size"`
}

// OptimizeMeta は圧縮処理のメタデータです。
type OptimizeMeta struct {
	OriginalSize int64          `json:"originalSize"`
	OutputSize   int64          `json:"outputSize"`
	SavedBytes   int64          `json:"savedBytes"`
	SavedPercent float64        `json:"savedPercent"`
	Preset       OptimizePreset `json:"preset"`
	Source       SourceFileMeta `json:"source"`
}
