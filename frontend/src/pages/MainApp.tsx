/**
 * メインアプリケーション (Tailwind CSS版)
 *
 * design.htmlのタブナビゲーションデザインを踏襲
 */

import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { logout as logoutApi } from '@/api/auth';
import { MergeTab } from '@/components/tabs/MergeTab';
import { ReorderTab } from '@/components/tabs/ReorderTab';
import { SplitTab } from '@/components/tabs/SplitTab';
import { OptimizeTab } from '@/components/tabs/OptimizeTab';

type TabType = 'merge' | 'reorder' | 'split' | 'optimize';

export const MainApp = () => {
  const [activeTab, setActiveTab] = useState<TabType>('merge');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logoutApi();
    } catch (error) {
      console.error('ログアウトAPIエラー:', error);
    } finally {
      logout();
    }
  };

  const tabs = [
    {
      id: 'merge' as const,
      label: '結合',
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
      id: 'reorder' as const,
      label: 'ページ順入替',
      icon: (
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      ),
    },
    {
      id: 'split' as const,
      label: '分割',
      icon: (
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
    },
    {
      id: 'optimize' as const,
      label: '圧縮',
      icon: (
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-full bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
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
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {isLoggingOut ? 'ログアウト中...' : 'ログアウト'}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
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

        {/* Tab Content */}
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
