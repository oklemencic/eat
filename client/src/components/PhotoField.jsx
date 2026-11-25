import { useEffect, useRef, useState } from 'react';
import { api, photoUrl } from '../api.js';
import StockPicker from './StockPicker.jsx';

const MAX_SIDE = 1280;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

// Verkleinert Handy-Fotos vor dem Upload (max. 1280 px, JPEG). Das spart Platz auf dem Server
// und bleibt unter dem 10-MB-Limit. Fallback: Originaldatei, falls das Format direkt erlaubt ist.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (blob) return blob;
  } catch {
    // Bild nicht dekodierbar: unten Fallback oder Fehler
  }
  if (ALLOWED.includes(file.type)) return file;
  throw new Error('Bildformat wird nicht unterstützt (JPEG, PNG oder WebP)');
}

// Ob eine Bildsuche eingerichtet ist (API-Keys am Server), wird einmal je Seitenaufruf abgefragt
let stockAvailable = null;
function useStockAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    stockAvailable ??= api.stockProviders().then((r) => r.providers.length > 0, () => { stockAvailable = null; return false; });
    stockAvailable.then((v) => alive && setAvailable(v));
    return () => { alive = false; };
  }, []);
  return available;
}

// value: Foto-ID oder null; onChange erhält die neue ID bzw. null; query: Vorschlag für die Online-Bildsuche (z. B. Gerichtname)
export default function PhotoField({ value, onChange, query = '' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const stock = useStockAvailable();

  async function pick(e) {
    const file = e.target.files[0];
    e.target.value = ''; // dieselbe Datei erneut wählbar
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const { id } = await api.uploadPhoto(await shrink(file));
      onChange(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photo-field">
      {value ? <img src={photoUrl(value)} alt="Foto" /> : <div className="photo-empty muted small">Kein Foto</div>}
      <div className="photo-actions">
        <button type="button" disabled={busy} onClick={() => input.current.click()}>
          {busy ? 'Lädt hoch …' : value ? 'Foto ersetzen' : 'Foto hinzufügen'}
        </button>
        {stock && !busy && !searching && <button type="button" onClick={() => setSearching(true)}>Online suchen</button>}
        {value && !busy && <button type="button" className="danger" onClick={() => onChange(null)}>Entfernen</button>}
      </div>
      {searching && (
        <StockPicker
          initialQuery={query}
          onPick={(id) => { onChange(id); setSearching(false); }}
          onClose={() => setSearching(false)}
        />
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
