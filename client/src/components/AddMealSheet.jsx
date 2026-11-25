import { useEffect, useMemo, useState } from 'react';
import { api, photoUrl } from '../api.js';
import { nowMinute, today } from '../lib/date.js';
import Sheet from './Sheet.jsx';
import MealForm from './MealForm.jsx';
import DishForm from './DishForm.jsx';
import BarcodeScanner from './BarcodeScanner.jsx';
import ProductForm from './ProductForm.jsx';
import ProductAmount from './ProductAmount.jsx';

// Vorbelegte Uhrzeit: heute jetzt, an anderen Tagen Mittag als neutrale Zeit
const defaultTime = (date) => (date === today() ? nowMinute().slice(11) : '12:00');

const fromDish = (d, time) => ({
  dish_id: d.id, name: d.name, category: d.category, kcal: d.kcal, protein: d.protein,
  carbs: d.carbs, fat: d.fat, portion: 1, photo_id: d.photo_id, time,
});

// Essen hinzufügen: erst ein Gericht wählen (Zuletzt gegessen, Suche), ein neues Gericht anlegen, ein Produkt
// per Barcode scannen oder einen eigenen Eintrag erfassen, dann im Formular Portion und Werte anpassen.
export default function AddMealSheet({ date, categories, onClose, onAdded }) {
  const [dishes, setDishes] = useState([]);
  const [recent, setRecent] = useState([]);
  const [query, setQuery] = useState('');
  const [initial, setInitial] = useState(null); // gesetzt = Formular-Schritt
  const [creating, setCreating] = useState(false); // true = Formular für ein neues Gericht
  // Barcode-Ablauf: null | { step: 'scan' } | { step: 'register', barcode, prefill? } | { step: 'amount', product } | { step: 'edit', product }
  const [flow, setFlow] = useState(null);
  const [looking, setLooking] = useState(false); // Barcode erkannt, Produkt wird gesucht
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.dishes(), api.recentDishes(6)]).then(([all, rec]) => {
      setDishes(all);
      setRecent(rec);
    }, (e) => setError(e.message));
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? dishes.filter((d) => d.name.toLowerCase().includes(q)) : dishes), [dishes, q]);

  async function add({ time, ...meal }) {
    setBusy(true);
    setError('');
    try {
      await api.addMeal({ ...meal, eaten_at: `${date}T${time}` });
      onAdded();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  // Neues Gericht speichern und direkt als Essens-Eintrag weiterverwenden
  async function createDish(dish) {
    setBusy(true);
    setError('');
    try {
      const created = await api.addDish(dish);
      // Reihenfolge wie vom Server: Favoriten zuerst, dann alphabetisch
      setDishes((list) => [...list, created].sort((a, b) => b.favorite - a.favorite || a.name.localeCompare(b.name, 'de')));
      setCreating(false);
      setInitial(fromDish(created, defaultTime(date)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Barcode erkannt: eigenes Produkt -> Menge wählen; sonst Vorschlag aus Open Food Facts (falls vorhanden)
  // oder leeres Formular zum Registrieren. Ein Ausfall der Produktdatenbank blockiert die manuelle Eingabe nicht.
  async function scanned(code) {
    setError('');
    setLooking(true);
    try {
      const product = await api.productByBarcode(code);
      if (product) return setFlow({ step: 'amount', product });
      const prefill = await api.lookupProduct(code).catch(() => null);
      setFlow({ step: 'register', barcode: code, prefill });
    } catch (e) {
      setError(e.message);
      setFlow({ step: 'scan', n: Date.now() }); // Scanner neu starten (er hört nach einem Treffer auf)
    } finally {
      setLooking(false);
    }
  }

  async function saveProduct(data) {
    setBusy(true);
    setError('');
    try {
      const product = flow.step === 'edit' ? await api.updateProduct(flow.product.id, data) : await api.addProduct(data);
      setFlow({ step: 'amount', product });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeProduct() {
    if (!window.confirm(`„${flow.product.name}“ aus den Produkten löschen? Bereits eingetragene Mahlzeiten bleiben erhalten.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteProduct(flow.product.id);
      setFlow(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <Sheet title="Neues Gericht" onClose={onClose} onBack={() => { setCreating(false); setError(''); }}>
        <DishForm categories={categories} onSave={createDish} busy={busy} error={error} />
      </Sheet>
    );
  }

  if (initial) {
    return (
      <Sheet title={initial.name || 'Eigener Eintrag'} onClose={onClose} onBack={() => { setInitial(null); setError(''); }}>
        <MealForm
          initial={initial}
          categories={categories}
          onSubmit={add}
          submitLabel="Hinzufügen"
          busy={busy}
          error={error}
        />
      </Sheet>
    );
  }

  if (flow) {
    const back = () => {
      setError('');
      // Beim Bearbeiten zurück zur Mengenwahl, sonst zurück zum Scannen
      setFlow(flow.step === 'edit' ? { step: 'amount', product: flow.product } : { step: 'scan', n: Date.now() });
    };
    const leave = () => { setFlow(null); setError(''); };
    const errorLine = error && <p className="error" role="alert">{error}</p>;
    if (flow.step === 'scan') {
      return (
        <Sheet title="Barcode scannen" onClose={onClose} onBack={leave}>
          {errorLine}
          {looking && <p className="muted small" role="status">Suche Produktdaten …</p>}
          <BarcodeScanner key={flow.n} onDetected={scanned} />
        </Sheet>
      );
    }
    if (flow.step === 'register') {
      return (
        <Sheet title="Neues Produkt" onClose={onClose} onBack={back}>
          <p className="muted small">
            {flow.prefill
              ? 'Dieser Barcode ist noch nicht gespeichert. Die Angaben sind ein Vorschlag aus Open Food Facts: bitte prüfen, ergänzen und speichern.'
              : 'Dieser Barcode ist noch nicht gespeichert und es liegt kein Vorschlag aus Open Food Facts vor. Bitte das Produkt einmalig anlegen.'}
          </p>
          <ProductForm barcode={flow.barcode} prefill={flow.prefill} onSave={saveProduct} busy={busy} error={error} />
        </Sheet>
      );
    }
    if (flow.step === 'edit') {
      return (
        <Sheet title="Produkt bearbeiten" onClose={onClose} onBack={back}>
          <ProductForm product={flow.product} onSave={saveProduct} onDelete={removeProduct} busy={busy} error={error} />
        </Sheet>
      );
    }
    return (
      <Sheet title="Produkt" onClose={onClose} onBack={back}>
        {errorLine}
        <ProductAmount
          product={flow.product}
          onNext={(values) => setInitial({ ...values, portion: 1, time: defaultTime(date) })}
          onEdit={() => { setError(''); setFlow({ step: 'edit', product: flow.product }); }}
        />
      </Sheet>
    );
  }

  const pick = (d) => setInitial(fromDish(d, defaultTime(date)));
  return (
    <Sheet title="Essen hinzufügen" onClose={onClose}>
      {error && <p className="error" role="alert">{error}</p>}
      <input type="search" placeholder="Gericht suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
      <button className="primary" onClick={() => { setError(''); setCreating(true); }}>＋ Neues Gericht anlegen</button>
      <button onClick={() => { setError(''); setFlow({ step: 'scan' }); }}>▥ Barcode scannen</button>
      <button onClick={() => setInitial({ portion: 1, time: defaultTime(date) })}>Eigener Eintrag ohne Gericht</button>
      {!q && recent.length > 0 && (
        <section>
          <h3>Zuletzt gegessen</h3>
          <DishList dishes={recent} onPick={pick} />
        </section>
      )}
      <section>
        <h3>{q ? 'Treffer' : 'Alle Gerichte'}</h3>
        {shown.length ? <DishList dishes={shown} onPick={pick} /> : <p className="muted">Nichts gefunden.</p>}
      </section>
    </Sheet>
  );
}

function DishList({ dishes, onPick }) {
  return (
    <ul className="list">
      {dishes.map((d) => (
        <li key={d.id}>
          <button className="row" onClick={() => onPick(d)}>
            {d.photo_id ? <img className="thumb" src={photoUrl(d.photo_id)} alt="" loading="lazy" /> : <span className="thumb empty" />}
            <span className="grow">{d.favorite ? '★ ' : ''}{d.name}</span>
            <span className="muted small">{Math.round(d.kcal)} kcal · {Math.round(d.protein)} g</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
