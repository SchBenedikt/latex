/* Bibliography manager: browse every BibTeX entry of the project, see which
 * keys the document actually cites, jump to the entry in the .bib file, copy
 * an entry or insert its citation. Everything is computed from the project
 * files, so it also works in the browser-local workspace. */

import { api } from './api.js';
import { state, on } from './state.js';
import { $, el, clear, debounce, toast } from './util.js';
import { insertText, openFile, currentPath, currentText } from './editor/index.js';
import { activatePanel } from './search.js';

const CITE_RE = /\\[a-zA-Z]*[Cc]ite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;
const BIB_RE = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/;

let cited = new Map();      // key -> { count, files:Set }
let scanning = false;
let scanned = false;
let filters = { query: '', type: 'All', status: 'All' };

/* ---------------------------------------------------------------- Data */

let fileEntries = [];
let entriesLoading = false;

/** Minimal BibTeX reader: braced, quoted and bare values, nested braces. */
function parseBibText(text, source) {
  const out = [];
  const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].search(/[{(]/);
    let depth = 0;
    let end = text.length;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{' || text[i] === '(') depth++;
      else if (text[i] === '}' || text[i] === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const body = text.slice(m.index, end);
    out.push({
      key: m[2], type: m[1].toLowerCase(), source,
      title: bibField(body, 'title'),
      author: bibField(body, 'author'),
      year: bibField(body, 'year'),
      journal: bibField(body, 'journal') || bibField(body, 'booktitle') || bibField(body, 'publisher') || bibField(body, 'howpublished'),
    });
  }
  return out;
}

function bibField(body, name) {
  const m = new RegExp(`(^|[^\\w])${name}\\s*=\\s*`, 'i').exec(body);
  if (!m) return '';
  let i = m.index + m[0].length;
  let value = '';
  if (body[i] === '{') {
    let depth = 0;
    for (; i < body.length; i++) {
      if (body[i] === '{') { depth++; if (depth === 1) continue; }
      else if (body[i] === '}') { depth--; if (depth === 0) break; }
      value += body[i];
    }
  } else if (body[i] === '"') {
    for (i++; i < body.length && body[i] !== '"'; i++) value += body[i];
  } else {
    for (; i < body.length && body[i] !== ',' && body[i] !== '\n' && body[i] !== '}'; i++) value += body[i];
  }
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** Reads every .bib file of the project so the panel works before a build. */
async function loadEntries() {
  if (!state.project || entriesLoading) return;
  entriesLoading = true;
  try {
    let files = [];
    try { files = (await api.projectFiles(state.project)).files || []; } catch { files = []; }
    const next = [];
    for (const file of files.filter((f) => /\.bib$/i.test(f)).slice(0, 40)) {
      try {
        const res = await api.file(`${state.project}/${file}`);
        next.push(...parseBibText(typeof res === 'string' ? res : (res?.content || ''), file));
      } catch { /* unreadable file */ }
    }
    fileEntries = next;
  } finally {
    entriesLoading = false;
    render();
  }
}

/** All BibTeX entries of the project, deduplicated by citation key. */
export function entries() {
  const source = fileEntries.length ? fileEntries : (state.meta?.bib || []);
  const map = new Map();
  for (const e of source) {
    if (!e?.key) continue;
    const seen = map.get(e.key);
    if (seen) {
      if (e.source && !seen.sources.includes(e.source)) seen.sources.push(e.source);
      continue;
    }
    map.set(e.key, { ...e, sources: e.source ? [e.source] : [] });
  }
  return [...map.values()];
}

function citedCount(key) {
  return cited.get(key)?.count || 0;
}

/** Keys that the document cites but no .bib entry defines. */
function missingKeys() {
  const known = new Set(entries().map((e) => e.key));
  return [...cited.keys()].filter((key) => !known.has(key));
}

/** Scans every .tex file for citation commands, so the panel works before a build. */
async function scanCitations() {
  if (!state.project || scanning) return;
  scanning = true;
  try {
    const res = await api.search(state.project, {
      query: '\\\\[a-zA-Z]*[Cc]ite[a-zA-Z]*\\*?',
      regex: true,
      caseSensitive: false,
      wholeWord: false,
    });
    const next = new Map();
    for (const hit of res.results || []) {
      if (!/\.tex$/i.test(hit.file || '')) continue;
      if (/^\s*%/.test(hit.text || '')) continue;
      CITE_RE.lastIndex = 0;
      let m;
      while ((m = CITE_RE.exec(hit.text || ''))) {
        for (const raw of m[1].split(',')) {
          const key = raw.trim().replace(/^[*\s]+/, '');
          if (!key) continue;
          const entry = next.get(key) || { count: 0, files: new Set() };
          entry.count++;
          entry.files.add(hit.file);
          next.set(key, entry);
        }
      }
    }
    // Keys resolved from the last build's .aux stay visible even when the
    // source scan misses them (for example citations built from macros).
    for (const key of state.meta?.cites || []) {
      if (!next.has(key)) next.set(key, { count: 1, files: new Set() });
    }
    cited = next;
    scanned = true;
  } catch (e) {
    if (!scanned) toast('Citation scan failed: ' + e.message, { type: 'err', ms: 5000 });
  } finally {
    scanning = false;
    render();
  }
}

/* --------------------------------------------------------------- Source */

/** Reads the raw text of one entry from its .bib file. */
async function readEntry(entry) {
  const source = entry.sources[0];
  if (!source) return null;
  let text = '';
  try {
    text = (await api.file(`${state.project}/${source}`)).content || '';
  } catch {
    return null;
  }
  const key = entry.key;
  const re = new RegExp(`@\\w+\\s*[{(]\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  let depth = 0;
  let end = text.length;
  for (let i = m.index + m[0].search(/[{(]/); i < text.length; i++) {
    if (text[i] === '{' || text[i] === '(') depth++;
    else if (text[i] === '}' || text[i] === ')') { depth--; if (depth <= 0) { end = i + 1; break; } }
  }
  const before = text.slice(0, m.index);
  return { raw: text.slice(m.index, end), line: before.split('\n').length, file: source };
}

async function openEntry(entry) {
  const found = await readEntry(entry);
  if (!found) { toast(`Could not find ${entry.key} in ${entry.sources[0] || 'the bibliography'}.`, { type: 'warn' }); return; }
  await openFile(`${state.project}/${found.file}`, { line: found.line, col: 1 });
}

async function copyEntry(entry) {
  const found = await readEntry(entry);
  if (!found) { toast(`Could not find ${entry.key} in ${entry.sources[0] || 'the bibliography'}.`, { type: 'warn' }); return; }
  try {
    await navigator.clipboard.writeText(found.raw.trim());
    toast(`BibTeX entry ${entry.key} copied.`, { type: 'ok', ms: 2000 });
  } catch (e) {
    toast('Clipboard access failed: ' + e.message, { type: 'err' });
  }
}

/** Picks a citation command that matches the project's bibliography setup. */
async function citationCommand() {
  const mainPath = `${state.project}/${state.settings.mainFile || 'main.tex'}`;
  let text = currentPath() === mainPath ? currentText() : state.docs.get(mainPath)?.content;
  if (text == null) {
    try { text = (await api.file(mainPath)).content || ''; } catch { text = ''; }
  }
  return /\\usepackage(?:\s*\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b/i.test(text) ? 'parencite' : 'cite';
}

async function insertCitation(entry) {
  if (!/\.[a-z]+$/i.test(currentPath() || '')) {
    toast('Open a .tex document before inserting a citation.', { type: 'warn' });
    return;
  }
  const command = await citationCommand();
  insertText(`\\${command}{${entry.key}}`);
  toast(`\\${command}{${entry.key}} inserted`, { type: 'ok', ms: 2000 });
}

/* ------------------------------------------------------------ Rendering */

function types() {
  const set = new Set(entries().map((e) => (e.type || 'misc').toLowerCase()));
  return [...set].sort();
}

function summary() {
  const all = entries();
  const miss = missingKeys();
  const used = all.filter((e) => citedCount(e.key) > 0).length;
  const parts = [
    `${all.length} entr${all.length === 1 ? 'y' : 'ies'}`,
    `${used} cited`,
    `${all.length - used} never cited`,
  ];
  if (miss.length) parts.push(`${miss.length} missing`);
  return parts.join(' · ');
}

function renderChips() {
  const typeBox = $('#bib-types');
  const statusBox = $('#bib-status');
  if (typeBox) {
    clear(typeBox);
    const counts = new Map();
    for (const e of entries()) {
      const t = (e.type || 'misc').toLowerCase();
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    for (const t of ['All', ...types()]) {
      typeBox.append(el('button', {
        class: 'chip' + (filters.type === t ? ' active' : ''),
        text: t === 'All' ? `All types ${entries().length}` : `${t} ${counts.get(t) || 0}`,
        onclick: () => { filters.type = t; render(); },
      }));
    }
  }
  if (statusBox) {
    clear(statusBox);
    const options = [['All', 'All'], ['cited', 'Cited'], ['uncited', 'Never cited'], ['missing', 'Missing']];
    for (const [value, label] of options) {
      statusBox.append(el('button', {
        class: 'chip' + (filters.status === value ? ' active' : ''),
        text: label,
        onclick: () => { filters.status = value; render(); },
      }));
    }
  }
}

function matches(entry) {
  const q = filters.query.trim().toLowerCase();
  if (q) {
    const hay = [entry.key, entry.title, entry.author, entry.journal, entry.year, entry.type].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  const type = (entry.type || 'misc').toLowerCase();
  if (filters.type !== 'All' && type !== filters.type) return false;
  if (filters.status === 'cited' && citedCount(entry.key) === 0) return false;
  if (filters.status === 'uncited' && citedCount(entry.key) > 0) return false;
  return true;
}

function entryRow(entry) {
  const count = citedCount(entry.key);
  const meta = [
    entry.author ? entry.author.split(' and ').slice(0, 2).join(', ') + (entry.author.includes(' and ') ? ' et al.' : '') : '',
    entry.year,
    entry.journal,
    entry.sources.length ? entry.sources.join(', ') : 'no file',
  ].filter(Boolean).join(' · ');
  const badge = el('span', {
    class: 'bib-badge' + (count ? ' cited' : ''),
    text: count ? `cited ${count}×` : 'never cited',
    title: count ? `Cited in ${[...(cited.get(entry.key)?.files || [])].join(', ')}` : 'Not referenced by any citation command',
  });
  return el('div', { class: 'bib-row' },
    el('div', { class: 'bib-main' },
      el('div', { class: 'bib-title-row' },
        el('span', { class: 'bib-key', text: entry.key }),
        el('span', { class: 'bib-type', text: (entry.type || 'misc').toLowerCase() }),
        badge),
      entry.title ? el('div', { class: 'bib-title', text: entry.title }) : null,
      el('div', { class: 'bib-meta', text: meta })),
    el('div', { class: 'bib-actions' },
      el('button', { class: 'tb-btn', text: 'Cite', title: `Insert a citation for ${entry.key}`, onclick: () => insertCitation(entry) }),
      el('button', { class: 'tb-btn', text: 'Copy', title: 'Copy the BibTeX entry', onclick: () => copyEntry(entry) }),
      el('button', { class: 'tb-btn', text: 'Open', title: `Open ${entry.sources[0] || 'the bibliography'} at this entry`, onclick: () => openEntry(entry) })),
  );
}

function renderMissing() {
  const box = $('#bib-missing');
  if (!box) return;
  clear(box);
  const miss = missingKeys();
  if (!miss.length) { box.hidden = true; return; }
  box.hidden = false;
  box.append(el('div', { class: 'bib-missing-head', text: `⚠ ${miss.length} cited key${miss.length === 1 ? '' : 's'} without a BibTeX entry` }));
  for (const key of miss) {
    const info = cited.get(key);
    box.append(el('button', {
      class: 'bib-missing-row',
      title: 'Copy the key and add the entry to your bibliography',
      onclick: () => { navigator.clipboard?.writeText(key).catch(() => {}); toast(`Key ${key} copied — add a matching @entry to your .bib file.`, { type: 'warn', ms: 5000 }); },
    },
      el('span', { class: 'bib-key', text: key }),
      el('span', { class: 'bib-meta', text: [...(info?.files || [])].join(', ') || 'cited in the document' })));
  }
}

export function render() {
  const list = $('#bib-list');
  if (!list) return;
  const summaryEl = $('#bib-summary');
  if (summaryEl) summaryEl.textContent = state.project ? summary() : 'No project selected';

  if (!state.project) {
    clear(list);
    renderChips();
    renderMissing();
    list.append(el('div', { class: 'problems-empty', text: 'Open a project to browse its bibliography.' }));
    return;
  }

  renderChips();
  renderMissing();
  const all = entries();
  const shown = all.filter(matches);
  clear(list);

  if (!all.length) {
    list.append(el('div', { class: 'problems-empty', text: 'No BibTeX entries found. Add a .bib file to the project or import one from Zotero.' }));
    return;
  }
  if (!shown.length) {
    list.append(el('div', { class: 'problems-empty', text: 'No entry matches the current filter.' }));
    return;
  }

  let lastSource = null;
  for (const entry of shown) {
    const source = entry.sources[0] || 'no file';
    if (source !== lastSource) {
      list.append(el('div', { class: 'sr-file', text: source }));
      lastSource = source;
    }
    list.append(entryRow(entry));
  }
}

/* ------------------------------------------------------------------ Init */

/** Re-reads the project's .bib files and re-scans citation commands. */
export function refreshBibliography() {
  scanned = false;
  return Promise.all([loadEntries(), scanCitations()]);
}

export function initBibliography() {
  const filter = $('#bib-filter');
  if (filter) filter.addEventListener('input', debounce(() => { filters.query = filter.value; render(); }, 120));
  $('#bib-refresh')?.addEventListener('click', () => {
    refreshBibliography();
    toast('Bibliography refreshed', { type: 'ok', ms: 1500 });
  });

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if ((e.key === 'b' || e.key === 'B') && $('#modal-root')?.classList.contains('hidden')) {
      e.preventDefault();
      activatePanel('bibliography');
    }
  });

  on('meta', () => render());
  on('meta:refresh', () => { render(); loadEntries(); });
  on('tree:refresh', () => loadEntries());
  on('project', () => {
    cited = new Map();
    fileEntries = [];
    scanned = false;
    filters = { query: '', type: 'All', status: 'All' };
    if (filter) filter.value = '';
    render();
    loadEntries();
    scanCitations();
  });
  on('file-saved', (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) return;
    if (/\.bib$/i.test(path)) loadEntries();
    if (/\.(tex|bib)$/i.test(path)) scanCitations();
  });

  render();
  loadEntries();
  scanCitations();
}
