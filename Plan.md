# Eat – Plan

Persönliche Fitness- und Ernährungs-App (Web-App mit PWA-Support für das Handy).
Ziel: Gewicht zunehmen, vorwiegend Muskelaufbau.

## Rahmenbedingungen

- Läuft auf diesem Rechner (Self-Hosted), mehrere Benutzer mit getrennten Daten (siehe Schritt 10).
- Node.js-Server mit SQLite-Datenbank, Client als PWA mit Vite + React (Build-Schritt im Docker-Build).
- Zugangsdaten nie im Code oder in Dateien im Repo: Session-Secret per Umgebungsvariable, Benutzerpasswörter nur als Hash in der Datenbank.
- Betrieb in Docker (siehe „Betrieb mit Docker“), keine Node.js-Installation auf dem Host.

## Architektur

| Bereich | Entscheidung |
|---|---|
| Server | Node.js (Express oder Fastify), REST-API, liefert die PWA als statische Dateien aus |
| Datenbank | SQLite auf dem Server (`node:sqlite` ab Node 22, sonst `better-sqlite3`) |
| Fotos | Als Dateien in `data/photos`, in der DB nur der Pfad |
| Client | Single-Page-App mit Vite + React, mobil zuerst, dunkles und helles Design; Build erzeugt statische Dateien (`dist/`), die der Server ausliefert |
| PWA | Manifest, Icons, Service Worker (App-Hülle offline verfügbar), z. B. über `vite-plugin-pwa` |
| Auth | Login (Benutzername + Passwort) mit Session-Cookie; Benutzer und Passwort-Hashes in der Datenbank, Session-Secret aus der Umgebung |
| HTTPS | Pflicht für PWA-Installation, per Reverse Proxy (z. B. Caddy) |
| Backup | Kopie der SQLite-Datei und des Foto-Ordners, zusätzlich JSON/CSV-Export in der App |

## Betrieb mit Docker

Entscheidung: Der Server läuft in einem Docker-Container, ebenso der Reverse Proxy.
Dasselbe Muster ist für weitere eigene Projekte gedacht (je ein `compose.yaml`).

Geprüft am 2026-11-24 auf diesem Rechner:

- Docker 20.10.7 vorhanden, Node.js auf dem Host nicht.
- Docker Compose vorhanden (`docker compose` v2.18.1, `docker-compose` v2.29.3).
- `node:22-slim` startet trotz Kernel 4.15 (`node -v` ergibt v22.23.5). `node:sqlite` und Dauerbetrieb sind noch nicht getestet.
- Arbeitsspeicher knapp: ca. 1 GB gesamt, zuletzt ca. 130 MB verfügbar. Vor dem Parallelbetrieb mehrerer Projekte prüfen.

Aufbau:

- Basis-Image `node:22-slim`; Fallback Node 20 mit `better-sqlite3`, falls `node:sqlite` nicht läuft.
- `data/` (SQLite-Datei, Fotos) als gemountetes Volume, Backup bleibt eine Dateikopie.
- Secrets (Passwort-Hash, Session-Secret) über eine Env-Datei außerhalb des Repos oder Docker Secrets, nie im Image.
- Caddy als eigener Container vor den Anwendungen (HTTPS, mehrere Projekte über Hostnamen).
- Autostart über `restart: unless-stopped`, kein eigenes systemd-Unit nötig.
- Mehrstufiger Docker-Build: Stufe 1 baut den Client (`vite build`), Stufe 2 enthält nur Server und `dist/`. Node und `node_modules` des Clients landen nicht im Laufzeit-Image.
- Entwicklung: Vite-Dev-Server mit Proxy auf `/api` und `/photos` zum Node-Server.
- Der Build braucht deutlich mehr Arbeitsspeicher als der Betrieb; bei ca. 1 GB RAM ggf. Swap anlegen oder das Image auf einem anderen Rechner bauen.

Warum SQLite statt IndexedDB: Es gibt einen Server, daher SQL für Auswertungen
(Wochenschnitt, Gewichtstrend), geräteübergreifend dieselben Daten und einfaches
Backup per Datei.

## Features

### Phase 1 (Kern)

1. **Essens-Tracking**
   - Vorkonfigurierte Gerichte mit hinterlegten Kalorien und Protein (optional Kohlenhydrate, Fett).
   - Kalorien pro Eintrag editierbar, Portionsfaktor (z. B. 1,5×) skaliert die Werte.
   - Optional Foto und Kategorie (Frühstück, Warme Mahlzeit, Snack, Süßes, Shake/Getränk, eigene Kategorien).
   - Favoriten und „Zuletzt gegessen“ für schnelles Hinzufügen.
   - Gerichte-Verwaltung (anlegen, bearbeiten, löschen), einige Beispielgerichte als Startdaten.
2. **Sport-Tracking**
   - Kategorie und Dauer.
   - Krafttraining: Übung, Sätze, Wiederholungen, Gewicht; Anzeige von Bestleistungen.
3. **Gewichts-Tracking**
   - Tageswert, Verlauf als Diagramm, gleitender 7-Tage-Durchschnitt.
   - Zielkorridor ca. 0,25–0,5 kg Zunahme pro Woche mit Hinweis, ob zu langsam oder zu schnell.
4. **Tagesziele**
   - Kalorienziel (Überschuss ca. +300 bis 500 kcal) und Proteinziel (ca. 1,6–2,2 g pro kg Körpergewicht).
   - Fortschrittsbalken auf der Startseite „Heute“.
5. **Mahlzeiten-Vorlagen**: ganzen Standard-Tag mit einem Tipp übernehmen.
6. **Wochen-Übersicht**: Durchschnitt Kalorien/Protein, Trainingstage, Gewichtsänderung.
7. **Export/Import** als JSON und CSV.

### Phase 2 (später)

- Offline-Warteschlange: Einträge ohne Netz erfassen und später synchronisieren.
- Erinnerungen (Push; auf iOS eingeschränkt).
- Körperumfänge (Arm, Brust, Taille) und Fortschrittsfotos.
- Wasser-Tracker.

## Navigation (untere Tab-Leiste)

Heute · Sport · Gerichte · Statistik · Profil

Das Profil enthält Konto (Passwort, Benutzerverwaltung), Einstellungen, Abmelden und den Gewichtsbereich
(früher eigener Tab „Gewicht“; `/gewicht` leitet auf `/profil` um).

## Datenmodell (Entwurf)

- `dishes`: id, name, kategorie, kcal, protein, carbs, fat, favorit, foto
- `products`: id, user_id, barcode (normalisiert, je Benutzer eindeutig), name, marke, kcal/protein/carbs/fat pro 100 g, übliche Portion in g
- `meal_entries`: id, datum/zeit, dish_id (optional), name, kategorie, kcal, protein, portion, foto, notiz
- `workouts`: id, datum, kategorie, dauer_min, notiz
- `workout_sets`: id, workout_id, übung, sätze, wiederholungen, gewicht_kg
- `weights`: id, datum, kg
- `settings`: kcal_ziel, protein_ziel, zielgewicht, einstellungen

## API (Entwurf)

- `GET /api/session`, `POST /api/setup` (nur ohne Benutzer), `POST /api/login`, `POST /api/logout`
- `GET/POST/DELETE /api/users`, `PUT /api/users/:id/password` (Administrator), `PUT /api/account/password`
- `GET/POST/PUT/DELETE /api/dishes`, `GET /api/dishes/suggest?q=…` (Vorschläge für fertige Gerichte aus Open Food Facts, speichert nichts)
- `GET/POST/PUT/DELETE /api/products`, `GET /api/products/barcode/:code`, `GET /api/products/lookup/:code` (Vorschlag Open Food Facts), `POST /api/products/batch`
- `GET/POST/PUT/DELETE /api/meals?date=…`
- `GET/POST/PUT/DELETE /api/workouts`
- `GET/POST/DELETE /api/weights`
- `GET/PUT /api/settings`
- `POST /api/photos` (Upload), `GET /photos/:id`
- `GET /api/stock` (aktive Bildanbieter), `GET /api/stock/search?q=…` (Pexels/Pixabay), `POST /api/photos/stock` (gewählten Treffer übernehmen)
- `GET /api/stats/week`, `GET /api/export`, `POST /api/import`

## Projektstruktur (Entwurf)

```
eat-source/
├── Plan.md
├── Dockerfile
├── compose.yaml        # App + Caddy, Volume für data/, Env-Datei für Secrets
├── server/
│   ├── index.js        # Server-Start, Routing, Auth
│   ├── db.js           # SQLite-Zugriff, Schema, Migrationen
│   └── routes/         # dishes, meals, workouts, weights, stats, ...
├── client/             # Vite + React
│   ├── index.html
│   ├── vite.config.js  # inkl. Dev-Proxy und PWA-Plugin
│   ├── public/         # Icons, Manifest
│   └── src/            # main.jsx, Seiten (Heute, Sport, Gewicht, Gerichte, Statistik), Komponenten
│                       # Build-Ausgabe: client/dist/ (wird vom Server ausgeliefert)
└── data/               # SQLite-Datei und Fotos (nicht ins Repo)
```

## Umsetzungsschritte

1. ✅ Projekt initialisieren, Dockerfile und `compose.yaml` anlegen; `node:sqlite` im Container testen, Speicherverbrauch prüfen.
2. ✅ Server-Grundgerüst, SQLite-Schema, Login.
3. ✅ API für Gerichte, Essens-Einträge, Gewicht, Sport, Einstellungen (außerdem Fotos, Wochenstatistik, Export/Import).
   Stand 2026-11-24: 17 Tests grün, Image gebaut und im Container geprüft (ca. 57 MiB RAM im Leerlauf, Healthcheck ok).
   Noch nicht im Server: Mahlzeiten-Vorlagen (Phase 1, Punkt 5).
4. ✅ Client mit Vite + React aufsetzen: Layout, Tabs (Router), Startseite „Heute“ mit Zielbalken.
   Stand 2026-11-25: Login, Tab-Leiste, „Heute“ (Tagesnavigation, Kalorien-/Proteinbalken, Mahlzeiten-Liste, Hinzufügen
   aus Gerichten mit Portionsfaktor und Suche, Löschen). Sport, Gewicht, Gerichte, Statistik sind Platzhalter.
   Mehrstufiger Docker-Build läuft; Smoke-Test im Container (Login, API, SPA-Fallback) ok. Noch nicht im Browser/auf dem Handy angesehen.
5. ✅ Gerichte-Verwaltung, Fotos, Favoriten, Portionsfaktor.
   Stand 2026-11-25: Gerichte-Tab (Suche, Filter nach Kategorie/Favoriten, Stern, Anlegen/Bearbeiten/Löschen mit Foto);
   Essens-Einträge mit Portionsfaktor (Schnellwahl und freie Eingabe), anpassbaren Werten, Kategorie, Uhrzeit, Notiz, Foto,
   „Eigener Eintrag“ ohne Gericht, Bearbeiten und Löschen. Fotos werden vor dem Upload auf max. 1280 px verkleinert.
   Anfragen der Formulare gegen den Container geprüft; die Oberfläche selbst noch nicht im Browser.
   Bekannt: Ersetzte oder entfernte Fotos bleiben als Datei auf dem Server (kein Lösch-Endpoint); Kategorien lassen sich noch nicht in der App ändern (nur über `meal_categories` in den Einstellungen).
6. ✅ Sport- und Gewichtsansichten, Diagramme, Wochenstatistik.
   Stand 2026-11-25: Sport-Tab (Trainings der letzten 90 Tage, Anlegen/Bearbeiten/Löschen mit Übungen, Bestleistungen);
   Gewicht-Tab (Kennzahlen, Trend mit Status „zu langsam / im Zielkorridor / zu schnell“, Tageseingabe, Diagramm mit
   7-Tage-Schnitt, Zeitraum 30/90/alles, Messungen als Tabelle); Statistik-Tab (Woche vor/zurück, Kennzahlen, Säulen für
   Kalorien und Protein mit Ziellinie, Tabelle); Einstellungen (Tagesziele, Zielgewicht, Kategorien, Export JSON/CSV, Import).
   Diagramme als eigenes SVG ohne Bibliothek (Bundle ca. 96 KB gzip gesamt). Akzentfarbe der Diagramme mit dem
   Palette-Validator geprüft (Hell ok, Dunkel angepasst auf #46b074). Diagramme zusätzlich per SVG-Rendering angesehen
   (Hell/Dunkel, wenige/viele Messungen, einzelne Messung, Säule über Ziel). Anfragen aller Formulare gegen den Container
   geprüft (inkl. Import-Rundlauf). Noch nicht im echten Browser/auf dem Handy (Touch, Tooltip, Layout der Sheets).
   Bekannt: Trainings werden nur 90 Tage zurück geladen; Mahlzeiten-Vorlagen (Phase 1, Punkt 5) fehlen weiter in Server und App.
7. ✅ (Code) Manifest, Service Worker, Icons; Installierbarkeit auf dem Handy noch zu prüfen (braucht HTTPS, Schritt 8).
   Stand 2026-11-25: `vite-plugin-pwa` 2.0 (Workbox generateSW). Manifest (standalone, Hell/Dunkel-Themefarbe, Icons 192/512 und
   maskable), Icons aus `client/tools/make-icons.mjs` (Teller mit Gabel und Messer), iOS-Meta-Tags und Touch-Icon, Safe-Area oben.
   Service Worker lädt nur die App-Hülle vor (10 Dateien, ca. 317 KiB); `/api` und `/photos` gehen nie durch den Cache
   (hängen an der Anmeldung). Neue Versionen werden sofort aktiv und laden die Seite neu (`skipWaiting`/`clientsClaim` müssen
   bei `injectRegister: false` ausdrücklich gesetzt sein, sonst bleibt ein Update „wartend“).
   Geprüft im Container: Manifest, Icons (Typ und Größe), `sw.js` ohne Anmeldung erreichbar, `Cache-Control: max-age=0`,
   Manifest erfüllt die Installierbarkeits-Kriterien. Nicht geprüft: Registrierung des Service Workers, Installieren und
   Offline-Start in einem echten Browser/auf dem Handy.
   Offline gibt es nur die App-Hülle; Daten brauchen weiter den Server (Offline-Warteschlange ist Phase 2).
   Hinweis: `workbox-build` zieht `glob@11.1.0` (npm meldet „deprecated“); es läuft nur beim Build und landet nicht im Laufzeit-Image.
8. ✅ (vorbereitet, Umstellung offen) HTTPS per Caddy-Container, Autostart über Docker-Restart-Policy, Backup-Routine.
   Stand 2026-11-25: Es läuft bereits ein gemeinsamer Caddy (`caddy1`, Ports 80/443, Konfiguration `/root/caddy/caddy.json`),
   der `eat.oliverklemencic.com` an `eat:3000` im Docker-Netz `postgres-network` weiterleitet. Dort läuft aktuell nur ein
   Platzhalter aus `/root/eat` (Container `eat`, Seite „Node.js app is running“). Entscheidung: Domain `eat.oliverklemencic.com`
   wiederverwenden; `compose.yaml` nimmt Container-Name `eat`, Netz `postgres-network` und Port 3000 des Platzhalters an,
   Caddy bleibt unverändert. `TRUST_PROXY=1` und `PORT=3000` sind in der `compose.yaml` fest gesetzt.
   Autostart: Docker-Dienst ist aktiviert, Container mit `restart: unless-stopped`.
   Backup: `scripts/backup.sh` (Host) ruft `scripts/backup.js` (Container) auf: konsistenter Schnappschuss per `VACUUM INTO`
   mit Integritätsprüfung, dazu Fotos, als `tar.gz` in `~/backups/eat` (Rechte 700), Aufbewahrung 30 Tage. Wiederherstellung steht
   im Kopf des Skripts.
   Geprüft in isolierten Testcontainern (der echte `eat`-Container und `caddy1` wurden nicht berührt): 8 Sicherungen unter 240
   gleichzeitigen Schreibzugriffen ohne Fehler, Wiederherstellung samt Integritätsprüfung; Compose-Netzanbindung, Erreichbarkeit
   per Name im Netz, Healthcheck, Host-Port nur auf 127.0.0.1, Login-Sperre pro Client-IP hinter dem Proxy.
   Dabei gefundener Fehler (behoben): Die Online-Backup-Funktion von `node:sqlite` brach unter Schreiblast ab und ließ eine
   halbe Datei zurück; deshalb `VACUUM INTO` und Aufräumen bei jedem Fehler.

   **Umstellung (noch nicht ausgeführt):**
   ```
   cd /root/eat-source
   docker compose build                                           # Image eat-source-app; Speicher knapp, ggf. Swap
   mkdir -p data && chown 1000:1000 data                          # ohne das stürzt die App mit EACCES ab
   (cd /root/eat && docker compose down)                          # Platzhalter stoppen (gleicher Container-Name)
   docker compose up -d
   ```
   Danach im Browser `https://eat.oliverklemencic.com` öffnen: Ohne Benutzer in der Datenbank erscheint die Einrichtung, dort den ersten
   Benutzer (Administrator) anlegen. Das sofort nach dem Start tun, solange die Seite öffentlich erreichbar ist.
   Zurück zum Platzhalter: `docker compose down` hier, dann `(cd /root/eat && docker compose up -d)`.
   Backup täglich (nach der Umstellung, `crontab -e`):
   `15 3 * * * /root/eat-source/scripts/backup.sh >> /root/backups/eat/backup.log 2>&1`
   Hinweis zur gemeinsamen Caddy-Konfiguration (nicht verändert): `automatic_https.disable_redirects` ist `true`, also wird
   `http://` nicht auf `https://` umgeleitet. Die App setzt Secure-Cookies; Anmeldung funktioniert nur über `https://`.
9. Phase 2 nach Bedarf.
10. ✅ Mehrbenutzerbetrieb. Stand 2026-11-25: Tabelle `users` (Name ohne Beachtung der Groß-/Kleinschreibung, scrypt-Hash, Administrator-Flag),
   `user_id` an Fotos, Gerichten, Essens-Einträgen, Trainings, Gewicht und Einstellungen (Sätze gehören über das Training dazu). Alle Abfragen
   sind auf den angemeldeten Benutzer begrenzt; fremde Datensätze, Gerichte und Fotos sind per ID nicht erreichbar (404/400).
   - Erster Start ohne Benutzer: Die Web-Oberfläche zeigt die Einrichtung (`POST /api/setup`, nur solange es keinen Benutzer gibt).
     Der erste Benutzer wird Administrator und übernimmt vorhandene Daten (Migration 3 lässt sie mit `user_id` NULL liegen,
     auch die Beispielgerichte einer neuen Datenbank). Weitere Benutzer starten mit den Beispielgerichten.
   - `APP_PASSWORD_HASH` entfällt (Konfiguration, `scripts/secrets.js hash`). Der Signaturschlüssel der Sessions entsteht beim ersten Start zufällig und liegt in der Tabelle `app_meta` (Migration 4, nicht im Export); `SESSION_SECRET` ist nur noch ein optionaler Override. Es ist keine `.env` mehr nötig. Das Session-Token enthält die
     Benutzer-ID und ist an den Passwort-Hash des Benutzers gebunden: Passwortwechsel oder Löschen beendet dessen Sessions sofort.
     Alte Cookies sind ungültig (einmal neu anmelden).
   - Administrator: Benutzer anlegen (keine Selbstregistrierung), Passwort setzen, Benutzer samt Daten löschen (nicht sich selbst).
     Jeder: eigenes Passwort ändern (Mindestlänge 12). In der App unter Statistik → Konto.
   - Export/Import betreffen nur den eigenen Benutzer; beim Import werden die IDs neu vergeben (alte Exportdateien bleiben importierbar).
   - Backup (`scripts/backup.js`) sichert die ganze Datenbank, also auch die Passwort-Hashes aller Benutzer und den Signaturschlüssel; Rechte 700 auf `~/backups/eat` beibehalten.
   - Bekannt: Kein Zurücksetzen des Administrator-Passworts, wenn es verloren ist und es keinen zweiten Administrator gibt (müsste per
     Skript im Container oder direkt in der Datenbank erfolgen). Foto-Dateien gelöschter Benutzer bleiben auf dem Server liegen.
     Login-Sperre weiterhin nur pro IP.
11. ✅ (Code) Barcode-Scan und Produkte. Stand 2026-11-25: Migration 5 (`products`, Nährwerte pro 100 g, Barcode je Benutzer eindeutig,
   UPC-A/EAN-13 werden über das Entfernen führender Nullen gleichgesetzt), API `/api/products`, Teil von Export/Import (CSV-Tabelle „Produkte“).
   „Essen hinzufügen“ → „Barcode scannen“: Kamera-Scan über die `BarcodeDetector`-API des Browsers oder Eintippen; bekannter Barcode →
   Menge in g wählen (Werte werden umgerechnet, danach das normale Essens-Formular), unbekannter → Produkt manuell registrieren
   (Name, Marke, kcal/Protein/Kohlenhydrate/Fett pro 100 g, übliche Portion).
   Server-Tests grün (28), Client-Build ok. Nicht im Browser/auf dem Handy geprüft.
   Ergänzt 2026-11-25: Fallback auf Open Food Facts (`server/lookup.js`, API v3, kein Key, generischer User-Agent, nach außen geht nur der Barcode,
   Cache 1 h/10 min, Abschalten mit `PRODUCT_LOOKUP=off`). `GET /api/products/lookup/:code` liefert nur einen Vorschlag (404 unbekannt, 502 Dienst
   nicht erreichbar); gespeichert wird erst nach Prüfung im Formular. Billa/Hofer-Shops werden nicht abgefragt (keine offizielle API, keine EAN in den
   Shop-URLs). Batch-Registrierung: Gerichte-Seite → „Produkte erfassen“ (Dauer-Scan oder mehrere Codes einfügen, Prüfung nacheinander, vollständige
   Vorschläge per Klick übernehmen, unvollständige einzeln ergänzen), API `POST /api/products/batch` (max. 100, je Produkt einzeln bewertet).
   Server-Tests dann 33, Client-Build ok; Lookup gegen die echte API geprüft, Oberfläche nicht im Browser/auf dem Handy.
   Bekannt: `BarcodeDetector` fehlt u. a. in Safari/iOS und Firefox; dort bleibt nur das Eintippen. Ein JS-Decoder (z. B. `@zxing/browser`)
   wäre die Ergänzung dafür. Produkte lassen sich bisher nur im Scan-Ablauf bearbeiten/löschen, nicht in der Gerichte-Ansicht.
   Ergänzt 2026-11-25: Online-Bildsuche für Gerichte und Einträge (`server/stock.js`, `routes/stock.js`, `StockPicker.jsx`). Im Foto-Feld „Online suchen“
   (Suchbegriff = Gerichtname) zeigt Treffer von Pexels und Pixabay; ein Klick lässt den Server das Bild herunterladen und wie einen Upload in
   `data/photos` speichern (kein Hotlinking). Keys nur über `PEXELS_API_KEY` / `PIXABAY_API_KEY` (Umgebung bzw. `.env`, nicht im Repo); ohne Key ist
   der Anbieter aus, ohne beide Keys erscheint der Knopf nicht. Lokal (ohne Docker) lädt `server/index.js` die `.env` im Projektordner selbst
   (`process.loadEnvFile`, gesetzte Variablen haben Vorrang) und meldet beim Start „Bildsuche: Pixabay“ bzw. „aus“. Nach außen geht nur der Suchbegriff, generischer User-Agent. Der Server lädt nur von
   den Bild-Hosts des Anbieters (`images.pexels.com`, `pixabay.com`, `cdn.pixabay.com`, https, Weiterleitungen einzeln geprüft, max. 10 MB, Typ per
   Magic Bytes). Suchergebnisse 24 h im Speicher (Pixabay-Vorgabe). Quellenangabe (Fotograf, Anbieter) steht in der Trefferliste, wird aber nicht
   mit dem Foto gespeichert.
   Ergänzt 2026-11-25: Gericht-Vorschläge online (`server/dish-search.js`, `DishSuggest.jsx`). Im Formular „Neues Gericht“ sucht „Fertiges Gericht online
   suchen“ in Open Food Facts (search-a-licious liefert nur Barcodes, die Nährwerte kommen aus der Barcode-Abfrage `lookup.js`). Werte pro Portion, wenn die
   Portionsgröße bekannt ist, sonst pro 100 g mit Hinweis; Übernahme füllt nur das Formular, gespeichert wird erst mit „Speichern“. Open Food Facts bremst
   Anfragen-Schübe (429): Nachschlagung in Dreiergruppen, bei Sperre Teilergebnis bzw. Meldung „bitte kurz warten“, Cache 1 h. Abschalten wie die
   Barcode-Abfrage mit `PRODUCT_LOOKUP=off`. Bekannt: Trockenmischungen (z. B. „Fix für Lasagne“) tragen oft Nährwerte der trockenen Ware mit der Portionsgröße
   des fertigen Gerichts; solche Vorschläge muss der Benutzer prüfen.

## Offene Punkte

- ~~Node.js-Installation auf diesem Rechner freigeben.~~ Entfällt durch den Betrieb in Docker.
- ~~`node:sqlite` im Container testen~~ läuft (Node 22.23). Arbeitsspeicher weiter beobachten (ca. 1 GB gesamt); gilt vor allem für den Vite-Build.
- ~~Client in JavaScript oder TypeScript?~~ Entschieden: JavaScript (wie der Server), `react-router-dom`, State lokal per Hooks. Diagramme: eigenes SVG ohne Bibliothek (Schritt 6).
- ~~Wie wird der Server vom Handy aus erreicht?~~ Entschieden: über die Domain `eat.oliverklemencic.com` (gemeinsamer Caddy, HTTPS). Damit ist die App öffentlich erreichbar und nur durch die Anmeldung geschützt (Login-Sperre nach 5 Fehlversuchen pro IP und 15 Minuten, Secure-/HttpOnly-/SameSite-Cookie) geschützt; ein langes Passwort ist wichtig.
- Passwort-Handling: umgesetzt als Benutzer in der Datenbank (Schritt 10); der erste Benutzer wird beim ersten Start in der Web-Oberfläche angelegt. Aus der Umgebung ist nichts zwingend nötig.
