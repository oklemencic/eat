import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { addDays, today } from '../lib/date.js';
import { fmt, weekdayDate } from '../lib/format.js';
import Sheet from '../components/Sheet.jsx';
import WorkoutForm from '../components/WorkoutForm.jsx';

const HISTORY_DAYS = 90;

const summarize = (sets) =>
  sets.map((s) => `${s.exercise} ${s.sets}×${s.reps}${s.weight_kg ? ` @ ${fmt(s.weight_kg, 1)} kg` : ''}`).join(', ');

export default function Sport() {
  const [workouts, setWorkouts] = useState(null);
  const [records, setRecords] = useState([]);
  const [editing, setEditing] = useState(null); // null = zu, 'new' = neu, sonst das Training
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [w, r] = await Promise.all([api.workouts({ from: addDays(today(), -HISTORY_DAYS) }), api.workoutRecords()]);
      setWorkouts(w);
      setRecords(r);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const exercises = useMemo(() => records.map((r) => r.exercise), [records]);

  const closeForm = () => {
    setEditing(null);
    setFormError('');
  };

  async function run(fn) {
    setBusy(true);
    setFormError('');
    try {
      await fn();
      closeForm();
      await load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const save = (w) => run(() => (editing === 'new' ? api.addWorkout(w) : api.updateWorkout(editing.id, w)));
  const remove = () => {
    if (window.confirm(`Training vom ${weekdayDate(editing.date)} löschen?`)) run(() => api.deleteWorkout(editing.id));
  };

  return (
    <>
      <header className="page-head"><h1>Sport</h1></header>
      {error && <p className="error" role="alert">{error}</p>}

      {records.length > 0 && (
        <details className="card records">
          <summary>Bestleistungen ({records.length})</summary>
          <table className="table">
            <thead>
              <tr><th scope="col">Übung</th><th scope="col" className="num">Bestwert</th><th scope="col" className="num">Datum</th></tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.exercise}>
                  <td>{r.exercise}</td>
                  <td className="num">{r.weight_kg ? `${fmt(r.weight_kg, 1)} kg × ${r.reps}` : `${r.reps} Wdh.`}</td>
                  <td className="num muted">{weekdayDate(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <h2>Trainings</h2>
      {workouts &&
        (workouts.length === 0 ? (
          <p className="muted">In den letzten {HISTORY_DAYS} Tagen kein Training eingetragen.</p>
        ) : (
          <ul className="list card">
            {workouts.map((w) => (
              <li key={w.id}>
                <button className="row" aria-label={`Training vom ${weekdayDate(w.date)} bearbeiten`} onClick={() => setEditing(w)}>
                  <span className="grow">
                    <span className="block">{w.category} <span className="muted">· {w.duration_min} min</span></span>
                    <span className="block muted small">{weekdayDate(w.date)}</span>
                    {w.sets.length > 0 && <span className="block muted small clamp">{summarize(w.sets)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}

      <button className="fab" aria-label="Training eintragen" onClick={() => setEditing('new')}>＋</button>

      {editing && (
        <Sheet title={editing === 'new' ? 'Neues Training' : 'Training bearbeiten'} onClose={closeForm}>
          <WorkoutForm
            workout={editing === 'new' ? null : editing}
            exercises={exercises}
            onSave={save}
            onDelete={editing === 'new' ? undefined : remove}
            busy={busy}
            error={formError}
          />
        </Sheet>
      )}
    </>
  );
}
