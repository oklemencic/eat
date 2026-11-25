import { useState } from 'react';
import { numText, parseNum } from '../lib/num.js';
import CategorySelect from './CategorySelect.jsx';
import PhotoField from './PhotoField.jsx';

// Anlegen/Bearbeiten eines Gerichts. Nährwerte gelten pro Portion. dish = null: neues Gericht.
// onSave erhält den Request-Body; onDelete ist nur beim Bearbeiten gesetzt.
export default function DishForm({ dish, categories, onSave, onDelete, busy, error }) {
  const [name, setName] = useState(dish?.name ?? '');
  const [category, setCategory] = useState(dish?.category ?? null);
  const [kcal, setKcal] = useState(numText(dish?.kcal));
  const [protein, setProtein] = useState(numText(dish?.protein));
  const [carbs, setCarbs] = useState(numText(dish?.carbs));
  const [fat, setFat] = useState(numText(dish?.fat));
  const [favorite, setFavorite] = useState(dish?.favorite ?? false);
  const [photoId, setPhotoId] = useState(dish?.photo_id ?? null);
  const [localError, setLocalError] = useState('');

  function submit(e) {
    e.preventDefault();
    const n = { kcal: parseNum(kcal), protein: parseNum(protein), carbs: parseNum(carbs), fat: parseNum(fat) };
    if (!name.trim()) return setLocalError('Name fehlt');
    if (n.kcal === null || Number.isNaN(n.kcal)) return setLocalError('Kalorien fehlen oder sind keine Zahl');
    if ([n.protein, n.carbs, n.fat].some(Number.isNaN)) return setLocalError('Nährwerte müssen Zahlen sein');
    setLocalError('');
    onSave({
      name: name.trim(),
      category,
      kcal: n.kcal,
      protein: n.protein ?? 0,
      carbs: n.carbs,
      fat: n.fat,
      favorite,
      photo_id: photoId,
    });
  }

  const shownError = localError || error;
  return (
    <form className="form" onSubmit={submit}>
      <label>
        Name
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus={!dish} />
      </label>
      <label>
        Kategorie
        <CategorySelect value={category} categories={categories} onChange={setCategory} />
      </label>
      <p className="muted small">Nährwerte pro Portion</p>
      <div className="fields">
        <label>Kalorien (kcal)<input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
        <label>Protein (g)<input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} /></label>
        <label>Kohlenhydrate (g)<input inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} /></label>
        <label>Fett (g)<input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} /></label>
      </div>
      <label className="check">
        <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
        Favorit
      </label>
      <PhotoField value={photoId} onChange={setPhotoId} />
      {shownError && <p className="error" role="alert">{shownError}</p>}
      <button className="primary" disabled={busy}>Speichern</button>
      {onDelete && (
        <button type="button" className="danger" disabled={busy} onClick={onDelete}>Gericht löschen</button>
      )}
    </form>
  );
}
