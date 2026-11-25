import { useState } from 'react';
import { fmt, weekday, weekdayDate } from '../../lib/format.js';
import { niceTicks, useWidth } from './chartUtils.js';

const HEIGHT = 190;
const M = { top: 20, right: 10, bottom: 26, left: 44 };
const MAX_BAR = 24;

// Säulen pro Tag mit Ziellinie. days: [{ date, value, logged }]. Nicht erfasste Tage bekommen keine Säule.
// Hover, Tippen und Tastaturfokus zeigen denselben Tooltip; die Werte stehen zusätzlich in der Tabelle der Seite.
export default function DayBarChart({ days, goal, unit, title }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);

  let body = null;
  if (width > 0) {
    const innerW = Math.max(width - M.left - M.right, 1);
    const innerH = HEIGHT - M.top - M.bottom;
    const top = Math.max(goal ?? 0, ...days.map((d) => d.value)) * 1.08;
    const ticks = niceTicks(0, top || 1, 4);
    const yMax = ticks.at(-1);
    const y = (v) => M.top + innerH - (v / yMax) * innerH;
    const band = innerW / days.length;
    const barW = Math.min(MAX_BAR, band * 0.6);
    const base = M.top + innerH;
    const act = active === null ? null : days[active];

    // 4 px gerundetes Ende oben, am Boden eckig
    const barPath = (cx, v) => {
      const top = y(v);
      const h = base - top;
      const r = Math.min(4, barW / 2, h);
      const x0 = cx - barW / 2;
      return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${base}Z`;
    };

    body = (
      <>
        <svg width={width} height={HEIGHT} role="group" aria-label={title} onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'viz-axis' : 'viz-grid'} x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{fmt(t)}</text>
            </g>
          ))}
          {goal > 0 && <line className="viz-goal" x1={M.left} x2={width - M.right} y1={y(goal)} y2={y(goal)} />}
          {days.map((d, i) => {
            const cx = M.left + band * (i + 0.5);
            return (
              <g key={d.date}>
                {d.logged && d.value > 0 && <path className={active === i ? 'viz-bar active' : 'viz-bar'} d={barPath(cx, d.value)} />}
                <text className="viz-tick" x={cx} y={HEIGHT - 8} textAnchor="middle">{weekday(d.date)}</text>
                {/* Trefferfläche: ganze Spalte, deutlich größer als die Säule */}
                <rect
                  className="viz-hit"
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={innerH + M.bottom}
                  tabIndex={0}
                  role="img"
                  aria-label={`${weekdayDate(d.date)}: ${d.logged ? `${fmt(d.value)} ${unit}` : 'nichts erfasst'}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {act && (
          <div
            className="viz-tooltip"
            role="status"
            style={{ left: Math.min(Math.max(M.left + band * (active + 0.5), 60), width - 60), top: 0 }}
          >
            <div className="viz-tooltip-title">{weekdayDate(act.date)}</div>
            <div>{act.logged ? <><strong>{fmt(act.value)} {unit}</strong></> : <span className="muted">nichts erfasst</span>}</div>
          </div>
        )}
        {goal > 0 && (
          <ul className="viz-legend">
            <li><span className="key goal" />Ziel {fmt(goal)} {unit}</li>
          </ul>
        )}
      </>
    );
  }

  return (
    <div className="viz" ref={ref}>
      {body}
    </div>
  );
}
