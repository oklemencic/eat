import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './styles.css';

// Service Worker nur im Produktions-Build (Dev-Server liefert immer den aktuellen Stand).
// Er braucht HTTPS bzw. localhost; ohne beides läuft die App ganz normal ohne ihn.
if (import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
