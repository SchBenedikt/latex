/* Research toolkit: per-project word goals, TODO tasks, and browser-local notes. */

import { api } from './api.js';
import { state, on } from './state.js';
import { $, el, clear, debounce, toast, promptDialog } from './util.js';
import { openFile, currentText } from './editor/index.js';
import { computeStats, computeProjectStats, invalidateProjectStats } from './stats.js';

const goalKey = (project) => `latex-goal-v1:${project}`;
const notesKey = (project) => `latex-notes-v1:${project}`;

const TASK_KINDS = ['TODO', 'FIXME', 'XXX', 'NOTE', 'HACK'];
let taskFilter = 'All';

/* ------------------------------------------------------------ Word goal */

export function getGoal(project = state.project) {
  if (!project) return 0;
  try {
    return Math.max(0, parseInt(JSON.parse(localStorage.getItem(goalKey(project)) || '0'), 10) || 0);
  } catch {
    return 0;
  }
}

/** Progress towards the word goal across every text file of the project. */
export async function goalProgress() {
  const goal = getGoal();
  if (!goal) return null;
  const projectStats = await computeProjectStats().catch(() => null);
  const words = projectStats
    ? projectStats.words
    : computeStats(currentText() || '').words;
  return { goal, words, pct: Math.min(100, Math.round((words / goal) * 100)) };
}

export async function setGoalDialog() {
  if (!state.project) { toast('No project selected', { type: 'warn' }); return; }
  const v = await promptDialog('Word goal', 'Target word count for this project (0 clears it)', String(getGoal() || ''), '8000');
  if (v == null) return;
  const n = Math.max(0, Math.min(1000000, parseInt(String(v).replace(/[^0-9]/g, ''), 10) || 0));
  localStorage.setItem(goalKey(state.project), JSON.stringify(n));
  toast(n ? `Word goal: ${n.toLocaleString('en-US')} words` : 'Word goal cleared', { type: 'ok', ms: 2000 });
  renderGoal();
}

async function renderGoal() {
  const fill = $('#goal-fill');
  const text = $('#goal-text');
  if (!fill || !text) return;
  const p = await goalProgress();
  if (!p) {
    fill.style.width = '0%';
    fill.classList.remove('done');
    text.textContent = 'No goal yet — set one to track this paper.';
    return;
  }
  fill.style.width = p.pct + '%';
  fill.classList.toggle('done', p.pct >= 100);
  text.textContent = `${p.words.toLocaleString('en-US')} / ${p.goal.toLocaleString('en-US')} words · ${p.pct}%${p.pct >= 100 ? ' · goal reached 🎉' : ''}`;
}

/* ----------------------------------------------------------------- Tasks */

let lastTasks = [];

export async function refreshTasks() {
  const list = $('#task-list');
  const count = $('#task-count');
  if (!list) return;
  if (!state.project) {
    lastTasks = [];
    renderTasks();
    if (count) count.textContent = '';
    return;
  }
  if (count) count.textContent = 'Scanning …';
  try {
    const res = await api.search(state.project, {
      query: '\\b(TODO|FIXME|XXX|NOTE|HACK)\\b:?\\s*(.*)$',
      regex: true,
      caseSensitive: false,
      wholeWord: false,
    });
    lastTasks = (res.results || []).slice(0, 200);
  } catch (e) {
    lastTasks = [];
    clear(list);
    list.append(el('div', { class: 'problems-empty', text: 'Task scan failed: ' + e.message }));
    if (count) count.textContent = '';
    renderTaskBadge();
    return;
  }
  if (count) count.textContent = lastTasks.length ? `${lastTasks.length} open` : '';
  renderTasks();
}

function taskKindOf(hit) {
  const m = String(hit.text || '').match(/\b(TODO|FIXME|XXX|NOTE|HACK)\b/i);
  return (m?.[1] || 'TODO').toUpperCase();
}

function renderTaskFilters() {
  const box = $('#task-filters');
  if (!box) return;
  clear(box);
  const counts = new Map();
  for (const t of lastTasks) {
    const kind = taskKindOf(t);
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  const options = ['All', ...TASK_KINDS.filter((k) => counts.has(k))];
  for (const kind of options) {
    const n = kind === 'All' ? lastTasks.length : (counts.get(kind) || 0);
    box.append(el('button', {
      class: 'chip' + (taskFilter === kind ? ' active' : ''),
      text: `${kind} ${n}`,
      onclick: () => { taskFilter = kind; renderTasks(); },
    }));
  }
}

function renderTasks() {
  const list = $('#task-list');
  if (!list) return;
  renderTaskFilters();
  renderTaskBadge();
  clear(list);
  const shown = taskFilter === 'All' ? lastTasks : lastTasks.filter((t) => taskKindOf(t) === taskFilter);
  if (!lastTasks.length) {
    list.append(el('div', { class: 'problems-empty', text: 'No TODOs found. Add “% TODO: …” anywhere to track work.' }));
    return;
  }
  if (!shown.length) {
    list.append(el('div', { class: 'problems-empty', text: `No ${taskFilter} items.` }));
    return;
  }
  let lastFile = null;
  for (const t of shown) {
    if (t.file !== lastFile) {
      list.append(el('div', { class: 'sr-file', text: t.file }));
      lastFile = t.file;
    }
    const m = String(t.text || '').match(/\b(TODO|FIXME|XXX|NOTE|HACK)\b:?\s*(.*)$/i);
    const kind = (m?.[1] || 'TODO').toUpperCase();
    const label = (m?.[2] || t.text || '').trim() || '(no description)';
    list.append(el('div', {
      class: 'sr-hit task-hit',
      onclick: () => openFile(t.file, { line: t.line, col: 1 }),
      title: `${t.file}:${t.line}`,
    },
      el('span', { class: 'task-kind ' + kind.toLowerCase(), text: kind }),
      el('span', { class: 'sr-line', text: String(t.line) }),
      el('span', { text: label }),
    ));
  }
}

function renderTaskBadge() {
  const btn = document.querySelector('.rail-btn[data-panel="research"]');
  if (!btn) return;
  let badge = btn.querySelector('.rail-badge');
  if (!badge) {
    badge = el('span', { class: 'rail-badge' });
    btn.append(badge);
  }
  badge.textContent = lastTasks.length > 99 ? '99+' : String(lastTasks.length);
  badge.hidden = lastTasks.length === 0;
  btn.title = `Research: goals, tasks, notes (Alt+T)${lastTasks.length ? ` · ${lastTasks.length} open tasks` : ''}`;
}

export function openResearch(panel = 'research') {
  const btn = document.querySelector(`.rail-btn[data-panel="${panel}"]`);
  if (btn) btn.click();
}

/* ----------------------------------------------------------------- Notes */

const saveNotes = debounce(() => {
  if (!state.project) return;
  const area = $('#research-notes');
  if (!area) return;
  try {
    localStorage.setItem(notesKey(state.project), area.value);
  } catch { /* quota — notes stay for the session */ }
  renderNotesCount();
}, 400);

function loadNotes() {
  const area = $('#research-notes');
  if (!area) return;
  let v = '';
  try {
    v = localStorage.getItem(notesKey(state.project)) || '';
  } catch { v = ''; }
  if (document.activeElement !== area) area.value = v;
  renderNotesCount();
}

function renderNotesCount() {
  const area = $('#research-notes');
  const count = $('#notes-count');
  if (!area || !count) return;
  const words = (area.value.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  count.textContent = words ? `${words.toLocaleString('en-US')} words · saved locally` : 'saved locally';
}

/* ------------------------------------------------------------------ Init */

export function initResearch() {
  $('#goal-set')?.addEventListener('click', setGoalDialog);
  $('#research-refresh')?.addEventListener('click', refreshTasks);
  $('#research-notes')?.addEventListener('input', saveNotes);

  const sync = debounce(() => renderGoal(), 300);
  on('dirty', sync);
  on('saved', () => { invalidateProjectStats(); sync(); });
  on('file-saved', () => invalidateProjectStats());
  on('active-file', () => { renderGoal(); });
  on('project', () => {
    invalidateProjectStats();
    renderGoal();
    loadNotes();
    refreshTasks();
  });
  on('meta:refresh', () => refreshTasks());

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.key === 't' || e.key === 'T') && $('#modal-root')?.classList.contains('hidden')) {
      e.preventDefault();
      openResearch();
    }
  });

  renderGoal();
  loadNotes();
  refreshTasks();
}
