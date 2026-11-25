// Erzeugt die App-Icons in client/public (favicon.svg und PNGs) aus einer einzigen Zeichnung.
// Wird nur bei Änderungen am Icon gebraucht; die erzeugten Dateien liegen im Repo.
//
// Aufruf (ohne Node auf dem Host), im Ordner client/:
//   docker run --rm -v "$PWD":/client -w /tmp/r node:22-slim sh -c \
//     'npm init -y >/dev/null && npm i --silent @resvg/resvg-js && RESVG_DIR=/tmp/r node /client/tools/make-icons.mjs'

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const { Resvg } = createRequire(path.join(process.env.RESVG_DIR, 'package.json'))('@resvg/resvg-js');
const out = path.resolve(import.meta.dirname, '..', 'public');

const GREEN = '#2f7d4f';

// Teller mit Gabel und Messer, auf 512×512 gezeichnet; scale verkleinert um die Mitte (Sicherheitszone)
const art = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)" fill="#fff">
    <circle cx="256" cy="256" r="104"/>
    <circle cx="256" cy="256" r="78" fill="none" stroke="${GREEN}" stroke-width="6"/>
    <rect x="88" y="150" width="10" height="64" rx="5"/>
    <rect x="104" y="150" width="10" height="64" rx="5"/>
    <rect x="120" y="150" width="10" height="64" rx="5"/>
    <rect x="88" y="196" width="42" height="40" rx="14"/>
    <rect x="102" y="230" width="14" height="150" rx="7"/>
    <rect x="390" y="150" width="26" height="140" rx="13"/>
    <rect x="396" y="280" width="14" height="100" rx="7"/>
  </g>`;

const svg = (radius, scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${GREEN}"/>${art(scale)}</svg>\n`;

const png = (source, size) => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();

const rounded = svg(112, 1); // "any": abgerundet, Ecken transparent
const fullBleed = (scale) => svg(0, scale); // Maskable/iOS: bis zum Rand, das System schneidet zu

writeFileSync(path.join(out, 'favicon.svg'), rounded);
writeFileSync(path.join(out, 'icon-192.png'), png(rounded, 192));
writeFileSync(path.join(out, 'icon-512.png'), png(rounded, 512));
writeFileSync(path.join(out, 'icon-maskable-512.png'), png(fullBleed(0.7), 512));
writeFileSync(path.join(out, 'apple-touch-icon.png'), png(fullBleed(0.85), 180));
console.log('Icons geschrieben in', out);
