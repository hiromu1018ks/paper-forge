package pdf

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const manifestFilename = "manifest.json"

// JobManifest はジョブに必要な情報を保持します。
type JobManifest struct {
	JobID     string         `json:"jobId"`
	Operation OperationType  `json:"operation"`
	Files     []JobFile      `json:"files"`
	Order     []int          `json:"order,omitempty"`
	Ranges    string         `json:"ranges,omitempty"`
	Preset    OptimizePreset `json:"preset,omitempty"`
	CreatedAt time.Time      `json:"createdAt"`
}

// JobFile はジョブ入力ファイルのメタデータを表します。
type JobFile struct {
	StoredName   string `json:"storedName"`
	OriginalName string `json:"originalName"`
	Size         int64  `json:"size"`
	Pages        int    `json:"pages"`
}

func writeManifest(jobDir string, manifest *JobManifest) error {
	if manifest == nil {
		return fmt.Errorf("manifest is nil")
	}
	path := filepath.Join(jobDir, manifestFilename)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return fmt.Errorf("failed to open manifest: %w", err)
	}
	defer file.Close()
	enc := json.NewEncoder(file)
	enc.SetIndent("", "  ")
	return enc.Encode(manifest)
}

func loadManifest(jobDir string) (*JobManifest, error) {
	path := filepath.Join(jobDir, manifestFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read manifest: %w", err)
	}
	var manifest JobManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("failed to parse manifest: %w", err)
	}
	return &manifest, nil
}
