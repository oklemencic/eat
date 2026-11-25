// Zahlen und Daten für die Anzeige (de-AT: Komma als Dezimaltrenner).

const formatters = new Map();
function formatter(digits) {
  if (!formatters.has(digits)) {
    formatters.set(digits, new Intl.NumberFormat('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: digits }));
  }
  return formatters.get(digits);
}

export const fmt = (n, digits = 0) => (n === null || n === undefined ? '–' : formatter(digits).format(n));

// Mit Vorzeichen, z. B. "+0,3" / "−0,2"
export function fmtSigned(n, digits = 1) {
  if (n === null || n === undefined) return '–';
  const s = formatter(digits).format(Math.abs(n));
  if (n > 0) return `+${s}`;
  return n < 0 ? `−${s}` : s;
}

const utc = (dateStr) => new Date(`${dateStr}T00:00:00Z`);

// "25.11."
export const shortDate = (dateStr) =>
  utc(dateStr).toLocaleDateString('de-AT', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });

// "Mi, 25.11."
export const weekdayDate = (dateStr) =>
  utc(dateStr).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });

// "Mi"
export const weekday = (dateStr) => utc(dateStr).toLocaleDateString('de-AT', { weekday: 'short', timeZone: 'UTC' });
