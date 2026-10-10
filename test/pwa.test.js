import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('build app iPhone: file installabili, CSP restrittiva, nessun segreto', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-pwa.mjs')], { cwd: root, stdio: 'pipe' });
  const out = path.join(root, 'dist/pwa');
  for (const file of ['index.html', 'engine.js', 'app.js', 'styles.css', 'sw.js', 'register-sw.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'seed-ledger.json', '.nojekyll']) {
    assert.ok(fs.existsSync(path.join(out, file)), `manca ${file}`);
  }
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'self' https:\/\/site\.api\.espn\.com https:\/\/geocoding-api\.open-meteo\.com https:\/\/api\.open-meteo\.com https:\/\/api\.anthropic\.com/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'nessuno script inline: la CSP li bloccherebbe');
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  const png = fs.readFileSync(path.join(out, 'icon-512.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 512);
  const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
  assert.doesNotMatch(sw, /__BUILD_VERSION__/);
  const everything = fs.readdirSync(out).filter((file) => /\.(js|html|json)$/.test(file)).map((file) => fs.readFileSync(path.join(out, file), 'utf8')).join('\n');
  assert.doesNotMatch(everything, /AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}/, 'nessuna chiave API nei file pubblicati');
});
