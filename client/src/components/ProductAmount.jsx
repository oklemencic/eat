import { useState } from 'react';
import { numText, parseNum } from '../lib/num.js';

const round1 = (n) => Math.round(n * 10) / 10;
const scale = (per100, g) => (per100 === null || per100 === undefined ? null : round1((per100 * g) / 100));

// Menge eines gescannten Produkts wählen (in g). Rechnet die Werte pro 100 g auf diese Menge um;
// onNext erhält die Startwerte für das Essens-Formular (Portionsfaktor 1 = diese Menge).
export default function ProductAmount({ product, onNext, onEdit }) {
  const [grams, setGrams] = useState(numText(product.serving_g ?? 100));
  const [error, setError] = useState('');
  const g = parseNum(grams);
  const valid = g !== null && !Number.isNaN(g) && g > 0 && g <= 5000;

  function submit(e) {
    e.preventDefault();
    if (!valid) return setError('Menge muss zwischen 0 und 5000 g liegen');
    onNext({
      name: `${product.name} (${numText(g)} g)`,
      kcal: scale(product.kcal_100, g),
      protein: scale(product.protein_100, g),
      carbs: scale(product.carbs_100, g),
      fat: scale(product.fat_100, g),
    });
  }

  return (
    <form className="form" onSubmit={submit}>
      <p>
        <strong>{product.name}</strong>
        {product.brand && <span className="muted"> · {product.brand}</span>}
        <span className="block muted small">
          pro 100 g: {Math.round(product.kcal_100)} kcal · {Math.round(product.protein_100)} g Protein
        </span>
      </p>
      <label>
        Menge (g)
        <input inputMode="decimal" value={grams} onChange={(e) => { setGrams(e.target.value); setError(''); }} autoFocus />
      </label>
      {valid && (
        <p className="total">
          Summe: <strong>{Math.round((product.kcal_100 * g) / 100)} kcal</strong>, {Math.round((product.protein_100 * g) / 100)} g Protein
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary">Weiter</button>
      <button type="button" onClick={onEdit}>Produkt bearbeiten</button>
    </form>
  );
}
