/* Zentraler Anwendungszustand + Persistenz in localStorage */

import { api } from './api.js';

const STORAGE_KEY = 'latex-studio-v1';
const SCOPE_KEY = 'latex-studio-scopes-v1';

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  fontSize: 14,
  tabSize: 2,
  wrap: 'off',
  autoBuild: 'on',
  autoBuildDelay: 900,
  engine: 'pdflatex',
  mainFile: 'main.tex',
  shellEscape: 'off',
  showAll: 'off',
  pdfZoom: 'fit-width',
  syncMode: 'on',       // on | always | off
  sidebarWidth: 232,
  bottomHeight: 220,
  previewWidth: 42,      // Prozent
};

/** Settings, die pro Project in .latexstudio.json gespeichert werden */
export const PROJECT_KEYS = ['mainFile', 'engine', 'shellEscape'];

export const state = {
  app: { projects: [], engines: [], tools: {}, version: '' },
  project: null,
  settings: { ...DEFAULT_SETTINGS },
  scopes: {},            // Project -> { mainFile, engine, ... }
  tabs: [],              // [{ path, name }]
  active: null,          // aktiver Tab-Pfad
  docs: new Map(),       // path -> { content, saved (bool), mtime }
  meta: { labels: [], bib: [], cites: [], refs: [], outline: [], stats: {}, includes: [], main: 'main.tex' },
  issues: [],
  build: { status: 'idle', engine: null, duration: null, stats: null },
  pdf: null,             // { file, mtime, size }
  treeAll: false,
  cursor: { line: 1, col: 1 },
};

/* -------------------------------------------------------------- Events */

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, data) {
  for (const fn of listeners.get(event) || []) {
    try { fn(data); } catch (e) { console.error(`[state:${event}]`, e); }
  }
}

/* ------------------------------------------------------------ Persistenz */

export function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.settings) state.settings = { ...DEFAULT_SETTINGS, ...p.settings };
      if (p.project) state.project = p.project;
      if (Array.isArray(p.tabs)) state.tabs = p.tabs.filter((t) => t && t.path);
      if (p.active) state.active = p.active;
    }
  } catch (e) {
    console.warn('Konnte Settings nicht laden', e);
  }
  try {
    const s = JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}');
    if (s && typeof s === 'object') state.scopes = s;
  } catch { /* */ }
  applyScope(state.project);
}

let saveTimer = null;
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings: state.settings,
        project: state.project,
        tabs: state.tabs,
        active: state.active,
      }));
    } catch (e) { console.warn('Persistenz fehlgeschlagen', e); }
  }, 250);
}

function persistScopes() {
  try { localStorage.setItem(SCOPE_KEY, JSON.stringify(state.scopes)); } catch { /* */ }
}

/** Setzt die projektspezifischen Schlüssel in state.settings */
export function applyScope(project) {
  const scope = (project && state.scopes[project]) || {};
  for (const k of PROJECT_KEYS) {
    state.settings[k] = scope[k] !== undefined ? scope[k] : DEFAULT_SETTINGS[k];
  }
}

function currentScope() {
  const out = {};
  for (const k of PROJECT_KEYS) out[k] = state.settings[k];
  return out;
}

let scopePutTimer = null;

/** Merkt sich die projektspezifischen Settings und schreibt sie auf den Server */
export function saveScope({ immediate = false } = {}) {
  if (!state.project) return;
  state.scopes[state.project] = currentScope();
  persistScopes();
  clearTimeout(scopePutTimer);
  const push = () => api.saveProjectConfig(state.project, state.scopes[state.project]).catch(() => {});
  if (immediate) push();
  else scopePutTimer = setTimeout(push, 600);
}

/** Holt die Server-Konfiguration und wendet sie an (Server schlägt Cache) */
export async function loadScope(project) {
  if (!project) return;
  try {
    const res = await api.projectConfig(project);
    const cfg = res?.config || {};
    const merged = { ...(state.scopes[project] || {}) };
    let changed = false;
    for (const k of PROJECT_KEYS) {
      if (cfg[k] !== undefined) { merged[k] = cfg[k]; changed = true; }
    }
    if (Object.keys(merged).length) state.scopes[project] = merged;
    else delete state.scopes[project];
    persistScopes();
    if (changed || Object.keys(merged).length) {
      applyScope(project);
      emit('settings', state.settings);
      emit('scope:changed', state.settings);
    }
  } catch { /* Project ohne Konfiguration */ }
}

export function setSettings(patch) {
  Object.assign(state.settings, patch);
  persist();
  if (patch && PROJECT_KEYS.some((k) => k in patch)) saveScope();
  emit('settings', state.settings);
}

export function setProject(name) {
  if (state.project && state.project !== name) saveScope({ immediate: true });
  state.project = name;
  applyScope(name);
  persist();
  emit('project', name);
}

export function tabPath(path) { return state.tabs.find((t) => t.path === path); }

/**
 * Pfad in die einheitliche arbeitsbereich-relative Form "Project/ordner/datei.tex".
 * Absolute Pfade bleiben unchanged.
 */
export function projPath(p) {
  const s = String(p == null ? '' : p).replace(/\\/g, '/');
  if (!s) return s;
  if (s.startsWith('/')) return s;
  const proj = state.project;
  if (proj && s !== proj && !s.startsWith(proj + '/')) return proj + '/' + s;
  return s;
}

/** Gegenstück zu projPath: Pfad zurück in projekt-interne Form. */
export function projectRelPath(p) {
  const s = String(p == null ? '' : p).replace(/\\/g, '/');
  const proj = state.project;
  if (proj && s.startsWith(proj + '/')) return s.slice(proj.length + 1);
  return s;
}

export function addTab(path, name) {
  if (!tabPath(path)) {
    state.tabs.push({ path, name: name || path.split('/').pop() });
    persist();
    emit('tabs', state.tabs);
  }
}

export function removeTab(path) {
  const i = state.tabs.findIndex((t) => t.path === path);
  if (i >= 0) {
    state.tabs.splice(i, 1);
    state.docs.delete(path);
    persist();
    emit('tabs', state.tabs);
    return state.tabs[Math.min(i, state.tabs.length - 1)]?.path || null;
  }
  return state.active;
}

export function setActive(path) {
  state.active = path;
  persist();
  emit('active', path);
}

export function docOf(path) {
  if (!state.docs.has(path)) state.docs.set(path, { content: '', saved: true, mtime: 0 });
  return state.docs.get(path);
}
