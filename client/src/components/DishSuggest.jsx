import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';

const fmt = (n) => String(n).replace('.', ',');

// "511 kcal · 20 g Protein · 66 g KH · 12 g Fett"
function facts(s) {
  const parts = [`${fmt(s.kcal)} kcal`];
  if (s.protein !== null) parts.push(`${fmt(s.protein)} g Protein`);
  if (s.carbs !== null) parts.push(`${fmt(s.carbs)} g KH`);
  if (s.fat !== null) parts.push(`${fmt(s.fat)} g Fett`);
  return parts.join(' · ');
}

// Vorschläge für fertige Gerichte aus Open Food Facts. Liegt in einem <form>, daher kein eigenes Formular:
// Enter startet nur die Suche. onPick erhält den Vorschlag; der Benutzer prüft die Werte im Formular.
export default function DishSuggest({ initialQuery, onPick, onClose }) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  async function search(term = q) {
    if (!term.trim()) return;
    const run = ++latest.current;
    setBusy(true);
    setError('');
    try {
      const { results: found } = await api.suggestDishes(term.trim());
      if (run === latest.current) setResults(found);
    } catch (err) {
      if (run !== latest.current) return;
      setResults(null);
      setError(err instanceof ApiError && err.status === 404 ? 'Die Online-Suche ist am Server abgeschaltet.' : err.message);
    } finally {
      if (run === latest.current) setBusy(false);
    }
  }

  // Beim Öffnen gleich mit dem bisherigen Namen suchen (falls schon einer eingetragen ist)
  useEffect(() => {
    search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stock-picker">
      <div className="stock-search">
        <input
          value={q}
          maxLength={100}
          placeholder="Gericht suchen, z. B. Lasagne"
          aria-label="Gericht suchen"
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
        />
        <button type="button" disabled={busy || !q.trim()} onClick={() => search()}>Suchen</button>
      </div>
      {busy && <p className="muted small">Suche läuft … (kann einige Sekunden dauern)</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {results && !busy && !results.length && <p className="muted small">Keine Vorschläge mit Nährwerten gefunden.</p>}
      {results && results.length > 0 && (
        <ul className="suggest-list">
          {results.map((s) => (
            <li key={s.barcode}>
              <button type="button" className="suggest-item" onClick={() => onPick(s)}>
                <span className="block">{s.name}{s.brand ? <span className="muted"> · {s.brand}</span> : null}</span>
                <span className="block muted small">{facts(s)}</span>
                <span className="block muted small">
                  {s.basis === 'portion' ? `pro Portion (${fmt(s.serving_g)} g)` : 'pro 100 g – Portionsgröße unbekannt, bitte anpassen'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="stock-footer">
        <span className="muted small">Daten von Open Food Facts (von Nutzern erfasst, bitte prüfen)</span>
        <button type="button" onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
