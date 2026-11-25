import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const LABELS = { pexels: 'Pexels', pixabay: 'Pixabay' };

// Bildsuche bei Pexels/Pixabay. Liegt in einem <form>, daher kein eigenes Formular: Enter startet nur die Suche.
// onPick erhält die ID des heruntergeladenen und lokal gespeicherten Fotos.
export default function StockPicker({ initialQuery, onPick, onClose }) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  async function search(term = q) {
    if (!term.trim()) return;
    const run = ++latest.current;
    setBusy(true);
    setError('');
    try {
      const { results: found } = await api.stockSearch(term.trim());
      if (run === latest.current) setResults(found);
    } catch (err) {
      if (run === latest.current) setError(err.message);
    } finally {
      if (run === latest.current) setBusy(false);
    }
  }

  // Beim Öffnen gleich mit dem Namen des Gerichts suchen
  useEffect(() => {
    search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(r) {
    setImporting(true);
    setError('');
    try {
      const { id } = await api.importStockPhoto(r.provider, r.url);
      onPick(id);
    } catch (err) {
      setError(err.message);
      setImporting(false);
    }
  }

  return (
    <div className="stock-picker">
      <div className="stock-search">
        <input
          value={q}
          maxLength={100}
          placeholder="Suchbegriff, z. B. Spaghetti"
          aria-label="Suchbegriff"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
        />
        <button type="button" disabled={busy || importing || !q.trim()} onClick={() => search()}>Suchen</button>
      </div>
      {busy && <p className="muted small">Suche läuft …</p>}
      {importing && <p className="muted small">Bild wird übernommen …</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {results && !busy && !results.length && !error && <p className="muted small">Keine Bilder gefunden.</p>}
      {results && results.length > 0 && (
        <ul className="stock-grid">
          {results.map((r) => (
            <li key={r.url}>
              <button type="button" className="stock-thumb" disabled={importing} onClick={() => choose(r)} aria-label={`Bild von ${r.author || LABELS[r.provider]} wählen`}>
                <img src={r.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </button>
              <span className="muted small">
                {r.page
                  ? <a href={r.page} target="_blank" rel="noopener noreferrer">{r.author || LABELS[r.provider]}</a>
                  : r.author}
                {' · '}{LABELS[r.provider]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="stock-footer">
        <span className="muted small">Fotos von Pexels und Pixabay</span>
        <button type="button" onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
