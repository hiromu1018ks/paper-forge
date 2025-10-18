/**
 * アプリケーションのルートコンポーネント
 *
 * React Router を用いて画面遷移を制御し、認証済みユーザーのみが
 * メインアプリケーションおよびワークスペースにアクセスできるようにする。
 */

import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { LoginPage } from '@/pages/LoginPage';
import { MainApp } from '@/pages/MainApp';
import { WorkspacePage } from '@/pages/WorkspacePage';
import { useAuthStore } from '@/stores/authStore';

const ProtectedRoute = ({ isLoggedIn }: { isLoggedIn: boolean }) => {
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};

const LoginRoute = ({ isLoggedIn }: { isLoggedIn: boolean }) => {
  if (isLoggedIn) {
    return <Navigate to="/app" replace />;
  }
  return <LoginPage />;
};

function App() {
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute isLoggedIn={isLoggedIn} />} />
        <Route element={<ProtectedRoute isLoggedIn={isLoggedIn} />}>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<MainApp />} />
          <Route path="/workspace" element={<WorkspacePage />} />
        </Route>
        <Route path="*" element={<Navigate to={isLoggedIn ? '/app' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
