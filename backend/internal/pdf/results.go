package pdf

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var operationOutput = map[OperationType]struct {
	filename string
	kind     ResultKind
}{
	OperationMerge:    {filename: outputFilename, kind: ResultKindPDF},
	OperationReorder:  {filename: reorderFilename, kind: ResultKindPDF},
	OperationSplit:    {filename: splitFilename, kind: ResultKindZIP},
	OperationOptimize: {filename: optimizedFilename, kind: ResultKindPDF},
}

// OpenResultFile はジョブIDに対応する成果物ファイルを開き、Result 情報とファイルハンドルを返します。
func (s *Service) OpenResultFile(jobID string) (*Result, *os.File, error) {
	if strings.TrimSpace(jobID) == "" {
		return nil, nil, fmt.Errorf("jobID is required")
	}

	ws := s.workspaceFor(jobID)
	manifest, err := loadManifest(ws.dir)
	if err != nil {
		return nil, nil, err
	}
	output, ok := operationOutput[manifest.Operation]
	if !ok {
		return nil, nil, fmt.Errorf("unsupported operation for result download: %s", manifest.Operation)
	}

	outputPath := filepath.Join(ws.outDir, output.filename)
	file, err := os.Open(outputPath)
	if err != nil {
		return nil, nil, err
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, nil, err
	}

	result := &Result{
		JobID:          jobID,
		Operation:      manifest.Operation,
		OutputPath:     outputPath,
		OutputFilename: output.filename,
		OutputSize:     info.Size(),
		ResultKind:     output.kind,
		jobDir:         ws.dir,
	}

	return result, file, nil
}
