// Bottom-Sheet. Klick auf den Hintergrund und Escape schließen; "Zurück" ersetzt "Schließen", wenn onBack gesetzt ist.
import { useEffect } from 'react';

export default function Sheet({ title, onClose, onBack, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onBack ?? onClose}>{onBack ? 'Zurück' : 'Schließen'}</button>
        </div>
        {children}
      </div>
    </div>
  );
}
