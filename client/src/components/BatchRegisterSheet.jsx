import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Sheet from './Sheet.jsx';
import BarcodeScanner from './BarcodeScanner.jsx';
import ProductForm from './ProductForm.jsx';

// Gleicher Artikel unabhängig von führenden Nullen (UPC-A <-> EAN-13), wie beim Speichern auf dem Server
const keyOf = (code) => code.replace(/^0+/, '') || '0';

// Status je Barcode:
// queued -> checking -> known (schon registriert) | ready (vollständiger Vorschlag) | incomplete (manuell ergänzen) | error (erneut versuchen)
// ready/incomplete -> saved (gespeichert)
const STATUS_TEXT = {
  queued: 'wartet …',
  checking: 'wird gesucht …',
  known: 'bereits registriert',
  ready: 'Vorschlag aus Open Food Facts, bereit zum Übernehmen',
  incomplete: 'bitte ergänzen',
  error: 'Fehler, antippen zum Wiederholen',
  saved: 'gespeichert',
};
const STATUS_ICON = { queued: '…', checking: '…', known: '✓', ready: '●', incomplete: '✎', error: '!', saved: '✓' };

// Mehrere Produkte auf einmal registrieren (z. B. den Vorrat zu Hause): Barcodes nacheinander scannen oder
// eintippen/einfügen. Jeder Code wird nacheinander geprüft (schon registriert? sonst Vorschlag aus Open Food Facts).
// Vollständige Vorschläge werden gesammelt und mit einem Klick übernommen, unvollständige ergänzt man einzeln.
export default function BatchRegisterSheet({ onClose }) {
  const [items, setItems] = useState([]); // neueste zuerst: { key, code, status, draft?, product?, message? }
  const [editing, setEditing] = useState(null); // key des Eintrags im Formular
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // wichtig im StrictMode: Aufräumen und erneutes Einhängen
    return () => { alive.current = false; };
  }, []);

  const patch = useCallback((key, changes) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...changes } : i))), []);

  const add = useCallback((code) => {
    const key = keyOf(code);
    setItems((list) => (list.some((i) => i.key === key) ? list : [{ key, code, status: 'queued' }, ...list]));
  }, []);

  // Eine Prüfung nach der anderen: schont die Produktdatenbank und hält die Reihenfolge nachvollziehbar
  useEffect(() => {
    if (items.some((i) => i.status === 'checking')) return;
    const next = [...items].reverse().find((i) => i.status === 'queued'); // älteste zuerst
    if (!next) return;
    patch(next.key, { status: 'checking' });
    check(next.code).then((result) => alive.current && patch(next.key, result));
  }, [items, patch]);

  async function check(code) {
    try {
      const product = await api.productByBarcode(code);
      if (product) return { status: 'known', product };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
    try {
      const draft = await api.lookupProduct(code);
      if (!draft) return { status: 'incomplete', draft: null, message: 'Nicht in Open Food Facts gefunden' };
      const complete = Boolean(draft.name) && draft.kcal_100 !== null;
      return { status: complete ? 'ready' : 'incomplete', draft, message: complete ? undefined : 'Angaben unvollständig' };
    } catch (e) {
      // Produktdatenbank nicht erreichbar: manuelle Eingabe bleibt möglich
      return { status: 'incomplete', draft: null, message: e.status === 502 ? 'Produktdatenbank nicht erreichbar' : e.message };
    }
  }

  const ready = items.filter((i) => i.status === 'ready');
  const open = items.filter((i) => ['queued', 'checking', 'ready', 'incomplete', 'error'].includes(i.status));
  const saved = items.filter((i) => i.status === 'saved').length;

  function close() {
    if (open.length && !window.confirm(`${open.length} Produkt(e) wurden noch nicht übernommen. Trotzdem schließen?`)) return;
    onClose();
  }

  async function saveReady() {
    setBusy(true);
    setError('');
    try {
      const { results } = await api.addProducts(ready.map((i) => ({ ...i.draft, barcode: i.code, protein_100: i.draft.protein_100 ?? 0 })));
      setItems((list) => list.map((i) => {
        const idx = ready.findIndex((r) => r.key === i.key);
        const res = idx === -1 ? null : results[idx];
        if (!res) return i;
        if (res.status === 'invalid') return { ...i, status: 'incomplete', message: `Ungültig: ${res.error}` };
        return { ...i, status: res.status === 'exists' ? 'known' : 'saved', product: res.product };
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveOne(item, data) {
    setBusy(true);
    setError('');
    try {
      if (item.product) {
        patch(item.key, { product: await api.updateProduct(item.product.id, data) });
      } else {
        patch(item.key, { status: 'saved', product: await api.addProduct(data), message: undefined });
      }
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(item) {
    if (!window.confirm(`„${item.product.name}“ aus den Produkten löschen? Bereits eingetragene Mahlzeiten bleiben erhalten.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteProduct(item.product.id);
      setItems((list) => list.filter((i) => i.key !== item.key));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const item = editing && items.find((i) => i.key === editing);
  if (item) {
    const back = () => { setEditing(null); setError(''); };
    return (
      <Sheet title={item.product ? 'Produkt bearbeiten' : 'Produkt ergänzen'} onClose={close} onBack={back}>
        {item.message && !item.product && <p className="muted small">{item.message}</p>}
        <ProductForm
          barcode={item.code}
          product={item.product}
          prefill={item.draft}
          onSave={(data) => saveOne(item, data)}
          onDelete={item.product ? () => removeOne(item) : undefined}
          busy={busy}
          error={error}
        />
      </Sheet>
    );
  }

  const tap = (i) => {
    if (i.status === 'error') return patch(i.key, { status: 'queued', message: undefined });
    if (['ready', 'incomplete', 'known', 'saved'].includes(i.status)) {
      setError('');
      setEditing(i.key);
    }
  };

  return (
    <Sheet title="Produkte erfassen" onClose={close}>
      <p className="muted small">
        Barcodes nacheinander scannen oder eintippen. Unbekannte Produkte werden in Open Food Facts nachgeschlagen
        (dorthin geht nur der Barcode). Die Vorschläge stammen von Nutzern: Bei Unsicherheit mit der Packung vergleichen.
      </p>
      <BarcodeScanner continuous onDetected={add} />
      {error && <p className="error" role="alert">{error}</p>}

      {items.length > 0 && (
        <>
          <p className="muted small" role="status">
            {items.length} Code(s): {saved} gespeichert, {ready.length} bereit, {items.filter((i) => i.status === 'incomplete').length} zu ergänzen
          </p>
          <button className="primary" disabled={busy || !ready.length} onClick={saveReady}>
            {ready.length ? `${ready.length} Vorschlag/Vorschläge übernehmen` : 'Nichts zum Übernehmen'}
          </button>
          <ul className="list batch-list">
            {items.map((i) => {
              const name = i.product?.name ?? i.draft?.name;
              const tappable = i.status !== 'queued' && i.status !== 'checking';
              return (
                <li key={i.key}>
                  <button className="row" disabled={!tappable} onClick={() => tap(i)} data-status={i.status}>
                    <span className="batch-icon" aria-hidden="true">{STATUS_ICON[i.status]}</span>
                    <span className="grow">
                      <span className="block">{name || i.code}</span>
                      <span className="block muted small">
                        {name ? `${i.code} · ` : ''}{i.message && i.status !== 'saved' ? i.message : STATUS_TEXT[i.status]}
                      </span>
                    </span>
                  </button>
                  {['ready', 'incomplete', 'error'].includes(i.status) && (
                    <button className="ghost" aria-label={`${name || i.code} aus der Liste entfernen`} onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}>✕</button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
