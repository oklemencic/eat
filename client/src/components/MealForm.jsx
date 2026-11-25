import { useState } from 'react';
import { numText, parseNum } from '../lib/num.js';
import CategorySelect from './CategorySelect.jsx';
import PhotoField from './PhotoField.jsx';

const PORTIONS = [0.5, 1, 1.5, 2];

// Formular für einen Essens-Eintrag (neu oder bearbeiten). Kalorien/Nährwerte gelten pro Portion,
// der Portionsfaktor skaliert die Summe. initial: { dish_id, name, category, kcal, protein, carbs, fat,
// portion, note, photo_id, time }. onSubmit erhält den Request-Body ohne eaten_at-Datum (nur time).
export default function MealForm({ initial, categories, onSubmit, onDelete, submitLabel, busy, error }) {
  const [name, setName] = useState(initial.name ?? '');
  const [category, setCategory] = useState(initial.category ?? null);
  const [kcal, setKcal] = useState(numText(initial.kcal));
  const [protein, setProtein] = useState(numText(initial.protein));
  const [carbs, setCarbs] = useState(numText(initial.carbs));
  const [fat, setFat] = useState(numText(initial.fat));
  const [portion, setPortion] = useState(numText(initial.portion ?? 1));
  const [time, setTime] = useState(initial.time);
  const [note, setNote] = useState(initial.note ?? '');
  const [photoId, setPhotoId] = useState(initial.photo_id ?? null);
  const [localError, setLocalError] = useState('');

  const factor = parseNum(portion);
  const perPortion = { kcal: parseNum(kcal), protein: parseNum(protein) };
  const showTotal = [factor, perPortion.kcal].every((v) => v !== null && !Number.isNaN(v));

  function submit(e) {
    e.preventDefault();
    const n = { kcal: parseNum(kcal), protein: parseNum(protein), carbs: parseNum(carbs), fat: parseNum(fat) };
    if (!name.trim()) return setLocalError('Name fehlt');
    if (n.kcal === null || Number.isNaN(n.kcal)) return setLocalError('Kalorien fehlen oder sind keine Zahl');
    if ([n.protein, n.carbs, n.fat].some(Number.isNaN)) return setLocalError('Nährwerte müssen Zahlen sein');
    if (factor === null || Number.isNaN(factor) || factor < 0.05 || factor > 20) {
      return setLocalError('Portion muss zwischen 0,05 und 20 liegen');
    }
    if (!time) return setLocalError('Uhrzeit fehlt');
    setLocalError('');
    onSubmit({
      dish_id: initial.dish_id ?? null,
      name: name.trim(),
      category,
      kcal: n.kcal,
      protein: n.protein ?? 0,
      carbs: n.carbs,
      fat: n.fat,
      portion: factor,
      note: note.trim() || null,
      photo_id: photoId,
      time,
    });
  }

  const shownError = localError || error;
  return (
    <form className="form" onSubmit={submit}>
      <label>
        Name
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus={!initial.name} />
      </label>

      <div className="portions" role="group" aria-label="Portionsfaktor">
        {PORTIONS.map((p) => (
          <button type="button" key={p} className={factor === p ? 'chip active' : 'chip'} onClick={() => setPortion(numText(p))}>
            {numText(p)}×
          </button>
        ))}
      </div>
      <div className="fields">
        <label>Portion (×)<input inputMode="decimal" value={portion} onChange={(e) => setPortion(e.target.value)} /></label>
        <label>Uhrzeit<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>

      <p className="muted small">Nährwerte pro Portion (anpassbar)</p>
      <div className="fields">
        <label>Kalorien (kcal)<input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
        <label>Protein (g)<input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} /></label>
        <label>Kohlenhydrate (g)<input inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} /></label>
        <label>Fett (g)<input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} /></label>
      </div>
      {showTotal && (
        <p className="total">
          Summe: <strong>{Math.round(perPortion.kcal * factor)} kcal</strong>
          {perPortion.protein !== null && !Number.isNaN(perPortion.protein) && `, ${Math.round(perPortion.protein * factor)} g Protein`}
        </p>
      )}

      <label>
        Kategorie
        <CategorySelect value={category} categories={categories} onChange={setCategory} />
      </label>
      <label>
        Notiz
        <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>
      <PhotoField value={photoId} onChange={setPhotoId} />

      {shownError && <p className="error" role="alert">{shownError}</p>}
      <button className="primary" disabled={busy}>{submitLabel}</button>
      {onDelete && <button type="button" className="danger" disabled={busy} onClick={onDelete}>Eintrag löschen</button>}
    </form>
  );
}
