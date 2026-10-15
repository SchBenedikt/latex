/* Project changelog: automatic local history of saved file versions plus a
 * journal of project events (snapshots, imports, exports, builds).
 * Everything is stored in this browser — nothing leaves the device. */

import { api } from './api.js';
import { state, on, emit } from './state.js';
import { $, el, clear, openModal, closeModal, toast, confirmDialog, escapeHtml } from './util.js';
import { reloadFile } from './editor/index.js';

const keyOf = (project) => `latex-history-v1:${project}`;
const MAX_EVENTS = 200;         // journal entries kept per project
const MAX_FILE_VERSIONS = 30;   // saved versions kept per file
const MIN_VERSION_GAP_MS = 15000; // don't record the same file more often
const MAX_CONTENT = 200000;     // skip storing content above this size

const NOTE_META = {
  'snapshot-create': { icon: 'save', label: 'Snapshot created' },
  'snapshot-restore': { icon: 'refresh', label: 'Snapshot restored' },
  export: { icon: 'download', label: 'Project exported' },
  import: { icon: 'folder', label: 'Import' },
  build: { icon: 'play', label: 'Build' },
  project: { icon: 'folder', label: 'Project' },
};

/* ------------------------------------------------------------- Storage */

export function listHistory(project = state.project) {
  if (!project) return [];
  try {
    const rows = JSON.parse(localStorage.getItem(keyOf(project)) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function storeHistory(project, rows) {
  try {
    localStorage.setItem(keyOf(project), JSON.stringify(rows.slice(0, MAX_EVENTS)));
  } catch { /* quota — history stays for the session */ }
}

function pushEntry(entry) {
  const project = state.project;
  if (!project) return;
  const rows = listHistory(project);
  rows.unshift({ id: `h${Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...entry });
  // Keep only the newest versions of each file with content.
  const perFile = new Map();
  const trimmed = [];
  for (const row of rows) {
    if (row.kind !== 'save') { trimmed.push(row); continue; }
    const n = (perFile.get(row.file) || 0) + 1;
    perFile.set(row.file, n);
    if (n > MAX_FILE_VERSIONS) continue;
    trimmed.push(row);
  }
  storeHistory(project, trimmed);
}

/* -------------------------------------------------------- Record events */

export function recordVersion(file, content) {
  const project = state.project;
  if (!project || !file || content == null) return;
  if (content.length > MAX_CONTENT) return;
  const rows = listHistory(project);
  const last = rows.find((r) => r.kind === 'save' && r.file === file);
  if (last && Date.now() - last.at < MIN_VERSION_GAP_MS) return;
  const previous = last ? (last.content || '').length : null;
  pushEntry({ kind: 'save', file, chars: content.length, delta: previous == null ? null : content.length - previous, content });
}

export function recordNote({ note, label, ok = null }) {
  pushEntry({ kind: 'note', note, label: String(label || ''), ok });
}

export function clearHistory() {
  if (!state.project) return;
  try { localStorage.removeItem(keyOf(state.project)); } catch { /* */ }
  renderHistoryList();
}

/* ----------------------------------------------------------------- Diff */

/** Minimal LCS line diff; returns null when the inputs are too large. */
export function lineDiff(oldText, newText) {
  const a = String(oldText).split('\n');
  const b = String(newText).split('\n');
  if (a.length * b.length > 400000) return null;
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ t: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ t: 'del', text: a[i] }); i++; }
    else { rows.push({ t: 'add', text: b[j] }); j++; }
  }
  while (i < n) rows.push({ t: 'del', text: a[i++] });
  while (j < m) rows.push({ t: 'add', text: b[j++] });
  return rows;
}

function renderDiff(rows) {
  const wrap = el('div', { class: 'history-diff' });
  if (!rows) {
    wrap.append(el('div', { class: 'problems-empty', text: 'The file is too large for an inline diff.' }));
    return wrap;
  }
  let unchanged = 0;
  const flush = () => {
    if (unchanged > 0) {
      wrap.append(el('div', { class: 'diff-line same dim', text: `⋯ ${unchanged} unchanged line${unchanged === 1 ? '' : 's'}` }));
      unchanged = 0;
    }
  };
  for (const row of rows) {
    if (row.t === 'same') { unchanged++; continue; }
    flush();
    wrap.append(el('div', { class: 'diff-line ' + row.t },
      el('span', { class: 'diff-sign', text: row.t === 'add' ? '+' : '−' }),
      el('span', { class: 'diff-text', text: row.text }),
    ));
  }
  flush();
  return wrap;
}

/* -------------------------------------------------------------- Restore */

async function restoreVersion(entry) {
  const project = state.project;
  if (!project || entry.content == null) return;
  const ok = await confirmDialog(
    'Restore this version',
    `Replace ${entry.file} with the version from ${new Date(entry.at).toLocaleString()}? The current text is kept in the change history.`,
    'Restore',
  );
  if (!ok) return;
  try {
    const path = `${project}/${entry.file}`;
    await api.saveFile(path, entry.content);
    await reloadFile(path);
    emit('tree:refresh');
    emit('meta:refresh');
    recordNote({ note: 'import', label: `Restored ${entry.file} from ${new Date(entry.at).toLocaleString()}` });
    renderHistoryList();
    toast(`Restored ${entry.file}`, { type: 'ok' });
  } catch (e) {
    toast('Restore failed: ' + e.message, { type: 'err' });
  }
}

/* ----------------------------------------------------------- Rendering */

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (x) => x.toDateString() === d.toDateString();
  if (same(today)) return 'Today';
  if (same(yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function entryTitle(row) {
  if (row.kind === 'save') return row.file;
  const meta = NOTE_META[row.note] || { label: 'Event' };
  return row.label ? `${meta.label} · ${row.label}` : meta.label;
}

function renderHistoryList() {
  const list = $('#history-list');
  const count = $('#history-count');
  if (!list) return;
  const project = state.project;
  const rows = listHistory(project);
  clear(list);
  const projName = $('#history-project');
  if (projName) projName.textContent = project || '';
  if (count) count.textContent = rows.length
    ? `${rows.length} entries · stored in this browser`
    : 'No entries yet — stored in this browser';
  if (!rows.length) {
    list.append(el('div', { class: 'problems-empty', text: 'Saves, snapshots, builds and imports of this project appear here. Restore any saved version with one click.' }));
    return;
  }

  let lastDay = null;
  for (const row of rows) {
    const day = dayLabel(row.at);
    if (day !== lastDay) {
      lastDay = day;
      list.append(el('div', { class: 'history-day', text: day }));
    }
    const time = new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const meta = row.kind === 'save'
      ? `${time} · ${row.chars.toLocaleString('en-US')} chars${row.delta != null ? ` (${row.delta >= 0 ? '+' : ''}${row.delta})` : ''}`
      : `${time}${row.ok === false ? ' · failed' : row.ok ? ' · ok' : ''}`;
    const body = el('div', { class: 'history-body' },
      el('b', { text: entryTitle(row) }),
      el('span', { text: meta }),
    );
    const actions = el('div', { class: 'history-actions' });
    if (row.kind === 'save' && row.content != null) {
      actions.append(
        el('button', {
          class: 'tb-btn', text: 'Diff',
          title: 'Compare with the current file',
          onclick: (e) => toggleDiff(e.currentTarget, row),
        }),
        el('button', { class: 'tb-btn', text: 'Restore', onclick: () => restoreVersion(row) }),
      );
    }
    if (row.kind === 'save') {
      actions.append(el('button', {
        class: 'tb-btn', text: 'Open', title: `Open ${row.file}`,
        onclick: () => { closeModal(null); import('./editor/index.js').then((m) => m.openFile(`${state.project}/${row.file}`)); },
      }));
    }
    const node = el('div', { class: 'history-row ' + (row.kind === 'save' ? 'save' : row.note || '') },
      el('div', { class: 'history-icon', text: row.kind === 'save' ? '✎' : (NOTE_META[row.note] || {}).icon === 'build' ? '▶' : row.note === 'snapshot-create' || row.note === 'snapshot-restore' ? '💾' : '•' }),
      body,
      actions,
    );
    list.append(node);
  }
}

function toggleDiff(button, row) {
  const node = button.closest('.history-row');
  const existing = node.nextElementSibling;
  if (existing && existing.classList.contains('history-diff-wrap')) {
    existing.remove();
    button.textContent = 'Diff';
    return;
  }
  const currentPath = `${state.project}/${row.file}`;
  api.file(currentPath).then((res) => {
    const content = typeof res === 'string' ? res : (res?.content ?? '');
    const wrap = el('div', { class: 'history-diff-wrap' }, renderDiff(lineDiff(row.content, content)));
    node.after(wrap);
    button.textContent = 'Hide diff';
  }).catch(() => {
    const wrap = el('div', { class: 'history-diff-wrap' }, renderDiff(lineDiff(row.content, '')));
    node.after(wrap);
    button.textContent = 'Hide diff';
  });
}

/* ------------------------------------------------------------------ Init */

export function openHistory() {
  if (!state.project) { toast('No project selected', { type: 'warn' }); return; }
  renderHistoryList();
  openModal('history');
}

export function initHistory() {
  $('#btn-history')?.addEventListener('click', openHistory);
  $('#history-clear')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Clear change history', 'Remove all saved versions and journal entries for this project from this browser?', 'Clear');
    if (ok) clearHistory();
  });

  on('file-saved', (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    const content = typeof data === 'object' && data ? data.content : null;
    if (!path) return;
    const rel = String(path).startsWith(state.project + '/') ? path.slice(state.project.length + 1) : path;
    recordVersion(rel, content != null ? content : (state.docs.get(path)?.content ?? ''));
    const list = $('#history-list');
    if (list && !$('#modal-root').classList.contains('hidden')) renderHistoryList();
  });

  on('history:note', (note) => recordNote(note));
  on('build:end', (msg) => {
    recordNote({
      note: 'build',
      label: `${msg?.engine || state.settings.engine} · ${msg?.status === 'ok' ? 'success' : 'failed'}`,
      ok: msg?.status === 'ok',
    });
    const list = $('#history-list');
    if (list && !$('#modal-root').classList.contains('hidden')) renderHistoryList();
  });
  on('project', () => renderHistoryList());
}
