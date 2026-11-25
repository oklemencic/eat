import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, photoUrl } from '../api.js';
import Sheet from '../components/Sheet.jsx';
import DishForm from '../components/DishForm.jsx';
import BatchRegisterSheet from '../components/BatchRegisterSheet.jsx';

const ALL = 'all';
const FAVORITES = 'favorites';

export default function Dishes() {
  const [dishes, setDishes] = useState(null);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(ALL);
  const [editing, setEditing] = useState(null); // null = zu, 'new' = neu, sonst das Gericht
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [batch, setBatch] = useState(false); // Sheet "Produkte erfassen"
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api.dishes(), api.settings()]);
      setDishes(d);
      setCategories(s.meal_categories);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (dishes ?? []).filter((d) => {
      if (filter === FAVORITES && !d.favorite) return false;
      if (filter !== ALL && filter !== FAVORITES && d.category !== filter) return false;
      return !q || d.name.toLowerCase().includes(q);
    });
  }, [dishes, query, filter]);

  // Filter-Chips: Kategorien aus den Einstellungen plus solche, die nur an Gerichten hängen
  const chips = useMemo(() => {
    const extra = (dishes ?? []).map((d) => d.category).filter((c) => c && !categories.includes(c));
    return [...categories, ...new Set(extra)];
  }, [categories, dishes]);

  const closeForm = () => {
    setEditing(null);
    setFormError('');
  };

  async function run(fn) {
    setBusy(true);
    setFormError('');
    try {
      await fn();
      closeForm();
      await load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const save = (dish) => run(() => (editing === 'new' ? api.addDish(dish) : api.updateDish(editing.id, dish)));
  const remove = () => {
    if (window.confirm(`„${editing.name}“ löschen? Bereits eingetragene Mahlzeiten bleiben erhalten.`)) {
      run(() => api.deleteDish(editing.id));
    }
  };

  async function toggleFavorite(d) {
    try {
      await api.updateDish(d.id, { ...d, favorite: !d.favorite });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <header className="page-head">
        <h1>Gerichte</h1>
        <button onClick={() => setBatch(true)}>▥ Produkte erfassen</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <input type="search" placeholder="Gericht suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chips" role="group" aria-label="Filter">
        <FilterChip id={ALL} current={filter} onPick={setFilter}>Alle</FilterChip>
        <FilterChip id={FAVORITES} current={filter} onPick={setFilter}>★ Favoriten</FilterChip>
        {chips.map((c) => <FilterChip key={c} id={c} current={filter} onPick={setFilter}>{c}</FilterChip>)}
      </div>

      {dishes && (shown.length === 0 ? (
        <p className="muted">{dishes.length ? 'Nichts gefunden.' : 'Noch keine Gerichte angelegt.'}</p>
      ) : (
        <ul className="list card">
          {shown.map((d) => (
            <li key={d.id} className="entry">
              <button className="row" aria-label={`${d.name} bearbeiten`} onClick={() => setEditing(d)}>
                {d.photo_id ? <img className="thumb" src={photoUrl(d.photo_id)} alt="" loading="lazy" /> : <span className="thumb empty" />}
                <span className="grow">
                  <span className="block">{d.name}</span>
                  <span className="block muted small">
                    {d.category ? `${d.category} · ` : ''}{Math.round(d.kcal)} kcal · {Math.round(d.protein)} g Protein
                  </span>
                </span>
              </button>
              <button
                className="ghost star"
                aria-label={d.favorite ? `${d.name} aus Favoriten entfernen` : `${d.name} zu Favoriten`}
                aria-pressed={d.favorite}
                onClick={() => toggleFavorite(d)}
              >
                {d.favorite ? '★' : '☆'}
              </button>
            </li>
          ))}
        </ul>
      ))}

      <button className="fab" aria-label="Gericht anlegen" onClick={() => setEditing('new')}>＋</button>

      {batch && <BatchRegisterSheet onClose={() => setBatch(false)} />}

      {editing && (
        <Sheet title={editing === 'new' ? 'Neues Gericht' : 'Gericht bearbeiten'} onClose={closeForm}>
          <DishForm
            dish={editing === 'new' ? null : editing}
            categories={categories}
            onSave={save}
            onDelete={editing === 'new' ? undefined : remove}
            busy={busy}
            error={formError}
          />
        </Sheet>
      )}
    </>
  );
}

function FilterChip({ id, current, onPick, children }) {
  return (
    <button className={id === current ? 'chip active' : 'chip'} aria-pressed={id === current} onClick={() => onPick(id)}>
      {children}
    </button>
  );
}
