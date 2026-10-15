/* Local project snapshots: capture and restore text files without a server round-trip. */

import { api } from './api.js';
import { state, emit, on } from './state.js';
import { $, $$, el, clear, openModal, closeModal, toast, promptDialog, confirmDialog, escapeHtml } from './util.js';
import { saveAll, openFile, currentPath } from './editor/index.js';

const keyOf = (project) => `latex-snapshots-v1:${project}`;
const AUTO_KEEP = 5;                 // automatic snapshots kept per project
const AUTO_SNAPSHOT_GAP_MS = 20 * 60 * 1000; // at most one auto snapshot per 20 min
let autoTimer = null;

export function listSnapshots(project = state.project) {
  if (!project) return [];
  try {
    return JSON.parse(localStorage.getItem(keyOf(project)) || '[]');
  } catch {
    return [];
  }
}

function storeSnapshots(project, snaps) {
  localStorage.setItem(keyOf(project), JSON.stringify(snaps.slice(0, 20)));
}

export async function createSnapshot(label, { auto = false, silent = false } = {}) {
  const project = state.project;
  if (!project) { if (!silent) toast('No project selected', { type: 'warn' }); return null; }
  const name = label ?? await promptDialog('Create snapshot', 'Snapshot name', new Date().toLocaleString('en-US'));
  if (name == null || !String(name).trim()) return null;
  try {
    await saveAll();
    const { files = [] } = await api.projectFiles(project);
    const textFiles = files.filter((f) => /\.(tex|bib|sty|cls|txt|md|cfg|json)$/i.test(f));
    const data = {};
    for (const f of textFiles.slice(0, 120)) {
      try {
        const res = await api.file(`${project}/${f}`);
        const content = typeof res === 'string' ? res : (res?.content ?? '');
        data[f] = content;
      } catch { /* skip unreadable files */ }
    }
    let snaps = listSnapshots(project);
    snaps.unshift({ id: `s${Date.now()}`, label: String(name).trim(), createdAt: new Date().toISOString(), files: data, auto });
    if (auto) {
      let kept = 0;
      snaps = snaps.filter((s) => !s.auto || (kept++ < AUTO_KEEP));
    }
    storeSnapshots(project, snaps);
    emit('history:note', { note: 'snapshot-create', label: `${String(name).trim()} (${Object.keys(data).length} files)` });
    if (!silent) toast(`Snapshot saved: ${name} (${Object.keys(data).length} files)`, { type: 'ok' });
    renderSnapshotList();
    return snaps[0];
  } catch (e) {
    if (!silent) toast('Could not create snapshot: ' + e.message, { type: 'err' });
    return null;
  }
}

/** Creates a quiet automatic snapshot at most every 20 minutes per project. */
export function scheduleAutoSnapshot() {
  if (state.settings.autoSnapshots !== 'on' || !state.project) return;
  if (autoTimer) return;
  const project = state.project;
  autoTimer = setTimeout(async () => {
    autoTimer = null;
    if (state.project !== project || state.settings.autoSnapshots !== 'on') return;
    const snaps = listSnapshots(project);
    const lastAuto = snaps.find((s) => s.auto);
    if (lastAuto && Date.now() - new Date(lastAuto.createdAt).getTime() < AUTO_SNAPSHOT_GAP_MS) return;
    await createSnapshot(`Automatic backup · ${new Date().toLocaleString()}`, { auto: true, silent: true });
  }, 60 * 1000);
}

export async function restoreSnapshot(id) {
  const project = state.project;
  const snap = listSnapshots(project).find((s) => s.id === id);
  if (!snap) return;
  const ok = await confirmDialog('Restore snapshot', `Replace current text files with “${snap.label}”? Unsaved changes will be lost.`, 'Restore');
  if (!ok) return;
  try {
    await saveAll();
    // Keep a safety copy of the current state before overwriting anything.
    await createSnapshot(`Before restoring “${snap.label}”`, { auto: true, silent: true });
    for (const [rel, content] of Object.entries(snap.files || {})) {
      await api.saveFile(`${project}/${rel}`, content);
    }
    emit('tree:refresh');
    emit('meta:refresh');
    emit('history:note', { note: 'snapshot-restore', label: snap.label });
    if (currentPath()) await openFile(currentPath());
    closeModal(null);
    toast(`Restored snapshot: ${snap.label}`, { type: 'ok' });
  } catch (e) {
    toast('Restore failed: ' + e.message, { type: 'err' });
  }
}

export async function deleteSnapshot(id) {
  const project = state.project;
  const snaps = listSnapshots(project).filter((s) => s.id !== id);
  storeSnapshots(project, snaps);
  renderSnapshotList();
}

export function renderSnapshotList() {
  const list = $('#snapshot-list');
  if (!list) return;
  clear(list);
  const snaps = listSnapshots();
  $('#snapshot-count').textContent = snaps.length ? `${snaps.length} snapshot${snaps.length === 1 ? '' : 's'} — stored in this browser` : 'No snapshots yet — stored in this browser';
  if (!snaps.length) {
    list.append(el('div', { class: 'problems-empty', text: 'Capture the current state before a big rewrite, then restore it if needed.' }));
    return;
  }
  for (const s of snaps) {
    const n = Object.keys(s.files || {}).length;
    const when = new Date(s.createdAt).toLocaleString('en-US');
    list.append(el('div', { class: 'snapshot-row' + (s.auto ? ' auto' : '') },
      el('div', { class: 'snapshot-copy' },
        el('b', {}, s.auto ? el('span', { class: 'snapshot-auto-tag', text: 'AUTO' }) : null, document.createTextNode(s.label)),
        el('span', { text: `${when} · ${n} text files` })),
      el('div', { class: 'snapshot-actions' },
        el('button', { class: 'tb-btn', text: 'Restore', onclick: () => restoreSnapshot(s.id) }),
        el('button', { class: 'tb-btn danger', text: 'Delete', onclick: () => deleteSnapshot(s.id) }),
      ),
    ));
  }
}

export function openSnapshots() {
  if (!state.project) { toast('No project selected', { type: 'warn' }); return; }
  renderSnapshotList();
  openModal('snapshots');
}

export function initSnapshots() {
  $('#snapshot-create')?.addEventListener('click', () => createSnapshot());
  on('saved', scheduleAutoSnapshot);
  on('project', () => { clearTimeout(autoTimer); autoTimer = null; });
}
