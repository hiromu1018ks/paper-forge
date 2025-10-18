/**
 * ワークスペースで保持する結合結果などの型定義
 */

export type WorkspaceResultType = 'pdf' | 'zip';

export type WorkspaceSource = 'merge' | 'reorder' | 'split' | 'optimize';

export interface WorkspaceResultMeta {
  inputFilenames?: string[];
  pageCount?: number;
  order?: number[];
  ranges?: string[];
  savedBytes?: number;
  savedPercent?: number;
  preset?: 'standard' | 'aggressive';
}

export interface WorkspaceResult {
  id: string;
  type: WorkspaceResultType;
  source: WorkspaceSource;
  filename: string;
  size: number;
  createdAt: string; // ISO8601
  hash?: string;
  meta?: WorkspaceResultMeta;
}
