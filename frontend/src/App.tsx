/**
 * アプリケーションのルートコンポーネント
 *
 * React Routerを使用してルーティングを設定。
 * 認証が必要なページは保護されている。
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { useAuthStore } from '@/stores/authStore';

/**
 * 認証が必要なルートを保護するコンポーネント
 */
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  if (!isLoggedIn) {
    // ログインしていない場合はログインページにリダイレクト
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ログインページ */}
        <Route path="/login" element={<LoginPage />} />

        {/* ダッシュボード（保護されたルート） */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        {/* TODO: 今後追加予定のルート */}
        {/* <Route path="/edit/merge" element={<ProtectedRoute><MergePage /></ProtectedRoute>} /> */}
        {/* <Route path="/edit/split" element={<ProtectedRoute><SplitPage /></ProtectedRoute>} /> */}
        {/* <Route path="/edit/reorder" element={<ProtectedRoute><ReorderPage /></ProtectedRoute>} /> */}
        {/* <Route path="/edit/optimize" element={<ProtectedRoute><OptimizePage /></ProtectedRoute>} /> */}
        {/* <Route path="/workspace" element={<ProtectedRoute><WorkspacePage /></ProtectedRoute>} /> */}

        {/* 404 - 存在しないパスはダッシュボードにリダイレクト */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
