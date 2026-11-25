import { useState } from 'react';
import { numText, parseNum } from '../lib/num.js';

// Produkt registrieren/bearbeiten. Nährwerte gelten pro 100 g. product = null: neues Produkt zum Barcode,
// optional mit prefill (Vorschlag aus Open Food Facts, Felder wie das Produkt, fehlende = null).
// onSave erhält den Request-Body; onDelete ist nur beim Bearbeiten gesetzt.
export default function ProductForm({ barcode, product, prefill, onSave, onDelete, busy, error }) {
  const start = product ?? prefill;
  const [name, setName] = useState(start?.name ?? '');
  const [brand, setBrand] = useState(start?.brand ?? '');
  const [kcal, setKcal] = useState(numText(start?.kcal_100));
  const [protein, setProtein] = useState(numText(start?.protein_100));
  const [carbs, setCarbs] = useState(numText(start?.carbs_100));
  const [fat, setFat] = useState(numText(start?.fat_100));
  const [serving, setServing] = useState(numText(start?.serving_g));
  const [localError, setLocalError] = useState('');

  function submit(e) {
    e.preventDefault();
    const n = { kcal: parseNum(kcal), protein: parseNum(protein), carbs: parseNum(carbs), fat: parseNum(fat), serving: parseNum(serving) };
    if (!name.trim()) return setLocalError('Name fehlt');
    if (n.kcal === null || Number.isNaN(n.kcal)) return setLocalError('Kalorien fehlen oder sind keine Zahl');
    if ([n.protein, n.carbs, n.fat, n.serving].some(Number.isNaN)) return setLocalError('Nährwerte und Portionsgröße müssen Zahlen sein');
    if (n.kcal > 1000 || [n.protein, n.carbs, n.fat].some((v) => v !== null && v > 100)) {
      return setLocalError('Werte pro 100 g: max. 1000 kcal und 100 g je Nährstoff');
    }
    if (n.serving !== null && (n.serving < 1 || n.serving > 5000)) return setLocalError('Portionsgröße muss zwischen 1 und 5000 g liegen');
    setLocalError('');
    onSave({
      barcode: product?.barcode ?? barcode,
      name: name.trim(),
      brand: brand.trim() || null,
      kcal_100: n.kcal,
      protein_100: n.protein ?? 0,
      carbs_100: n.carbs,
      fat_100: n.fat,
      serving_g: n.serving,
    });
  }

  const shownError = localError || error;
  return (
    <form className="form" onSubmit={submit}>
      <p className="muted small">Barcode {product?.barcode ?? barcode}</p>
      {!product && prefill?.source === 'openfoodfacts' && (
        <p className="muted small">Vorschlag aus Open Food Facts (Angaben von Nutzern). Bitte mit der Packung vergleichen.</p>
      )}
      <label>
        Name
        <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus={!product} />
      </label>
      <label>
        Marke (optional)
        <input value={brand} maxLength={100} onChange={(e) => setBrand(e.target.value)} />
      </label>
      <p className="muted small">Nährwerte pro 100 g</p>
      <div className="fields">
        <label>Kalorien (kcal)<input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
        <label>Protein (g)<input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} /></label>
        <label>Kohlenhydrate (g)<input inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} /></label>
        <label>Fett (g)<input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} /></label>
      </div>
      <label>
        Übliche Portion in g (optional)
        <input inputMode="decimal" value={serving} onChange={(e) => setServing(e.target.value)} />
      </label>
      {shownError && <p className="error" role="alert">{shownError}</p>}
      <button className="primary" disabled={busy}>Speichern</button>
      {onDelete && <button type="button" className="danger" disabled={busy} onClick={onDelete}>Produkt löschen</button>}
    </form>
  );
}
