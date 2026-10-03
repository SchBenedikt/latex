/* Projectsuche über alle Textdateien */

import { api } from './api.js';
import { state, emit, on } from './state.js';
import { $, el, clear, debounce, escapeHtml, toast, confirmDialog } from './util.js';
import { openFile, saveAll, reloadFile } from './editor/index.js';

const input = $('#search-input');
const resultsEl = $('#search-results');
const statsEl = $('#search-stats');
let lastQuery = '';

function searchOptions() {
  return {
    query: input.value,
    regex: $('#search-regex').checked,
    caseSensitive: $('#search-case').checked,
    wholeWord: $('#search-word').checked,
  };
}

export async function runSearch() {
  const query = input.value;
  lastQuery = query;
  clear(resultsEl);
  if (!query || !state.project) {
    statsEl.textContent = '';
    return;
  }
  statsEl.textContent = 'Searching …';
  try {
    const res = await api.search(state.project, searchOptions());
    if (input.value !== lastQuery) return;
    const results = res.results || [];
    statsEl.textContent = results.length
      ? `${results.length}  matches in ${new Set(results.map((r) => r.file)).size} file(s)${res.truncated ? ' (truncated)' : ''}`
      : 'No matches';

    let lastFile = null;
    for (const r of results) {
      if (r.file !== lastFile) {
        resultsEl.append(el('div', { class: 'sr-file', text: r.file }));
        lastFile = r.file;
      }
      resultsEl.append(el('div', {
        class: 'sr-hit',
        onclick: () => openFile(r.file, { line: r.line, col: r.col + 1 }),
        title: `${r.file}:${r.line}`,
      },
        el('span', { class: 'sr-line', text: String(r.line) }),
        el('span', { html: mark(r.text, query) }),
      ));
    }
  } catch (e) {
    statsEl.textContent = 'Error: ' + e.message;
  }
}

function mark(text, query) {
  if ($('#search-regex').checked) return escapeHtml(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = $('#search-case').checked ? 'g' : 'gi';
  try {
    return escapeHtml(text).replace(new RegExp(q, flags), (m) => `<mark>${m}</mark>`);
  } catch {
    return escapeHtml(text);
  }
}

export function initSearch() {
  const debounced = debounce(runSearch, 320);
  input.addEventListener('input', debounced);
  for (const id of ['#search-regex', '#search-case', '#search-word']) {
    $(id).addEventListener('change', runSearch);
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    if (e.key === 'Escape') { input.value = ''; runSearch(); }
  });

  $('#search-replace-one').addEventListener('click', () => doReplace(1));
  $('#search-replace-all').addEventListener('click', () => doReplace(0));
  $('#search-replace').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doReplace(e.shiftKey ? 0 : 1); }
    if (e.key === 'Escape') { $('#search-replace').value = ''; }
  });

  on('cmd:search', () => {
    activatePanel('search');
    input.focus();
    input.select();
  });
  on('cmd:replace', () => {
    activatePanel('search');
    $('#search-replace').focus();
    $('#search-replace').select();
  });
  on('project', () => {
    input.value = '';
    $('#search-replace').value = '';
    clear(resultsEl);
    statsEl.textContent = '';
  });
}

/* ----------------------------------------------------------- Ersetzen */

async function doReplace(limit) {
  if (!state.project) { toast('No project selected', { type: 'warn' }); return; }
  const q = input.value;
  if (!q) { toast('Enter a search term first', { type: 'warn' }); return; }
  const replacement = $('#search-replace').value;

  if (limit !== 1) {
    const ok = await confirmDialog(
      'Alle Treffer ersetzen',
      `“${q}“ with “${replacement}“ in all project files?`,
      'Alle ersetzen',
    );
    if (!ok) return;
  }

  try {
    await saveAll();
    const res = await api.replace(state.project, { ...searchOptions(), replacement, limit });
    if (!res.count) { toast('No matches to replace', { type: 'warn' }); return; }
    for (const f of res.files) await reloadFile(f);
    await runSearch();
    emit('meta:refresh');
    emit('tree:refresh');
    toast(`${res.count}  matches in ${res.files.length} file(s) replaced`, { type: 'ok', ms: 4000 });
  } catch (e) {
    toast('Replace failed: ' + e.message, { type: 'err', ms: 6000 });
  }
}

export function activatePanel(name) {
  const btn = document.querySelector(`.rail-btn[data-panel="${name}"]`);
  if (btn) btn.click();
}
