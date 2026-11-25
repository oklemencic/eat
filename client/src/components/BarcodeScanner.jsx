import { useEffect, useRef, useState } from 'react';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'];

// Kamera-Scan über die BarcodeDetector-API des Browsers (Chrome/Edge/Android). Wo sie fehlt (z. B. Safari/iOS,
// Firefox) oder die Kamera nicht erlaubt ist, bleibt die Eingabe per Hand. Es wird nichts hochgeladen:
// Die Erkennung läuft im Browser, nur der erkannte Code geht an den eigenen Server.
// Standard: Nach dem ersten Treffer stoppt der Scan. continuous: Der Scan läuft weiter (derselbe Code wird nicht
// mehrfach gemeldet, solange er im Bild bleibt) und die Handeingabe nimmt mehrere Codes auf einmal an
// (getrennt durch Leerzeichen, Komma oder Zeilenumbruch).
export default function BarcodeScanner({ onDetected, continuous = false }) {
  const video = useRef(null);
  // Immer der aktuelle Handler, ohne dass die Kamera neu startet, wenn er sich ändert
  const handler = useRef(onDetected);
  handler.current = onDetected;
  const [hint, setHint] = useState('');
  const [code, setCode] = useState('');
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  const [camera, setCamera] = useState(supported);

  useEffect(() => {
    if (!camera) return undefined;
    let stream;
    let timer;
    let stopped = false;
    let last = { code: '', at: 0 };

    (async () => {
      try {
        const detector = new window.BarcodeDetector({ formats: FORMATS });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const found = await detector.detect(video.current);
            if (found.length && !stopped) {
              const value = found[0].rawValue;
              if (!continuous) {
                stopped = true;
                handler.current(value);
                return;
              }
              // Derselbe Code bleibt meist noch einen Moment im Bild: erst nach 4 s wieder melden
              if (value !== last.code || Date.now() - last.at > 4000) {
                navigator.vibrate?.(60);
                handler.current(value);
              }
              last = { code: value, at: Date.now() };
            }
          } catch {
            // einzelnes Bild nicht auswertbar: nächstes versuchen
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch (e) {
        setHint(e?.name === 'NotAllowedError' ? 'Kamerazugriff nicht erlaubt.' : 'Kamera nicht verfügbar.');
        setCamera(false);
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, continuous]);

  function submit(e) {
    e.preventDefault();
    const codes = continuous ? code.split(/[\s,;]+/).filter(Boolean) : [code.replace(/\s/g, '')];
    const invalid = codes.filter((c) => !/^\d{6,14}$/.test(c));
    if (!codes.length || invalid.length) {
      return setHint(codes.length && continuous ? `Kein gültiger Barcode (6 bis 14 Ziffern): ${invalid.join(', ')}` : 'Barcode: 6 bis 14 Ziffern.');
    }
    if (continuous) setCode('');
    codes.forEach((c) => handler.current(c));
  }

  return (
    <div className="form">
      {camera && <video ref={video} className="scanner" playsInline muted />}
      {camera && <p className="muted small">Barcode ins Bild halten.</p>}
      {!camera && !hint && <p className="muted small">Kamera-Scan wird von diesem Browser nicht unterstützt. Barcode bitte eintippen.</p>}
      <form className="form" onSubmit={submit}>
        <label>
          {continuous ? 'Barcodes eintippen oder einfügen (mehrere möglich)' : 'Barcode eintippen'}
          {continuous ? (
            <textarea rows={2} inputMode="numeric" autoComplete="off" value={code} onChange={(e) => { setCode(e.target.value); setHint(''); }} />
          ) : (
            <input inputMode="numeric" autoComplete="off" value={code} onChange={(e) => { setCode(e.target.value); setHint(''); }} />
          )}
        </label>
        {hint && <p className="error" role="alert">{hint}</p>}
        <button className="primary">{continuous ? 'Hinzufügen' : 'Suchen'}</button>
      </form>
    </div>
  );
}
