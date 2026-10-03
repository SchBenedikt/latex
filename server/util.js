import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Extensions/Names, die als Build-Artefakte gelten und standardmäßig ausgeblendet werden */
export const ARTIFACT_PATTERNS = [
  /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|blg|bbl|bcf|run\.xml|nav|snm|vrb|idx|ilg|ind|brf|bbl|dvi|fdb|tdo|synctex\.gz|synctex|xdv|mw|glg|glo|gls|glstex|ist|acn|acr|alg|nlo|nls|lol|abx|abd|tlg)$/,
  /^\.DS_Store$/, /^Thumbs\.db$/, /^\.git$/, /^\.latexstudio\.tmp$/,
];

export function isArtifact(name) {
  return ARTIFACT_PATTERNS.some((re) => re.test(name));
}

/* ------------------------------------------------------------------ Pfade */

export function makeResolver(root) {
  const ROOT = path.resolve(root);
  const ROOT_REAL = fs.realpathSync(ROOT);
  const resolve = (p = '') => {
    const abs = path.resolve(ROOT, '.' + path.sep + String(p || ''));
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
      const err = new Error('Path is outside the workspace: ' + p);
      err.status = 403;
      throw err;
    }
    // Lexical path checks alone allow a project symlink to expose files outside
    // the workspace. Resolve the nearest existing ancestor before any IO.
    let existing = abs;
    while (true) {
      try { fs.lstatSync(existing); break; } catch { /* Find the nearest existing parent. */ }
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    let real;
    try { real = fs.realpathSync(existing); } catch {
      const err = new Error('Invalid file path: ' + p);
      err.status = 403;
      throw err;
    }
    if (real !== ROOT_REAL && !real.startsWith(ROOT_REAL + path.sep)) {
      const err = new Error('Path points outside the workspace: ' + p);
      err.status = 403;
      throw err;
    }
    return abs;
  };
  const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
  return { ROOT, resolve, rel };
}

/* ------------------------------------------------------------- Dateibaum */

export async function readTree(absDir, { showAll = false, depth = 0, maxDepth = 12, root = '' } = {}) {
  let entries;
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!showAll && isArtifact(e.name)) continue;
    const full = path.join(absDir, e.name);
    // Pfade sind relativ zum Arbeitsbereich (root), damit sie im Client
    // direkt mit den Tab-/Dokumentpfaden übereinstimmen.
    const nodePath = root
      ? path.relative(root, full).split(path.sep).join('/')
      : full;
    const node = { name: e.name, path: nodePath, type: e.isDirectory() ? 'dir' : 'file' };
    try {
      const st = await fsp.stat(full);
      node.size = st.size;
      node.mtime = st.mtimeMs;
    } catch { /* ignore */ }
    if (e.isDirectory()) {
      if (depth < maxDepth) node.children = await readTree(full, { showAll, depth: depth + 1, maxDepth, root });
      else node.children = [];
      node.children.sort(cmpNodes);
    }
    out.push(node);
  }
  out.sort(cmpNodes);
  return out;
}

function cmpNodes(a, b) {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
}

/* ------------------------------------------------------------- Datei-IO */

export async function readTextFile(abs) {
  const st = await fsp.stat(abs);
  if (st.size > 25 * 1024 * 1024) throw Object.assign(new Error('File is too large'), { status: 413 });
  const buf = await fsp.readFile(abs);
  return { content: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs };
}

export async function writeTextFile(abs, content) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = abs + '.latexstudio.tmp';
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, abs);
  const st = await fsp.stat(abs);
  return { size: st.size, mtime: st.mtimeMs };
}

/* ------------------------------------------------------------- latexmk */

const ENGINES = {
  pdflatex: { latexmk: ['-pdf'], label: 'pdfLaTeX' },
  xelatex: { latexmk: ['-pdfxe'], label: 'XeLaTeX' },
  lualatex: { latexmk: ['-pdflua'], label: 'LuaLaTeX' },
  platex: { latexmk: ['-pdvdvipdfmx'], label: 'pLaTeX' },
};

export function engineList() {
  return Object.entries(ENGINES).map(([id, e]) => ({ id, label: e.label }));
}

export function latexmkArgs(engine, { shellEscape = false, maxRuns = 5, extraArgs = [] } = {}) {
  const eng = ENGINES[engine] || ENGINES.pdflatex;
  const repeatLimit = Math.max(1, Math.min(20, Math.trunc(Number(maxRuns) || 5)));
  const args = [
    ...eng.latexmk,
    '-e', `$max_repeat=${repeatLimit}`,
    '-synctex=1',
    '-interaction=nonstopmode',
    '-file-line-error',
    '-halt-on-error',
  ];
  if (shellEscape) args.push('-shell-escape');
  for (const a of extraArgs) if (a && typeof a === 'string') args.push(a);
  return args;
}

export function which(bin) {
  try {
    const p = execFileSync('sh', ['-c', `command -v ${JSON.stringify(bin)} || true`], { encoding: 'utf8' }).trim();
    return p || null;
  } catch { return null; }
}

export async function toolchain() {
  const bins = ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'synctex', 'makeindex', 'kpsewhich', 'findtexmf', 'tlmgr', 'miktex'];
  const out = {};
  for (const b of bins) out[b] = which(b);
  return out;
}

export { execFileP };

/* ------------------------------------------------------- Log-Auswertung */

const FILE_LINE_RE = /^(\/?[^:\n]+?\.(?:tex|sty|cls|bib|clo|def)):(\d+):\s*(.*)$/;
const L_LINE_RE = /^l\.(\d+)\s*(.*)$/;
const ERR_RE = /^!\s*(.*)$/;
const WARN_RE = /^(?:LaTeX|Package\s+(\S+)|Class\s+(\S+))\s+Warning:\s*(.*)$/;

export function parseLog(raw, projectDir) {
  const issues = [];
  const text = String(raw || '').replace(/\r/g, '');
  const lines = text.split('\n');
  let i = 0;
  let currentErr = null;
  let multilineWarn = null;
  let overfullBox = null;
  const rel = (p) => {
    if (!p) return null;
    const abs = path.isAbsolute(p) ? p : path.join(projectDir, p);
    const r = path.relative(projectDir, abs);
    return r.startsWith('..') ? p : r.split(path.sep).join('/');
  };

  while (i < lines.length) {
    const line = lines[i];

    const fl = line.match(FILE_LINE_RE);
    if (fl) {
      const msg = fl[3].replace(/^\s*\.?\s*$/, '') || 'Fehler';
      issues.push({ severity: 'error', file: rel(fl[1]), line: +fl[2], message: clean(msg), raw: line });
      i++; continue;
    }

    const er = line.match(ERR_RE);
    if (er) {
      currentErr = { severity: 'error', file: null, line: null, message: clean(er[1]), raw: line };
      // Kontextzeilen bis l.NNN suchen
      let j = i + 1;
      let found = null;
      while (j < lines.length && j < i + 40) {
        const lm = lines[j].match(L_LINE_RE);
        if (lm) { found = lm; break; }
        if (lines[j].startsWith('!')) break;
        j++;
      }
      if (found) {
        currentErr.line = +found[1];
        currentErr.raw += '\n' + lines.slice(i + 1, j + 1).join('\n');
        if (found[2]) currentErr.context = found[2].trim();
      }
      const missing = currentErr.message.match(/File\s+['`\"]([^'`\"]+\.(?:sty|cls))['`\"]\s+not found/i);
      if (missing) {
        currentErr.package = path.basename(missing[1]).replace(/\.(?:sty|cls)$/i, '');
        currentErr.fix = `Installiere „${currentErr.package}“ oder prüfe den Dateinamen.`;
      } else if (/Undefined control sequence/i.test(currentErr.message)) {
        currentErr.fix = 'Prüfe die Schreibweise des Befehls und ob das dafür benötigte Paket eingebunden ist.';
      }
      issues.push(currentErr);
      i = found ? j + 1 : i + 1;
      currentErr = null;
      continue;
    }

    const wl = line.match(WARN_RE);
    if (wl) {
      let msg = wl[3];
      let j = i + 1;
      // "on input line N" am Ende?
      const onLine = msg.match(/^(.*?)\s+on input line (\d+)/);
      let ln = onLine ? +onLine[2] : null;
      if (onLine) msg = onLine[1];
      const cont = [];
      while (j < lines.length && j < i + 12 && lines[j].trim() && !/^\S+:/.test(lines[j]) && !lines[j].startsWith('!')) {
        if (/on input line (\d+)/.test(lines[j])) { ln = +(lines[j].match(/on input line (\d+)/) || [])[1]; break; }
        cont.push(lines[j].trim()); j++;
      }
      const pkg = wl[1] || wl[2] || null;
      issues.push({
        severity: 'warning', file: null, line: ln,
        message: clean((pkg ? `[${pkg}] ` : '') + msg + (cont.length ? ' ' + cont.join(' ') : '')),
        raw: line,
      });
      i = j; continue;
    }

    const ob = line.match(/^Overfull \\([hv])box \(([\d.]+)pt too wide\)/);
    if (ob) {
      let ln = null;
      let j = i + 1;
      while (j < lines.length && j < i + 6) { const m = lines[j].match(L_LINE_RE); if (m) { ln = +m[1]; break; } j++; }
      issues.push({ severity: 'info', file: null, line: ln, message: `Überbreites ${ob[1]}box (${ob[2]}pt zu breit)`, raw: line });
      i = j + 1; continue;
    }
    const ub = line.match(/^Underfull \\([hv])box/);
    if (ub) { i++; continue; }

    if (/^LaTeX Warning: File .* not found/.test(line)) {
      issues.push({ severity: 'error', file: null, line: null, message: clean(line), raw: line });
    }

    i++;
  }

  // Duplikate entfernen (gleiche Datei+Zeile+Msg)
  const seen = new Set();
  const uniq = [];
  for (const it of issues) {
    const k = `${it.severity}|${it.file}|${it.line}|${it.message}`;
    if (seen.has(k)) continue;
    seen.add(k); uniq.push(it);
  }

  const stats = {
    errors: uniq.filter((x) => x.severity === 'error').length,
    warnings: uniq.filter((x) => x.severity === 'warning').length,
    boxes: uniq.filter((x) => x.severity === 'info').length,
    pages: (text.match(/Output written on .*? \((\d+) pages?/i) || [])[1] || null,
    time: (text.match(/Latexmk: applying rule '.*'->.*?\n?/g) || []).length || null,
  };
  return { issues: uniq, stats };
}

function clean(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+\s*/, '')
    .trim();
}

/* ------------------------------------------------------------- .aux/.bib */

export function parseAux(absAux) {
  const labels = [];
  const refs = [];
  const cites = [];
  let content = '';
  try { content = fs.readFileSync(absAux, 'utf8'); } catch { return { labels, refs, cites }; }

  const labelRe = /\\newlabel\{([^{}]+)\}\{\{([^{}]*)\}\{(\d+)\}([^}]*)\}/g;
  let m;
  while ((m = labelRe.exec(content))) {
    labels.push({ name: m[1], number: m[2], page: m[3], file: (m[4].match(/\{([^{}]+)\}/) || [])[1] || null });
  }
  const refRe = /\\ref\{([^}]+)\}|\\eqref\{([^}]+)\}|\\pageref\{([^}]+)\}|\\autoref\{([^}]+)\}/g;
  while ((m = refRe.exec(content))) refs.push(m[1] || m[2] || m[3] || m[4]);
  const citeRe = /\\citation\{([^}]+)\}/g;
  while ((m = citeRe.exec(content))) m[1].split(',').forEach((c) => cites.push(c.trim()));
  return { labels, refs: [...new Set(refs)], cites: [...new Set(cites)] };
}

export function parseBibFiles(absDir, recurse = true) {
  const entries = [];
  const walk = (dir, depth = 0) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (e.name.startsWith('.') || isArtifact(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (recurse && depth < 4) walk(full, depth + 1); continue; }
      if (!e.name.toLowerCase().endsWith('.bib')) continue;
      entries.push(...parseBib(fs.readFileSync(full, 'utf8'), e.name));
    }
  };
  walk(absDir);
  return entries;
}

export function parseBib(text, source = '') {
  const out = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    // Felder bis schließende Klammer (Tiefe zählen)
    let depth = 0, i = start + m[0].length - 1, end = text.length;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = text.slice(m.index, end);
    const field = (name) => {
      const f = body.match(new RegExp(`(^|[^\\w])${name}\\s*=\\s*[{"']([^}]*)}`, 'i'));
      return f ? f[2].replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() : '';
    };
    out.push({
      key: m[2], type: m[1].toLowerCase(), source,
      title: field('title'), author: field('author'), year: field('year'),
      journal: field('journal') || field('booktitle') || field('publisher') || field('howpublished'),
    });
  }
  return out;
}

/* ------------------------------------------------------------- Statistik */

export function wordStats(text) {
  const noComments = text.replace(/(^|[^\\])%.*$/gm, '$1');
  const words = (noComments.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s+/g, '').length;
  const lines = text ? text.split('\n').length : 0;
  const paragraphs = noComments.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const sentences = (noComments.match(/[.!?…]+(\s|$)/g) || []).length;
  return { words, chars, charsNoSpaces, lines, paragraphs, sentences, minutes: Math.max(1, Math.round(words / 200)) };
}

/* ------------------------------------------------------- Projektstruktur */

export function collectProjectFiles(absDir, showAll = false) {
  const files = [];
  const walk = (dir, depth = 0) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (e.name.startsWith('.') && e.name !== '.latexstudio.json') continue;
      if (!showAll && isArtifact(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 6) walk(full, depth + 1); }
      else files.push(path.relative(absDir, full).split(path.sep).join('/'));
    }
  };
  walk(absDir);
  return files.sort();
}

/** \input/\include/graphics nachverfolgen */
export function resolveIncludes(mainAbs, projectDir, seen = new Set()) {
  const result = new Set();
  const stack = [mainAbs];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    result.add(path.relative(projectDir, file).split(path.sep).join('/'));
    const re = /\\(?:input|include|subfile)\s*(?:\{([^}]+)\}|(\S+))/g;
    let m;
    while ((m = re.exec(text))) {
      let inc = (m[1] || m[2] || '').trim();
      if (!inc) continue;
      if (!/\.(tex|sty|cls|ltx)$/i.test(inc)) inc += '.tex';
      const abs = path.resolve(path.dirname(file), inc);
      if (abs.startsWith(projectDir)) stack.push(abs);
    }
  }
  return [...result];
}

/* ------------------------------------------------------------- synctex */

export async function synctexView(projectDir, file, line, column = 1) {
  const pdf = findMainPdf(projectDir, file);
  if (!pdf) return null;
  const input = file.replace(/^\.\//, '');
  const { stdout } = await execFileP(
    'synctex', ['view', '-i', `${line}:${column}:${input}`, '-o', pdf],
    { cwd: projectDir, maxBuffer: 8 * 1024 * 1024 },
  );
  return parseSyncView(stdout, projectDir);
}

export async function synctexEdit(projectDir, page, x, y, file) {
  const pdf = findMainPdf(projectDir, file);
  if (!pdf) return null;
  // synctex erwartet Koordinaten mit Ursprung oben-links
  const { stdout } = await execFileP(
    'synctex', ['edit', '-o', `${page}:${x}:${y}:${pdf}`],
    { cwd: projectDir, maxBuffer: 8 * 1024 * 1024 },
  );
  return parseSyncEdit(stdout, projectDir);
}

function findMainPdf(projectDir, file) {
  if (file && file.endsWith('.pdf')) return path.resolve(projectDir, file);
  try {
    const names = fs.readdirSync(projectDir).filter((n) => n.endsWith('.pdf'));
    if (!names.length) return null;
    const st = names.map((n) => ({ n, m: fs.statSync(path.join(projectDir, n)).mtimeMs })).sort((a, b) => b.m - a.m);
    return path.join(projectDir, st[0].n);
  } catch { return null; }
}

/** synctex view – erster (genauester) Trefferblock */
function parseSyncView(out, projectDir) {
  const res = { page: null, x: null, y: null, h: null, v: null, width: null, height: null };
  let inFirst = false;
  let seen = false;
  for (const raw of String(out).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('Output:')) {
      if (seen) break;      // zweiter Block – abbrechen
      seen = true;
      inFirst = true;
      continue;
    }
    if (!inFirst) continue;
    let m;
    if ((m = line.match(/^Page:(\d+)/))) res.page = +m[1];
    else if ((m = line.match(/^x:([\d.\-]+)/))) res.x = parseFloat(m[1]);
    else if ((m = line.match(/^y:([\d.\-]+)/))) res.y = parseFloat(m[1]);
    else if ((m = line.match(/^h:([\d.\-]+)/))) res.h = parseFloat(m[1]);
    else if ((m = line.match(/^v:([\d.\-]+)/))) res.v = parseFloat(m[1]);
    else if ((m = line.match(/^W:([\d.\-]+)/))) res.width = parseFloat(m[1]);
    else if ((m = line.match(/^H:([\d.\-]+)/))) res.height = parseFloat(m[1]);
    else if (line.startsWith('SyncTeX result end')) break;
  }
  return res.page ? res : null;
}

/** synctex edit – Datei + Zeile ermitteln */
function parseSyncEdit(out, projectDir) {
  const res = { file: null, line: null, column: null, page: null };
  for (const raw of String(out).split('\n')) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^Input:(.+)$/))) {
      const p = m[1].trim();
      if (/^\d+$/.test(p)) continue;
      res.file = normalizeInput(p, projectDir);
    } else if ((m = line.match(/^Line:(\d+)/))) res.line = +m[1];
    else if ((m = line.match(/^Column:(-?\d+)/))) res.column = Math.max(1, +m[1]);
    else if ((m = line.match(/^Page:(\d+)/))) res.page = +m[1];
  }
  return res.line != null ? res : null;
}

function normalizeInput(p, projectDir) {
  let abs = p;
  if (!path.isAbsolute(abs)) abs = path.resolve(projectDir, abs);
  abs = path.normalize(abs);
  const rel = path.relative(projectDir, abs);
  if (!rel.startsWith('..')) return rel.split(path.sep).join('/');
  return abs;
}

export { zlib };
