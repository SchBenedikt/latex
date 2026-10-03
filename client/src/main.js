/* LaTeX Studio – Bootstrapping, Layout, globale Kürzel */

import { $, $$, el, clear, modal, openModal, closeModal, toast, promptDialog, debounce, flash } from './util.js';
import { api } from './api.js';
import {
  state, loadPersisted, persist, setSettings, setProject, on, emit, DEFAULT_SETTINGS, loadScope, projectRelPath,
} from './state.js';
import {
  openFile, closeTab, saveActive, saveAll, currentPath, currentLine, anyDirty,
  renderTabs, setWelcomeVisible, focusEditor, reconfigureAllEditors, closeAllTabs,
} from './editor/index.js';
import { initTree, refreshTree } from './tree.js';
import { initOutline } from './outline.js';
import { initSearch } from './search.js';
import { initSymbolPanel } from './symbols.js';
import { initBuild, refreshMeta, buildProject } from './build.js';
import { loadPdf, forwardSync, setZoom } from './preview.js';
import { initPalette, applyTheme, openCommandPalette, openQuickOpen, showShortcuts } from './palette.js';
import { initSettings, applySettings, syncTopbar } from './settings.js';
import { initStatus } from './status.js';
import { initProjects, exportProject } from './projects.js';
import { applyEditorSettings } from './editor/index.js';
import { initPackages } from './packages.js';
import { initIcons, icon } from './icons.js';

loadPersisted();
initIcons();
let narrowWorkspace = window.innerWidth <= 560;
let previousWideView = 'split';

/* ------------------------------------------------------------- Design */

function applyCssVars() {
  const s = state.settings;
  document.documentElement.style.setProperty('--editor-size', s.fontSize + 'px');
  const savedSidebarWidth = s.sidebarWidth === 264 ? 232 : s.sidebarWidth;
  const sidebarLimit = window.innerWidth <= 900 ? Math.max(144, window.innerWidth * .23) : 700;
  const sw = Math.min(sidebarLimit, Math.max(144, savedSidebarWidth || 232));
  const bh = Math.min(Math.max(110, window.innerHeight - 220), Math.max(110, s.bottomHeight || 220));
  const savedPreviewWidth = s.previewWidth === 46 ? 42 : s.previewWidth;
  const pw = Math.min(80, Math.max(18, savedPreviewWidth || 42));
  document.documentElement.style.setProperty('--sidebar-w', sw + 'px');
  document.documentElement.style.setProperty('--bottom-h', bh + 'px');
  document.documentElement.style.setProperty('--preview-grow', String(pw / (100 - pw)));
  $('#btn-sidebar').setAttribute('aria-pressed', String(window.innerWidth <= 560
    ? $('#sidebar').classList.contains('mobile-open') : !$('#sidebar').classList.contains('collapsed')));
}

applyTheme();
applyCssVars();

/* ------------------------------------------------------- Applikationsstand */

async function boot() {
  try {
    const app = await api.state();
    state.app = app;
    window.__latexRoot = app.root;

    // Project-Dropdown
    const sel = $('#project-select');
    clear(sel);
    for (const p of app.projects) sel.append(el('option', { value: p, text: p }));
    if (!app.projects.length) {
      sel.append(el('option', { value: '', text: '(no projects)' }));
    }
    sel.addEventListener('change', () => { if (sel.value) switchProject(sel.value); });

    // Engines
    if (app.engines?.length) {
      const es = $('#engine-select');
      clear(es);
      for (const e of app.engines) es.append(el('option', { value: e.id, text: e.label }));
      es.value = state.settings.engine;
      es.addEventListener('change', () => setSettings({ engine: es.value }));
    }

    if (!app.tools?.latexmk) {
      toast('latexmk was not found — compilation is unavailable.', { type: 'err', ms: 12000 });
    }
  } catch (e) {
    toast('Server unavailable: ' + e.message, { type: 'err', ms: 15000 });
    return;
  }

  // Module initialisieren
  initBuild();
  initTree();
  initOutline();
  initSearch();
  initSymbolPanel();
  initPalette();
  initSettings();
  initStatus();
  initProjects();
  initPackages();
  wireUi();
  wireEvents();
  wireKeys();

  // Project wählen
  const projects = state.app.projects || [];
  const wanted = state.project && projects.includes(state.project) ? state.project : projects[0];
  if (wanted) {
    await switchProject(wanted, { restoreTabs: true });
  } else {
    setWelcomeVisible(true);
    setTimeout(() => emit('cmd:new-project'), 350);
  }
}

/* -------------------------------------------------------------- Projects */

async function switchProject(name, { restoreTabs = false } = {}) {
  const savedTabs = restoreTabs ? [...state.tabs] : [];
  const savedActive = state.active;
  setProject(name);
  // Projectspezifische Settings (.latexstudio.json) laden
  await loadScope(name);
  syncTopbar();
  $('#project-select').value = name;
  closeAllTabs();
  setWelcomeVisible(true);
  clear(state.issues);
  state.issues = [];
  state.meta = { labels: [], bib: [], cites: [], refs: [], outline: [], stats: {}, includes: [], main: state.settings.mainFile };
  emit('meta', state.meta);
  emit('build:idle');

  await refreshFiles();
  await refreshMeta();

  // Tabs wiederherstellen
  let opened = false;
  for (const t of savedTabs) {
    if ((state.files || []).includes(projectRelPath(t.path))) {
      await openFile(t.path, { focus: false });
      opened = true;
    }
  }
  if (savedActive && state.tabs.some((t) => t.path === savedActive)) {
    await openFile(savedActive, { focus: false });
  }

  if (!opened) {
    const main = state.settings.mainFile;
    const files = state.files || [];
    const fallback = files.find((f) => f === main)
      || files.find((f) => f.endsWith('.tex'))
      || files[0];
    if (fallback) await openFile(fallback, { focus: false });
  }

  // Vorhandenes PDF show
  if (state.pdf?.file) {
    loadPdf(api.pdfUrl(name, state.pdf.file));
  } else {
    emit('pdf:empty');
  }

  renderTabs();
  emit('tree:refresh');
}

async function refreshFiles() {
  if (!state.project) { state.files = []; return; }
  try {
    const res = await api.projectFiles(state.project, state.treeAll);
    state.files = res.files || [];
  } catch {
    state.files = [];
  }
}

/* ---------------------------------------------------------- UI-Verdrahtung */

function wireUi() {
  const syncSaveState = () => {
    const indicator = $('#header-save-state');
    const dirty = anyDirty();
    indicator.dataset.dirty = String(dirty);
    indicator.textContent = dirty ? 'Unsaved' : 'Saved';
    indicator.title = dirty ? 'There are unsaved changes' : 'All changes are saved';
  };
  for (const event of ['dirty', 'saved', 'file-saved', 'active-file', 'project']) on(event, syncSaveState);
  syncSaveState();
  on('build-status', ({ kind }) => {
    const busy = kind === 'busy';
    const button = $('#btn-build');
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.closest('.compile-control').classList.toggle('is-busy', busy);
    $('span', button).textContent = busy ? 'Building …' : 'Build';
  });
  /* Topbar */
  $('#btn-sidebar').addEventListener('click', toggleSidebar);
  on('cmd:goto-line', goLineDialog);
  $('#btn-command').addEventListener('click', openCommandPalette);
  for (const button of $$('[data-workspace-view]')) {
    button.addEventListener('click', () => setWorkspaceView(button.dataset.workspaceView));
  }
  if (narrowWorkspace) setWorkspaceView('source');
  for (const button of $$('.toolbar-menu-items button')) {
    button.addEventListener('click', () => {
      if (button.id !== 'btn-autobuild' && button.id !== 'pdf-sync-toggle') button.closest('details').open = false;
    });
  }
  for (const menu of $$('.toolbar-menu')) {
    menu.addEventListener('toggle', () => {
      const summary = $('summary', menu);
      summary.setAttribute('aria-expanded', String(menu.open));
      if (menu.open) for (const other of $$('.toolbar-menu')) if (other !== menu) other.open = false;
    });
  }
  document.addEventListener('click', (event) => {
    for (const menu of $$('.toolbar-menu')) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') for (const menu of $$('.toolbar-menu')) {
      if (menu.open) { menu.open = false; $('summary', menu).focus(); }
    }
  });
  $('#btn-save').addEventListener('click', () => saveActive(true));
  $('#btn-theme').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setSettings({ theme });
    applyTheme();
  });
  $('#btn-help').addEventListener('click', showShortcuts);
  $('#btn-preview').addEventListener('click', togglePreview);
  $('#btn-new-project').addEventListener('click', () => emit('cmd:new-project'));
  $('#btn-export').addEventListener('click', exportProject);

  /* Rail: Panel wählen; ernewter Klick klappt die Seitenleiste ein */
  for (const btn of $$('.rail-btn')) {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (panel === 'shortcuts') { showShortcuts(); return; }
      const sidebar = $('#sidebar');
      const wasActive = btn.classList.contains('active');
      const quick = wasActive && btn._lastClick && (Date.now() - btn._lastClick) < 500;
      btn._lastClick = Date.now();
      for (const b of $$('.rail-btn')) b.classList.toggle('active', b === btn);
      for (const p of $$('.panel')) p.classList.toggle('active', p.dataset.panel === panel);
      sidebar.classList.remove('collapsed');
      if (quick) sidebar.classList.add('collapsed');
      $('#btn-sidebar').setAttribute('aria-pressed', String(!sidebar.classList.contains('collapsed')));
      window.dispatchEvent(new Event('resize'));
      if (panel === 'search') setTimeout(() => $('#search-input').focus(), 60);
      if (panel === 'symbols') setTimeout(() => $('#symbol-filter').focus(), 60);
    });
  }

  /* Welcome-Aktionen */
  for (const b of $$('#welcome [data-action]')) {
    b.addEventListener('click', () => {
      const a = b.dataset.action;
      if (a === 'new-project') emit('cmd:new-project');
      if (a === 'demos') emit('cmd:project-demos');
      if (a === 'build') buildProject();
      if (a === 'palette') openCommandPalette();
      if (a === 'shortcuts') showShortcuts();
    });
  }

  /* Splitter */
  setupSplitter($('#sidebar-splitter'), 'x', (dx, start) => {
    const w = Math.max(144, Math.min(700, $('#main').clientWidth * .4, start + dx));
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    return w;
  }, (w) => setSettings({ sidebarWidth: w }));

  setupSplitter($('#main-splitter'), 'x', (dx, start) => {
    const total = documentAreaWidth();
    const pct = Math.max(18, Math.min(80, ((start * total / 100) - dx) / total * 100));
    document.documentElement.style.setProperty('--preview-grow', String(pct / (100 - pct)));
    window.dispatchEvent(new Event('resize'));
    return pct;
  }, (pct) => setSettings({ previewWidth: pct }));

  setupSplitter($('#bottom-splitter'), 'y', (dy, start) => {
    const h = Math.max(110, Math.min(window.innerHeight - 220, start - dy));
    document.documentElement.style.setProperty('--bottom-h', h + 'px');
    return h;
  }, (h) => setSettings({ bottomHeight: h }));

  /* PDF-Toolbar */
  $('#pdf-first').addEventListener('click', () => import('./preview.js').then((m) => m.firstPage()));
  $('#pdf-prev').addEventListener('click', () => import('./preview.js').then((m) => m.stepPage(-1)));
  $('#pdf-next').addEventListener('click', () => import('./preview.js').then((m) => m.stepPage(1)));
  $('#pdf-last').addEventListener('click', () => import('./preview.js').then((m) => m.lastPage()));
  $('#pdf-page').addEventListener('change', (e) => import('./preview.js').then((m) => m.gotoPage(e.target.value)));
  $('#pdf-zoom').addEventListener('change', (e) => setZoom(e.target.value));
  $('#pdf-zoom-in').addEventListener('click', () => import('./preview.js').then((m) => m.zoomBy(1.25)));
  $('#pdf-zoom-out').addEventListener('click', () => import('./preview.js').then((m) => m.zoomBy(0.8)));
  $('#pdf-sync-toggle').addEventListener('click', () => {
    const order = { on: 'always', always: 'off', off: 'on' };
    const next = order[state.settings.syncMode] || 'on';
    setSettings({ syncMode: next });
    updateSyncControl();
    toast('SyncTeX click: ' + (next === 'off' ? 'off' : next === 'always' ? 'always' : 'Ctrl+click'), { type: 'ok', ms: 1600 });
  });
  $('#pdf-open').addEventListener('click', () => import('./preview.js').then((m) => m.openPdfInTab()));
  $('#pdf-download').addEventListener('click', () => import('./preview.js').then((m) => m.downloadPdf()));

  /* PDF-Suche */
  const openSearch = () => {
    $('#pdf-searchbar').hidden = false;
    $('#pdf-search-input').focus();
    $('#pdf-search-input').select();
  };
  $('#pdf-search-btn').addEventListener('click', openSearch);
  $('#pdf-search-close').addEventListener('click', async () => {
    $('#pdf-searchbar').hidden = true;
    const m = await import('./preview.js');
    m.clearSearch();
  });
  const doSearch = async () => {
    const m = await import('./preview.js');
    await m.searchInPdf($('#pdf-search-input').value);
  };
  $('#pdf-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    if (e.key === 'Escape') { $('#pdf-searchbar').hidden = true; }
  });
  $('#pdf-search-input').addEventListener('input', debounce(doSearch, 350));
  $('#pdf-search-next').addEventListener('click', async () => (await import('./preview.js')).nextSearchHit(1));
  $('#pdf-search-prev').addEventListener('click', async () => (await import('./preview.js')).nextSearchHit(-1));

  /* Sync-Toggle-Initialzustand */
  updateSyncControl();
  on('settings', updateSyncControl);
}

function updateSyncControl() {
  const button = $('#pdf-sync-toggle');
  const mode = state.settings.syncMode;
  button.classList.toggle('toggle', mode !== 'off');
  button.setAttribute('aria-pressed', String(mode !== 'off'));
  button.dataset.mode = mode === 'off' ? 'Aus' : mode === 'always' ? 'Immer' : 'Ctrl+Klick';
  button.innerHTML = icon('sync') + '<span>SyncTeX</span>';
}

function setupSplitter(node, axis, onDrag, onDone) {
  if (!node) return;
  node.addEventListener('mousedown', (e) => {
    e.preventDefault();
    node.classList.add('dragging');
    const startPos = axis === 'x' ? e.clientX : e.clientY;
    const parent = axis === 'x' ? node.parentElement : node.parentElement;
    const start = axis === 'x'
      ? (node.id === 'main-splitter' ? $('#preview-pane').getBoundingClientRect().width / documentAreaWidth() * 100 : $('#sidebar').getBoundingClientRect().width)
      : $('#bottom-panel').getBoundingClientRect().height;
    void parent;
    const move = (ev) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - startPos;
      onDrag.__last = onDrag(delta, start);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      node.classList.remove('dragging');
      if (onDrag.__last != null && onDone) onDone(onDrag.__last);
      window.dispatchEvent(new Event('resize'));
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function documentAreaWidth() {
  const sidebar = $('#sidebar');
  const sidebarWidth = getComputedStyle(sidebar).position === 'absolute' ? 0 : sidebar.getBoundingClientRect().width;
  return Math.max(1, $('#main').clientWidth - sidebarWidth - $('#main-splitter').getBoundingClientRect().width);
}

function toggleSidebar() {
  const visible = window.innerWidth <= 560
    ? $('#sidebar').classList.toggle('mobile-open') : !$('#sidebar').classList.toggle('collapsed');
  if (window.innerWidth <= 560) $('#sidebar').classList.remove('collapsed');
  $('#btn-sidebar').setAttribute('aria-pressed', String(visible));
  window.dispatchEvent(new Event('resize'));
}

function setWorkspaceView(view) {
  if (!['source', 'split', 'preview'].includes(view)) return;
  $('#main').dataset.view = view;
  const pane = $('#preview-pane');
  pane.classList.toggle('collapsed', view === 'source');
  $('#btn-preview').classList.toggle('toggle', view !== 'source');
  for (const button of $$('[data-workspace-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.workspaceView === view));
  }
  window.dispatchEvent(new Event('resize'));
}

function togglePreview() {
  setWorkspaceView($('#main').dataset.view === 'source' ? 'split' : 'source');
}

/* ------------------------------------------------------------ Events */

function wireEvents() {
  on('cmd:toggle-preview', togglePreview);
  on('cmd:toggle-sidebar', toggleSidebar);
  on('active-file', () => {
    if (window.innerWidth <= 560) {
      $('#sidebar').classList.remove('mobile-open');
      $('#btn-sidebar').setAttribute('aria-pressed', 'false');
    }
  });
  on('cmd:new-project', newProjectDialog);

  on('project:switch', (name) => {
    if (name && name !== state.project) switchProject(name);
    else if (name) $('#project-select').value = name;
  });
  on('project:none', () => {
    setWelcomeVisible(true);
    emit('pdf:empty');
    $('#project-select').value = '';
  });
  on('settings', syncTopbar);
  on('scope:changed', () => { syncTopbar(); emit('meta:refresh'); });

  on('cmd:sync-preview', () => {
    if (!currentPath()) return;
    forwardSync(currentLine().line, currentPath());
  });
  on('cmd:sync-here', () => {
    if (!currentPath()) return;
    forwardSync(currentLine().line, currentPath());
  });

  on('pdf:refresh', (pdf) => {
    if (pdf?.file) loadPdf(api.pdfUrl(state.project, pdf.file), { keepScroll: true });
  });
  on('pdf:empty', () => {
    document.getElementById('pdf-pages').innerHTML = '';
    document.getElementById('pdf-empty').classList.remove('hidden');
    document.getElementById('pdf-pagecount').textContent = '/ –';
    document.getElementById('pdf-pagechip')?.classList.add('hidden');
  });

  on('meta:refresh', () => refreshMeta());
  on('tree:refresh', () => { refreshFiles(); });
  on('settings:set', (patch) => applySettings(patch));

  window.addEventListener('beforeunload', (e) => {
    if (anyDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  window.addEventListener('resize', debounce(() => {
    if (!document.querySelector('.dragging')) applyCssVars();
    const narrow = window.innerWidth <= 560;
    if (narrow !== narrowWorkspace) {
      narrowWorkspace = narrow;
      if (narrow) {
        previousWideView = $('#main').dataset.view;
        setWorkspaceView('source');
      } else {
        $('#sidebar').classList.remove('mobile-open');
        setWorkspaceView(previousWideView);
      }
    }
    // Passt sich die Seitenleiste an, muss die Breiten-Fit-Option new rechnen
    window.dispatchEvent(new Event('latex:resize'));
  }, 120));
}

/* ------------------------------------------------------ Neue Projects */

async function newProjectDialog() {
  let templates = [];
  try {
    const res = await api.templates();
    templates = res.templates || [];
  } catch { /* */ }

  const grid = $('#np-templates');
  clear(grid);
  let chosen = templates[0]?.name || 'article';
  for (const t of templates) {
    const card = el('div', {
      class: 'tpl' + (t.name === chosen ? ' active' : ''),
      role: 'radio', tabindex: t.name === chosen ? 0 : -1, 'aria-checked': String(t.name === chosen),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          const cards = $$('.tpl', grid);
          const direction = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
          const next = cards[(cards.indexOf(card) + direction + cards.length) % cards.length];
          next.click(); next.focus();
        }
      },
      onclick: () => {
        chosen = t.name;
        for (const c of $$('.tpl', grid)) {
          c.classList.toggle('active', c === card);
          c.setAttribute('aria-checked', String(c === card));
          c.tabIndex = c === card ? 0 : -1;
        }
      },
    },
      el('b', { text: t.title || t.name }),
      el('span', { text: t.description || '' }),
    );
    grid.append(card);
  }

  $('#np-name').value = '';
  openModal('new-project');
  $('#np-name').focus();

  const create = async () => {
    const name = $('#np-name').value.trim();
    if (!name) { toast('Enter a project name', { type: 'warn' }); return; }
    try {
      await api.createProject(name, chosen);
      closeModal(null);
      const sel = $('#project-select');
      if (!sel.querySelector(`option[value="${CSS.escape(name)}"]`)) {
        sel.append(el('option', { value: name, text: name }));
      }
      toast('Project created: ' + name, { type: 'ok' });
      await switchProject(name);
      const main = state.settings.mainFile;
      if (!(state.files || []).includes(main)) {
        const tex = (state.files || []).find((f) => f.endsWith('.tex'));
        if (tex) { setSettings({ mainFile: tex }); await refreshMeta(); await openFile(tex); }
      }
      setTimeout(() => buildProject(), 400);
    } catch (e) {
      toast('Could not create project: ' + e.message, { type: 'err', ms: 6000 });
    }
  };
  $('#np-create').onclick = create;
  $('#np-name').onkeydown = (e) => { if (e.key === 'Enter') create(); };
}

/* ------------------------------------------------------------ Tasten */

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (!$('#modal-root').classList.contains('hidden')) { closeModal(null); return; }
    }
    if (!$('#modal-root').classList.contains('hidden')) return;
    if (!mod) return;

    const k = e.key.toLowerCase();
    if (k === 's' && e.shiftKey) { e.preventDefault(); saveAll(); return; }
    if (k === 's' && !e.shiftKey) { e.preventDefault(); saveActive(true); return; }
    if (k === 'p' && !e.shiftKey) { e.preventDefault(); emit('cmd:quickopen'); return; }
    if ((k === 'p' && e.shiftKey) || k === 'k') { e.preventDefault(); openCommandPalette(); return; }
    if (k === 'f' && e.shiftKey) { e.preventDefault(); $('#search-input').focus(); import('./search.js').then((m) => m.activatePanel('search')); return; }
    if (k === 'o' && e.shiftKey) { e.preventDefault(); import('./search.js').then((m) => m.activatePanel('outline')); return; }
    if (k === 'b' && e.shiftKey) { e.preventDefault(); emit('cmd:toggle-sidebar'); return; }
    if (k === 'j') { e.preventDefault(); import('./build.js').then((m) => m.toggleBottom()); return; }
    if (k === 'g' && !e.shiftKey) { e.preventDefault(); goLineDialog(); return; }
    if (k === 'g' && e.shiftKey) { e.preventDefault(); emit('cmd:sync-preview'); return; }
    if (k === 'l' && e.shiftKey) { e.preventDefault(); emit('cmd:sync-here'); return; }
    if (e.key === 'F4') { e.preventDefault(); if (currentPath()) closeTab(currentPath()); return; }
    if (e.key === 'Tab' && e.altKey) {
      e.preventDefault();
      const tabs = state.tabs;
      if (!tabs.length) return;
      const i = tabs.findIndex((t) => t.path === currentPath());
      const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
      openFile(next.path);
      return;
    }
    if (e.key === '\\') { e.preventDefault(); emit('cmd:toggle-preview'); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom('1.25'); return; }
    if (e.key === '-') { e.preventDefault(); setZoom('0.75'); return; }
    if (e.key === '0') { e.preventDefault(); setZoom('fit-width'); return; }
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'F1') { e.preventDefault(); showShortcuts(); }
    if (e.key === 'F5') { e.preventDefault(); buildProject(); }
    if (e.key === 'F2' && currentPath()) {
      e.preventDefault();
      import('./tree.js').then(async ({ }) => {
        const { promptDialog: p } = await import('./util.js');
        // Rename über Kontextmenü des Baumes – hier nur Hinweis
        toast('To rename, right-click in the file tree', { type: 'ok', ms: 2200 });
        void p;
      });
    }
  });
}

function goLineDialog() {
  promptDialog('Go to line', 'Line number', String(currentLine().line)).then((v) => {
    if (v && /^\d+$/.test(v.trim())) {
      import('./editor/index.js').then((m) => m.gotoLine(parseInt(v.trim(), 10)));
    }
  });
}

/* --------------------------------------------------------------- Start */

boot().catch((e) => {
  console.error(e);
  toast('Startup error: ' + e.message, { type: 'err', ms: 15000 });
});
