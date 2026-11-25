// Kennzahl: Beschriftung, Wert, optionale Zusatzzeile. children ersetzt die Zusatzzeile (z. B. Status mit Symbol).
export default function StatTile({ label, value, unit, sub, children }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">
        {value}{unit && <span className="tile-unit"> {unit}</span>}
      </div>
      {children ?? (sub && <div className="tile-sub muted small">{sub}</div>)}
    </div>
  );
}
