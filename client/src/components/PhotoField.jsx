import { useRef, useState } from 'react';
import { api, photoUrl } from '../api.js';

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

// value: Foto-ID oder null; onChange erhält die neue ID bzw. null
export default function PhotoField({ value, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
        {value && !busy && <button type="button" className="danger" onClick={() => onChange(null)}>Entfernen</button>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
