/**
 * アプリケーションのルートコンポーネント (シンプル版)
 *
 * ログイン状態によってLoginPageとMainAppを切り替える
 */

import { LoginPage } from '@/pages/LoginPage';
import { MainApp } from '@/pages/MainApp';
import { useAuthStore } from '@/stores/authStore';

function App() {
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

  return isLoggedIn ? <MainApp /> : <LoginPage />;
}

export default App;
