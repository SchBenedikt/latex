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
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching…');
} else {
  await esbuild.build(options);
  cpSync(path.join(root, 'node_modules', '@siglum', 'engine', 'src', 'worker.js'), path.join(root, 'client', 'dist', 'siglum-worker.js'));
  writeFileSync(path.join(root, 'client', 'templates.json'), JSON.stringify(collectTemplates()));
  const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist');
  const publicPdfjs = path.join(root, 'client', 'vendor', 'pdfjs');
  mkdirSync(path.join(publicPdfjs, 'build'), { recursive: true });
  cpSync(path.join(pdfjs, 'build', 'pdf.worker.min.mjs'), path.join(publicPdfjs, 'build', 'pdf.worker.min.mjs'));
  cpSync(path.join(pdfjs, 'cmaps'), path.join(publicPdfjs, 'cmaps'), { recursive: true });
  cpSync(path.join(pdfjs, 'standard_fonts'), path.join(publicPdfjs, 'standard_fonts'), { recursive: true });
  console.log('[build] client bundle written to client/dist/app.js');
}
