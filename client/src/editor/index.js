/* Editor-Verwaltung: Tabs, Dokumente, Save, Sprünge, Snippets */

import {
  EditorState, StateField, StateEffect, Compartment, EditorSelection,
} from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor,
  highlightActiveLine, Decoration,
} from '@codemirror/view';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';

import { latexLanguage, latexHighlighting, latexIndent, latexFolding } from './language.js';
import { latexCompletion, inMath } from './completion.js';
import { envCloseHandler } from './keys.js';
import { api } from '../api.js';
import { state, docOf, addTab, removeTab, setActive, tabPath, persist, emit, projPath, projectRelPath } from '../state.js';
import { el, clear, basename, debounce, toast, confirmDialog, contextMenu } from '../util.js';
import { icon, fileIcon } from '../icons.js';

/* --------------------------------------------------- Sync-Zeilen-Markierung */

const setSyncLine = StateEffect.define();

const syncLineField = StateField.define({
  create: () => null,
  update(pos, tr) {
    let p = pos;
    for (const e of tr.effects) if (e.is(setSyncLine)) p = e.value;
    if (p != null && tr.docChanged) {
      try { p = tr.changes.mapPos(p); } catch { p = null; }
    }
    if (p != null) p = tr.newDoc.lineAt(Math.min(p, tr.newDoc.length)).from;
    return p;
  },
  provide: (f) => EditorView.decorations.from(f, (pos) => {
    if (pos == null) return Decoration.none;
    return Decoration.set([Decoration.line({ class: 'cm-syncLine' }).range(pos)]);
  }),
});

/* --------------------------------------------------------------- Module */

const wrapComp = new Compartment();
const indentComp = new Compartment();
const tabComp = new Compartment();
const phComp = new Compartment();

const host = document.getElementById('editor-host');
export const editorView = new EditorView({ parent: host });

const docStates = new Map();   // path -> EditorState
let activePath = null;

function baseExtensions() {
  const s = state.settings;
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter({ openText: '⌄', closedText: '›' }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      override: [latexCompletion],
      activateOnTyping: true,
      icons: true,
      maxRenderedOptions: 60,
      defaultKeymap: true,
    }),
    highlightActiveLine(),
    highlightSelectionMatches({ highlightWordAroundCursor: true, minSelectionLength: 2 }),
    rectangularSelection(),
    crosshairCursor(),
    search({ top: true }),
    latexLanguage,
    latexHighlighting,
    latexIndent(s.tabSize),
    latexFolding(),
    envCloseHandler(() => state.settings.tabSize),
    syncLineField,
    phComp.of([]),
    wrapComp.of(s.wrap === 'on' ? EditorState.lineWrapping : []),
    indentComp.of(indentUnit.of(' '.repeat(s.tabSize))),
    tabComp.of(EditorState.tabSize.of(s.tabSize)),
    keymap.of([
      { key: 'Mod-g', preventDefault: true, run: () => { emit('cmd:goto-line'); return true; } },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...defaultKeymap,
      indentWithTab,
      { key: 'Mod-s', preventDefault: true, run: () => { saveActive(true); return true; } },
      { key: 'Mod-b', preventDefault: true, run: () => { emit('cmd:build'); return true; } },
      { key: 'F5', preventDefault: true, run: () => { emit('cmd:build'); return true; } },
      { key: 'Mod-e', preventDefault: true, run: () => { emit('cmd:environment'); return true; } },
      { key: 'Mod-Shift-g', preventDefault: true, run: () => { emit('cmd:sync-preview'); return true; } },
      { key: 'Mod-Shift-l', preventDefault: true, run: () => { emit('cmd:sync-here'); return true; } },
      { key: 'Mod-p', preventDefault: true, run: () => { emit('cmd:quickopen'); return true; } },
      { key: 'Mod-Shift-p', preventDefault: true, run: () => { emit('cmd:palette'); return true; } },
      { key: 'F1', preventDefault: true, run: () => { emit('cmd:shortcuts'); return true; } },
      { key: 'Mod-j', preventDefault: true, run: () => { emit('cmd:console'); return true; } },
      { key: 'Mod-Shift-f', preventDefault: true, run: () => { emit('cmd:search'); return true; } },
      { key: 'Mod-Shift-o', preventDefault: true, run: () => { emit('cmd:outline'); return true; } },
      { key: 'Mod-k', preventDefault: true, run: () => { emit('cmd:palette'); return true; } },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && activePath) {
        docStates.set(activePath, update.state);
        const doc = docOf(activePath);
        doc.content = update.state.doc.toString();
        doc.saved = false;
        renderTabs();
        emit('dirty', activePath);
        scheduleSave();
      }
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        state.cursor = { line: line.number, col: head - line.from + 1 };
        emit('cursor', state.cursor);
      }
    }),
  ];
}

/* ------------------------------------------------------------ Save */

const scheduleSave = debounce(() => saveAll(), 700);
const pendingSaves = new Map();

function saveDocument(path, manual = false) {
  const pending = (pendingSaves.get(path) || Promise.resolve()).then(async () => {
    const doc = state.docs.get(path);
    if (!doc || (doc.saved && !manual)) return true;
    const content = doc.content;
    try {
      await api.saveFile(path, content);
      // Edits made during a request still need another save.
      doc.saved = doc.content === content;
      renderTabs();
      if (doc.saved) emit('saved', path);
      emit('file-saved', path);
      if (manual && doc.saved) toast('Saved: ' + basename(path), { type: 'ok', ms: 1500 });
      return doc.saved;
    } catch (e) {
      toast('Save failed: ' + e.message, { type: 'err', ms: 5000 });
      return false;
    }
  });
  pendingSaves.set(path, pending);
  pending.finally(() => { if (pendingSaves.get(path) === pending) pendingSaves.delete(path); });
  return pending;
}

export function saveActive(manual = false) {
  return activePath ? saveDocument(activePath, manual) : Promise.resolve(true);
}

export async function saveAll() {
  let saved = true;
  let changed = false;
  for (const t of state.tabs) {
    const doc = state.docs.get(t.path);
    if (doc && !doc.saved) {
      changed = true;
      if (!await saveDocument(t.path)) saved = false;
    }
  }
  renderTabs();
  if (changed) emit('saved', null);
  return saved;
}

export function anyDirty() {
  return [...state.docs.values()].some((d) => !d.saved);
}

/** Lädt eine File new vom Server (z. B. nach projektweiter Ersetzung) */
export async function reloadFile(path) {
  path = projPath(path);
  const doc = state.docs.get(path);
  if (doc && !doc.saved) return false;
  let res;
  try { res = await api.file(path); } catch { return false; }
  const d = docOf(path);
  d.content = res.content;
  d.saved = true;
  d.mtime = res.mtime;
  const old = docStates.get(path);
  const head = old ? Math.min(old.selection.main.head, res.content.length) : 0;
  const next = EditorState.create({
    doc: res.content,
    extensions: baseExtensions(),
    selection: EditorSelection.cursor(head),
  });
  docStates.set(path, next);
  if (activePath === path) editorView.setState(next);
  renderTabs();
  emit('file-saved', path);
  return true;
}

/* ------------------------------------------------------------ Open */

export async function openFile(path, { line = null, col = null, focus = true } = {}) {
  if (!path) return;
  path = projPath(path);
  if (!tabPath(path)) addTab(path, basename(path));

  let viewState = docStates.get(path);
  if (!viewState) {
    let content = '';
    try {
      const res = await api.file(path);
      content = res.content;
      const doc = docOf(path);
      doc.content = content;
      doc.saved = true;
      doc.mtime = res.mtime;
    } catch (e) {
      toast('Could not read file: ' + e.message, { type: 'err' });
      return;
    }
    viewState = EditorState.create({ doc: content, extensions: baseExtensions() });
    docStates.set(path, viewState);
  } else {
    const doc = docOf(path);
    if (doc.content !== viewState.doc.toString() && !doc.saved) {
      // interne Diskrepanz – Zustand gewinnt
      doc.content = viewState.doc.toString();
    }
  }

  activePath = path;
  setActive(path);
  editorView.setState(viewState);
  renderTabs();
  setWelcomeVisible(false);
  emit('active-file', path);

  if (line != null) gotoLine(line, col);
  if (focus) editorView.focus();
}

export async function closeTab(path, force = false) {
  const doc = state.docs.get(path);
  if (!force && doc && !doc.saved) {
    const ok = await confirmDialog(
      'Unsaved changes',
      `${basename(path)} has unsaved changes. Close it anyway?`,
      'Close',
    );
    if (!ok) return;
  }
  doClose(path);
}

function doClose(path) {
  const wasActive = activePath === path;
  const idx = state.tabs.findIndex((t) => t.path === path);
  const nextPath = state.tabs[idx + 1]?.path || state.tabs[idx - 1]?.path || null;
  removeTab(path);
  docStates.delete(path);
  if (wasActive) {
    activePath = null;
    if (nextPath) { openFile(nextPath); return; }
    editorView.setState(EditorState.create({ doc: '', extensions: baseExtensions() }));
    setWelcomeVisible(true);
    emit('active-file', null);
  }
  renderTabs();
  emit('tabs', state.tabs);
}

/* ------------------------------------------------------------- Sprünge */

export function gotoLine(line, col = 1, flashMs = 1800) {
  const doc = editorView.state.doc;
  const n = Math.max(1, Math.min(Number(line) || 1, doc.lines));
  const l = doc.line(n);
  const pos = Math.min(l.from + Math.max(0, (col || 1) - 1), l.to);
  editorView.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: [
      EditorView.scrollIntoView(pos, { y: 'center' }),
      setSyncLine.of(l.from),
    ],
    scrollIntoView: true,
  });
  editorView.focus();
  if (flashMs > 0) {
    setTimeout(() => {
      try { editorView.dispatch({ effects: setSyncLine.of(null) }); } catch { /* */ }
    }, flashMs);
  }
}

export function currentText() { return editorView.state.doc.toString(); }
export function currentPath() { return activePath; }
export function currentSelection() {
  const { from, to } = editorView.state.selection.main;
  return editorView.state.sliceDoc(from, to);
}
export function currentLine() {
  const head = editorView.state.selection.main.head;
  const l = editorView.state.doc.lineAt(head);
  return { line: l.number, col: head - l.from + 1 };
}
export function isMathCursor() { return inMath(editorView.state.doc, editorView.state.selection.main.head); }
export function focusEditor() { editorView.focus(); }

export function insertText(text, cursorOffset = null) {
  const { from, to } = editorView.state.selection.main;
  editorView.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + (cursorOffset == null ? text.length : cursorOffset) },
    scrollIntoView: true,
  });
  editorView.focus();
}

/** Insert generated text at an absolute document offset without moving the caret. */
export function insertTextAt(text, position) {
  const doc = editorView.state.doc;
  const offset = Math.max(0, Math.min(Number(position) || 0, doc.length));
  editorView.dispatch({ changes: { from: offset, to: offset, insert: text }, scrollIntoView: false });
}

/* ------------------------------------------------------------ Snippets */

function findClosingBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

export function expandSnippet(snippet) {
  const unit = ' '.repeat(state.settings.tabSize);
  const text = snippet.replace(/\t/g, unit);
  let out = '';
  const ranges = new Map();
  let cursor = null;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '$' && text[i + 1] === '{') {
      const end = findClosingBrace(text, i + 1);
      if (end > i) {
        const inner = text.slice(i + 2, end);
        const m = inner.match(/^(\d+)(?::([\s\S]*))?$/);
        if (m) {
          const id = m[1];
          const def = m[2] ?? '';
          const start = out.length;
          out += def;
          if (id === '0') { if (cursor == null) cursor = start; }
          else if (!ranges.has(id)) ranges.set(id, [start, out.length]);
          i = end + 1;
          continue;
        }
      }
    }
    if (text[i] === '$' && /\d/.test(text[i + 1] || '')) {
      let j = i + 1, num = '';
      while (j < text.length && /\d/.test(text[j])) num += text[j++];
      if (num === '0') { if (cursor == null) cursor = out.length; }
      else if (!ranges.has(num)) ranges.set(num, [out.length, out.length]);
      i = j;
      continue;
    }
    out += text[i++];
  }
  if (cursor == null) cursor = out.length;
  return { text: out, cursor, ranges: [...ranges.values()] };
}

export function insertSnippet(snippet) {
  const sel = editorView.state.selection.main;
  const { text, cursor } = expandSnippet(snippet);
  editorView.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + Math.min(cursor, text.length) },
    scrollIntoView: true,
  });
  editorView.focus();
}

/* ------------------------------------------------------------- Tabs UI */

export function renderTabs() {
  const bar = document.getElementById('tabbar');
  clear(bar);
  for (const t of state.tabs) {
    const doc = state.docs.get(t.path);
    const isActive = t.path === activePath;
    const dirty = doc && !doc.saved;
    const tab = el('div', {
      class: 'tab' + (isActive ? ' active' : ''),
      role: 'tab', 'aria-selected': String(isActive), tabindex: isActive ? 0 : -1,
      title: t.path + (dirty ? ' (ungespeichert)' : ''),
      onkeydown: (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(t.path); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const index = state.tabs.findIndex((item) => item.path === t.path);
          const next = state.tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length];
          openFile(next.path);
        }
      },
      onclick: () => openFile(t.path),
      onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.path); } },
      oncontextmenu: (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Save', icon: '💾', action: () => { if (activePath === t.path) saveActive(true); else toast('Save Sie den aktiven Tab', { type: 'warn' }); } },
          { label: 'Close', icon: '✕', action: () => closeTab(t.path) },
          { label: 'Close all others', icon: '✕', action: () => { for (const o of [...state.tabs]) if (o.path !== t.path) closeTab(o.path, true); } },
          '-',
          { label: 'Pfad kopieren', icon: '⧉', action: () => navigator.clipboard.writeText(t.path).then(() => toast('Path copied', { type: 'ok', ms: 1200 })) },
        ]);
      },
    },
      el('span', { class: 'ticon', html: fileIcon(t.name) }),
      el('span', { class: 'tname', text: t.name }),
      dirty ? el('span', { class: 'tdirty', title: 'Unsaved' }) : null,
      el('button', {
        class: 'tclose', html: icon('close'), title: 'Close', 'aria-label': t.name + ' schließen',
        onclick: (e) => { e.stopPropagation(); closeTab(t.path); },
      }),
    );
    bar.append(tab);
  }
  bar.append(el('button', {
    class: 'tab-add', title: 'Open file (Ctrl+P)',
    onclick: () => emit('cmd:quickopen'),
  }, '+'));
  renderBreadcrumb();
}

function showFilesPanel() {
  const btn = document.querySelector('.rail-btn[data-panel="files"]');
  if (btn && !btn.classList.contains('active')) btn.click();
}

/* --------------------------------------------------------- Breadcrumb */

function renderBreadcrumb() {
  const bar = document.getElementById('breadcrumb');
  if (!bar) return;
  clear(bar);
  if (!activePath) { bar.classList.add('hidden'); return; }
  const rel = projectRelPath(activePath);
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  const mk = (text, cls, title, onclick) => el('span', {
    class: 'bc-seg' + (cls ? ' ' + cls : ''), text, title: title || text, onclick,
  });
  const sep = () => el('span', { class: 'bc-sep', text: '/' });

  bar.append(mk(state.project || '', 'bc-root', 'Reveal project in file tree', () => {
    showFilesPanel();
    import('../tree.js').then((m) => m.revealPath(''));
  }));

  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const ws = [state.project, ...parts.slice(0, i + 1)].join('/');
    bar.append(sep());
    bar.append(mk(
      parts[i],
      isLast ? 'bc-current' : 'bc-dir',
      isLast ? ws : `Im Baum show: ${ws}`,
      isLast ? null : () => {
        showFilesPanel();
        import('../tree.js').then((m) => m.revealPath(ws));
      },
    ));
  }
}

/* -------------------------------------------------------- Einstellungen */

export function applyEditorSettings(patch = {}) {
  const s = state.settings;
  const effects = [];
  if ('wrap' in patch) {
    effects.push(wrapComp.reconfigure(s.wrap === 'on' ? EditorState.lineWrapping : []));
  }
  if ('tabSize' in patch) {
    effects.push(indentComp.reconfigure(indentUnit.of(' '.repeat(s.tabSize))));
    effects.push(tabComp.reconfigure(EditorState.tabSize.of(s.tabSize)));
  }
  if (effects.length) {
    try { editorView.dispatch({ effects }); } catch (e) { console.warn(e); }
  }
  document.getElementById('st-indent').textContent = `${s.tabSize} Leerzeichen`;
}

export function reconfigureAllEditors() {
  const ext = baseExtensions();
  const active = activePath;
  const saved = new Map();
  for (const [path, st] of docStates) saved.set(path, { doc: st.doc.toString(), sel: st.selection.main.from });
  for (const path of saved.keys()) docStates.delete(path);
  for (const [path, info] of saved) {
    const ns = EditorState.create({
      doc: info.doc,
      extensions: ext,
      selection: EditorSelection.cursor(Math.min(info.sel, info.doc.length)),
    });
    docStates.set(path, ns);
    if (path === active) editorView.setState(ns);
  }
  if (!docStates.size) editorView.setState(EditorState.create({ doc: '', extensions: ext }));
}

export function setWelcomeVisible(v) {
  document.getElementById('welcome').classList.toggle('hidden', !v);
}

export function closeAllTabs() {
  docStates.clear();
  state.tabs.length = 0;
  state.docs.clear();
  activePath = null;
  editorView.setState(EditorState.create({ doc: '', extensions: baseExtensions() }));
  renderTabs();
  setWelcomeVisible(true);
  persist();
}

export { docStates };
