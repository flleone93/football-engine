#!/usr/bin/env node
// Genera la demo standalone single-file: dist/football-engine-demo.html
// Motore reale src/* + frontend public/* in un unico HTML: si apre con doppio clic, offline, senza Node né chiavi.
import path from 'node:path';
import { bundleModules, renderPage, root, writeOutput } from './lib/bundler.mjs';

const { source, moduleCount } = bundleModules(path.join(root, 'src/browser/entry.js'));
const output = renderPage({
  bundle: source,
  title: 'Enterprise Football Engine Demo',
  comment: 'Demo standalone generata da scripts/build-standalone.mjs: motore reale eseguito nel browser, dati dimostrativi, AI off.'
});
const target = writeOutput('dist/football-engine-demo.html', output);
console.log(`Demo standalone generata: ${path.relative(process.cwd(), target)} (${(output.length / 1024).toFixed(1)} KB, ${moduleCount} moduli)`);
