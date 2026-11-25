import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Sheet from './Sheet.jsx';

const MIN_PASSWORD_LENGTH = 12;

function checkNewPassword(password, again) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Das neue Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
  if (password !== again) return 'Die neuen Passwörter stimmen nicht überein.';
  return '';
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const problem = checkNewPassword(password, again);
    if (problem) return setMsg({ text: problem, error: true });
    setBusy(true);
    try {
      await api.changePassword(current, password);
      setCurrent('');
      setPassword('');
      setAgain('');
      setMsg({ text: 'Passwort geändert.', error: false });
    } catch (err) {
      setMsg({ text: err.status === 403 ? 'Das aktuelle Passwort ist falsch.' : err.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h3>Eigenes Passwort ändern</h3>
      <label>
        Aktuelles Passwort
        <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label>
        Neues Passwort (mindestens {MIN_PASSWORD_LENGTH} Zeichen)
        <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Neues Passwort wiederholen
        <input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {msg.text && <p className={msg.error ? 'error' : undefined} role={msg.error ? 'alert' : 'status'}>{msg.text}</p>}
      <button className="primary" disabled={busy || !current || !password || !again}>Passwort ändern</button>
    </form>
  );
}

function UserRow({ user, self, onChanged, onError }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function reset(e) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return onError(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
    setBusy(true);
    try {
      await api.resetUserPassword(user.id, password);
      setResetting(false);
      setPassword('');
      onError('');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Benutzer „${user.username}“ mit ALLEN seinen Daten (Gerichte, Mahlzeiten, Trainings, Gewicht) löschen?`)) return;
    try {
      await api.deleteUser(user.id);
      onChanged();
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <li>
      <div className="entry">
        <div className="grow">
          {user.username}
          {user.is_admin && <span className="muted small"> · Administrator</span>}
          {self && <span className="muted small"> · du</span>}
        </div>
        {!self && (
          <>
            <button type="button" onClick={() => setResetting(!resetting)}>Passwort</button>
            <button type="button" className="danger" onClick={remove}>Löschen</button>
          </>
        )}
      </div>
      {resetting && (
        <form className="inline" onSubmit={reset}>
          <input
            type="password"
            autoComplete="new-password"
            aria-label={`Neues Passwort für ${user.username}`}
            placeholder="Neues Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="primary" disabled={busy || !password}>Setzen</button>
        </form>
      )}
    </li>
  );
}

function Users({ me }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.users().then(setUsers, (e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function add(e) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
    setBusy(true);
    setError('');
    try {
      await api.addUser(username.trim(), password, isAdmin);
      setUsername('');
      setPassword('');
      setIsAdmin(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>Benutzer</h3>
      <ul className="list card">
        {users.map((u) => (
          <UserRow key={u.id} user={u} self={u.id === me.id} onChanged={load} onError={setError} />
        ))}
      </ul>
      <form className="form" onSubmit={add}>
        <h3>Benutzer hinzufügen</h3>
        <label>
          Benutzername
          <input autoComplete="off" autoCapitalize="none" required minLength={2} maxLength={40} value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Startpasswort (mindestens {MIN_PASSWORD_LENGTH} Zeichen)
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
          Administrator (darf Benutzer verwalten)
        </label>
        <p className="muted small">
          Buchstaben, Ziffern, „.“, „_“ und „-“, 2–40 Zeichen. Jeder Benutzer hat eigene Gerichte, Einträge und Einstellungen.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy || !username.trim() || !password}>Hinzufügen</button>
      </form>
    </>
  );
}

// Eigenes Konto (Passwort) und, für Administratoren, die Benutzerverwaltung
export default function AccountSheet({ user, onClose }) {
  return (
    <Sheet title="Konto" onClose={onClose}>
      <p className="muted">Angemeldet als <strong>{user.username}</strong>{user.is_admin ? ' (Administrator)' : ''}.</p>
      <ChangePassword />
      {user.is_admin && <Users me={user} />}
    </Sheet>
  );
}
