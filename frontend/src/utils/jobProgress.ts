export const jobStageToLabel = (stage?: string): string | undefined => {
  switch (stage) {
    case 'queued':
      return 'キューに登録されています';
    case 'load':
      return 'ファイルを読み込んでいます';
    case 'process':
      return 'PDFを処理しています';
    case 'write':
      return '結果を書き出しています';
    case 'completed':
      return '完了しました';
    default:
      return undefined;
  }
};
