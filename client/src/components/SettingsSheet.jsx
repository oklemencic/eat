import { useEffect, useRef, useState } from 'react';
import { api, exportUrl } from '../api.js';
import { fmt } from '../lib/format.js';
import { numText, parseNum } from '../lib/num.js';
import Sheet from './Sheet.jsx';

const CSV_TABLES = [
  ['meal_entries', 'Mahlzeiten'],
  ['dishes', 'Gerichte'],
  ['products', 'Produkte'],
  ['workouts', 'Trainings'],
  ['workout_sets', 'Übungen (Sätze)'],
  ['weights', 'Gewicht'],
];

// Tagesziele, Zielgewicht, Kategorien sowie Export/Import. settings: aktueller Stand vom Server.
export default function SettingsSheet({ settings, onClose, onSaved }) {
  const [kcal, setKcal] = useState(numText(settings.kcal_goal));
  const [protein, setProtein] = useState(numText(settings.protein_goal));
  const [target, setTarget] = useState(numText(settings.target_weight));
  const [categories, setCategories] = useState(settings.meal_categories);
  const [newCategory, setNewCategory] = useState('');
  const [latestKg, setLatestKg] = useState(null);
  const [csvTable, setCsvTable] = useState(CSV_TABLES[0][0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const fileInput = useRef(null);

  // Für den Proteinrichtwert (1,6–2,2 g pro kg Körpergewicht)
  useEffect(() => {
    api.weights().then((w) => setLatestKg(w.entries.at(-1)?.kg ?? null), () => {});
  }, []);

  function addCategory() {
    const c = newCategory.trim();
    if (c && !categories.includes(c)) setCategories([...categories, c]);
    setNewCategory('');
  }

  async function save(e) {
    e.preventDefault();
    const n = { kcal_goal: parseNum(kcal), protein_goal: parseNum(protein), target_weight: parseNum(target) };
    if (n.kcal_goal === null || Number.isNaN(n.kcal_goal) || n.kcal_goal < 500 || n.kcal_goal > 10000) {
      return setError('Kalorienziel zwischen 500 und 10.000 kcal');
    }
    if (n.protein_goal === null || Number.isNaN(n.protein_goal) || n.protein_goal < 10 || n.protein_goal > 500) {
      return setError('Proteinziel zwischen 10 und 500 g');
    }
    if (Number.isNaN(n.target_weight) || (n.target_weight !== null && (n.target_weight < 20 || n.target_weight > 400))) {
      return setError('Zielgewicht zwischen 20 und 400 kg (oder leer lassen)');
    }
    const pending = newCategory.trim();
    const cats = pending && !categories.includes(pending) ? [...categories, pending] : categories;
    setBusy(true);
    setError('');
    try {
      await api.updateSettings({ ...n, meal_categories: cats });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function importFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImportMsg('');
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return setImportMsg('Die Datei ist kein gültiges JSON.');
    }
    if (!window.confirm('Der Import ERSETZT alle vorhandenen Daten (Gerichte, Mahlzeiten, Trainings, Gewicht). Fortfahren?')) return;
    try {
      const { imported } = await api.importData(data);
      const total = Object.values(imported).reduce((s, n) => s + n, 0);
      setImportMsg(`Import abgeschlossen (${total} Datensätze). Die Seite wird neu geladen …`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setImportMsg(`Import abgelehnt, Daten unverändert: ${err.message}`);
    }
  }

  return (
    <Sheet title="Einstellungen" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <h3>Tagesziele</h3>
        <div className="fields">
          <label>Kalorien (kcal)<input inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} /></label>
          <label>Protein (g)<input inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} /></label>
        </div>
        {latestKg && (
          <p className="muted small">
            Richtwert Protein bei {fmt(latestKg, 1)} kg: {fmt(latestKg * 1.6)}–{fmt(latestKg * 2.2)} g (1,6–2,2 g pro kg).
            Kalorien: Erhaltungsbedarf plus ca. 300–500 kcal.
          </p>
        )}
        <label>
          Zielgewicht (kg, optional)
          <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>

        <h3>Kategorien für Mahlzeiten</h3>
        <ul className="tags">
          {categories.map((c) => (
            <li key={c}>
              {c}
              <button type="button" className="ghost" aria-label={`${c} entfernen`} onClick={() => setCategories(categories.filter((x) => x !== c))}>✕</button>
            </li>
          ))}
        </ul>
        <div className="inline">
          <input
            aria-label="Neue Kategorie"
            placeholder="Neue Kategorie"
            value={newCategory}
            maxLength={50}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCategory();
              }
            }}
          />
          <button type="button" onClick={addCategory}>Hinzufügen</button>
        </div>
        <p className="muted small">Bestehende Gerichte und Einträge behalten ihre Kategorie, auch wenn sie hier entfernt wird.</p>

        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>Speichern</button>
      </form>

      <h3>Datensicherung</h3>
      <p className="muted small">
        Der Export enthält Daten, aber keine Foto-Dateien; diese liegen im Ordner <code>data/photos</code> auf dem Server.
      </p>
      <a className="button" href={exportUrl('json')} download>Alles exportieren (JSON)</a>
      <div className="inline">
        <select aria-label="Tabelle für CSV-Export" value={csvTable} onChange={(e) => setCsvTable(e.target.value)}>
          {CSV_TABLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <a className="button" href={exportUrl('csv', csvTable)} download>CSV</a>
      </div>
      <button onClick={() => fileInput.current.click()}>JSON importieren …</button>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
      {importMsg && <p role="status">{importMsg}</p>}
    </Sheet>
  );
}
