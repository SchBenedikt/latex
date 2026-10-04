import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'client', 'engine-data', 'tl2025');
const chunkSize = 20 * 1024 * 1024;

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function writeChunks(source, relative) {
  const destination = path.join(output, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  const input = await import('node:fs');
  const stream = input.createReadStream(source);
  let chunkIndex = 0;
  let pending = Buffer.alloc(0);
  for await (const part of stream) {
    pending = pending.length ? Buffer.concat([pending, part]) : part;
    while (pending.length >= chunkSize) {
      const target = `${destination}.part${String(chunkIndex++).padStart(3, '0')}`;
      await pipeline(Readable.from([pending.subarray(0, chunkSize)]), createWriteStream(target));
      pending = pending.subarray(chunkSize);
    }
  }
  if (pending.length || chunkIndex === 0) {
    const target = `${destination}.part${String(chunkIndex).padStart(3, '0')}`;
    await pipeline(Readable.from([pending]), createWriteStream(target));
  }
  return { asset: relative, size: (await stat(source)).size, chunks: chunkIndex + (pending.length || chunkIndex === 0 ? 1 : 0) };
}

let reusable = false;
try {
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'client', 'engine-data', 'manifest.json'), 'utf8'));
  if (manifest.version === 'tl2025' && Array.isArray(manifest.assets) && manifest.assets.length) {
    const complete = await Promise.all(manifest.assets.map(async (asset) => {
      for (let index = 0; index < asset.chunks; index++) {
        try { await stat(path.join(root, 'client', 'engine-data', 'tl2025', `${asset.asset}.part${String(index).padStart(3, '0')}`)); }
        catch { return false; }
      }
      return true;
    }));
    reusable = complete.every(Boolean);
    if (reusable) console.log(`[cloudflare] reusing ${manifest.assets.length} prepared runtime assets.`);
  }
} catch { /* A clean Cloudflare checkout must download the runtime. */ }

// Cloudflare Worker Builds runs `npm run build` in a fresh checkout, so this
// branch downloads the gitignored runtime before Wrangler snapshots static files.
if (!reusable) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'latex-studio-engine-'));
  const archive = path.join(temporary, 'bundles.tar.gz');
  try {
  await rm(path.join(root, 'client', 'engine-data'), { recursive: true, force: true });
  const extracted = path.join(temporary, 'extract');
  await mkdir(extracted, { recursive: true });
  console.log('[cloudflare] preparing the TeX Live WebAssembly runtime (about 230 MB)…');
  let bundlesDir = process.env.LATEX_ENGINE_BUNDLE_DIR;
  if (bundlesDir) {
    bundlesDir = path.resolve(bundlesDir);
  } else {
    await download('https://cdn.siglum.org/tl2025/siglum-bundles-v0.1.0.tar.gz', archive);
    const tar = spawnSync('tar', ['--exclude=bundles/node_modules', '-xzf', archive, '-C', extracted, 'bundles'], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error('Could not extract the TeX Live bundle archive');
    bundlesDir = path.join(extracted, 'bundles');
  }
  await Promise.all([
    download('https://cdn.siglum.org/tl2025/busytex.wasm', path.join(temporary, 'busytex.wasm')),
    download('https://cdn.siglum.org/tl2025/busytex.js', path.join(temporary, 'busytex.js')),
  ]);
  const names = (await readdir(bundlesDir)).filter((name) => !name.startsWith('._') && (/^(bundles|file-manifest|file-to-package|package-deps)\.json$/.test(name) || name.endsWith('.data.gz')));
  const assets = [];
  for (const name of names) assets.push(await writeChunks(path.join(bundlesDir, name), `bundles/${name}`));
  assets.push(await writeChunks(path.join(temporary, 'busytex.wasm'), 'busytex.wasm'));
  assets.push(await writeChunks(path.join(temporary, 'busytex.js'), 'busytex.js'));
  await import('node:fs/promises').then(({ writeFile }) => writeFile(path.join(root, 'client', 'engine-data', 'manifest.json'), JSON.stringify({ version: 'tl2025', assets }, null, 2)));
  console.log(`[cloudflare] prepared ${assets.length} runtime assets as same-origin static chunks.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
