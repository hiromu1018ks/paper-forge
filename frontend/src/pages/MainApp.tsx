/**
 * メインアプリケーション (Tailwind CSS版)
 *
 * design.html のタブナビゲーションデザインを踏襲しつつ、
 * React Router から渡される状態に応じて初期タブや遷移先を切り替える。
 */

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { logout as logoutApi } from '@/api/auth';
import { MergeTab } from '@/components/tabs/MergeTab';
import { OptimizeTab } from '@/components/tabs/OptimizeTab';
import { ReorderTab } from '@/components/tabs/ReorderTab';
import { SplitTab } from '@/components/tabs/SplitTab';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

type TabType = 'merge' | 'reorder' | 'split' | 'optimize';

const TAB_LABELS: Record<TabType, string> = {
  merge: '結合',
  reorder: 'ページ順入替',
  split: '分割',
  optimize: '圧縮',
};

export const MainApp = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { activeTab?: TabType } | undefined;
  const initialTab = useMemo<TabType>(() => state?.activeTab ?? 'merge', [state]);

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const user = useAuthStore((current) => current.user);
  const logout = useAuthStore((current) => current.logout);
  const lastResult = useWorkspaceStore((current) => current.lastResult);
  const clearWorkspace = useWorkspaceStore((current) => current.clearAll);

  useEffect(() => {
    if (state?.activeTab) {
      setActiveTab(state.activeTab);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, navigate, state]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logoutApi();
    } catch (error) {
      console.error('ログアウトAPIエラー:', error);
    } finally {
      try {
        await clearWorkspace();
      } catch (workspaceError) {
        console.warn('ワークスペースのクリアに失敗しました:', workspaceError);
      }
      logout();
      navigate('/login', { replace: true });
    }
  };

  const tabs: { id: TabType; label: string; icon: ReactNode }[] = [
    {
      id: 'merge',
      label: TAB_LABELS.merge,
      icon: (
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"
          />
        </svg>
      ),
    },
    {
      id: 'reorder',
      label: TAB_LABELS.reorder,
      icon: (
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      ),
    },
    {
      id: 'split',
      label: TAB_LABELS.split,
      icon: (
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
    },
    {
      id: 'optimize',
      label: TAB_LABELS.optimize,
      icon: (
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-full bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">Paper Forge</h1>
              {user && <span className="ml-4 text-sm text-gray-500">ようこそ、{user.username}さん</span>}
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => navigate('/workspace')}
                className="text-blue-500 hover:text-blue-700 px-3 py-2 rounded-md text-sm font-medium border border-blue-200 hover:border-blue-400 transition-colors"
              >
                ワークスペース{lastResult ? '' : ' (空)'}
              </button>
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50"
              >
                {isLoggingOut ? 'ログアウト中...' : 'ログアウト'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <nav className="flex space-x-8" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'text-blue-600 border-blue-600'
                    : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div>
          {activeTab === 'merge' && <MergeTab />}
          {activeTab === 'reorder' && <ReorderTab />}
          {activeTab === 'split' && <SplitTab />}
          {activeTab === 'optimize' && <OptimizeTab />}
        </div>
      </div>
    </div>
  );
};
