// Auswahl aus den Kategorien der Einstellungen. Eine nicht (mehr) gelistete Kategorie bleibt auswählbar.
export default function CategorySelect({ value, categories, onChange }) {
  const options = value && !categories.includes(value) ? [...categories, value] : categories;
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Keine Kategorie</option>
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}
