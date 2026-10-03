import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { latexmkArgs, parseLog, parseAux, parseBibFiles, resolveIncludes, wordStats } from './util.js';

let jobCounter = 0;

export class BuildJob {
  constructor(projectDir, opts, emit) {
    this.id = 'job-' + Date.now().toString(36) + '-' + (++jobCounter);
    this.projectDir = projectDir;
    this.opts = opts;
    this.emit = emit;
    this.status = 'running';
    this.log = '';
    this.startedAt = Date.now();
    this.child = null;
    this.proc = null;
    this.cancelled = false;
    this.finished = false;
    this.issues = [];
    this.stats = {};
    this.engine = opts.engine || 'pdflatex';
  }

  start() {
    const args = latexmkArgs(this.engine, this.opts);
    const file = this.opts.file || 'main.tex';
    args.push('-interaction=nonstopmode', file);

    this.emit({ type: 'build:start', job: this.id, project: this.opts.project, engine: this.engine, cmd: 'latexmk ' + args.join(' ') });

    const child = spawn('latexmk', args, {
      cwd: this.projectDir,
      env: { ...process.env, max_print_line: '1000', error_line: '254', half_error_line: '238' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    const onData = (buf) => {
      const s = buf.toString('utf8');
      this.log += s;
      if (this.log.length > 4_000_000) this.log = this.log.slice(-2_000_000);
      this.emit({ type: 'build:log', job: this.id, project: this.opts.project, data: s });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => {
      if (this.finished || this.cancelled) return;
      this.finished = true;
      this.status = 'failed';
      this.emit({ type: 'build:end', job: this.id, project: this.opts.project, code: -1, error: String(err.message), duration: Date.now() - this.startedAt });
    });

    child.on('close', async (code) => {
      if (this.finished || this.cancelled) return;
      this.finished = true;
      this.code = code;
      this.status = code === 0 ? 'ok' : 'failed';
      this.duration = Date.now() - this.startedAt;
      const parsed = parseLog(this.log, this.projectDir);
      this.issues = parsed.issues;
      this.stats = parsed.stats;
      const meta = await buildMeta(this.projectDir, this.opts).catch(() => null);
      this.emit({
        type: 'build:end', job: this.id, project: this.opts.project,
        code, status: this.status, duration: this.duration,
        issues: this.issues, stats: this.stats, log: this.log.slice(-400_000),
        pdf: this.status === 'ok' ? await findPdf(this.projectDir) : null,
        meta,
      });
    });
    return this;
  }

  kill(signal = 'SIGTERM') {
    this.cancelled = true;
    this.status = 'cancelled';
    if (this.child && this.child.pid) {
      try { process.kill(-this.child.pid, signal); } catch { try { this.child.kill(signal); } catch { /* */ } }
    }
    if (this.proc) { try { this.proc.kill(signal); } catch { /* */ } }
  }
}

export class BuildManager {
  constructor(emit) {
    this.emit = emit;
    this.jobs = new Map(); // project -> BuildJob
  }

  start(projectDir, opts) {
    const key = projectDir;
    const existing = this.jobs.get(key);
    if (existing && existing.status === 'running') {
      existing.kill('SIGKILL');
      this.jobs.delete(key);
    }
    const job = new BuildJob(projectDir, opts, this.emit);
    this.jobs.set(key, job);
    job.start();
    return job;
  }

  status(projectDir) {
    const j = this.jobs.get(projectDir);
    if (!j) return { status: 'idle' };
    return { status: j.status, id: j.id, engine: j.engine, duration: Date.now() - j.startedAt };
  }
}

/* --------------------------------------------------------- Metadaten */

export async function buildMeta(projectDir, opts = {}) {
  const mainAbs = path.resolve(projectDir, opts.file || 'main.tex');
  const base = mainAbs.replace(/\.tex$/i, '');
  const aux = parseAux(base + '.aux');

  const included = resolveIncludes(mainAbs, projectDir);
  const labelsInFiles = new Map();
  for (const rel of included) {
    const abs = path.join(projectDir, rel);
    let text = '';
    try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
    const re = /\\label\s*\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(text))) {
      if (!labelsInFiles.has(m[1])) labelsInFiles.set(m[1], { name: m[1], file: rel, line: text.slice(0, m.index).split('\n').length });
    }
    const citeRe = /\\(?:cite|citep|citet|autocite|parencite|textcite|footcite|Cite)\s*(?:\[[^\]]*\])*\{([^}]+)\}/g;
    while ((m = citeRe.exec(text))) {
      m[1].split(',').forEach((c) => { const k = c.trim(); if (k && !aux.cites.includes(k)) aux.cites.push(k); });
    }
  }

  const bib = parseBibFiles(projectDir);
  const usedBibKeys = new Set(aux.cites);
  const bibFiltered = bib.filter((b) => usedBibKeys.size === 0 ? true : true);

  const outline = buildOutline(included, projectDir);

  let stats = { words: 0, chars: 0, lines: 0, paragraphs: 0, minutes: 0 };
  for (const rel of included) {
    try {
      const t = await fsp.readFile(path.join(projectDir, rel), 'utf8');
      const s = wordStats(t);
      stats.words += s.words; stats.chars += s.chars; stats.lines += s.lines;
      stats.paragraphs += s.paragraphs; stats.charsNoSpaces = (stats.charsNoSpaces || 0) + s.charsNoSpaces;
    } catch { /* */ }
  }
  stats.minutes = Math.max(1, Math.round(stats.words / 200));

  return {
    labels: [...labelsInFiles.values()],
    auxLabels: aux.labels,
    refs: aux.refs,
    cites: aux.cites,
    bib: bibFiltered,
    outline,
    stats,
    includes: included,
    main: path.relative(projectDir, mainAbs).split(path.sep).join('/'),
  };
}

const SECTION_RE = /^\\(chapter|part|section|subsection|subsubsection|paragraph|subparagraph|title|author)\s*(\[[^\]]*\])?\s*\{([^}]*)\}/;

export function buildOutline(files, projectDir) {
  const nodes = [];
  for (const rel of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(projectDir, rel), 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    const stack = [];
    let inVerbatim = false;
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (/\\begin\{(?:verbatim|lstlisting|minted)\}/.test(line)) inVerbatim = true;
      if (/\\end\{(?:verbatim|lstlisting|minted)\}/.test(line)) { inVerbatim = false; return; }
      if (inVerbatim || line.startsWith('%')) return;

      const sec = line.match(SECTION_RE);
      if (sec) {
        const level = LEVELS[sec[1]] ?? 9;
        const title = sec[3];
        const labelM = (lines[idx + 1] || '').match(/\\label\s*\{([^}]+)\}/) || line.match(/\\label\s*\{([^}]+)\}/);
        const node = { kind: sec[1], level, title, file: rel, line: idx + 1, label: labelM ? labelM[1] : null, children: [] };
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        if (stack.length) stack[stack.length - 1].children.push(node);
        else nodes.push(node);
        stack.push(node);
        return;
      }
      const lbl = line.match(/^\\label\s*\{([^}]+)\}/);
      if (lbl && stack.length) { stack[stack.length - 1].label = lbl[1]; return; }
      if (/^\\(begin\{(figure|table|algorithm)\}|bibliography|bibliographystyle|printbibliography)/.test(line)) {
        const kind = (line.match(/\\begin\{(figure|table|algorithm)\}/) || [])[1] || (line.startsWith('\\bibliography') || line.includes('printbibliography') ? 'bib' : 'env');
        const node = { kind, level: 8, title: kind === 'bib' ? 'Literatur' : line.replace(/\\\w+\{/, '').replace(/\}$/, ''), file: rel, line: idx + 1, children: [], env: true };
        while (stack.length && stack[stack.length - 1].level >= 8) stack.pop();
        if (stack.length && stack[stack.length - 1].level < 8) stack[stack.length - 1].children.push(node);
        else nodes.push(node);
        return;
      }
      const todo = line.match(/%?\s*\\?(TODO|FIXME|XXX)\b[:\s]*(.*)/i);
      if (todo) nodes.push({ kind: 'todo', level: 9, title: (todo[2] || todo[1]).trim() || todo[1], file: rel, line: idx + 1, children: [], todo: true });
    });
  }
  return nodes;
}

const LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6, title: 0, author: 0 };

export async function findPdf(projectDir) {
  try {
    const names = (await fsp.readdir(projectDir)).filter((n) => n.endsWith('.pdf'));
    if (!names.length) return null;
    const withTime = await Promise.all(names.map(async (n) => ({ n, m: (await fsp.stat(path.join(projectDir, n))).mtimeMs })));
    withTime.sort((a, b) => b.m - a.m);
    const st = await fsp.stat(path.join(projectDir, withTime[0].n));
    return { file: withTime[0].n, mtime: st.mtimeMs, size: st.size };
  } catch { return null; }
}
