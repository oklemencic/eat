import { useState } from 'react';
import { fmt, shortDate, weekdayDate } from '../../lib/format.js';
import { niceTicks, useWidth } from './chartUtils.js';

const HEIGHT = 220;
const M = { top: 18, right: 14, bottom: 26, left: 44 };
const MAX_DOTS = 45; // darüber werden die Tageswerte nur im Tooltip gezeigt

const dayNumber = (dateStr) => Date.parse(`${dateStr}T00:00:00Z`) / 864e5;

// Gewichtsverlauf: gleitender 7-Tage-Durchschnitt als Linie (Akzentfarbe), Tageswerte als graue Punkte.
// points: aufsteigend nach Datum, [{ date, kg, avg7 }]. Pfeiltasten bewegen den Cursor (wie Hover).
export default function WeightChart({ points }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);

  const innerW = Math.max(width - M.left - M.right, 1);
  const innerH = HEIGHT - M.top - M.bottom;

  let body = null;
  if (width > 0 && points.length > 0) {
    const values = points.flatMap((p) => [p.kg, p.avg7]);
    // Mindestens 2 kg Spanne, damit eine einzelne Messung keine Achse von 60 bis 80 erzeugt
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max((2 - (hi - lo)) / 2, 0);
    const ticks = niceTicks(lo - pad, hi + pad, 4);
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const d0 = dayNumber(points[0].date);
    const span = dayNumber(points.at(-1).date) - d0;
    const x = (p) => M.left + (span === 0 ? innerW / 2 : ((dayNumber(p.date) - d0) / span) * innerW);
    const y = (v) => M.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.avg7).toFixed(1)}`).join('');
    const showDots = points.length <= MAX_DOTS;
    const last = points.at(-1);
    const act = active === null ? null : points[Math.min(active, points.length - 1)];

    const nearest = (clientX, rect) => {
      const px = clientX - rect.left;
      let best = 0;
      points.forEach((p, i) => {
        if (Math.abs(x(p) - px) < Math.abs(x(points[best]) - px)) best = i;
      });
      return best;
    };
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') setActive((a) => Math.max((a ?? points.length) - 1, 0));
      else if (e.key === 'ArrowRight') setActive((a) => Math.min((a ?? -1) + 1, points.length - 1));
      else if (e.key === 'Escape') setActive(null);
      else return;
      e.preventDefault();
    };

    const xLabels = points.length > 1 ? [points[0], points[Math.floor((points.length - 1) / 2)], last] : [last];
    const uniqueX = xLabels.filter((p, i) => xLabels.findIndex((q) => q.date === p.date) === i);

    body = (
      <>
        <svg
          width={width}
          height={HEIGHT}
          tabIndex={0}
          role="img"
          aria-label={`Gewichtsverlauf, ${points.length} Messungen, zuletzt ${fmt(last.kg, 1)} kg, Durchschnitt ${fmt(last.avg7, 1)} kg. Pfeiltasten wählen einen Tag.`}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerDown={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{fmt(t, 1)}</text>
            </g>
          ))}
          <line className="viz-axis" x1={M.left} x2={width - M.right} y1={M.top + innerH} y2={M.top + innerH} />
          {uniqueX.map((p, i) => (
            <text
              key={p.date}
              className="viz-tick"
              x={x(p)}
              y={HEIGHT - 8}
              textAnchor={uniqueX.length === 1 ? 'middle' : i === 0 ? 'start' : i === uniqueX.length - 1 ? 'end' : 'middle'}
            >
              {shortDate(p.date)}
            </text>
          ))}

          {act && <line className="viz-cursor" x1={x(act)} x2={x(act)} y1={M.top} y2={M.top + innerH} />}
          {points.length > 1 && <path className="viz-line" d={line} />}
          {showDots && points.map((p) => (
            <circle key={`d${p.date}`} className="viz-dot" cx={x(p)} cy={y(p.kg)} r={4} />
          ))}
          <circle className="viz-end" cx={x(last)} cy={y(last.avg7)} r={5} />
          <text className="viz-label" x={x(last)} y={y(last.avg7) - 12} textAnchor={x(last) > width - 40 ? 'end' : 'middle'}>
            {fmt(last.avg7, 1)} kg
          </text>
          {act && <circle className="viz-end" cx={x(act)} cy={y(act.avg7)} r={5} />}
          {act && showDots && <circle className="viz-dot active" cx={x(act)} cy={y(act.kg)} r={5} />}
        </svg>

        {act && (
          <div
            className="viz-tooltip"
            role="status"
            style={{ left: Math.min(Math.max(x(act), 80), width - 80), top: 0 }}
          >
            <div className="viz-tooltip-title">{weekdayDate(act.date)}</div>
            <div><span className="key line" />{fmt(act.avg7, 2)} kg <span className="muted">7-Tage-Schnitt</span></div>
            <div><span className="key dot" />{fmt(act.kg, 1)} kg <span className="muted">Tageswert</span></div>
          </div>
        )}

        <ul className="viz-legend">
          <li><span className="key line" />7-Tage-Schnitt</li>
          {showDots && <li><span className="key dot" />Tageswert</li>}
        </ul>
      </>
    );
  }

  return (
    <div className="viz" ref={ref}>
      {body}
    </div>
  );
}
