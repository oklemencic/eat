import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { addDays, today } from '../lib/date.js';
import { fmt, fmtSigned, shortDate, weekdayDate } from '../lib/format.js';
import StatTile from '../components/StatTile.jsx';
import DayBarChart from '../components/charts/DayBarChart.jsx';

export default function Stats() {
  const [end, setEnd] = useState(today);
  const [week, setWeek] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, s] = await Promise.all([api.statsWeek(end), api.settings()]);
      setWeek(w);
      setSettings(s);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [end]);

  useEffect(() => {
    load();
  }, [load]);

  const w = week;
  const kcalDays = w?.days.map((d) => ({ date: d.date, value: d.kcal, logged: d.logged }));
  const proteinDays = w?.days.map((d) => ({ date: d.date, value: d.protein, logged: d.logged }));

  return (
    <>
      <header className="page-head">
        <button className="ghost" aria-label="Vorherige Woche" onClick={() => setEnd(addDays(end, -7))}>‹</button>
        <div className="page-title">
          <h1>Woche</h1>
          {w && <div className="muted small">{shortDate(w.start)} – {shortDate(w.end)}</div>}
        </div>
        <button className="ghost" aria-label="Nächste Woche" disabled={end >= today()} onClick={() => setEnd(addDays(end, 7) > today() ? today() : addDays(end, 7))}>›</button>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      {/* Bei Neuladen bleibt der alte Stand sichtbar, nur abgedunkelt */}
      {w && settings && (
        <div className={loading ? 'reloading' : undefined}>
          <section className="tiles">
            <StatTile
              label="Ø Kalorien"
              value={fmt(w.avg_kcal)}
              unit={w.avg_kcal !== null ? 'kcal' : undefined}
              sub={w.avg_kcal !== null ? `Ziel ${fmt(settings.kcal_goal)}` : 'Keine Einträge'}
            />
            <StatTile
              label="Ø Protein"
              value={fmt(w.avg_protein)}
              unit={w.avg_protein !== null ? 'g' : undefined}
              sub={w.avg_protein !== null ? `Ziel ${fmt(settings.protein_goal)}` : 'Keine Einträge'}
            />
            <StatTile label="Trainingstage" value={fmt(w.training_days)} unit="von 7" />
            <StatTile
              label="Gewicht"
              value={w.weight ? fmtSigned(w.weight.change, 1) : '–'}
              unit={w.weight ? 'kg' : undefined}
              sub={w.weight ? `${fmt(w.weight.first, 1)} → ${fmt(w.weight.last, 1)} kg` : 'Mindestens 2 Messungen'}
            />
          </section>
          <p className="muted small">Durchschnitte über {w.days_logged} {w.days_logged === 1 ? 'Tag' : 'Tage'} mit Einträgen.</p>

          <h2>Kalorien pro Tag</h2>
          <div className="card"><DayBarChart days={kcalDays} goal={settings.kcal_goal} unit="kcal" title="Kalorien pro Tag" /></div>
          <h2>Protein pro Tag</h2>
          <div className="card"><DayBarChart days={proteinDays} goal={settings.protein_goal} unit="g" title="Protein pro Tag" /></div>

          <details className="card records">
            <summary>Tabelle</summary>
            <table className="table">
              <thead>
                <tr><th scope="col">Tag</th><th scope="col" className="num">kcal</th><th scope="col" className="num">Protein (g)</th></tr>
              </thead>
              <tbody>
                {w.days.map((d) => (
                  <tr key={d.date}>
                    <td>{weekdayDate(d.date)}</td>
                    <td className="num">{d.logged ? fmt(d.kcal) : '–'}</td>
                    <td className="num">{d.logged ? fmt(d.protein) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </>
  );
}
