import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { User } from './types';
import Layout from './components/Layout';
import Login from './pages/Login';
import StudentDashboard from './pages/StudentDashboard';
import JudgeDashboard from './pages/JudgeDashboard';
import AdminDashboard from './pages/AdminDashboard';

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isVerifying, setIsVerifying] = useState(true);

  // ✅ 앱 시작 시 서버에서 세션 유효성 검증
  useEffect(() => {
    const verifySession = async () => {
      const saved = localStorage.getItem('user');
      if (!saved) { setIsVerifying(false); return; }
      try {
        const res = await fetch('/api/health');
        if (!res.ok) {
          // 401 등 오류 시 로컬 상태 초기화
          setUser(null);
          localStorage.removeItem('user');
        }
      } catch {
        // 네트워크 오류 시에는 로컬 상태 유지 (오프라인 대응)
      } finally {
        setIsVerifying(false);
      }
    };
    verifySession();
  }, []);

  const handleLogin = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem('user', JSON.stringify(newUser));
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout failed', err);
    }
    setUser(null);
    localStorage.removeItem('user');
  };

  // ✅ 전역 401 인터셉터 — 세션 만료 시 자동 로그아웃
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      if (res.status === 401) {
        setUser(null);
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
      return res;
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  // ✅ 세션 검증 중에는 빈 화면 표시 (깜빡임 방지)
  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-black/30 text-sm font-medium">불러오는 중...</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={handleLogout}>
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />}
          />
          <Route
            path="/"
            element={
              user ? (
                user.role === 'student' ? <StudentDashboard user={user} /> :
                user.role === 'judge' ? <JudgeDashboard user={user} /> :
                <AdminDashboard user={user} />
              ) : (
                <Navigate to="/login" />
              )
            }
          />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
