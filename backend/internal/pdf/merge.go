// Package pdf はPDF操作機能を提供します。
package pdf

// TODO: PDF結合機能の実装
//
// 実装予定の機能:
// - 複数PDFファイルの結合
// - ファイル順序の制御（DnD順またはorder配列）
// - しおり保持（可能範囲）
// - メタデータ継承（先頭ファイル優先）
// - 進捗報告（読込20% / 処理60% / 書込20%）
//
// 使用ライブラリ:
// - pdfcpu: PDF操作のコアライブラリ
//   - pdf.MergeCreateFile(output, inputs...) でファイル結合
//
// 処理フロー:
// 1. 入力ファイルの検証（拡張子・MIME・シグネチャ）
// 2. ページ数とサイズのチェック（上限: 200頁/100MB）
// 3. 一時ディレクトリへの保存（/tmp/app/<jobId>/in/）
// 4. pdfcpuで結合処理
// 5. 結果の保存（/tmp/app/<jobId>/out/）
// 6. ストリーム返却 or GCS署名URL
//
// 参考:
// - docs/01_requirements.md: 5.1 結合（Merge）
// - docs/02_basic_design.md: PDF処理実装の例
// - docs/04_api_spec.md: POST /pdf/merge
