import esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(root, 'client', 'dist');
mkdirSync(outdir, { recursive: true });

const watch = process.argv.includes('--watch');

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
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching…');
} else {
  await esbuild.build(options);
  const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist');
  const publicPdfjs = path.join(root, 'client', 'vendor', 'pdfjs');
  mkdirSync(path.join(publicPdfjs, 'build'), { recursive: true });
  cpSync(path.join(pdfjs, 'build', 'pdf.worker.min.mjs'), path.join(publicPdfjs, 'build', 'pdf.worker.min.mjs'));
  cpSync(path.join(pdfjs, 'cmaps'), path.join(publicPdfjs, 'cmaps'), { recursive: true });
  cpSync(path.join(pdfjs, 'standard_fonts'), path.join(publicPdfjs, 'standard_fonts'), { recursive: true });
  console.log('[build] client bundle written to client/dist/app.js');
}
