import { useState } from 'react';
import { api } from '../api.js';

export const MIN_PASSWORD_LENGTH = 12;

// Erster Start ohne Benutzer: Der erste Benutzer wird Administrator und kann danach weitere anlegen.
export default function Setup({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
    if (password !== again) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    setError('');
    try {
      onDone(await api.setup(username.trim(), password));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="login card" onSubmit={submit}>
      <h1>Eat</h1>
      <p className="muted">
        Willkommen! Lege den ersten Benutzer an. Er ist Administrator und kann später weitere Benutzer hinzufügen.
        Bereits vorhandene Daten gehören danach diesem Benutzer.
      </p>
      <label>
        Benutzername
        <input
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          required
          minLength={2}
          maxLength={40}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label>
        Passwort (mindestens {MIN_PASSWORD_LENGTH} Zeichen)
        <input
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        Passwort wiederholen
        <input
          type="password"
          autoComplete="new-password"
          required
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy || !username.trim() || !password || !again}>Benutzer anlegen</button>
    </form>
  );
}
