import JSZip from 'jszip';
import { SiglumCompiler } from '@siglum/engine';

const DB_NAME = 'latex-studio-workspace-v1';
const STORE = 'entries';
let dbPromise;
let templatesPromise;
let compilerPromise;
let compilerLogs = [];

// Siglum's browser worker runs LaTeX passes but does not launch BibTeX. Supply
// the resulting classic .bbl as an extra input so citekeys resolve offline.
function parseBibFile(input) {
  const text = String(input || '');
  const entries = new Map();
  let at = 0;
  while ((at = text.indexOf('@', at)) >= 0) {
    const start = at;
    const head = text.slice(at).match(/^@([\w-]+)\s*([({])/);
    if (!head) { at++; continue; }
    at += head[0].length;
    const opener = head[2], closer = opener === '{' ? '}' : ')';
    const payloadStart = at;
    let depth = 1, quoted = false, escaped = false;
    for (; at < text.length && depth; at++) {
      const ch = text[at];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') quoted = !quoted;
      if (!quoted && ch === opener) depth++;
      else if (!quoted && ch === closer) depth--;
    }
    const type = head[1].toLowerCase();
    if (depth || ['comment', 'preamble', 'string'].includes(type)) continue;
    const payload = text.slice(payloadStart, at - 1);
    const comma = payload.indexOf(',');
    if (comma < 1) continue;
    const key = payload.slice(0, comma).trim();
    const fields = {};
    const tail = payload.slice(comma + 1);
    const fieldHead = /(?:^|,)\s*([\w-]+)\s*=\s*/g;
    let m;
    while ((m = fieldHead.exec(tail))) {
      let i = fieldHead.lastIndex;
      while (/\s/.test(tail[i] || '')) i++;
      const ch = tail[i];
      if (ch === '{' || ch === '"') {
        const begin = ++i;
        let level = ch === '{' ? 1 : 0, q = ch === '"', esc = false;
        for (; i < tail.length; i++) {
          const c = tail[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (ch === '{' && c === '{') level++;
          else if (c === '}' && ch === '{' && --level === 0) break;
          else if (q && c === '"') break;
        }
        fields[m[1].toLowerCase()] = tail.slice(begin, i).trim();
        fieldHead.lastIndex = i + 1;
      } else {
        const end = tail.indexOf(',', i);
        fields[m[1].toLowerCase()] = tail.slice(i, end < 0 ? tail.length : end).trim();
      }
    }
    if (key) entries.set(key, { type, key, fields });
    if (at <= start) at = start + 1;
  }
  return entries;
}

function makeBibItem(entry) {
  const f = entry.fields;
  const get = (...keys) => keys.map((key) => f[key]).find(Boolean) || '';
  const parts = [];
  const author = get('author', 'editor');
  if (author) parts.push(author.replace(/\s+and\s+/gi, ', '));
  if (get('title')) parts.push(`\\emph{${get('title')}}`);
  if (get('journal', 'booktitle', 'publisher', 'school', 'institution')) parts.push(`\\emph{${get('journal', 'booktitle', 'publisher', 'school', 'institution')}}`);
  const details = [get('volume') && `vol. ${get('volume')}`, get('number') && `no. ${get('number')}`, get('pages') && `pp. ${get('pages')}`].filter(Boolean).join(', ');
  if (details) parts.push(details);
  if (get('year', 'date')) parts.push(get('year', 'date'));
  if (get('doi')) parts.push(`doi: ${get('doi')}`);
  return `\\bibitem{${entry.key}} ${parts.join('. ')}.`;
}

function browserBbl(files, source) {
  if (!/\\(?:bibliography\s*\{|cite\w*\s*\{|nocite\s*\{)/i.test(source)) return null;
  const names = [...source.matchAll(/\\bibliography\s*\{([^}]+)\}/gi)].flatMap((m) => m[1].split(',').map((name) => name.trim()).filter(Boolean));
  if (!names.length) return null;
  const entries = new Map();
  for (const name of names) {
    const file = /\.bib$/i.test(name) ? name : `${name}.bib`;
    for (const [key, entry] of parseBibFile(files[file] ?? files[file.replace(/^\.\//, '')] ?? '')) entries.set(key, entry);
  }
  const citeKeys = new Set([...source.matchAll(/\\(?:cite\w*|nocite)\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]+)\}/gi)].flatMap((m) => m[1].split(',').map((key) => key.trim())));
  if (citeKeys.has('*')) for (const key of entries.keys()) citeKeys.add(key);
  const selected = [...citeKeys].map((key) => entries.get(key)).filter(Boolean);
  if (!selected.length) return null;
  return { file: `\\begin{thebibliography}{${selected.length}}\n${selected.map(makeBibItem).join('\n')}\n\\end{thebibliography}\n`, count: selected.length, missing: [...citeKeys].filter((key) => key !== '*' && !entries.has(key)) };
}

function normalizeBibliographySource(source) {
  if (!/\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b/i.test(source)) {
    const needsNatbib = /\\(?:citep|citet)\s*(?:\[[^\]]*\]\s*)?\{/i.test(source) && !/\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bnatbib\b/i.test(source);
    return { source: needsNatbib ? source.replace(/\\begin\s*\{document\}/, '\\usepackage{natbib}\n\\begin{document}') : source, biblatex: false, resources: [] };
  }
  const resources = [...source.matchAll(/\\addbibresource(?:\[[^\]]*\])?\s*\{([^}]+)\}/gi)].map((match) => match[1].trim());
  const resourceNames = resources.map((name) => name.replace(/\.bib$/i, '')).join(',');
  let normalized = source
    .replace(/\\usepackage(\[[^\]]*\])?\s*\{([^}]+)\}/gi, (command, options, packages) => {
      const remaining = packages.split(',').map((name) => name.trim()).filter((name) => name.toLowerCase() !== 'biblatex');
      return remaining.length ? `\\usepackage${options || ''}{${remaining.join(',')}}` : '';
    })
    .replace(/\\addbibresource(?:\[[^\]]*\])?\s*\{[^}]+\}/gi, '')
    .replace(/\\parencite(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\citep')
    .replace(/\\parencites(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\citep')
    .replace(/\\textcite(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\citet')
    .replace(/\\textcites(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\citet')
    .replace(/\\autocite(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\cite')
    .replace(/\\autocites(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\cite')
    .replace(/\\footcite(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\cite')
    .replace(/\\smartcite(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\cite')
    .replace(/\\supercite(?=\s*(?:\[[^\]]*\]\s*)*\{)/g, '\\cite')
    .replace(/\\(?:ExecuteBibliographyOptions|DeclareLanguageMapping|DefineBibliographyStrings)\s*(?:\[[^\]]*\]\s*)?\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '')
    .replace(/\\printbibliography(?:\[[^\]]*\])?/g, `\\bibliographystyle{plain}\\bibliography{${resourceNames}}`);
  if (/\\(?:citep|citet)\s*\{/.test(normalized) && !/\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bnatbib\b/i.test(normalized)) {
    normalized = normalized.replace(/\\begin\s*\{document\}/, '\\usepackage{natbib}\n\\begin{document}');
  }
  return { source: normalized, biblatex: true, resources };
}

function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error || new Error('Browser storage could not be opened'));
  });
  return dbPromise;
}
async function all() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function byId(entryId) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction(STORE).objectStore(STORE).get(entryId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function put(entry) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...entry, mtime: Date.now() });
    tx.oncomplete = () => resolve({ ok: true });
    tx.onerror = () => reject(tx.error || new Error('Could not save to browser storage'));
  });
}
async function remove(id) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function cleanPath(value) {
  const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('Invalid file path');
  return parts.join('/');
}
function projectOf(path) { return cleanPath(path).split('/')[0] || ''; }
function relOf(path) { return cleanPath(path).split('/').slice(1).join('/'); }
function id(project, path) { return `${project}/${path}`; }
function bytesFromBase64(text) { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer; }
function decode(value) { return typeof value === 'string' ? value : new TextDecoder().decode(value || new ArrayBuffer(0)); }
function fileEntry(project, rel, content) { return { id: id(project, rel), project, path: rel, type: 'file', content, mtime: Date.now() }; }
function dirname(path) { const at = path.lastIndexOf('/'); return at < 0 ? '' : path.slice(0, at); }
async function ensureDir(project, rel) {
  if (!rel) return;
  let cursor = '';
  for (const part of rel.split('/')) { cursor = cursor ? `${cursor}/${part}` : part; await put({ id: id(project, cursor), project, path: cursor, type: 'dir' }); }
}
async function list(project) { return (await all()).filter((x) => x.project === project); }
function makeTree(entries, base = '') {
  const dirs = new Map();
  const roots = [];
  const ensure = (p) => {
    if (dirs.has(p)) return dirs.get(p);
    const node = { name: p.split('/').pop(), path: p, type: 'dir', children: [] };
    dirs.set(p, node);
    const parent = dirname(p);
    if (parent) ensure(parent).children.push(node); else roots.push(node);
    return node;
  };
  for (const entry of entries) {
    if (entry.type === 'dir') ensure(entry.path);
    else {
      const parent = dirname(entry.path);
      const node = { name: entry.path.split('/').pop(), path: entry.path, type: 'file' };
      if (parent) ensure(parent).children.push(node); else roots.push(node);
    }
  }
  const sort = (nodes) => nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)).forEach((n) => sort(n.children || []));
  sort(roots);
  if (!base) return roots;
  let current = roots;
  for (const part of base.split('/').filter(Boolean)) {
    const match = current.find((n) => n.name === part && n.type === 'dir');
    if (!match) return [];
    current = match.children;
  }
  return current;
}
async function templates() {
  if (!templatesPromise) templatesPromise = fetch('/templates.json').then((r) => r.ok ? r.json() : []).catch(() => []);
  return templatesPromise;
}
async function projectFiles(project) {
  return (await list(project)).filter((x) => x.type === 'file').map((x) => x.path);
}
async function entriesUnder(project, path) {
  const prefix = path ? `${path}/` : '';
  return (await list(project)).filter((x) => x.path === path || x.path.startsWith(prefix));
}
async function fetchCompilerAsset(originalFetch, args) {
  const input = args[0];
  const requestUrl = String(input?.url || input);
  let response = await originalFetch(...args);
  // Workers static assets do not preserve a manually assigned
  // Content-Encoding header. Fetch the explicitly named gzip asset and
  // decode it here before Siglum passes the bytes to WebAssembly.compile().
  if (requestUrl.includes('/engine-static/') && requestUrl.includes('/busytex.wasm.gz') && response.ok) {
    if (typeof DecompressionStream === 'function') {
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      headers.set('content-type', 'application/wasm');
      response = new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } else {
      const fallbackUrl = requestUrl.replace('/engine-static/tl2025/busytex.wasm.gz', '/engine/tl2025/busytex.wasm');
      response = await originalFetch(input instanceof Request ? new Request(fallbackUrl, input) : fallbackUrl, input instanceof Request ? undefined : args[1]);
    }
  }
  if (requestUrl.includes('/engine-static/') && response.status === 404) {
    const fallbackUrl = requestUrl.replace('/engine-static/', '/engine/');
    const fallback = input instanceof Request ? new Request(fallbackUrl, input) : fallbackUrl;
    response = await originalFetch(fallback, input instanceof Request ? undefined : args[1]);
  }
  if (requestUrl.includes('/engine') || requestUrl.includes('/api/texlive/')) {
    compilerLogs.push(`[HTTP ${response.status}] ${requestUrl} · ${response.headers.get('content-type') || 'unknown type'}`);
    if (response.status === 429) {
      const body = await response.clone().text().catch(() => '');
      if (/error\s*1027|workers? free plan/i.test(body)) compilerLogs.push('[Cloudflare Error 1027] A Worker request was rate limited; static compiler assets remain available.');
    }
  }
  return response;
}
async function compiler() {
  if (!compilerPromise) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => fetchCompilerAsset(originalFetch, args);
    const instance = new SiglumCompiler({
      bundlesUrl: '/engine-static/tl2025/bundles',
      wasmUrl: '/engine-static/tl2025/busytex.wasm.gz',
      jsUrl: '/engine-static/tl2025/busytex.js',
      workerUrl: '/dist/siglum-worker.js',
      // Siglum appends /api/texlive/<package> to this origin itself.
      ctanProxyUrl: location.origin,
      xzwasmUrl: '/dist/xzwasm.js',
      enableCtan: true,
      enableLazyFS: true,
      enableDocCache: true,
      verbose: false,
      onLog: (message) => { compilerLogs.push(String(message)); if (compilerLogs.length > 400) compilerLogs.shift(); },
      onProgress: (stage, detail) => { if (compilerLogs.length < 400) compilerLogs.push(`[${stage}] ${detail}`); },
    });
    compilerPromise = instance.init().then(() => instance).catch((error) => { compilerPromise = null; throw error; }).finally(() => { globalThis.fetch = originalFetch; });
  }
  return compilerPromise;
}

export const browserWorkspace = {
  async integrationGet(key) { return (await byId(`@integration/${key}`))?.value ?? null; },
  async integrationSet(key, value) { return put({ id: `@integration/${key}`, type: 'integration', value }); },
  async integrationDelete(key) { return remove(`@integration/${key}`); },
  async integrationList(prefix) { return (await all()).filter((entry) => entry.id.startsWith(`@integration/${prefix}`)); },
  async state() {
    const entries = await all();
    const projects = [...new Set(entries.map((x) => x.project))].filter(Boolean).sort();
    return { root: 'This browser', projects, engines: [{ id: 'pdflatex', label: 'pdfLaTeX' }, { id: 'xelatex', label: 'XeLaTeX' }], tools: {}, browserWorkspace: true, app: 'LaTeX Studio', version: '0.1.1' };
  },
  async tree(path = '') {
    const project = projectOf(path);
    return { tree: makeTree(await list(project), relOf(path)) };
  },
  async file(path) {
    const project = projectOf(path); const rel = relOf(path);
    const entry = (await list(project)).find((x) => x.path === rel && x.type === 'file');
    if (!entry) throw new Error(`File not found: ${rel}`);
    return { path: rel, content: decode(entry.content), size: typeof entry.content === 'string' ? new Blob([entry.content]).size : entry.content?.byteLength || 0, mtime: entry.mtime };
  },
  async saveFile(path, content) {
    const project = projectOf(path); const rel = relOf(path);
    if (!project || !rel) throw new Error('Choose a project and file name first');
    await ensureDir(project, dirname(rel)); return put(fileEntry(project, rel, String(content)));
  },
  async saveBinary(path, buffer) {
    const project = projectOf(path); const rel = relOf(path);
    if (!project || !rel) throw new Error('Choose a project and file name first');
    await ensureDir(project, dirname(rel)); return put(fileEntry(project, rel, buffer));
  },
  async fs(body) {
    const { op } = body || {};
    if (op === 'mkdir') {
      const project = projectOf(body.path); const rel = relOf(body.path);
      if (!project || !rel) throw new Error('Folder name is required');
      await ensureDir(project, rel); return { ok: true };
    }
    if (op === 'delete') {
      const project = projectOf(body.path); const rel = relOf(body.path);
      if (!project || !rel) throw new Error('A project root cannot be deleted here');
      for (const entry of await entriesUnder(project, rel)) await remove(entry.id);
      return { ok: true };
    }
    if (op === 'rename' || op === 'copy') {
      const sourceProject = projectOf(body.from); const source = relOf(body.from);
      const targetProject = projectOf(body.to); const target = relOf(body.to);
      if (!source || !target || sourceProject !== targetProject) throw new Error('Move or copy must stay within one project');
      const items = await entriesUnder(sourceProject, source);
      if (!items.length) throw new Error(`Path not found: ${source}`);
      await ensureDir(targetProject, dirname(target));
      for (const entry of items) {
        const nextPath = target + entry.path.slice(source.length);
        await put({ ...entry, id: id(targetProject, nextPath), project: targetProject, path: nextPath });
      }
      if (op === 'rename') for (const entry of items) await remove(entry.id);
      return { ok: true };
    }
    throw new Error(`Unsupported file operation: ${op}`);
  },
  async templates() { return { templates: (await templates()).map(({ files, ...meta }) => meta) }; },
  async createProject(name, template) {
    name = String(name || '').trim();
    if (!/^[\w\-. ÄÖÜäöü()+ ]{1,80}$/.test(name)) throw new Error('Invalid project name');
    const existing = (await this.state()).projects;
    if (existing.includes(name)) throw new Error(`Project already exists: ${name}`);
    const tpl = (await templates()).find((x) => x.name === template) || (await templates()).find((x) => x.name === 'article');
    if (!tpl) throw new Error('Templates are not available in this deployment. Reload after rebuilding the app.');
    for (const [path, base64] of Object.entries(tpl.files || {})) await put(fileEntry(name, path, bytesFromBase64(base64)));
    await ensureDir(name, '');
    return { ok: true, project: name };
  },
  async projectFiles(project) { return { files: await projectFiles(project) }; },
  async projectConfig(project) {
    const entry = (await list(project)).find((x) => x.path === '.latexstudio.json');
    try { return { config: entry ? JSON.parse(decode(entry.content)) : {} }; } catch { return { config: {} }; }
  },
  async saveProjectConfig(project, config) {
    const allowed = Object.fromEntries(['mainFile', 'engine', 'shellEscape', 'autoBuild', 'autoBuildDelay'].filter((k) => config?.[k] !== undefined).map((k) => [k, config[k]]));
    if (Object.keys(allowed).length) await put(fileEntry(project, '.latexstudio.json', JSON.stringify(allowed, null, 2) + '\n'));
    else await remove(id(project, '.latexstudio.json'));
    return { ok: true, config: allowed };
  },
  async renameProject(name, to) {
    if ((await this.state()).projects.includes(to)) throw new Error(`Project already exists: ${to}`);
    for (const e of await list(name)) await put({ ...e, id: id(to, e.path), project: to });
    for (const e of await list(name)) await remove(e.id);
    return { ok: true, project: to };
  },
  async duplicateProject(name, to) {
    if ((await this.state()).projects.includes(to)) throw new Error(`Project already exists: ${to}`);
    for (const e of await list(name)) await put({ ...e, id: id(to, e.path), project: to });
    return { ok: true, project: to };
  },
  async deleteProject(name) { for (const e of await list(name)) await remove(e.id); return { ok: true, project: name }; },
  async importProject(name, buffer) {
    if ((await this.state()).projects.includes(name)) throw new Error(`Project already exists: ${name}`);
    const zip = await JSZip.loadAsync(buffer); let count = 0;
    const files = Object.values(zip.files).filter((f) => !f.dir);
    const top = new Set(files.map((f) => f.name.split('/')[0]));
    const strip = top.size === 1 && files.some((f) => f.name.includes('/')) ? `${[...top][0]}/` : '';
    for (const entry of files) {
      let path = entry.name.startsWith(strip) ? entry.name.slice(strip.length) : entry.name;
      path = cleanPath(path);
      if (!path) continue;
      await ensureDir(name, dirname(path));
      const data = await entry.async('uint8array');
      const text = /\.(tex|bib|sty|cls|txt|md|csv|json|ya?ml|xml)$/i.test(path) ? new TextDecoder().decode(data) : data.buffer;
      await put(fileEntry(name, path, text)); count++;
    }
    if (!count) throw new Error('ZIP archive contains no usable files');
    return { ok: true, project: name, files: count };
  },
  async importZip(project, buffer) {
    const zip = await JSZip.loadAsync(buffer); let count = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const path = cleanPath(entry.name);
      if (!path || path.split('/').includes('..')) continue;
      await ensureDir(project, dirname(path));
      const data = await entry.async('uint8array');
      const text = /\.(tex|bib|sty|cls|txt|md|csv|json|ya?ml|xml)$/i.test(path) ? new TextDecoder().decode(data) : data.buffer;
      await put(fileEntry(project, path, text)); count++;
    }
    return { ok: true, files: count };
  },
  async search(project, opts) {
    if (!opts.query) return { results: [] };
    const source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let regex;
    try { regex = new RegExp(opts.wholeWord && !opts.regex ? `\\b${source}\\b` : source, opts.caseSensitive ? 'g' : 'gi'); } catch { throw new Error('Invalid regular expression'); }
    const results = [];
    for (const e of await list(project)) {
      if (e.type !== 'file' || !/\.(tex|bib|sty|cls|txt|md|csv)$/i.test(e.path) || (opts.include && !e.path.toLowerCase().includes(opts.include.toLowerCase()))) continue;
      decode(e.content).split('\n').forEach((line, i) => { regex.lastIndex = 0; const m = [...line.matchAll(regex)]; if (m.length) results.push({ file: e.path, line: i + 1, text: line.trim().slice(0, 300), col: m[0].index, count: m.length }); });
      if (results.length >= 500) return { results: results.slice(0, 500), truncated: true };
    }
    return { results };
  },
  async build(project, { file = 'main.tex', engine = 'pdflatex' } = {}) {
    if (!['pdflatex', 'xelatex'].includes(engine)) throw new Error(`The browser compiler currently supports pdfLaTeX and XeLaTeX. Select one of those engines to build this project.`);
    const main = cleanPath(file);
    const projectFiles = await list(project);
    const mainEntry = projectFiles.find((x) => x.path === main && x.type === 'file');
    if (!mainEntry) throw new Error(`Main TeX file not found: ${main}`);
    const additionalFiles = {};
    for (const entry of projectFiles) {
      if (entry.type !== 'file' || entry.path === main || entry.path.startsWith('.latexstudio-')) continue;
      additionalFiles[entry.path] = typeof entry.content === 'string' ? entry.content : new Uint8Array(entry.content || new ArrayBuffer(0));
    }
    compilerLogs = [];
    try {
      const instance = await compiler();
      const rawSource = decode(mainEntry.content);
      const normalized = normalizeBibliographySource(rawSource);
      const source = normalized.source;
      if (normalized.biblatex) compilerLogs.push('[BIB] biblatex source adapted to the browser BibTeX path (numeric/plain style; common cite commands supported).');
      const bibliography = browserBbl(Object.fromEntries(Object.entries(additionalFiles).map(([path, content]) => [path, typeof content === 'string' ? content : new TextDecoder().decode(content)])), source);
      const hasBibliographyCommands = /\\(?:bibliography\s*\{|cite\w*\s*\{)/i.test(source);
      if (bibliography) {
        additionalFiles['document.bbl'] = bibliography.file;
        compilerLogs.push(`[BIB] Browser bibliography pass: ${bibliography.count} cited entr${bibliography.count === 1 ? 'y' : 'ies'} resolved.`);
        if (bibliography.missing.length) compilerLogs.push(`[BIB] Missing citation key${bibliography.missing.length === 1 ? '' : 's'} in the project's .bib files: ${bibliography.missing.join(', ')}`);
      } else if (/\\(?:bibliography\s*\{|cite\w*\s*\{)/i.test(source)) {
        compilerLogs.push('[BIB] No matching .bib database or citation entries were found. Check that the bibliography file is saved in the project and named in \\bibliography{...}.');
      }
      const started = performance.now();
      // TeX Live's compact base bundle contains babel.sty but omits regional
      // language definition files. Babel fails before Siglum's normal missing-
      // file retry can request them, so preload the German collection explicitly.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (...args) => fetchCompilerAsset(originalFetch, args);
      let result;
      try {
        if (/\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bbabel\b[^}]*\}/i.test(source) && /\b(?:ngerman|german|naustrian|austrian|swissgerman)\b/i.test(source)) {
          compilerLogs.push('[PACKAGE] Loading Babel language support: babel-german');
          const german = await instance.ctanFetcher.fetchPackage('babel-german');
          if (!german) compilerLogs.push('[PACKAGE] Could not load babel-german from the static package cache or TeX Live service.');
        }
        // The worker's PDF cache is keyed only by the TeX source, so bypass it
        // when a .bib file participates to avoid stale citations after edits.
        result = await instance.compile(source, { engine, additionalFiles, useCache: !hasBibliographyCommands });
      } finally { globalThis.fetch = originalFetch; }
      const duration = Math.round(performance.now() - started);
      if (!result.success || !result.pdf?.length) {
        return { status: 'failed', engine, duration, code: result.exitCode || 1, issues: [], log: [result.log || result.error || 'The TeX compiler did not produce a PDF.', ...compilerLogs].filter(Boolean).join('\n') };
      }
      // Siglum can return PDF bytes backed by SharedArrayBuffer. Blob rejects
      // shared views, so make an ordinary ArrayBuffer before creating the URL.
      const pdfBytes = new Uint8Array(result.pdf.byteLength);
      pdfBytes.set(result.pdf);
      const url = URL.createObjectURL(new Blob([pdfBytes.buffer], { type: 'application/pdf' }));
      return { status: 'ok', engine, duration, issues: [], log: [result.log, ...compilerLogs].filter(Boolean).join('\n'), cached: !!result.cached, pdf: { file: `${main.replace(/\.tex$/i, '')}.pdf`, url } };
    } catch (error) {
      if (compilerLogs.some((line) => line.includes('Cloudflare Error 1027'))) {
        throw new Error('Cloudflare’s daily Worker request limit blocked an uncached large compiler asset or package. The compiler base and common packages are served as static files; retry this document after the limit resets. Your browser-local project and files remain available.');
      }
      throw new Error(`${error.message}${compilerLogs.length ? `\n${compilerLogs.join('\n')}` : ''}`);
    }
  },
  async replace(project, opts) {
    const found = await this.search(project, opts);
    const source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(opts.wholeWord && !opts.regex ? `\\b${source}\\b` : source, (opts.caseSensitive ? 'g' : 'gi'));
    let changed = 0;
    for (const path of new Set(found.results.map((x) => x.file))) {
      const entry = (await list(project)).find((x) => x.path === path);
      if (!entry) continue;
      let content = decode(entry.content);
      content = content.replace(regex, (...args) => { changed++; return opts.replacement; });
      await put({ ...entry, content });
    }
    return { ok: true, changed, results: found.results };
  },
  async exportProject(project) {
    const zip = new JSZip();
    for (const e of await list(project)) if (e.type === 'file' && e.path !== '.latexstudio.json') zip.file(e.path, e.content);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${project}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
