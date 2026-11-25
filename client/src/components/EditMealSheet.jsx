import { useState } from 'react';
import { api } from '../api.js';
import { timeOf } from '../lib/date.js';
import Sheet from './Sheet.jsx';
import MealForm from './MealForm.jsx';

// Bestehenden Eintrag bearbeiten. Das Datum bleibt, nur die Uhrzeit ist änderbar.
export default function EditMealSheet({ entry, categories, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const save = ({ time, ...meal }) => run(() => api.updateMeal(entry.id, { ...meal, eaten_at: `${entry.date}T${time}` }));
  const remove = () => {
    if (window.confirm(`„${entry.name}“ löschen?`)) run(() => api.deleteMeal(entry.id));
  };

  return (
    <Sheet title="Eintrag bearbeiten" onClose={onClose}>
      <MealForm
        initial={{ ...entry, time: timeOf(entry.eaten_at) }}
        categories={categories}
        onSubmit={save}
        onDelete={remove}
        submitLabel="Speichern"
        busy={busy}
        error={error}
      />
    </Sheet>
  );
}
