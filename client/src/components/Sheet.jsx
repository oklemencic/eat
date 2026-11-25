// Bottom-Sheet. Klick auf den Hintergrund und Escape schließen; "Zurück" ersetzt "Schließen", wenn onBack gesetzt ist.
import { useEffect, useState } from 'react';

// Sichtbarer Bereich (ohne On-Screen-Tastatur). Mobile Browser verkleinern den Layout-Viewport
// nicht, wenn die Tastatur erscheint – das Sheet läge sonst dahinter.
function useVisibleArea() {
  const [area, setArea] = useState(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = () => {
      const keyboard = window.innerHeight - vv.height > 100;
      setArea(keyboard ? { top: vv.offsetTop, height: vv.height } : null);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return area;
}

export default function Sheet({ title, onClose, onBack, children }) {
  const area = useVisibleArea();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      style={area ? { top: area.top, bottom: 'auto', height: area.height } : undefined}
      onClick={onClose}
    >
      <div className={area ? 'sheet keyboard' : 'sheet'} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onBack ?? onClose}>{onBack ? 'Zurück' : 'Schließen'}</button>
        </div>
        {children}
      </div>
    </div>
  );
}
