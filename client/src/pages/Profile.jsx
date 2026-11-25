import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Weight from './Weight.jsx';
import SettingsSheet from '../components/SettingsSheet.jsx';
import AccountSheet from '../components/AccountSheet.jsx';

// Profil: eigenes Konto, Einstellungen, Abmelden und der Gewichtsverlauf
export default function Profile({ user, onLogout }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api.settings());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Profil</h1>
          <div className="muted small">
            Angemeldet als <strong>{user.username}</strong>{user.is_admin ? ' (Administrator)' : ''}
          </div>
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="actions profile-actions">
        <button onClick={() => setShowAccount(true)}>Konto</button>
        <button onClick={() => setShowSettings(true)} disabled={!settings}>Einstellungen</button>
        <button onClick={onLogout}>Abmelden</button>
      </div>

      <Weight settings={settings} />

      {showAccount && <AccountSheet user={user} onClose={() => setShowAccount(false)} />}

      {showSettings && settings && (
        <SettingsSheet
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            loadSettings();
          }}
        />
      )}
    </>
  );
}
