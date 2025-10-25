package pdf

import (
	"context"
	"mime/multipart"
)

// InspectResult はアップロードされたPDFの基本メタデータを表します。
type InspectResult struct {
	Source SourceFileMeta `json:"source"`
}

// InspectMultipart は単一PDFファイルを受け取り、ページ数などのメタデータを返します。
func (s *Service) InspectMultipart(ctx context.Context, file *multipart.FileHeader) (*InspectResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if file == nil {
		return nil, newError("INVALID_INPUT", "PDFファイルを選択してください。", nil)
	}

	ws, err := s.createWorkspace()
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = removeDir(ws.dir)
	}()

	stored, err := s.storeMultipartFile(ctx, file, ws.inDir, 0)
	if err != nil {
		return nil, err
	}

	return &InspectResult{
		Source: SourceFileMeta{
			Name:  stored.originalName,
			Size:  stored.size,
			Pages: stored.pages,
		},
	}, nil
}
