// Datumshelfer. Datumswerte sind immer "YYYY-MM-DD" in der lokalen Zeitzone des Geräts.

const pad = (n) => String(n).padStart(2, '0');

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowMinute() {
  const d = new Date();
  return `${today()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDay(dateStr) {
  const now = today();
  if (dateStr === now) return 'Heute';
  if (dateStr === addDays(now, -1)) return 'Gestern';
  if (dateStr === addDays(now, 1)) return 'Morgen';
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('de-AT', {
    weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

// "2026-11-25T08:30" -> "08:30"
export const timeOf = (eatenAt) => eatenAt.slice(11, 16);
