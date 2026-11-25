// Zielbalken: zeigt Wert/Ziel; über 100 % wird die Füllung als "erreicht" markiert.
export default function ProgressBar({ label, value, goal, unit }) {
  const pct = goal > 0 ? (value / goal) * 100 : 0;
  const left = Math.max(goal - value, 0);
  return (
    <div className="progress">
      <div className="progress-head">
        <span>{label}</span>
        <span>
          <strong>{Math.round(value)}</strong> / {Math.round(goal)} {unit}
        </span>
      </div>
      <div
        className="bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.round(value)}
      >
        <div className={pct >= 100 ? 'bar-fill done' : 'bar-fill'} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="muted small">{left > 0 ? `noch ${Math.round(left)} ${unit}` : 'Ziel erreicht'}</div>
    </div>
  );
}
