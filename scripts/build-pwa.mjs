#!/usr/bin/env node
// Genera l'app iPhone (PWA installabile) in dist/pwa/: tutto gira sul telefono, nessun server.
// Pubblicare la cartella su un hosting HTTPS statico (GitHub Pages) e aggiungerla alla schermata Home da Safari.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../src/api.js';
import { bundleModules, root } from './lib/bundler.mjs';
import { renderIcon } from './lib/icon.mjs';

const out = path.join(root, 'dist/pwa');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const write = (name, content) => fs.writeFileSync(path.join(out, name), content);

const { source, moduleCount } = bundleModules(path.join(root, 'src/browser/mobileEntry.js'));
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
write('engine.js', source);
write('app.js', app);
write('styles.css', css);

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://site.api.espn.com https://geocoding-api.open-meteo.com https://api.open-meteo.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.openai.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

let html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
html = html
  .replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
  .replace(/<link rel="stylesheet" href="\/styles\.css">/, `<meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icon-180.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Football Engine">
  <link rel="stylesheet" href="styles.css">`)
  .replace(/<script type="module" src="\/app\.js"><\/script>/, '<script src="engine.js"></script>\n  <script type="module" src="app.js"></script>\n  <script src="register-sw.js"></script>')
  .replace(/<title>[^<]*<\/title>/, '<title>Football Engine</title>');
if (!html.includes('engine.js') || !html.includes('href="styles.css"')) throw new Error('Trasformazione di public/index.html non riuscita.');
write('index.html', html);

write('register-sw.js', `if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((error) => console.warn('[sw]', error)));
}
`);

const buildVersion = `${APP_VERSION}-${createHash('sha256').update(source + app + css + html).digest('hex').slice(0, 10)}`;
write('sw.js', fs.readFileSync(path.join(root, 'mobile/sw.js'), 'utf8').replace('__BUILD_VERSION__', buildVersion));

write('manifest.webmanifest', JSON.stringify({
  name: 'Enterprise Football Engine',
  short_name: 'Football Engine',
  description: 'Previsioni calcistiche probabilistiche con dati reali, motore statistico e agenti AI, interamente sul dispositivo.',
  lang: 'it',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#1b2420',
  theme_color: '#131a16',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
}, null, 2));
for (const size of [180, 192, 512]) write(`icon-${size}.png`, renderIcon(size));

// Storico previsioni reali già registrato sul Mac: importato al primo avvio se il telefono non ha ancora dati.
const ledgerFile = path.join(root, 'data/live-predictions.jsonl');
const seed = fs.existsSync(ledgerFile)
  ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } })
  : [];
write('seed-ledger.json', JSON.stringify(seed));
write('.nojekyll', '');
write('README.md', `# Enterprise Football Engine · app iPhone\n\nVersione ${buildVersion}. Generata da \`npm run build:pwa\`.\nApri il link in Safari su iPhone → Condividi → "Aggiungi alla schermata Home".\nNessuna chiave è contenuta in questi file: la chiave AI si inserisce nelle Impostazioni dell'app e resta sul telefono.\n`);

console.log(`App iPhone generata in dist/pwa (${buildVersion}, ${moduleCount} moduli, storico iniziale ${seed.length} eventi).`);
