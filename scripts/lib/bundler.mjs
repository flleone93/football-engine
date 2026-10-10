// Bundler minimale senza dipendenze: impacchetta i moduli ES di src/* in un unico script per il browser
// e li incorpora con public/* in una pagina HTML singola (file offline) o nel formato contenuto di un Artifact claude.ai.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const aliases = { 'node:crypto': path.join(root, 'src/browser/crypto.js') };

function resolveSpecifier(specifier, fromFile) {
  if (aliases[specifier]) return aliases[specifier];
  if (specifier.startsWith('node:')) throw new Error(`Modulo Node non supportato nel browser: ${specifier} (in ${fromFile})`);
  if (!specifier.startsWith('.')) throw new Error(`Dipendenza esterna non supportata: ${specifier} (in ${fromFile})`);
  return path.resolve(path.dirname(fromFile), specifier);
}

const bindingList = (list) => list.split(',').map((part) => part.trim()).filter(Boolean)
  .map((part) => {
    const [imported, local] = part.split(/\s+as\s+/).map((s) => s.trim());
    return { imported, local: local || imported };
  });

export function bundleModules(entryFile) {
  const modules = new Map(); // absolutePath -> { id, code }

  function transform(file) {
    if (modules.has(file)) return modules.get(file).id;
    const id = path.relative(root, file).split(path.sep).join('/');
    modules.set(file, { id, code: '' });
    let code = fs.readFileSync(file, 'utf8');
    const exported = [];

    code = code.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/gm, (_, list, specifier) => {
      const depId = transform(resolveSpecifier(specifier, file));
      const destructure = bindingList(list).map(({ imported, local }) => imported === local ? imported : `${imported}: ${local}`).join(', ');
      return `const { ${destructure} } = __require(${JSON.stringify(depId)});`;
    });
    code = code.replace(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"];?/gm, (_, local, specifier) => {
      const depId = transform(resolveSpecifier(specifier, file));
      return `const ${local} = __require(${JSON.stringify(depId)}).default;`;
    });
    code = code.replace(/^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/gm, (_, list, specifier) => {
      const depId = transform(resolveSpecifier(specifier, file));
      const bindings = bindingList(list);
      bindings.forEach(({ local }) => exported.push(local));
      return `const { ${bindings.map(({ imported, local }) => imported === local ? imported : `${imported}: ${local}`).join(', ')} } = __require(${JSON.stringify(depId)});`;
    });
    code = code.replace(/^export\s*\{([^}]*)\};?/gm, (_, list) => {
      bindingList(list).forEach(({ imported, local }) => exported.push(imported === local ? imported : `${local}: ${imported}`));
      return '';
    });
    code = code.replace(/^export\s+((?:async\s+)?function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    });
    if (/^\s*(import|export)\s/m.test(code)) throw new Error(`Sintassi import/export non gestita in ${id}`);
    if (/import\.meta/.test(code)) throw new Error(`import.meta non supportato in ${id}`);

    modules.get(file).code = `${code}\nreturn { ${exported.join(', ')} };`;
    return id;
  }

  const entryId = transform(entryFile);
  const source = `(function () {
'use strict';
const __defs = Object.create(null);
const __cache = Object.create(null);
function __require(id) {
  if (id in __cache) return __cache[id];
  if (!(id in __defs)) throw new Error('Modulo mancante: ' + id);
  __cache[id] = {};
  return (__cache[id] = __defs[id](__require));
}
${[...modules.values()].map(({ id, code }) => `__defs[${JSON.stringify(id)}] = function (__require) {\n${code}\n};`).join('\n')}
__require(${JSON.stringify(entryId)});
})();`;
  return { source, moduleCount: modules.size };
}

export const escapeScript = (source) => source.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

/** Serializza dati per un <script> inline senza possibilità di chiuderlo. */
export const inlineJson = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * `variant: 'file'` produce un documento completo; `variant: 'artifact'` produce il contenuto della pagina
 * (title, style, markup, script) che il publisher Artifact avvolge nel proprio scheletro HTML.
 */
export function renderPage({ bundle, prelude = '', variant = 'file', title, comment }) {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  const scripts = `${prelude ? `<script>\n${prelude}\n</script>\n` : ''}<script>\n${escapeScript(bundle)}\n</script>\n<script type="module">\n${escapeScript(app)}\n</script>`;
  if (variant === 'artifact') {
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1];
    if (!body) throw new Error('public/index.html senza <body>.');
    const markup = body.replace(/<script[^>]*src="\/app\.js"[^>]*><\/script>/, '');
    return `<title>${title}</title>\n<!-- ${comment} -->\n<style>\n${css}\n</style>\n${markup}\n${scripts}\n`;
  }
  let output = html
    .replace(/<link[^>]*rel="stylesheet"[^>]*href="\/styles\.css"[^>]*>/, () => `<style>\n${css}\n</style>`)
    .replace(/<script[^>]*src="\/app\.js"[^>]*><\/script>/, () => scripts);
  if (output.includes('href="/styles.css"') || output.includes('src="/app.js"')) {
    throw new Error('Impossibile incorporare styles.css o app.js: verificare public/index.html.');
  }
  if (title) output = output.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  return output.replace('<title>', `<!-- ${comment} -->\n  <title>`);
}

export function writeOutput(relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}
