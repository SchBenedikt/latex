import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import JSZip from 'jszip';
import {
  makeResolver, readTree, readTextFile, writeTextFile, engineList,
  toolchain, wordStats, synctexView, synctexEdit, collectProjectFiles, isArtifact,
  resolveIncludes, execFileP,
} from './util.js';
import { BuildManager, buildMeta, findPdf } from './build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(process.env.LATEX_ROOT || path.join(APP_ROOT, 'projects'));
const CLIENT = path.join(APP_ROOT, 'client');
const PORT = Number(process.env.PORT || 4180);
const HOST = process.env.HOST || '0.0.0.0';

fs.mkdirSync(WORKSPACE, { recursive: true });
const { resolve, rel } = makeResolver(WORKSPACE);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100mb' }));
app.use(express.text({ type: ['text/plain', 'application/x-latex', 'text/x-tex'], limit: '100mb' }));
app.use(express.raw({ type: ['application/octet-stream', 'image/*', 'application/pdf', 'application/zip'], limit: '200mb', inflate: true }));

/* ------------------------------------------------------------- Helfer */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
  const filesystemStatus = { ENOENT: 404, ENOTDIR: 404, EACCES: 403, EPERM: 403, EEXIST: 409 }[err.code];
  res.status(err.status || filesystemStatus || 500).json({ error: err.message || String(err) });
});

const projectDir = (req) => {
  const p = req.query.project || req.body?.project || '';
  const abs = resolve(p);
  if (!fs.existsSync(abs)) { const e = new Error('Project not found: ' + p); e.status = 404; throw e; }
  return abs;
};

const PROJECT_NAME_RE = /^[\w\-. ÄÖÜäöü()+ ]{1,80}$/;

/**
 * Dateiangabe des Clients (relativ, projekt-relativ oder arbeitsbereich-relativ
 * wie "Projekt/unter/ordner.tex") in einen projekt-internen Pfad umwandeln.
 */
function projectRel(dir, file) {
  const s = String(file == null ? '' : file).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!s) return s;
  if (path.isAbsolute(s)) return path.relative(dir, s).split(path.sep).join('/');
  const prefix = path.basename(dir).split(path.sep).join('/');
  if (s === prefix) return '';
  if (s.startsWith(prefix + '/')) return s.slice(prefix.length + 1);
  return s;
}

/** Resolve a file inside a project and reject traversal into sibling projects. */
function projectFile(dir, file) {
  const relative = projectRel(dir, file);
  const abs = path.resolve(dir, relative || '.');
  if (abs === dir || !abs.startsWith(dir + path.sep)) {
    throw Object.assign(new Error('File path is outside the project'), { status: 400 });
  }
  const rootReal = fs.realpathSync(dir);
  let existing = abs;
  while (true) {
    try { fs.lstatSync(existing); break; } catch { existing = path.dirname(existing); }
  }
  let real;
  try { real = fs.realpathSync(existing); } catch {
    throw Object.assign(new Error('Invalid file path in project'), { status: 400 });
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw Object.assign(new Error('File path points outside the project'), { status: 400 });
  }
  return { abs, relative: path.relative(dir, abs).split(path.sep).join('/') };
}

/** Validierter Projektname -> absoluter Pfad (direkt unterhalb des Arbeitsbereichs) */
function projectPath(name, { mustExist = true } = {}) {
  const n = String(name || '').trim();
  if (!PROJECT_NAME_RE.test(n) || n === '.' || n === '..') {
    throw Object.assign(new Error('Invalid project name'), { status: 400 });
  }
  const abs = path.resolve(WORKSPACE, n);
  if (path.dirname(abs) !== WORKSPACE) {
    throw Object.assign(new Error('Invalid project name'), { status: 400 });
  }
  if (mustExist && !fs.existsSync(abs)) {
    throw Object.assign(new Error('Project not found: ' + n), { status: 404 });
  }
  return abs;
}

function conflict(msg) { throw Object.assign(new Error(msg), { status: 409 }); }

async function listProjects() {
  const entries = await fsp.readdir(WORKSPACE, { withFileTypes: true });
  return entries.filter((d) => d.isDirectory()).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'de'));
}

/* ------------------------------------------------------------ Zustand */

let TOOLS = {};
async function refreshTools() { TOOLS = await toolchain(); }
await refreshTools();

const emit = (msg) => broadcast(msg);
const builds = new BuildManager(emit);

/* -------------------------------------------------------------- Routes */

app.get('/api/state', wrap(async (req, res) => {
  res.json({
    root: WORKSPACE,
    projects: await listProjects(),
    engines: engineList(),
    tools: TOOLS,
    app: 'LaTeX Studio',
    version: '1.1.0',
    home: os.userInfo().username,
  });
}));

/* ---------------------------------------------------------- Dateibaum */

app.get('/api/tree', wrap(async (req, res) => {
  const base = req.query.path ? resolve(req.query.path) : WORKSPACE;
  const showAll = req.query.all === '1';
  res.json({ tree: await readTree(base, { showAll, root: WORKSPACE }) });
}));

app.get('/api/file', wrap(async (req, res) => {
  const abs = resolve(req.query.path);
  if (req.query.binary === '1') {
    res.sendFile(abs);
    return;
  }
  const f = await readTextFile(abs);
  res.json({ path: rel(abs), ...f });
}));

app.put('/api/file', wrap(async (req, res) => {
  const abs = resolve(req.query.path);
  let result;
  if (Buffer.isBuffer(req.body)) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, req.body);
    const st = await fsp.stat(abs);
    result = { size: st.size, mtime: st.mtimeMs };
  } else {
    const content = typeof req.body === 'string' ? req.body : req.body?.content ?? '';
    result = await writeTextFile(abs, content);
  }
  res.json({ ok: true, path: rel(abs), ...result });
}));

app.post('/api/fs', wrap(async (req, res) => {
  const { op } = req.body || {};
  if (op === 'mkdir') {
    const abs = resolve(req.body.path);
    await fsp.mkdir(abs, { recursive: true });
    res.json({ ok: true });
  } else if (op === 'rename') {
    const from = resolve(req.body.from);
    const to = resolve(req.body.to);
    if (path.dirname(from) !== path.dirname(to)) await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    res.json({ ok: true });
  } else if (op === 'delete') {
    const abs = resolve(req.body.path);
    if (abs === WORKSPACE) throw Object.assign(new Error('The workspace cannot be deleted'), { status: 400 });
    await fsp.rm(abs, { recursive: true, force: true });
    res.json({ ok: true });
  } else if (op === 'copy') {
    const from = resolve(req.body.from);
    const to = resolve(req.body.to);
    await fsp.cp(from, to, { recursive: true });
    res.json({ ok: true });
  } else {
    throw Object.assign(new Error('Unknown operation: ' + op), { status: 400 });
  }
}));

app.get('/api/download', wrap(async (req, res) => {
  const abs = resolve(req.query.path);
  res.download(abs, path.basename(abs));
}));

app.get('/api/export', wrap(async (req, res) => {
  const dir = projectDir(req);
  const zip = new JSZip();
  const add = async (base, prefix = '') => {
    const entries = await fsp.readdir(base, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.latexstudio.json') continue;
      const full = path.join(base, e.name);
      const relPath = prefix + e.name;
      if (e.isDirectory()) { if (!isArtifact(e.name)) await add(full, relPath + '/'); }
      else if (!isArtifact(e.name)) zip.file(relPath, await fsp.readFile(full));
    }
  };
  await add(dir);
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(dir)}.zip"`);
  res.send(buf);
}));

app.post('/api/import', wrap(async (req, res) => {
  const target = resolve(req.query.path || '');
  const zip = await JSZip.loadAsync(req.body);
  let count = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const name = entry.name;
    if (name.includes('..')) continue;
    const abs = path.join(target, name);
    if (!abs.startsWith(target)) continue;
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, await entry.async('nodebuffer'));
    count++;
  }
  res.json({ ok: true, files: count });
}));

/* ---------------------------------------------------------- Templates */

const TEMPLATES_DIR = path.join(APP_ROOT, 'templates');

app.get('/api/templates', wrap(async (req, res) => {
  let dirs = [];
  try { dirs = await fsp.readdir(TEMPLATES_DIR, { withFileTypes: true }); } catch { /* */ }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let meta = { name: d.name, title: d.name, description: '' };
    try {
      const json = JSON.parse(await fsp.readFile(path.join(TEMPLATES_DIR, d.name, 'template.json'), 'utf8'));
      // name ist der Verzeichnis-Identifier und darf nicht überschrieben werden
      meta = { ...meta, ...json, name: d.name };
    } catch { /* */ }
    out.push(meta);
  }
  res.json({ templates: out });
}));

/* ------------------------------------------------------ TeX-Paketverwaltung */

function packageDeclarations(file, source) {
  const clean = String(source)
    .replace(/\\begin\{(?:verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{(?:verbatim\*?|lstlisting|minted)\}/g, '')
    .replace(/\\verb\*?(.)[^\n]*?\1/g, '')
    .replace(/(^|[^\\])%.*$/gm, '$1');
  const found = [];
  const re = /\\(usepackage|RequirePackage|documentclass|LoadClass)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let match;
  while ((match = re.exec(clean))) {
    for (const name of match[2].split(',').map((value) => value.trim())) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,99}$/.test(name)) continue;
      found.push({ name, file, kind: /documentclass|LoadClass/.test(match[1]) ? 'class' : 'package' });
    }
  }
  return found;
}

async function packageAvailability(item) {
  const extension = item.kind === 'class' ? 'cls' : 'sty';
  const resolver = TOOLS.kpsewhich ? 'kpsewhich' : TOOLS.findtexmf ? 'findtexmf' : null;
  if (!resolver) return { ...item, installed: null, resolvedPath: null };
  try {
    const { stdout } = await execFileP(resolver, [`${item.name}.${extension}`], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return { ...item, installed: !!stdout.trim(), resolvedPath: stdout.trim() || null };
  } catch {
    return { ...item, installed: false, resolvedPath: null };
  }
}

app.get('/api/packages', wrap(async (req, res) => {
  const dir = projectDir(req);
  const { abs: main } = projectFile(dir, req.query.file || 'main.tex');
  const declarations = [];
  for (const relative of resolveIncludes(main, dir)) {
    const abs = projectFile(dir, relative).abs;
    try { declarations.push(...packageDeclarations(relative, await fsp.readFile(abs, 'utf8'))); } catch { /* Missing include is reported by the compiler. */ }
  }
  const unique = [...new Map(declarations.map((item) => [`${item.kind}:${item.name}`, item])).values()];
  const packages = await Promise.all(unique.map(packageAvailability));
  const manager = TOOLS.tlmgr ? 'tlmgr' : TOOLS.miktex ? 'miktex' : null;
  res.json({
    packages: packages.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    manager,
    packageManagerAvailable: !!manager,
    resolverAvailable: !!(TOOLS.kpsewhich || TOOLS.findtexmf),
  });
}));

/* ------------------------------------------------------ Literaturimport */
function bibEntries(source) {
  const text = String(source || '');
  const entries = [];
  const start = /(^|[\r\n])\s*@([a-z]+)\s*([({])/ig;
  let match;
  while ((match = start.exec(text))) {
    const entryStart = match.index + match[0].lastIndexOf('@');
    const open = match[3];
    const close = open === '{' ? '}' : ')';
    let depth = 1, quote = false, escaped = false, end = entryStart + match[0].length - match[0].lastIndexOf('@');
    for (; end < text.length && depth; end++) {
      const char = text[end];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { quote = !quote; continue; }
      if (quote) continue;
      if (char === open) depth++;
      else if (char === close) depth--;
    }
    if (depth) continue;
    const raw = text.slice(entryStart, end);
    const head = raw.slice(raw.indexOf(open) + 1).split(',')[0];
    const key = /^(?:comment|preamble|string)$/i.test(match[2]) ? null : head.trim();
    if (key) entries.push({ key, raw, start: entryStart, end });
    start.lastIndex = end;
  }
  return entries;
}

app.post('/api/bibliography/merge', wrap(async (req, res) => {
  const dir = projectDir(req);
  const { content = '', file = 'references.bib', updateExisting = false } = req.body || {};
  if (typeof content !== 'string' || !content.trim() || content.length > 20 * 1024 * 1024) {
    throw Object.assign(new Error('The BibTeX file is empty or too large.'), { status: 400 });
  }
  const target = projectFile(dir, file);
  if (!/\.bib$/i.test(target.relative)) throw Object.assign(new Error('The target file must be a .bib file.'), { status: 400 });
  const parsedIncoming = bibEntries(content);
  if (!parsedIncoming.length) throw Object.assign(new Error('No valid BibTeX entries found.'), { status: 400 });
  const incoming = [...new Map(parsedIncoming.map((entry) => [entry.key.toLocaleLowerCase(), entry])).values()];
  const existing = await fsp.readFile(target.abs, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error));
  const current = bibEntries(existing);
  const incomingByKey = new Map(incoming.map((entry) => [entry.key.toLocaleLowerCase(), entry]));
  const currentKeys = new Set(current.map((entry) => entry.key.toLocaleLowerCase()));
  const added = incoming.filter((entry) => !currentKeys.has(entry.key.toLocaleLowerCase()));
  const updates = incoming.filter((entry) => currentKeys.has(entry.key.toLocaleLowerCase()));
  let merged = existing;
  if (updateExisting && updates.length) {
    for (const item of current.slice().reverse()) {
      const replacement = incomingByKey.get(item.key.toLocaleLowerCase());
      if (replacement) merged = merged.slice(0, item.start) + replacement.raw + merged.slice(item.end);
    }
  }
  if (added.length) merged = [merged.trimEnd(), added.map((entry) => entry.raw).join('\n\n')].filter(Boolean).join('\n\n') + '\n';
  const changed = added.length > 0 || (updateExisting && updates.length > 0);
  if (changed) await writeTextFile(target.abs, merged);
  res.json({ ok: true, file: target.relative, added: added.length, updated: updateExisting ? updates.length : 0, unchanged: updateExisting ? 0 : updates.length, updateCandidates: updates.length, duplicateInput: parsedIncoming.length - incoming.length, keys: added.map((entry) => entry.key) });
}));

/* ------------------------------ GitHub: öffentliche Projekte importieren */
app.post('/api/github/import', wrap(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  let parsed;
  try { parsed = new URL(url); } catch { throw Object.assign(new Error('Enter a valid GitHub repository URL.'), { status: 400 }); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password) {
    throw Object.assign(new Error('Only public repositories from https://github.com/ can be imported.'), { status: 400 });
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const owner = parts[0], repo = (parts[1] || '').replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner || '') || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo || '') || (parts.length > 2 && parts[2] !== 'tree')) {
    throw Object.assign(new Error('URL format: https://github.com/owner/repository or /tree/branch.'), { status: 400 });
  }
  const ref = parts.length > 3 ? parts.slice(3).join('/') : null;
  if (ref && !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(ref)) throw Object.assign(new Error('The branch name contains unsupported characters.'), { status: 400 });
  const name = String(req.body?.name || `${owner}-${repo}`).trim();
  const target = projectPath(name, { mustExist: false });
  if (fs.existsSync(target)) conflict('Project already exists: ' + name);
  let downloadRef = ref;
  if (!downloadRef) {
    const repoResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'LaTeX-Studio/1.0', Accept: 'application/vnd.github+json' } });
    if (!repoResponse.ok) throw Object.assign(new Error(`GitHub repository is unavailable (HTTP ${repoResponse.status}); private repositories are not supported.`), { status: 502 });
    downloadRef = (await repoResponse.json()).default_branch;
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(downloadRef || '') || downloadRef.length > 120) throw Object.assign(new Error('Could not determine the default branch.'), { status: 502 });
  }
  const archiveUrl = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/${encodeURIComponent(downloadRef)}`;
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'LaTeX-Studio/1.0', Accept: 'application/zip' } });
  if (!response.ok) throw Object.assign(new Error(`Could not download GitHub archive (HTTP ${response.status}). Check the repository and branch; private repositories are not supported.`), { status: 502 });
  const final = new URL(response.url);
  if (final.protocol !== 'https:' || final.hostname !== 'codeload.github.com') throw Object.assign(new Error('Unexpected destination for GitHub download.'), { status: 502 });
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > 100 * 1024 * 1024) throw Object.assign(new Error('GitHub archive exceeds 100 MB.'), { status: 413 });
  const archive = Buffer.from(await response.arrayBuffer());
  if (!archive.length || archive.length > 100 * 1024 * 1024) throw Object.assign(new Error('GitHub archive is empty or exceeds 100 MB.'), { status: 413 });
  const zip = await JSZip.loadAsync(archive);
  const files = Object.values(zip.files).filter((file) => !file.dir);
  const tops = new Set(files.map((file) => file.name.split('/').filter(Boolean)[0]));
  const strip = tops.size === 1 && files.some((file) => file.name.includes('/')) ? [...tops][0] + '/' : '';
  if (files.length > 5000) throw Object.assign(new Error('Repository contains more than 5,000 files.'), { status: 413 });
  const expandedSize = files.reduce((sum, file) => sum + Number(file._data?.uncompressedSize || 0), 0);
  if (expandedSize > 200 * 1024 * 1024) throw Object.assign(new Error('Entpackter Repository-Inhalt ist größer als 200 MB.'), { status: 413 });
  let totalBytes = 0, written = 0;
  try {
    await fsp.mkdir(target, { recursive: false });
    for (const entry of files) {
      let rel = entry.name;
      if (strip) { if (!rel.startsWith(strip)) continue; rel = rel.slice(strip.length); }
      if (!rel || rel.includes('..') || path.isAbsolute(rel)) continue;
      const abs = path.resolve(target, rel);
      if (!abs.startsWith(target + path.sep) || isArtifact(path.basename(abs)) || path.basename(abs) === '.git') continue;
      const content = await entry.async('nodebuffer');
      totalBytes += content.length;
      if (totalBytes > 200 * 1024 * 1024) throw Object.assign(new Error('Entpackter Repository-Inhalt ist größer als 200 MB.'), { status: 413 });
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content, { flag: 'wx' });
      written++;
    }
    if (!written) throw Object.assign(new Error('Repository archive contains no importable files.'), { status: 400 });
  } catch (error) {
    await fsp.rm(target, { recursive: true, force: true });
    throw error;
  }
  res.json({ ok: true, project: name, files: written, source: `https://github.com/${owner}/${repo}/tree/${downloadRef}` });
}));

app.post('/api/packages/install', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,99}$/.test(name)) {
    throw Object.assign(new Error('Invalid package name'), { status: 400 });
  }
  const manager = TOOLS.tlmgr ? 'tlmgr' : TOOLS.miktex ? 'miktex' : null;
  if (!manager) throw Object.assign(new Error('No supported TeX package manager found'), { status: 501 });
  try {
    let stdout = '';
    let stderr = '';
    if (manager === 'tlmgr') {
      try {
        ({ stdout, stderr } = await execFileP('tlmgr', ['install', name], { timeout: 300000, maxBuffer: 4 * 1024 * 1024 }));
      } catch (initial) {
        const report = `${initial.stderr || ''}\n${initial.stdout || ''}\n${initial.message || ''}`;
        if (!/user mode not initialized|cannot write|permission denied|not writable/i.test(report)) throw initial;
        try {
          await execFileP('tlmgr', ['init-usertree'], { timeout: 30000, maxBuffer: 1024 * 1024 });
          ({ stdout, stderr } = await execFileP('tlmgr', ['--usermode', 'install', name], { timeout: 300000, maxBuffer: 4 * 1024 * 1024 }));
          stderr = ['Im persönlichen TeX-Live-Paketbaum installiert.', stderr].filter(Boolean).join('\n');
        } catch (userError) {
          const detail = [userError.stderr, userError.stdout, userError.message].filter(Boolean).join('\n');
          throw Object.assign(new Error(detail), { stderr: detail });
        }
      }
    } else {
      ({ stdout, stderr } = await execFileP('miktex', ['packages', 'install', name], { timeout: 300000, maxBuffer: 4 * 1024 * 1024 }));
    }
    await refreshTools();
    res.json({ ok: true, manager, output: [stdout, stderr].filter(Boolean).join('\n').slice(-12000) });
  } catch (err) {
    const detail = [err.stderr, err.stdout, err.message].filter(Boolean).join('\n').slice(-12000);
    throw Object.assign(new Error(`${manager} could not install “${name}”. ${detail}`), { status: 502 });
  }
}));

app.post('/api/project', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!/^[\w\-. ÄÖÜäöü()+ ]{1,80}$/.test(name)) throw Object.assign(new Error('Invalid project name'), { status: 400 });
  const target = path.join(WORKSPACE, name);
  if (fs.existsSync(target)) throw Object.assign(new Error('Project already exists'), { status: 409 });
  const template = String(req.body.template || 'article');
  const tplDir = path.join(TEMPLATES_DIR, template);
  if (!fs.existsSync(tplDir)) throw Object.assign(new Error('Template not found'), { status: 404 });
  let tplMeta = {};
  try { tplMeta = JSON.parse(await fsp.readFile(path.join(tplDir, 'template.json'), 'utf8')); } catch { /* */ }
  await fsp.cp(tplDir, target, { recursive: true });
  await fsp.rm(path.join(target, 'template.json'), { force: true });
  // Projektscope aus der Vorlage anlegen (Hauptdatei/Engine)
  const scope = {};
  if (tplMeta.main) scope.mainFile = String(tplMeta.main);
  if (tplMeta.engine) scope.engine = String(tplMeta.engine);
  if (tplMeta.shellEscape) scope.shellEscape = String(tplMeta.shellEscape);
  if (Object.keys(scope).length) {
    await writeTextFile(path.join(target, CONFIG_NAME), JSON.stringify(scope, null, 2) + '\n');
  }
  res.json({ ok: true, project: name });
}));

/* ------------------------------------------------- Projektverwaltung */

const releaseBuild = (dir) => {
  const job = builds.jobs.get(dir);
  if (job) { job.kill('SIGKILL'); builds.jobs.delete(dir); }
};

app.post('/api/project/rename', wrap(async (req, res) => {
  const from = projectPath(req.body?.name);
  const to = projectPath(req.body?.to, { mustExist: false });
  if (from === to) return res.json({ ok: true, project: path.basename(to) });
  if (fs.existsSync(to)) conflict('Project already exists: ' + path.basename(to));
  releaseBuild(from);
  await fsp.rename(from, to);
  res.json({ ok: true, project: path.basename(to) });
}));

app.post('/api/project/duplicate', wrap(async (req, res) => {
  const from = projectPath(req.body?.name);
  const base = String(req.body?.to || '').trim() || path.basename(from) + ' (Kopie)';
  const to = projectPath(base, { mustExist: false });
  if (fs.existsSync(to)) conflict('Project already exists: ' + path.basename(to));
  await fsp.cp(from, to, {
    recursive: true,
    filter: (src) => !isArtifact(path.basename(src)),
  });
  await cleanArtifacts(to);
  res.json({ ok: true, project: path.basename(to) });
}));

const TRASH_DIR = path.join(APP_ROOT, '.trash');
const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Projekt in den Papierkorb verschieben statt endgültig löschen. */
async function trashProject(abs) {
  await fsp.mkdir(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(TRASH_DIR, `${stamp}-${path.basename(abs)}`);
  try {
    await fsp.rename(abs, target);
  } catch {
    await fsp.cp(abs, target, { recursive: true });
    await fsp.rm(abs, { recursive: true, force: true });
  }
  // Einträge älter als 30 Tage entfernen
  try {
    const now = Date.now();
    for (const e of await fsp.readdir(TRASH_DIR, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const full = path.join(TRASH_DIR, e.name);
      try {
        const st = await fsp.stat(full);
        if (now - st.mtimeMs > TRASH_MAX_AGE_MS) await fsp.rm(full, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

app.post('/api/project/delete', wrap(async (req, res) => {
  const dir = projectPath(req.body?.name);
  releaseBuild(dir);
  await trashProject(dir);
  res.json({ ok: true, project: path.basename(dir) });
}));

app.post('/api/project/import', wrap(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    throw Object.assign(new Error('ZIP archive contains no files'), { status: 400 });
  }
  const name = String(req.query.name || req.body.name || '').trim();
  const target = projectPath(name || 'Import', { mustExist: false });
  if (fs.existsSync(target)) conflict('Project already exists: ' + path.basename(target));

  const zip = await JSZip.loadAsync(req.body);
  const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name);
  if (!names.length) throw Object.assign(new Error('ZIP archive is empty'), { status: 400 });

  // Enthält das Archiv einen einzigen oberen Ordner, wird dieser entfernt
  const tops = new Set(names.map((n) => n.split('/').filter(Boolean)[0]));
  const flat = tops.size === 1 && names.some((n) => n.includes('/'));
  const strip = flat ? [...tops][0] + '/' : '';

  let count = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    let rel = entry.name;
    if (strip) { if (!rel.startsWith(strip)) continue; rel = rel.slice(strip.length); }
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) continue;
    const abs = path.join(target, rel);
    if (!abs.startsWith(target + path.sep)) continue;
    if (isArtifact(path.basename(abs))) continue;
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, await entry.async('nodebuffer'));
    count++;
  }
  if (!count) throw Object.assign(new Error('No files imported'), { status: 400 });
  res.json({ ok: true, project: path.basename(target), files: count });
}));

/* ------------------------------------------- Projekt-Konfiguration */

const CONFIG_NAME = '.latexstudio.json';

app.get('/api/project/config', wrap(async (req, res) => {
  const dir = projectDir(req);
  let config = {};
  try { config = JSON.parse(await fsp.readFile(path.join(dir, CONFIG_NAME), 'utf8')); } catch { /* */ }
  res.json({ config });
}));

app.put('/api/project/config', wrap(async (req, res) => {
  const dir = projectDir(req);
  const config = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? req.body.config || {} : {};
  const allowed = {};
  for (const k of ['mainFile', 'engine', 'shellEscape', 'autoBuild', 'autoBuildDelay']) {
    if (config[k] !== undefined) allowed[k] = config[k];
  }
  const file = path.join(dir, CONFIG_NAME);
  if (Object.keys(allowed).length) {
    await fsp.writeFile(file, JSON.stringify(allowed, null, 2) + '\n', 'utf8');
  } else {
    await fsp.rm(file, { force: true });
  }
  res.json({ ok: true, config: allowed });
}));

/* ------------------------------------------------------- Demo-Projekte */

const DEMOS_DIR = path.join(APP_ROOT, 'demos');

app.get('/api/demos', wrap(async (req, res) => {
  let dirs = [];
  try { dirs = await fsp.readdir(DEMOS_DIR, { withFileTypes: true }); } catch { /* */ }
  const existing = new Set(await listProjects());
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let meta = { name: d.name, title: d.name, description: '' };
    try { meta = { ...meta, ...JSON.parse(await fsp.readFile(path.join(DEMOS_DIR, d.name, 'demo.json'), 'utf8')) }; } catch { /* */ }
    out.push({ ...meta, name: d.name, exists: existing.has(d.name) });
  }
  res.json({ demos: out });
}));

app.post('/api/demo', wrap(async (req, res) => {
  let dirs = [];
  try { dirs = (await fsp.readdir(DEMOS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* */ }
  if (!dirs.length) throw Object.assign(new Error('No sample projects available'), { status: 404 });

  const wanted = Array.isArray(req.body?.names) && req.body.names.length
    ? req.body.names.map(String)
    : dirs;
  const created = [];
  const skipped = [];
  for (const name of wanted) {
    if (!dirs.includes(name)) { skipped.push({ name, reason: 'unbekannt' }); continue; }
    const target = projectPath(name, { mustExist: false });
    if (fs.existsSync(target)) { skipped.push({ name, reason: 'existiert' }); continue; }
    await fsp.cp(path.join(DEMOS_DIR, name), target, { recursive: true });
    await fsp.rm(path.join(target, 'demo.json'), { force: true });
    await cleanArtifacts(target);
    created.push(name);
  }
  res.json({ ok: true, created, skipped, projects: await listProjects() });
}));

/* --------------------------------------------- Projektweite Ersetzung */

app.post('/api/replace', wrap(async (req, res) => {
  const dir = projectDir(req);
  const {
    query = '', replacement = '', regex = false, caseSensitive = false, wholeWord = false,
    include = '', limit = 0,
  } = req.body || {};
  if (!query) return res.json({ count: 0, files: [] });

  let src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord && !regex) src = `\\b${src}\\b`;
  let re;
  try {
    re = new RegExp(src, caseSensitive ? 'g' : 'gi');
  } catch {
    throw Object.assign(new Error('Invalid regular expression'), { status: 400 });
  }
  const reOne = new RegExp(src, caseSensitive ? '' : 'i');

  const files = collectProjectFiles(dir, false)
    .filter((f) => /\.(tex|bib|sty|cls|txt|md|csv)$/i.test(f))
    .filter((f) => !include || f.toLowerCase().includes(include.toLowerCase()));

  let count = 0;
  const changed = [];
  for (const f of files) {
    if (limit && count >= limit) break;
    const abs = path.join(dir, f);
    let text = '';
    try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }

    let next;
    if (limit) {
      reOne.lastIndex = 0;
      if (!reOne.test(text)) continue;
      next = text.replace(reOne, replacement);
    } else {
      re.lastIndex = 0;
      const hits = (text.match(re) || []).length;
      if (!hits) continue;
      re.lastIndex = 0;
      next = text.replace(re, replacement);
      count += hits;
    }
    if (next === text) continue;
    if (limit) count++;
    await writeTextFile(abs, next);
    changed.push(f);
  }
  res.json({ ok: true, count, files: changed });
}));

/** Entfernt Build-Artefakte aus einem frisch kopierten Projekt */
async function cleanArtifacts(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await cleanArtifacts(full);
    else if (isArtifact(e.name) || e.name === 'demo.json') await fsp.rm(full, { force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------- Bauen */

app.post('/api/build', wrap(async (req, res) => {
  const dir = projectDir(req);
  const { engine = 'pdflatex', shellEscape = false, maxRuns = 5 } = req.body || {};
  if (!engineList().some((entry) => entry.id === engine)) throw Object.assign(new Error('Unknown TeX engine'), { status: 400 });
  const { abs, relative: file } = projectFile(dir, req.body?.file || 'main.tex');
  if (!fs.existsSync(abs)) throw Object.assign(new Error('Main file is missing: ' + file), { status: 404 });
  const job = builds.start(dir, { project: rel(dir), file, engine, shellEscape: !!shellEscape, maxRuns });
  res.json({ ok: true, job: job.id, engine });
}));

app.get('/api/build', wrap(async (req, res) => {
  const dir = projectDir(req);
  res.json(builds.status(dir));
}));

app.get('/api/meta', wrap(async (req, res) => {
  const dir = projectDir(req);
  const { relative: file } = projectFile(dir, req.query.file || 'main.tex');
  const meta = await buildMeta(dir, { file });
  const pdf = await findPdf(dir);
  res.json({ ...meta, pdf });
}));

app.get('/api/log', wrap(async (req, res) => {
  const dir = projectDir(req);
  const { abs: main } = projectFile(dir, req.query.file || 'main');
  const abs = projectFile(dir, path.relative(dir, main).replace(/\.tex$/i, '') + '.log').abs;
  if (!fs.existsSync(abs)) return res.json({ log: '' });
  res.json({ log: await fsp.readFile(abs, 'utf8') });
}));

app.get('/api/pdf', wrap(async (req, res) => {
  const dir = projectDir(req);
  const { abs } = projectFile(dir, req.query.file || 'main.pdf');
  if (!fs.existsSync(abs)) { const e = new Error('PDF not found'); e.status = 404; throw e; }
  const st = await fsp.stat(abs);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', st.size);
  fs.createReadStream(abs).pipe(res);
}));

/* ------------------------------------------------------------ SyncTeX */

app.get('/api/synctex', wrap(async (req, res) => {
  const dir = projectDir(req);
  const op = req.query.op || 'view';
  const { relative: file } = projectFile(dir, req.query.file || 'main.tex');
  if (op === 'view') {
    const line = Number(req.query.line || 1);
    const column = Number(req.query.column || 1);
    const out = await synctexView(dir, file, line, column);
    res.json({ ok: !!out, result: out });
  } else {
    const page = Number(req.query.page || 1);
    const x = Number(req.query.x || 0);
    const y = Number(req.query.y || 0);
    const out = await synctexEdit(dir, page, x, y, file);
    res.json({ ok: !!out, result: out });
  }
}));

/* ------------------------------------------------------- Projektdaten */

app.get('/api/projects/files', wrap(async (req, res) => {
  const dir = projectDir(req);
  res.json({ files: collectProjectFiles(dir, req.query.all === '1') });
}));

/* --------------------------------------------------------- Projektsuche */

app.post('/api/search', wrap(async (req, res) => {
  const dir = projectDir(req);
  const { query = '', regex = false, caseSensitive = false, wholeWord = false, include = '' } = req.body || {};
  if (!query) return res.json({ results: [] });
  let re;
  try {
    let src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord && !regex) src = `\\b${src}\\b`;
    re = new RegExp(src, caseSensitive ? 'g' : 'gi');
  } catch (e) {
    throw Object.assign(new Error('Invalid regular expression'), { status: 400 });
  }
  const files = collectProjectFiles(dir, false).filter((f) => /\.(tex|bib|sty|cls|txt|md|csv)$/i.test(f));
  const results = [];
  const maxHits = 500;
  for (const f of files) {
    if (include && !f.toLowerCase().includes(include.toLowerCase())) continue;
    let text = '';
    try { text = await fsp.readFile(path.join(dir, f), 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      const matches = [...lines[i].matchAll(re)];
      if (matches.length) {
        results.push({ file: f, line: i + 1, text: lines[i].trim().slice(0, 300), col: matches[0].index, count: matches.length });
        if (results.length >= maxHits) return res.json({ results, truncated: true });
      }
    }
  }
  res.json({ results });
}));

/* ------------------------------------------------------------- Static */

app.use('/vendor/pdfjs', express.static(path.join(APP_ROOT, 'node_modules', 'pdfjs-dist'), { fallthrough: true, maxAge: '1d' }));
// Client assets are rebuilt in place; revalidate immediately so the browser
// cannot keep an old editor bundle after an app update.
app.use('/client', express.static(CLIENT, { etag: true, maxAge: 0 }));
app.use('/docs', express.static(path.join(APP_ROOT, 'docs'), { etag: true, maxAge: 0 }));
app.get('/favicon.svg', (req, res) => res.sendFile(path.join(CLIENT, 'favicon.svg')));
app.get('/studio', (req, res) => res.sendFile(path.join(CLIENT, 'studio.html')));
app.get('/studio/', (req, res) => res.redirect(302, '/studio'));
app.get('/', (req, res) => res.sendFile(path.join(CLIENT, 'index.html')));

// SPA-Fallback ist nicht nötig – reine Single-Page-App.

/* --------------------------------------------------------------- WS */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'hello', tools: TOOLS }));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

/* -------------------------------------------------------------- Start */

server.listen(PORT, HOST, async () => {
  await refreshTools();
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────┐');
  console.log('  │  LaTeX Studio  –  local editor                │');
  console.log('  │  http://localhost:' + PORT + '                          │');
  console.log('  └─────────────────────────────────────────────────┘');
  console.log('  Workspace      : ' + WORKSPACE);
  console.log('  Listening on   : ' + HOST + ':' + PORT);
  console.log('  latexmk        : ' + (TOOLS.latexmk || 'NOT FOUND'));
  console.log('  pdflatex       : ' + (TOOLS.pdflatex || 'NOT FOUND'));
  console.log('  synctex        : ' + (TOOLS.synctex || 'NOT FOUND'));
  console.log('');
});

process.on('SIGINT', () => { process.exit(0); });
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
