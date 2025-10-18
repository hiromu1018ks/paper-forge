package pdf

import "path/filepath"

type workspace struct {
	jobID  string
	dir    string
	inDir  string
	outDir string
}

func (w workspace) manifestPath() string {
	return filepath.Join(w.dir, manifestFilename)
}
