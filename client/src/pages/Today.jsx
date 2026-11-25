import { useCallback, useEffect, useState } from 'react';
import { api, photoUrl } from '../api.js';
import { addDays, formatDay, timeOf, today } from '../lib/date.js';
import ProgressBar from '../components/ProgressBar.jsx';
import AddMealSheet from '../components/AddMealSheet.jsx';
import EditMealSheet from '../components/EditMealSheet.jsx';

export default function Today() {
  const [date, setDate] = useState(today);
  const [settings, setSettings] = useState(null);
  const [data, setData] = useState(null); // { entries, totals }
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // Eintrag

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.settings(), api.meals(date)]);
      setSettings(s);
      setData(m);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    setAdding(false);
    setEditing(null);
    load();
  };

  return (
    <>
      <header className="page-head">
        <button className="ghost" aria-label="Vorheriger Tag" onClick={() => setDate(addDays(date, -1))}>‹</button>
        <h1>{formatDay(date)}</h1>
        <button className="ghost" aria-label="Nächster Tag" disabled={date >= today()} onClick={() => setDate(addDays(date, 1))}>›</button>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      {settings && data && (
        <section className="card">
          <ProgressBar label="Kalorien" value={data.totals.kcal} goal={settings.kcal_goal} unit="kcal" />
          <ProgressBar label="Protein" value={data.totals.protein} goal={settings.protein_goal} unit="g" />
        </section>
      )}

      {data && (
        <section>
          <h2>Mahlzeiten</h2>
          {data.entries.length === 0 ? (
            <p className="muted">Noch nichts eingetragen.</p>
          ) : (
            <ul className="list card">
              {data.entries.map((e) => (
                <li key={e.id}>
                  <button className="row" aria-label={`${e.name} bearbeiten`} onClick={() => setEditing(e)}>
                    {e.photo_id ? <img className="thumb" src={photoUrl(e.photo_id)} alt="" loading="lazy" /> : <span className="thumb empty" />}
                    <span className="grow">
                      <span className="block">{e.name}{e.portion !== 1 && <span className="muted"> · {e.portion}×</span>}</span>
                      <span className="block muted small">
                        {timeOf(e.eaten_at)}{e.category && ` · ${e.category}`} · {Math.round(e.kcal_total)} kcal · {Math.round(e.protein_total)} g Protein
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {settings && <button className="fab" aria-label="Essen hinzufügen" onClick={() => setAdding(true)}>＋</button>}

      {adding && (
        <AddMealSheet date={date} categories={settings.meal_categories} onClose={() => setAdding(false)} onAdded={changed} />
      )}
      {editing && (
        <EditMealSheet entry={editing} categories={settings.meal_categories} onClose={() => setEditing(null)} onChanged={changed} />
      )}
    </>
  );
}
