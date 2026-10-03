/* Build-System: WebSocket-Log, Consolenansicht, Problemliste, Auto-Build */

import { api } from './api.js';
import { state, emit, on } from './state.js';
import { $, el, clear, toast, fmtDuration, escapeHtml } from './util.js';
import { saveAll, openFile, currentPath, anyDirty } from './editor/index.js';
import { loadPdf } from './preview.js';

let ws = null;
let reconnectDelay = 1000;
let building = false;
const completedJobs = new Set();
let consoleLines = 0;
const MAX_LINES = 4000;

const consoleEl = $('#console-out');
const problemsEl = $('#problems-list');
const buildStatusEl = $('#build-status');

/* ----------------------------------------------------------- WebSocket */

export function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    ws = new WebSocket(`${proto}://${location.host}/ws`);
  } catch { scheduleReconnect(); return; }

  ws.onopen = () => { reconnectDelay = 1000; };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };
  ws.onclose = () => scheduleReconnect();
  ws.onerror = () => { try { ws.close(); } catch { /* */ } };
}

function scheduleReconnect() {
  setTimeout(connectWs, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.6, 15000);
}

function handleMessage(msg) {
  if (msg.type === 'hello') return;
  if (msg.project && msg.project !== state.project) return;

  switch (msg.type) {
    case 'build:start':
      building = true;
      setBuildStatus('busy', `Baue mit ${msg.engine} …`);
      clearConsole();
      appendConsole('$ ' + msg.cmd + '\n', 'line-cmd');
      showBottom('console');
      emit('build:start', msg);
      break;
    case 'build:log':
      appendConsole(msg.data);
      break;
    case 'build:end':
      completedJobs.add(msg.job);
      if (completedJobs.size > 100) completedJobs.delete(completedJobs.values().next().value);
      building = false;
      onBuildEnd(msg);
      break;
    default: break;
  }
}

/* -------------------------------------------------------------- Bauen */

export async function buildProject({ silent = false } = {}) {
  if (!state.project) { toast('No project selected', { type: 'warn' }); return; }
  if (api.isBrowserWorkspace()) {
    if (building) return;
    const project = state.project;
    building = true;
    try {
      if (!await saveAll() || anyDirty()) throw new Error('Some changes could not be saved. Please build again.');
      if (state.project !== project) { building = false; return; }
      clearConsole();
      setBuildStatus('busy', 'Preparing browser TeX engine…');
      if (!silent) showBottom('console');
      appendConsole('[LaTeX Studio] Initializing TeX Live WebAssembly and compiling in this browser.\n');
      const result = await api.build(project, { file: state.settings.mainFile, engine: state.settings.engine });
      if (state.project !== project) { building = false; return; }
      building = false;
      appendConsole(result.log || (result.status === 'ok' ? '[TeX] PDF created.\n' : '[TeX] Compilation failed.\n'), result.status === 'ok' ? 'line-ok' : 'line-err');
      state.issues = result.issues || [];
      state.build = { status: result.status, engine: result.engine, duration: result.duration };
      setBuildStatus(result.status === 'ok' ? 'ok' : 'err', result.status === 'ok' ? `PDF ready · ${fmtDuration(result.duration)}` : `Build failed · ${fmtDuration(result.duration)}`);
      renderProblems();
      if (result.pdf) {
        state.pdf = result.pdf;
        emit('pdf:refresh', result.pdf);
        toast('PDF compiled in your browser', { type: 'ok' });
      } else {
        toast('LaTeX compilation failed. See the build log for details.', { type: 'err', ms: 7000 });
      }
      emit('build:end', result);
      emit('tree:refresh');
      return;
    } catch (e) {
      building = false;
      setBuildStatus('err', 'Build failed');
      appendConsole('\n[Browser TeX] ' + e.message + '\n', 'line-err');
      toast('Could not compile in this browser: ' + e.message, { type: 'err', ms: 9000 });
      return;
    }
  }
  if (building) return;
  building = true;
  const project = state.project;
  try {
    if (!await saveAll() || anyDirty()) throw new Error('Some changes could not be saved. Please build again.');
    if (state.project !== project) return;
    const body = {
      file: state.settings.mainFile,
      engine: state.settings.engine,
      shellEscape: state.settings.shellEscape === 'on',
    };
    const res = await api.build(project, body);
    if (state.project !== project || completedJobs.has(res.job)) return;
    building = true;
    setBuildStatus('busy', 'Baue …');
    emit('build:queued', res);
    if (!silent) showBottom('console');
  } catch (e) {
    if (state.project !== project) return;
    building = false;
    setBuildStatus('err', 'Build fehlgeschlagen');
    toast('Could not start build: ' + e.message, { type: 'err', ms: 5000 });
    appendConsole('\n[Editor] ' + e.message + '\n', 'line-err');
  }
}

async function onBuildEnd(msg) {
  const ok = msg.status === 'ok';
  setBuildStatus(ok ? 'ok' : 'err',
    ok ? `OK · ${fmtDuration(msg.duration)}${msg.stats?.pages ? ' · ' + msg.stats.pages + ' S.' : ''}`
      : `Error · ${fmtDuration(msg.duration)}`);

  appendConsole(`\n[Editor] ${ok ? '✓ Build succeeded' : '✗ Build failed (Code ' + msg.code + ')'} · ${fmtDuration(msg.duration)}\n`,
    ok ? 'line-ok' : 'line-err');

  state.issues = msg.issues || [];
  renderProblems();
  state.build = { status: msg.status, engine: msg.engine, duration: msg.duration, stats: msg.stats };
  emit('build:end', msg);

  if (msg.meta) {
    state.meta = { ...state.meta, ...msg.meta };
    emit('meta', state.meta);
  } else {
    refreshMeta();
  }

  if (msg.pdf) {
    state.pdf = msg.pdf;
    emit('pdf:refresh', msg.pdf);
  } else if (!ok) {
    emit('build:failed', msg);
  }

  emit('tree:refresh');

  if (!ok) {
    const errors = state.issues.filter((i) => i.severity === 'error');
    if (errors.length) toast(`Build finished with ${errors.length} error(s)`, { type: 'err' });
    if (msg.status === 'failed' && !state.issues.length) {
      appendConsole('[Editor] No LaTeX log found — check the console.\n', 'line-err');
    }
  } else if (state.issues.some((i) => i.severity === 'warning')) {
    toast('Built with warnings', { type: 'warn' });
  } else if (!state._firstBuildDone) {
    toast('Project built successfully', { type: 'ok' });
  }
  state._firstBuildDone = true;
}

export async function refreshMeta() {
  if (!state.project) return;
  if (api.isBrowserWorkspace()) return;
  try {
    const meta = await api.meta(state.project, state.settings.mainFile);
    state.meta = { ...state.meta, ...meta };
    if (meta.pdf) state.pdf = meta.pdf;
    emit('meta', state.meta);
  } catch (e) {
    if (e.status !== 404) console.warn('meta', e);
  }
}

/* -------------------------------------------------------------- Console */

export function appendConsole(text, cls = '') {
  if (consoleLines > MAX_LINES) {
    consoleEl.textContent = consoleEl.textContent.slice(-200000);
    consoleLines = 500;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i === lines.length - 1 && line === '') return;
    const span = document.createElement('span');
    span.textContent = line + (i < lines.length - 1 ? '\n' : '');
    if (cls) span.className = cls;
    else {
      const c = classify(line);
      if (c) span.className = c;
    }
    consoleEl.append(span);
  });
  consoleLines += lines.length;
  const pane = consoleEl.parentElement;
  if (pane) pane.scrollTop = pane.scrollHeight;
}

function classify(line) {
  if (/^\s*!/.test(line)) return 'line-err';
  if (/^(LaTeX|Package|Class) .*Warning:/.test(line)) return 'line-warn';
  if (/Overfull|Underfull/.test(line)) return 'line-warn';
  if (/^\s*<\*\/?|^\s*->/.test(line)) return 'line-dim';
  if (/Latexmk|Applying rule|^Latexmk:|Run number/.test(line)) return 'line-cmd';
  if (/Output written on/.test(line)) return 'line-ok';
  return '';
}

export function clearConsole() {
  consoleEl.textContent = '';
  consoleLines = 0;
}

/* ------------------------------------------------------------ Probleme */

export function renderProblems() {
  clear(problemsEl);
  const issues = state.issues || [];
  const badge = $('#problems-badge');
  const errCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  badge.textContent = String(errCount + warnCount);
  badge.classList.toggle('hidden', errCount + warnCount === 0);
  badge.classList.toggle('warn', errCount === 0);

  if (!issues.length) {
    problemsEl.append(el('div', { class: 'problems-empty', text: state.build.status === 'ok' ? 'No problems found. 🎉' : 'No problems yet — build the project (Ctrl+B).' }));
    updateStatusIssues();
    return;
  }

  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);

  for (const it of sorted) {
    const row = el('div', {
      class: 'issue ' + it.severity,
      title: 'Click to navigate',
      onclick: () => {
        if (it.file) openFile(it.file, { line: it.line || 1, col: 1 });
        else if (it.line) openFile(state.settings.mainFile, { line: it.line, col: 1 });
      },
    },
      el('span', { class: 'sev', text: it.severity === 'error' ? '✕' : it.severity === 'warning' ? '!' : 'i' }),
      el('span', { class: 'imsg' },
        el('span', { text: it.message }),
        it.context ? el('span', { class: 'isrc', text: it.context }) : null,
        it.fix ? el('span', { class: 'issue-fix', text: it.fix }) : null,
      ),
      el('span', { class: 'iloc', text: it.file ? `${it.file}${it.line ? ':' + it.line : ''}` : (it.line ? 'Line ' + it.line : '') }),
      it.package ? el('button', {
        class: 'tb-btn package-fix-action',
        text: 'Install and rebuild',
        onclick: (event) => {
          event.stopPropagation();
          import('./packages.js').then(({ installPackage }) => installPackage(it.package, { rebuild: true }));
        },
      }) : null,
    );
    problemsEl.append(row);
  }
  updateStatusIssues();
}

function updateStatusIssues() {
  const issues = state.issues || [];
  const e = issues.filter((i) => i.severity === 'error').length;
  const w = issues.filter((i) => i.severity === 'warning').length;
  $('#st-issues').innerHTML = e || w
    ? `<span class="err">✕ ${e}</span> <span class="warn">⚠ ${w}</span>`
    : '<span style="color:var(--ok)">✓ 0</span>';
}

/* ---------------------------------------------------------- Statusleiste */

export function setBuildStatus(kind, text) {
  const elStatus = $('#st-build');
  elStatus.className = 'st-item st-btn ' + kind;
  const icon = kind === 'busy' ? '⟳' : kind === 'ok' ? '✓' : kind === 'err' ? '✕' : '•';
  elStatus.textContent = icon + ' ' + text;
  buildStatusEl.textContent = text;
  emit('build-status', { kind, text });
}

/* ------------------------------------------------------------ Auto-Build */

let autoBuildTimer = null;

export function scheduleAutoBuild() {
  clearTimeout(autoBuildTimer);
  autoBuildTimer = null;
  if (state.settings.autoBuild !== 'on') return;
  autoBuildTimer = setTimeout(() => {
    if (!state.project || !state.settings.mainFile || !state.tabs.length) return;
    buildProject({ silent: true });
  }, Math.max(100, Math.min(10000, Number(state.settings.autoBuildDelay) || 900)));
}

/* ------------------------------------------------------- UI-Schnittstellen */

export function showBottom(tab = 'console') {
  const panel = $('#bottom-panel');
  panel.classList.remove('hidden');
  setBottomTab(tab);
}

export function toggleBottom() {
  const panel = $('#bottom-panel');
  panel.classList.toggle('hidden');
}

export function setBottomTab(name) {
  for (const b of document.querySelectorAll('.btab')) b.classList.toggle('active', b.dataset.btab === name);
  for (const p of document.querySelectorAll('.bpane')) p.classList.toggle('active', p.dataset.bpane === name);
  if (name === 'log') loadRawLog();
}

async function loadRawLog() {
  const out = $('#log-out');
  out.textContent = 'Lade Log …';
  try {
    const res = await api.log(state.project, state.settings.mainFile);
    out.textContent = res.log || 'No log available.';
    out.parentElement.scrollTop = 0;
  } catch (e) {
    out.textContent = 'Log unavailable: ' + e.message;
  }
}

export function initBuild() {
  if (!api.isBrowserWorkspace()) connectWs();

  $('#btn-build').addEventListener('click', () => buildProject());
  $('#btn-autobuild').addEventListener('click', () => {
    const next = state.settings.autoBuild === 'on' ? 'off' : 'on';
    emit('settings:set', { autoBuild: next });
    toast('Auto build ' + (next === 'on' ? 'enabled' : 'disabled'), { type: 'ok', ms: 1600 });
  });
  $('#btn-console').addEventListener('click', () => toggleBottom());
  $('#btn-close-bottom').addEventListener('click', () => $('#bottom-panel').classList.add('hidden'));
  $('#btn-clear-console').addEventListener('click', clearConsole);
  $('#st-build').addEventListener('click', () => { showBottom('console'); });
  $('#st-issues').addEventListener('click', () => { showBottom('problems'); });
  $('#problems-badge').addEventListener('click', () => showBottom('problems'));

  for (const tab of document.querySelectorAll('.btab')) {
    tab.addEventListener('click', () => setBottomTab(tab.dataset.btab));
  }

  on('cmd:build', () => buildProject());
  on('cmd:console', () => toggleBottom());
  on('dirty', () => scheduleAutoBuild());
  on('saved', () => scheduleAutoBuild());

  const syncAutoBtn = () => $('#btn-autobuild').classList.toggle('toggle', state.settings.autoBuild === 'on');
  on('settings', syncAutoBtn);
  syncAutoBtn();
  on('build:idle', () => {
    clearTimeout(autoBuildTimer);
    autoBuildTimer = null;
    building = false;
    setBuildStatus('idle', 'Ready');
  });
  on('project', () => {
    clearTimeout(autoBuildTimer);
    autoBuildTimer = null;
    building = false;
  });

  setBuildStatus('idle', 'Ready');
  renderProblems();
}
