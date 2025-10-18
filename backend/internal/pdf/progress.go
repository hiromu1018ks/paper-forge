package pdf

// ProgressReporter は進捗更新用コールバックです。
type ProgressReporter func(stage string, percent int)

func reportProgress(cb ProgressReporter, stage string, percent int) {
	if cb == nil {
		return
	}
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	cb(stage, percent)
}
