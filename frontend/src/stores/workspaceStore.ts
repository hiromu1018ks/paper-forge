/**
 * ワークスペース状態管理ストア (Zustand)
 *
 * - 結果メタデータは localStorage に永続化
 * - 実体の Blob データは IndexedDB (workspaceDb) またはメモリに保存
 * - プレビュー表示用に Object URL をキャッシュ
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { workspaceDb } from '@/utils/workspaceDb';
import type { WorkspaceResult, WorkspaceResultMeta, WorkspaceSource, WorkspaceResultType } from '@/types/workspace';

interface WorkspaceState {
  lastResult: WorkspaceResult | null;
  history: WorkspaceResult[];
  previewUrl: string | null;
  saveResult: (params: {
    blob: Blob;
    filename: string;
    type: WorkspaceResultType;
    source: WorkspaceSource;
    meta?: WorkspaceResultMeta;
  }) => Promise<WorkspaceResult>;
  ensurePreviewUrl: () => Promise<string | null>;
  getLastResultBlob: () => Promise<Blob | null>;
  clearLastResult: () => Promise<void>;
  clearAll: () => Promise<void>;
}

const MAX_HISTORY_LENGTH = 5;

const generateResultId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `result-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatHash = (buffer: ArrayBuffer): string => {
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

const computeHash = async (blob: Blob): Promise<string | undefined> => {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return undefined;
    }
    const arrayBuffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return formatHash(digest);
  } catch (error) {
    console.warn('Failed to compute hash for workspace result:', error);
    return undefined;
  }
};

const revokeUrl = (url: string | null) => {
  if (url) {
    URL.revokeObjectURL(url);
  }
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      lastResult: null,
      history: [],
      previewUrl: null,

      saveResult: async ({ blob, filename, type, source, meta }) => {
        const id = generateResultId();
        const hash = await computeHash(blob);
        await workspaceDb.save(id, blob);

        revokeUrl(get().previewUrl);
        const previewUrl = URL.createObjectURL(blob);
        const nextResult: WorkspaceResult = {
          id,
          filename,
          type,
          source,
          size: blob.size,
          createdAt: new Date().toISOString(),
          hash,
          meta,
        };

        set((state) => {
          const filteredHistory = state.history.filter((item) => item.id !== nextResult.id);
          const nextHistory = [nextResult, ...filteredHistory].slice(0, MAX_HISTORY_LENGTH);
          return {
            lastResult: nextResult,
            history: nextHistory,
            previewUrl,
          };
        });

        return nextResult;
      },

      ensurePreviewUrl: async () => {
        const { lastResult, previewUrl } = get();
        if (!lastResult) {
          return null;
        }
        if (previewUrl) {
          return previewUrl;
        }
        const blob = await workspaceDb.get(lastResult.id);
        if (!blob) {
          return null;
        }
        const url = URL.createObjectURL(blob);
        set({ previewUrl: url });
        return url;
      },

      getLastResultBlob: async () => {
        const { lastResult } = get();
        if (!lastResult) {
          return null;
        }
        return workspaceDb.get(lastResult.id);
      },

      clearLastResult: async () => {
        const { lastResult, previewUrl } = get();
        if (lastResult) {
          await workspaceDb.remove(lastResult.id);
        }
        revokeUrl(previewUrl);
        set((state) => ({
          lastResult: null,
          previewUrl: null,
          history: state.history.filter((entry) => entry.id !== lastResult?.id),
        }));
      },

      clearAll: async () => {
        revokeUrl(get().previewUrl);
        await workspaceDb.clearAll();
        set({
          lastResult: null,
          history: [],
          previewUrl: null,
        });
      },
    }),
    {
      name: 'workspace-storage',
      partialize: (state) => ({
        lastResult: state.lastResult,
        history: state.history,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }
        // 再水和後は Object URL を都度作り直す必要がある
        state.previewUrl = null;
      },
    }
  )
);
