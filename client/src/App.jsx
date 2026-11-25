import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, UNAUTHORIZED_EVENT } from './api.js';
import Login from './pages/Login.jsx';
import Setup from './pages/Setup.jsx';
import Today from './pages/Today.jsx';
import Sport from './pages/Sport.jsx';
import Dishes from './pages/Dishes.jsx';
import Stats from './pages/Stats.jsx';
import Profile from './pages/Profile.jsx';

const TABS = [
  { to: '/', label: 'Heute', icon: '🍽️', end: true },
  { to: '/sport', label: 'Sport', icon: '🏋️' },
  { to: '/gerichte', label: 'Gerichte', icon: '📖' },
  { to: '/statistik', label: 'Statistik', icon: '📊' },
  { to: '/profil', label: 'Profil', icon: '👤' },
];

export default function App() {
  // Antwort von /api/session: { authenticated, setup_required, user }; null = noch unbekannt
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.session().then(setSession, (e) => {
      setError(e.message);
      setSession({ authenticated: false, setup_required: false, user: null });
    });
    const onUnauthorized = () => setSession({ authenticated: false, setup_required: false, user: null });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setSession({ authenticated: false, setup_required: false, user: null });
  }, []);

  if (session === null) return <p className="center muted">Lädt …</p>;
  // Erster Start ohne Benutzer: den ersten Benutzer anlegen
  if (session.setup_required) return <Setup onDone={setSession} />;
  if (!session.authenticated) return <Login initialError={error} onLogin={setSession} />;

  return (
    <div className="app">
      <main className="content">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/sport" element={<Sport />} />
          <Route path="/gerichte" element={<Dishes />} />
          <Route path="/statistik" element={<Stats />} />
          <Route path="/profil" element={<Profile user={session.user} onLogout={logout} />} />
          {/* Früherer Gewicht-Tab, falls als Lesezeichen gespeichert */}
          <Route path="/gewicht" element={<Navigate to="/profil" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Hauptnavigation">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            <span className="tab-icon" aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
