/**
 * ダッシュボード画面
 *
 * PDF操作機能（結合・分割・順序・圧縮）の入口となる画面。
 * 現在はダミー実装で、各機能へのナビゲーションのみ。
 */

import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export const DashboardPage = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // 操作カードのスタイル
  const cardStyle: React.CSSProperties = {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'box-shadow 0.2s',
  };

  return (
    <div style={{ maxWidth: '800px', margin: '50px auto', padding: '20px' }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <div>
          <h1>Paper Forge</h1>
          <p style={{ color: '#666' }}>ようこそ、{user?.username}さん</p>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: '8px 16px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          ログアウト
        </button>
      </div>

      {/* 操作カード */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '20px'
      }}>
        <div style={cardStyle} onClick={() => alert('結合機能は準備中です')}>
          <h2>📄 結合</h2>
          <p style={{ fontSize: '14px', color: '#666' }}>複数のPDFを結合</p>
        </div>
        <div style={cardStyle} onClick={() => alert('分割機能は準備中です')}>
          <h2>✂️ 分割</h2>
          <p style={{ fontSize: '14px', color: '#666' }}>PDFを分割</p>
        </div>
        <div style={cardStyle} onClick={() => alert('順序入替機能は準備中です')}>
          <h2>🔄 順序</h2>
          <p style={{ fontSize: '14px', color: '#666' }}>ページ順を入替</p>
        </div>
        <div style={cardStyle} onClick={() => alert('圧縮機能は準備中です')}>
          <h2>🗜️ 圧縮</h2>
          <p style={{ fontSize: '14px', color: '#666' }}>ファイルを圧縮</p>
        </div>
      </div>

      <p style={{ marginTop: '40px', color: '#999', fontSize: '14px', textAlign: 'center' }}>
        ※ 各機能は今後実装予定です
      </p>
    </div>
  );
};
