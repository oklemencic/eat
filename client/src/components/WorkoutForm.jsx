import { useState } from 'react';
import { today } from '../lib/date.js';
import { numText, parseNum } from '../lib/num.js';

const CATEGORIES = ['Krafttraining', 'Laufen', 'Radfahren', 'Schwimmen', 'Gehen', 'Sonstiges'];

const blankSet = (prev) => ({
  exercise: prev?.exercise ?? '',
  sets: prev?.sets ?? '3',
  reps: prev?.reps ?? '8',
  weight_kg: prev?.weight_kg ?? '',
});

// Anlegen/Bearbeiten eines Trainings samt Sätzen (Übung, Sätze, Wiederholungen, Gewicht).
// workout = null: neu. exercises: bekannte Übungsnamen für die Vorschlagsliste.
export default function WorkoutForm({ workout, exercises, onSave, onDelete, busy, error }) {
  const [date, setDate] = useState(workout?.date ?? today());
  const [category, setCategory] = useState(workout?.category ?? 'Krafttraining');
  const [duration, setDuration] = useState(numText(workout?.duration_min));
  const [note, setNote] = useState(workout?.note ?? '');
  const [rows, setRows] = useState(
    (workout?.sets ?? []).map((s) => ({
      exercise: s.exercise, sets: String(s.sets), reps: String(s.reps), weight_kg: numText(s.weight_kg),
    })),
  );
  const [localError, setLocalError] = useState('');

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function submit(e) {
    e.preventDefault();
    const minutes = parseNum(duration);
    if (!category.trim()) return setLocalError('Kategorie fehlt');
    if (minutes === null || Number.isNaN(minutes) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      return setLocalError('Dauer in ganzen Minuten angeben (1–1440)');
    }
    // Komplett leere Zeilen werden ignoriert
    const used = rows.filter((r) => r.exercise.trim() || r.weight_kg.trim());
    const sets = [];
    for (const [i, r] of used.entries()) {
      const n = { sets: parseNum(r.sets), reps: parseNum(r.reps), weight_kg: parseNum(r.weight_kg) };
      const intOk = (v) => v !== null && Number.isInteger(v) && v >= 1;
      if (!r.exercise.trim()) return setLocalError(`Übung ${i + 1}: Name fehlt`);
      if (!intOk(n.sets) || !intOk(n.reps)) return setLocalError(`Übung ${i + 1}: Sätze und Wiederholungen als ganze Zahlen ab 1`);
      if (Number.isNaN(n.weight_kg)) return setLocalError(`Übung ${i + 1}: Gewicht muss eine Zahl sein`);
      sets.push({ exercise: r.exercise.trim(), sets: n.sets, reps: n.reps, weight_kg: n.weight_kg ?? 0 });
    }
    setLocalError('');
    onSave({ date, category: category.trim(), duration_min: minutes, note: note.trim() || null, sets });
  }

  const shownError = localError || error;
  return (
    <form className="form" onSubmit={submit}>
      <div className="fields">
        <label>
          Datum
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          Dauer (Minuten)
          <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} autoFocus={!workout} />
        </label>
      </div>
      <label>
        Kategorie
        <input list="workout-categories" value={category} maxLength={50} onChange={(e) => setCategory(e.target.value)} />
        <datalist id="workout-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
      </label>

      <h3>Übungen</h3>
      <datalist id="exercise-names">{exercises.map((n) => <option key={n} value={n} />)}</datalist>
      {rows.map((r, i) => (
        <fieldset className="set-row" key={i}>
          <legend className="sr-only">Übung {i + 1}</legend>
          <div className="set-head">
            <input
              aria-label={`Übung ${i + 1}: Name`}
              placeholder="Übung"
              list="exercise-names"
              value={r.exercise}
              maxLength={100}
              onChange={(e) => setRow(i, { exercise: e.target.value })}
            />
            <button type="button" className="ghost danger" aria-label={`Übung ${i + 1} entfernen`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </div>
          <div className="fields three">
            <label>Sätze<input inputMode="numeric" value={r.sets} onChange={(e) => setRow(i, { sets: e.target.value })} /></label>
            <label>Wdh.<input inputMode="numeric" value={r.reps} onChange={(e) => setRow(i, { reps: e.target.value })} /></label>
            <label>kg<input inputMode="decimal" value={r.weight_kg} onChange={(e) => setRow(i, { weight_kg: e.target.value })} /></label>
          </div>
        </fieldset>
      ))}
      <button type="button" onClick={() => setRows([...rows, blankSet(rows.at(-1))])}>＋ Übung hinzufügen</button>

      <label>
        Notiz
        <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>
      {shownError && <p className="error" role="alert">{shownError}</p>}
      <button className="primary" disabled={busy}>Speichern</button>
      {onDelete && <button type="button" className="danger" disabled={busy} onClick={onDelete}>Training löschen</button>}
    </form>
  );
}
