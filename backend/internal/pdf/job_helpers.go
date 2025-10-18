package pdf

import "path/filepath"

func toJobFiles(stored []storedFile) []JobFile {
	files := make([]JobFile, len(stored))
	for i, sf := range stored {
		files[i] = JobFile{
			StoredName:   filepath.Base(sf.path),
			OriginalName: sf.originalName,
			Size:         sf.size,
			Pages:        sf.pages,
		}
	}
	return files
}

func storedFilesFromManifest(jobDir string, manifest *JobManifest) []storedFile {
	if manifest == nil {
		return nil
	}
	stored := make([]storedFile, len(manifest.Files))
	for i, f := range manifest.Files {
		stored[i] = storedFile{
			path:         filepath.Join(jobDir, "in", f.StoredName),
			originalName: f.OriginalName,
			size:         f.Size,
			pages:        f.Pages,
		}
	}
	return stored
}
