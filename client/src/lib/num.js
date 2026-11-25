// Zahleneingaben als Text führen (Komma oder Punkt als Dezimaltrenner) und erst beim Speichern umwandeln.

// "" -> null, ungültig -> NaN
export function parseNum(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (s === '') return null;
  return /^\d*\.?\d+$|^\d+\.$/.test(s) ? Number(s) : NaN;
}

// Zahl -> Eingabetext ("" für null/undefined)
export const numText = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
