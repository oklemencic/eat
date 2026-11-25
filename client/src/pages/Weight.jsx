import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { addDays, today } from '../lib/date.js';
import { fmt, fmtSigned, weekdayDate } from '../lib/format.js';
import { numText, parseNum } from '../lib/num.js';
import StatTile from '../components/StatTile.jsx';
import WeightChart from '../components/charts/WeightChart.jsx';

const RANGES = [
  { id: '30', label: '30 Tage', days: 30 },
  { id: '90', label: '90 Tage', days: 90 },
  { id: 'all', label: 'Alles', days: null },
];
const PAGE = 30;

// Status des Trends: Symbol + Text, die Farbe allein trägt nie die Bedeutung
const STATUS = {
  too_slow: { icon: '▲', color: 'warning', text: 'Zu langsam' },
  on_track: { icon: '✓', color: 'good', text: 'Im Zielkorridor' },
  too_fast: { icon: '▲', color: 'warning', text: 'Zu schnell' },
};

// Gewichtsbereich der Profilseite. settings: Einstellungen vom Server (für das Zielgewicht), null solange unbekannt.
export default function Weight({ settings }) {
  const [data, setData] = useState(null); // { entries, trend }
  const [range, setRange] = useState('90');
  const [date, setDate] = useState(today);
  const [kg, setKg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      setData(await api.weights());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const entries = data?.entries ?? [];
  const latest = entries.at(-1);

  // Eingabefeld mit dem letzten Wert vorbelegen, solange noch nichts getippt wurde
  useEffect(() => {
    if (latest && kg === '') setKg(numText(latest.kg));
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps

  const points = useMemo(() => {
    const days = RANGES.find((r) => r.id === range).days;
    if (days === null) return entries;
    const from = addDays(today(), -days);
    return entries.filter((e) => e.date >= from);
  }, [entries, range]);

  async function save(e) {
    e.preventDefault();
    const value = parseNum(kg);
    if (value === null || Number.isNaN(value) || value < 20 || value > 400) {
      return setFormError('Bitte ein Gewicht zwischen 20 und 400 kg eingeben');
    }
    setBusy(true);
    setFormError('');
    try {
      await api.addWeight(date, value);
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry) {
    if (!window.confirm(`Messung vom ${weekdayDate(entry.date)} (${fmt(entry.kg, 1)} kg) löschen?`)) return;
    try {
      await api.deleteWeight(entry.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const trend = data?.trend;
  const target = settings?.target_weight;
  const history = [...entries].reverse();

  return (
    <>
      <h2>Gewicht</h2>
      {error && <p className="error" role="alert">{error}</p>}

      {data && (
        <section className="tiles">
          <StatTile
            label="Aktuell"
            value={latest ? fmt(latest.kg, 1) : '–'}
            unit={latest ? 'kg' : undefined}
            sub={latest ? weekdayDate(latest.date) : 'Noch keine Messung'}
          />
          <StatTile label="Trend pro Woche" value={trend ? fmtSigned(trend.kg_per_week, 2) : '–'} unit={trend ? 'kg' : undefined}>
            {trend ? (
              <div className="tile-sub small">
                <span className={`status ${STATUS[trend.status].color}`} aria-hidden="true">{STATUS[trend.status].icon}</span>{' '}
                {STATUS[trend.status].text}
                <span className="muted"> (Ziel {fmt(trend.target_min, 2)}–{fmt(trend.target_max, 2)})</span>
              </div>
            ) : (
              <div className="tile-sub muted small">Mindestens 7 Tage Verlauf nötig</div>
            )}
          </StatTile>
          {target && latest && (
            <StatTile
              label="Zielgewicht"
              value={fmt(target, 1)}
              unit="kg"
              sub={latest.avg7 >= target ? 'Ziel erreicht' : `noch ${fmt(target - latest.avg7, 1)} kg`}
            />
          )}
        </section>
      )}

      <form className="card form weight-form" onSubmit={save}>
        <div className="fields">
          <label>
            Datum
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Gewicht (kg)
            <input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} />
          </label>
        </div>
        <p className="muted small">Ein Wert pro Tag; ein vorhandener Wert wird überschrieben.</p>
        {formError && <p className="error" role="alert">{formError}</p>}
        <button className="primary" disabled={busy}>Speichern</button>
      </form>

      {data && entries.length > 0 && (
        <>
          <h3>Verlauf</h3>
          <div className="chips" role="group" aria-label="Zeitraum">
            {RANGES.map((r) => (
              <button key={r.id} className={r.id === range ? 'chip active' : 'chip'} aria-pressed={r.id === range} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="card">
            {points.length ? <WeightChart points={points} /> : <p className="muted">Keine Messungen in diesem Zeitraum.</p>}
          </div>

          <h3>Messungen</h3>
          <table className="table card">
            <thead>
              <tr><th scope="col">Datum</th><th scope="col" className="num">kg</th><th scope="col" className="num">Ø 7 Tage</th><th scope="col"><span className="sr-only">Löschen</span></th></tr>
            </thead>
            <tbody>
              {history.slice(0, shown).map((e) => (
                <tr key={e.id}>
                  <td>{weekdayDate(e.date)}</td>
                  <td className="num">{fmt(e.kg, 1)}</td>
                  <td className="num muted">{fmt(e.avg7, 1)}</td>
                  <td className="num">
                    <button className="ghost danger" aria-label={`Messung vom ${weekdayDate(e.date)} löschen`} onClick={() => remove(e)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length > shown && <button onClick={() => setShown(shown + PAGE)}>Mehr anzeigen</button>}
        </>
      )}
    </>
  );
}
