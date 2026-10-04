import esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(root, 'client', 'dist');
mkdirSync(outdir, { recursive: true });

const watch = process.argv.includes('--watch');

function collectTemplates() {
  const base = path.join(root, 'templates');
  const out = [];
  for (const name of readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const dir = path.join(base, name);
    let meta = { name, title: name, description: '' };
    try { meta = { ...meta, ...JSON.parse(readFileSync(path.join(dir, 'template.json'), 'utf8')) }; } catch { /* optional metadata */ }
    const files = {};
    const walk = (folder, prefix = '') => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.name === 'template.json') continue;
        const rel = prefix + entry.name;
        const abs = path.join(folder, entry.name);
        if (entry.isDirectory()) walk(abs, rel + '/');
        else files[rel] = readFileSync(abs, 'base64');
      }
    };
    walk(dir);
    out.push({ ...meta, name, files });
  }
  return out;
}

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(root, 'client', 'src', 'main.js')],
  bundle: true,
  outfile: path.join(outdir, 'app.js'),
  format: 'iife',
  target: ['chrome110', 'firefox115', 'safari16'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  loader: { '.css': 'css', '.woff2': 'file', '.svg': 'file' },
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  alias: { 'blake3-wasm/browser.js': path.join(root, 'client', 'src', 'blake3-shim.js') },
  plugins: [{
    name: 'siglum-babel-language-definitions',
    setup(build) {
      build.onLoad({ filter: /(ctan|storage)\.js$/ }, ({ path: sourcePath }) => {
        if (!sourcePath.includes(`${path.sep}@siglum${path.sep}engine${path.sep}`)) return null;
        const source = readFileSync(sourcePath, 'utf8');
        if (sourcePath.endsWith(`${path.sep}ctan.js`)) {
          const supportedFiles = "const texExtensions = ['.sty', '.cls', '.def', '.cfg', '.tex', '.fd', '.clo', '.ltx'];";
          if (!source.includes(supportedFiles)) throw new Error('Siglum CTAN file filter changed; update the Babel language definition patch.');
          const packageStatus = 'this.onLog(`[TEXLIVE] Response status: ${response?.status}`);';
          if (!source.includes(packageStatus)) throw new Error('Siglum TeX Live fetch flow changed; review transient error handling.');
          const transientStatus = `${packageStatus}\n            if (response && (response.status === 429 || response.status >= 500)) {\n                this.onLog('[TEXLIVE] Temporary package service error (' + response.status + '); not caching as missing.');\n                return null;\n            }`;
          return {
            contents: source.replace(supportedFiles, "const texExtensions = ['.sty', '.cls', '.def', '.ldf', '.cfg', '.tex', '.fd', '.clo', '.ltx'];").replace(packageStatus, transientStatus),
            loader: 'js',
          };
        }
        const oldCacheVersion = 'const CTAN_CACHE_VERSION = 9;';
        if (!source.includes(oldCacheVersion)) throw new Error('Siglum CTAN cache version changed; review package cache invalidation.');
        return {
          contents: source.replace(oldCacheVersion, 'const CTAN_CACHE_VERSION = 11;'),
          loader: 'js',
        };
      });
    },
  }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching…');
} else {
  await esbuild.build(options);
  const siglumWorker = readFileSync(path.join(root, 'node_modules', '@siglum', 'engine', 'src', 'worker.js'), 'utf8');
  const packageLookup = 'function getPackageFromFile(filename) {\n    const fontPkg = getFontPackage(filename);';
  if (!siglumWorker.includes(packageLookup)) throw new Error('The installed Siglum worker package lookup changed; update the browser package resolver patch.');
  const patchedWorker = siglumWorker.replace(packageLookup, `function getPackageFromFile(filename) {\n    // babel-german is not part of the upstream base bundles.\n    if (/^(ngerman|german|germanb)\\.ldf$/i.test(filename)) return 'babel-german';\n    const fontPkg = getFontPackage(filename);`);
  writeFileSync(path.join(root, 'client', 'dist', 'siglum-worker.js'), patchedWorker);
  cpSync(path.join(root, 'node_modules', 'xzwasm', 'dist', 'package', 'xzwasm.js'), path.join(root, 'client', 'dist', 'xzwasm.js'));
  writeFileSync(path.join(root, 'client', 'templates.json'), JSON.stringify(collectTemplates()));
  const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist');
  const publicPdfjs = path.join(root, 'client', 'vendor', 'pdfjs');
  mkdirSync(path.join(publicPdfjs, 'build'), { recursive: true });
  cpSync(path.join(pdfjs, 'build', 'pdf.worker.min.mjs'), path.join(publicPdfjs, 'build', 'pdf.worker.min.mjs'));
  cpSync(path.join(pdfjs, 'cmaps'), path.join(publicPdfjs, 'cmaps'), { recursive: true });
  cpSync(path.join(pdfjs, 'standard_fonts'), path.join(publicPdfjs, 'standard_fonts'), { recursive: true });
  console.log('[build] client bundle written to client/dist/app.js');
}
