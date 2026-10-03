/* Command palette, quick open, Tastenkürzel-Übersicht */

import { $, $$, el, clear, modal, openModal, closeModal, fuzzy, fuzzyHighlight, promptDialog, toast, basename, dirname } from './util.js';
import { state, emit, on, setSettings, setProject } from './state.js';
import { ENVIRONMENTS } from './editor/catalog.js';
import {
  openFile, closeTab, saveActive, saveAll, currentPath, insertSnippet,
  focusEditor, gotoLine, currentLine, reconfigureAllEditors, closeAllTabs,
} from './editor/index.js';
import { buildProject, showBottom, toggleBottom, clearConsole, refreshMeta } from './build.js';
import { setZoom, gotoPage, openPdfInTab, downloadPdf, forwardSync, hasPdf } from './preview.js';
import { activatePanel } from './search.js';
import { newFile, newFolder, refreshTree } from './tree.js';
import { applyEditorSettings } from './editor/index.js';
import { openPackageManager } from './packages.js';
import { commandIcon, fileIcon } from './icons.js';

/* ------------------------------------------------------------- Palette */

let paletteItems = [];
let paletteIdx = 0;
let palettePick = null;

export function commands() {
  const S = state.settings;
  return [
    /* Build */
    { grp: 'Build', ico: '', label: 'Build project', key: 'Ctrl+B', run: () => buildProject() },
    { grp: 'Build', ico: '', label: 'Check and manage LaTeX packages', key: '', run: openPackageManager },
    { grp: 'Build', ico: '', label: 'Auto-Build umschalten', key: '', run: () => setSettings({ autoBuild: S.autoBuild === 'on' ? 'off' : 'on' }) },
    { grp: 'Build', ico: '', label: 'Engine wechseln: pdfLaTeX', key: '', run: () => switchEngine('pdflatex') },
    { grp: 'Build', ico: '', label: 'Engine wechseln: XeLaTeX', key: '', run: () => switchEngine('xelatex') },
    { grp: 'Build', ico: '', label: 'Engine wechseln: LuaLaTeX', key: '', run: () => switchEngine('lualatex') },
    { grp: 'Build', ico: '', label: 'Metadaten new laden (Labels, Zitate)', key: '', run: refreshMeta },
    { grp: 'Build', ico: '', label: 'Consoleninhalt leeren', key: '', run: clearConsole },
    { grp: 'Build', ico: '', label: 'Editor new initialisieren (Settings anwenden)', key: '', run: reconfigureAllEditors },

    /* files */
    { grp: 'files', ico: '', label: 'Aktive File speichern', key: 'Ctrl+S', run: () => saveActive(true) },
    { grp: 'files', ico: '', label: 'Alle files speichern', key: 'Ctrl+Shift+S', run: saveAll },
    { grp: 'files', ico: '', label: 'Open file', key: 'Ctrl+P', run: () => emit('cmd:quickopen') },
    { grp: 'files', ico: '', label: 'New file', key: '', run: () => newFile('') },
    { grp: 'files', ico: '', label: 'New folder', key: '', run: () => newFolder('') },
    { grp: 'files', ico: '', label: 'Filebaum aktualisieren', key: '', run: refreshTree },
    { grp: 'files', ico: '', label: 'Go to line …', key: 'Ctrl+G', run: gotoLinePrompt },
    { grp: 'files', ico: '', label: 'Close tab', key: 'Ctrl+F4', run: () => currentPath() && closeTab(currentPath()) },
    { grp: 'files', ico: '', label: 'Alle Tabs schließen', key: '', run: closeAllTabs },

    /* Project */
    { grp: 'Project', ico: '', label: 'New project …', key: '', run: () => emit('cmd:new-project') },
    { grp: 'Project', ico: '', label: 'Add sample projects …', key: '', run: () => emit('cmd:project-demos') },
    { grp: 'Project', ico: '', label: 'Rename project …', key: '', run: () => emit('cmd:project-rename'), when: () => !!state.project },
    { grp: 'Project', ico: '', label: 'Duplicate project …', key: '', run: () => emit('cmd:project-duplicate'), when: () => !!state.project },
    { grp: 'Project', ico: '', label: 'Export project as ZIP', key: '', run: () => { location.href = '/api/export?project=' + encodeURIComponent(state.project); } },
    { grp: 'Project', ico: '', label: 'Import project from ZIP …', key: '', run: () => emit('cmd:project-import') },
    { grp: 'Project', ico: '', label: 'Delete project …', key: '', run: () => emit('cmd:project-delete'), when: () => !!state.project },

    /* Navigation & Search */
    { grp: 'Navigation & Search', ico: '', label: 'Project search', key: 'Ctrl+Shift+F', run: () => { activatePanel('search'); $('#search-input').focus(); } },
    { grp: 'Navigation & Search', ico: '', label: 'Projectweit ersetzen …', key: '', run: () => emit('cmd:replace'), when: () => !!state.project },
    { grp: 'Navigation & Search', ico: '', label: 'Show outline', key: 'Ctrl+Shift+O', run: () => activatePanel('outline') },
    { grp: 'Navigation & Search', ico: '', label: 'Preview current line', key: 'Ctrl+Shift+G', run: () => forwardSync(currentLine().line, currentPath()) },
    { grp: 'Navigation & Search', ico: '', label: 'Source at PDF position (SyncTeX)', key: 'Ctrl+Shift+L', run: () => emit('cmd:sync-here') },
    { grp: 'Navigation & Search', ico: '', label: 'Go to page …', key: '', run: gotoPagePrompt },

    /* Insert */
    { grp: 'Insert', ico: 'λ', label: 'Insert environment …', key: 'Ctrl+E', run: insertEnvironmentPalette },
    { grp: 'Insert', ico: 'Ω', label: 'Open symbol palette', key: '', run: () => activatePanel('symbols') },

    /* View */
    { grp: 'View', ico: '', label: 'Toggle console', key: 'Ctrl+J', run: toggleBottom },
    { grp: 'View', ico: '', label: 'Toggle preview', key: 'Ctrl+\\', run: () => emit('cmd:toggle-preview') },
    { grp: 'View', ico: '', label: 'Toggle sidebar', key: 'Ctrl+Shift+B', run: () => emit('cmd:toggle-sidebar') },
    { grp: 'View', ico: '', label: 'Toggle theme', key: '', run: toggleTheme },
    { grp: 'View', ico: '', label: 'Toggle word wrap', key: '', run: toggleWrap },
    { grp: 'View', ico: '', label: 'PDF in new tab', key: '', run: openPdfInTab, when: () => hasPdf() },
    { grp: 'View', ico: '', label: 'Download PDF', key: '', run: downloadPdf, when: () => hasPdf() },
    { grp: 'View', ico: '', label: 'Zoom in (preview)', key: 'Ctrl++', run: () => setZoom('1.25') },
    { grp: 'View', ico: '', label: 'Fit preview to width', key: '', run: () => setZoom('fit-width') },
    { grp: 'View', ico: '', label: 'Settings', key: '', run: () => emit('cmd:settings') },
    { grp: 'View', ico: '', label: 'Keyboard shortcuts & help', key: 'F1', run: () => emit('cmd:shortcuts') },
  ];
}

function switchEngine(engine) {
  setSettings({ engine });
  $('#engine-select').value = engine;
  toast('Engine: ' + engine, { type: 'ok', ms: 1500 });
}

function toggleWrap() {
  const wrap = state.settings.wrap === 'on' ? 'off' : 'on';
  setSettings({ wrap });
  applyEditorSettings({ wrap });
}

function toggleTheme() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setSettings({ theme });
  applyTheme();
}

export function applyTheme() {
  const t = state.settings.theme;
  const resolved = t === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : t;
  document.documentElement.dataset.theme = resolved;
  const sel = $('#set-theme');
  if (sel) sel.value = t;
}

function gotoLinePrompt() {
  const cur = currentLine().line;
  promptDialog('Go to line', 'Line number', String(cur)).then((v) => {
    if (v && /^\d+$/.test(v.trim())) gotoLine(parseInt(v.trim(), 10));
  });
}

function gotoPagePrompt() {
  promptDialog('Gehe zu Seite', 'Seitennummer', String(state.pdf ? 1 : 1)).then((v) => {
    if (v && /^\d+$/.test(v.trim())) gotoPage(parseInt(v.trim(), 10));
  });
}

function insertEnvironmentPalette() {
  const items = ENVIRONMENTS.map((e) => ({
    ico: 'λ',
    label: `Environment: ${e.label}`,
    note: e.detail,
    run: () => insertSnippet(e.snippet),
  }));
  runPalette(items, 'Choose environment …');
}

/* --------------------------------------------------- generische Palette */

function runPalette(items, placeholder = 'Befehl eingeben …') {
  paletteItems = items;
  paletteIdx = 0;
  palettePick = null;
  const input = $('#palette-input');
  input.placeholder = placeholder;
  input.value = '';
  openModal('palette');
  renderPalette('');
  input.focus();
}

function renderPalette(filter) {
  const list = $('#palette-list');
  clear(list);
  let items = paletteItems;
  const grouped = !filter;
  if (filter) {
    items = paletteItems
      .map((it) => ({ it, sc: fuzzy(filter, it.label + ' ' + (it.note || '')) }))
      .filter((x) => x.sc)
      .sort((a, b) => b.sc.score - a.sc.score)
      .map((x) => ({ ...x.it, _idx: x.sc.idx, _label: it2label(x.it, filter) }));
  }
  items = items.filter((it) => !it.when || it.when());
  palettePick = items;
  paletteIdx = Math.min(paletteIdx, Math.max(0, items.length - 1));
  const count = $('#palette-count');
  if (count) count.textContent = items.length ? `${items.length} ${filter ? 'Treffer' : 'Befehle'}` : '';
  if (!items.length) {
    list.append(el('div', { class: 'pal-empty', text: 'No matching commands' }));
    return;
  }
  let lastGrp = null;
  items.forEach((it, i) => {
    if (grouped && it.grp && it.grp !== lastGrp) {
      list.append(el('div', { class: 'pal-group', text: it.grp }));
      lastGrp = it.grp;
    }
    const row = el('div', {
      class: 'pal-item' + (i === paletteIdx ? ' selected' : ''),
      dataset: { idx: String(i) },
      onclick: () => pickPalette(i, items),
      onmousemove: () => { if (paletteIdx !== i) { paletteIdx = i; renderPalette(inputValue()); } },
    },
      el('span', { class: 'pal-ico', html: commandIcon(it) }),
      el('span', { class: 'pal-label', html: it._label || escape2(it.label) }),
      it.note ? el('span', { class: 'pal-note', text: it.note }) : null,
      it.key ? el('span', { class: 'pal-key', text: it.key }) : null,
    );
    list.append(row);
  });
  palettePick = items;
  const sel = list.querySelector('.pal-item[data-idx="' + paletteIdx + '"]');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function it2label(it, filter) {
  const sc = fuzzy(filter, it.label);
  return sc ? fuzzyHighlight(it.label, sc.idx) : escape2(it.label);
}

function escape2(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function inputValue() { return $('#palette-input').value; }

function pickPalette(i, items) {
  const it = (items || palettePick || [])[i];
  if (!it) return;
  closeModal(null);
  setTimeout(() => { try { it.run(); } catch (e) { toast(e.message, { type: 'err' }); } }, 30);
}

export function openCommandPalette() {
  runPalette(commands().map((c) => ({ ...c })), 'Befehl eingeben …');
}

/* --------------------------------------------------------- quick open */

let quickItems = [];
let quickIdx = 0;

export function openQuickOpen() {
  const files = state.files || [];
  quickItems = files.map((f) => ({ label: basename(f), path: f, note: dirname(f) || state.project || '', run: () => openFile(f) }));
  quickIdx = 0;
  const input = $('#quickopen-input');
  input.value = '';
  openModal('quickopen');
  renderQuick('');
  input.focus();
}

function renderQuick(filter) {
  const list = $('#quickopen-list');
  clear(list);
  let items = quickItems;
  if (filter) {
    items = quickItems
      .map((it) => ({ it, sc: fuzzy(filter, it.path) }))
      .filter((x) => x.sc)
      .sort((a, b) => b.sc.score - a.sc.score)
      .map((x) => ({ ...x.it, _label: quickLabel(x.it, x.sc.idx) }));
  }
  items = items.slice(0, 60);
  quickItems._rendered = items;
  quickIdx = Math.min(quickIdx, Math.max(0, items.length - 1));
  const count = $('#quickopen-count');
  if (count) count.textContent = items.length ? `${items.length} ${filter ? 'Treffer' : 'files'}` : '';
  if (!items.length) { list.append(el('div', { class: 'pal-empty', text: 'No files found' })); return; }
  items.forEach((it, i) => {
    list.append(el('div', {
      class: 'pal-item' + (i === quickIdx ? ' selected' : ''),
      dataset: { idx: String(i) },
      onclick: () => pickQuick(i, items),
      onmousemove: () => { quickIdx = i; renderQuick($('#quickopen-input').value); },
    },
      el('span', { class: 'pal-ico', html: fileIcon(it.label) }),
      el('span', { class: 'pal-label', html: it._label || escape2(it.label) }),
      it.note ? el('span', { class: 'pal-note', text: it.note }) : null,
    ));
  });
  quickItems._rendered = items;
}



function quickLabel(it, idx) {
  const off = it.note && it.path.startsWith(it.note + '/') ? it.note.length + 1 : 0;
  const local = (idx || []).map((i) => i - off).filter((i) => i >= 0 && i < it.label.length);
  return fuzzyHighlight(it.label, local);
}

function pickQuick(i, items) {
  const it = (items || quickItems._rendered || [])[i];
  if (!it) return;
  closeModal(null);
  setTimeout(() => it.run(), 20);
}

/* --------------------------------------------------------- Tastenkürzel */

const SHORTCUTS = [
  ['Editing & navigation', null],
  ['Save', 'Ctrl+S'],
  ['Save all', 'Ctrl+Shift+S'],
  ['Open file (quick open)', 'Ctrl+P'],
  ['Command palette', 'Ctrl+Shift+P / Ctrl+K'],
  ['Project search', 'Ctrl+Shift+F'],
  ['Outline', 'Ctrl+Shift+O'],
  ['Go to line', 'Ctrl+G'],
  ['Find / replace', 'Ctrl+F / Ctrl+H'],
  ['Multi-cursor selection', 'Ctrl+D / Alt+click'],
  ['Toggle comment', 'Ctrl+/'],
  ['Switch tab', 'Ctrl+Alt+←/→'],
  ['Close tab', 'Middle-click'],
  ['Build & preview', null],
  ['Build project', 'Ctrl+B / F5'],
  ['Auto build (settings)', 'AUTO-button'],
  ['Preview current line', 'Ctrl+Shift+G'],
  ['PDF position → source', 'Ctrl+click in PDF'],
  ['Console', 'Ctrl+J'],
  ['Toggle preview', 'Ctrl+\\'],
  ['PDF in new tab', 'button ↗'],
  ['Projects', null],
  ['Project menu (rename, duplicate, delete)', 'button ⋯'],
  ['New project / templates', 'button ＋'],
  ['Demo-Projects anlegen', 'button Demos'],
  ['Export project as ZIP', 'button Export'],
  ['Import project from ZIP', 'button Import'],
  ['Find and replace across project', 'Ctrl+Shift+F'],
  ['Insert', null],
  ['Autocomplete', 'Ctrl+Space'],
  ['Insert environment', 'Ctrl+E'],
  ['Autom. \\end bei } nach \\begin{…}', '}'],
  ['Indentation / snippet placeholders', 'Tab'],
  ['Show document snippets', 'Ctrl+Space at line start'],
  ['Other', null],
  ['Help / keyboard shortcuts', 'F1'],
  ['Change theme', 'button ◐'],
  ['Settings', 'button ⚙'],
];

export function showShortcuts() {
  const list = $('#shortcut-list');
  clear(list);
  for (const [desc, key] of SHORTCUTS) {
    if (key === null) { list.append(el('div', { class: 'sc-group', text: desc })); continue; }
    list.append(el('div', { class: 'sc' },
      el('span', { class: 'sc-desc', text: desc }),
      el('span', { html: key.split(' / ').map((k) => `<kbd>${k}</kbd>`).join(' ') }),
    ));
  }
  modal('shortcuts');
}

/* --------------------------------------------------------------- Init */

export function initPalette() {
  const input = $('#palette-input');
  input.addEventListener('input', () => { paletteIdx = 0; renderPalette(input.value); });
  input.addEventListener('keydown', (e) => {
    const n = (palettePick || []).length;
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIdx = Math.min(paletteIdx + 1, n - 1); renderPalette(input.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIdx = Math.max(paletteIdx - 1, 0); renderPalette(input.value); }
    else if (e.key === 'Enter') { e.preventDefault(); pickPalette(paletteIdx); }
    else if (e.key === 'Escape') { closeModal(null); }
  });

  const qinput = $('#quickopen-input');
  qinput.addEventListener('input', () => { quickIdx = 0; renderQuick(qinput.value); });
  qinput.addEventListener('keydown', (e) => {
    const items = quickItems._rendered || [];
    if (e.key === 'ArrowDown') { e.preventDefault(); quickIdx = Math.min(quickIdx + 1, items.length - 1); renderQuick(qinput.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); quickIdx = Math.max(quickIdx - 1, 0); renderQuick(qinput.value); }
    else if (e.key === 'Enter') { e.preventDefault(); pickQuick(quickIdx); }
    else if (e.key === 'Escape') { closeModal(null); }
  });

  on('cmd:palette', openCommandPalette);
  on('cmd:quickopen', openQuickOpen);
  on('cmd:shortcuts', showShortcuts);
}
