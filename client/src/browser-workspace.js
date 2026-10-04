import JSZip from 'jszip';
import { SiglumCompiler } from '@siglum/engine';

const DB_NAME = 'latex-studio-workspace-v1';
const STORE = 'entries';
let dbPromise;
let templatesPromise;
let compilerPromise;
let compilerLogs = [];

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
async function compiler() {
  if (!compilerPromise) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const input = args[0];
      const requestUrl = String(input?.url || input);
      let response = await originalFetch(...args);
      // Large optional bundles stay behind the Worker proxy. The normal
      // compiler runtime and manifests are served directly as static assets.
      if (requestUrl.includes('/engine-static/') && response.status === 404) {
        const fallbackUrl = requestUrl.replace('/engine-static/', '/engine/');
        const fallback = input instanceof Request
          ? new Request(fallbackUrl, input)
          : fallbackUrl;
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
    };
    const instance = new SiglumCompiler({
      bundlesUrl: '/engine-static/tl2025/bundles',
      wasmUrl: '/engine-static/tl2025/busytex.wasm',
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
      const source = decode(mainEntry.content);
      const started = performance.now();
      // TeX Live's compact base bundle contains babel.sty but omits regional
      // language definition files. Babel fails before Siglum's normal missing-
      // file retry can request them, so preload the German collection explicitly.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (...args) => {
        const input = args[0];
        const requestUrl = String(input?.url || input);
        let response = await originalFetch(...args);
        if (requestUrl.includes('/engine-static/') && response.status === 404) {
          const fallbackUrl = requestUrl.replace('/engine-static/', '/engine/');
          response = await originalFetch(input instanceof Request ? new Request(fallbackUrl, input) : fallbackUrl, input instanceof Request ? undefined : args[1]);
        }
        if ((requestUrl.includes('/engine') || requestUrl.includes('/api/texlive/')) && response.status === 429) {
          const body = await response.clone().text().catch(() => '');
          if (/error\s*1027|workers? free plan/i.test(body)) compilerLogs.push('[Cloudflare Error 1027] A Worker request was rate limited; static compiler assets remain available.');
        }
        return response;
      };
      let result;
      try {
        if (/\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bbabel\b[^}]*\}/i.test(source) && /\b(?:ngerman|german|naustrian|austrian|swissgerman)\b/i.test(source)) {
          compilerLogs.push('[PACKAGE] Loading Babel language support: babel-german');
          const german = await instance.ctanFetcher.fetchPackage('babel-german');
          if (!german) compilerLogs.push('[PACKAGE] Could not load babel-german from the static package cache or TeX Live service.');
        }
        result = await instance.compile(source, { engine, additionalFiles, useCache: true });
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
