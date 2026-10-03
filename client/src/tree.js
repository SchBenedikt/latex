/* Filebaum: Navigation, CRUD, Upload, Kontextmenü */

import { api } from './api.js';
import { state, on, emit, setSettings, persist, projectRelPath } from './state.js';
import { $, el, clear, basename, toast, promptDialog, confirmDialog, contextMenu, fmtBytes, debounce } from './util.js';
import { openFile, currentPath, saveActive } from './editor/index.js';
import { icon, fileIcon } from './icons.js';

const treeEl = $('#filetree');
let treeData = [];
const expanded = new Set(JSON.parse(localStorage.getItem('latex-tree-open') || '[]'));
let selected = null;

function extClass(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'tex' || ext === 'sty' || ext === 'cls') return 'tex';
  if (ext === 'bib') return 'bib';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'img';
  return '';
}

export async function refreshTree() {
  try {
    const res = await api.tree(state.project || '', state.treeAll);
    treeData = res.tree;
    render();
  } catch (e) {
    treeEl.innerHTML = '';
    treeEl.append(el('div', { class: 'problems-empty', text: 'Could not load file tree: ' + e.message }));
  }
}

function saveExpanded() {
  localStorage.setItem('latex-tree-open', JSON.stringify([...expanded]));
}

function render() {
  clear(treeEl);
  const root = el('ul', { class: 'tree-root' });
  for (const node of treeData) root.append(renderNode(node, 0));
  treeEl.append(root);
}

function renderNode(node, depth) {
  const isDir = node.type === 'dir';
  const li = el('li');
  const doc = state.docs.get(node.path);
  const isDirty = doc && !doc.saved;
  const isOpen = expanded.has(node.path);
  const row = el('div', {
    class: 'tree-item' + (isDir && isOpen ? ' open' : '') + (selected === node.path ? ' selected' : '') + (node.path === currentPath() ? ' active' : ''),
    dataset: { path: node.path, dir: isDir ? '1' : '' },
    style: { paddingLeft: (6 + depth * 13) + 'px' },
    draggable: 'true',
    onclick: () => {
      selected = node.path;
      if (isDir) toggle(node);
      else openFile(node.path);
      render();
    },
    oncontextmenu: (e) => {
      e.preventDefault();
      selected = node.path;
      render();
      showMenu(e.clientX, e.clientY, node);
    },
    ondragstart: (e) => {
      e.dataTransfer.setData('text/latex-path', node.path);
      e.dataTransfer.effectAllowed = 'move';
    },
    ondragover: (e) => { if (isDir) { e.preventDefault(); row.style.outline = '1px solid var(--accent)'; } },
    ondragleave: () => { row.style.outline = ''; },
    ondrop: async (e) => {
      row.style.outline = '';
      if (!isDir) return;
      e.preventDefault();
      e.stopPropagation();
      const src = e.dataTransfer.getData('text/latex-path');
      if (src && src !== node.path) {
        const name = basename(src);
        try {
          await api.fs({ op: 'rename', from: src, to: (node.path ? node.path + '/' : '') + name });
          toast('Moved: ' + name, { type: 'ok' });
          emit('tree:refresh');
        } catch (err) { toast(err.message, { type: 'err' }); }
      } else if (e.dataTransfer.files?.length) {
        await uploadFiles(e.dataTransfer.files, node.path);
      }
    },
  },
    el('span', { class: 'twisty', text: isDir ? '▸' : '' }),
    el('span', { class: 'tico ' + (isDir ? 'dir' : extClass(node.name)), html: isDir ? icon('folder') : fileIcon(node.name) }),
    el('span', { class: 'tname' + (isDirty ? ' dirty' : ''), text: node.name }),
    isDirty ? el('span', { class: 'tdot', text: '●', title: 'Unsaved' }) : null,
  );
  li.append(row);

  if (isDir && isOpen) {
    const kids = node.children || [];
    const ul = el('ul', { class: 'tree-children' });
    if (!kids.length) ul.append(el('div', { class: 'tree-item empty-note', dataset: { dir: '1' }, style: { paddingLeft: (26 + depth * 13) + 'px' }, text: '(empty)' }));
    for (const k of kids) ul.append(renderNode(k, depth + 1));
    li.append(ul);
  }
  return li;
}

function toggle(node) {
  if (expanded.has(node.path)) expanded.delete(node.path);
  else expanded.add(node.path);
  saveExpanded();
}

function showMenu(x, y, node) {
  const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
  const isDir = node.type === 'dir';
  const base = isDir ? node.path : parent;
  contextMenu(x, y, [
    ...(isDir ? [
      { label: 'New file here', icon: '＋', action: () => newFile(base) },
      { label: 'New folder here', icon: '＋', action: () => newFolder(base) },
      '-',
    ] : [
      { label: 'Open', icon: '↗', action: () => openFile(node.path) },
      { label: 'Set as main file', icon: '★', action: () => { const mf = projectRelPath(node.path); setSettings({ mainFile: mf }); toast('Main file: ' + mf, { type: 'ok' }); } },
      '-',
    ]),
    { label: 'Rename', icon: '✎', action: () => rename(node) },
    { label: 'Duplicate', icon: '⧉', action: () => duplicate(node) },
    ...(isDir ? [] : [{ label: 'Download', icon: '⭳', action: () => window.open('/api/download?path=' + encodeURIComponent(node.path), '_blank') }]),
    '-',
    { label: 'Delete', icon: '🗑', danger: true, action: () => remove(node) },
  ]);
}

/* ------------------------------------------------------------ Aktionen */

export async function newFile(dir = '') {
  const name = await promptDialog('New file', 'File name (including extension)', '', 'chapter3.tex');
  if (!name) return;
  const base = dir || state.project || '';
  const path = (base ? base + '/' : '') + name.trim();
  try {
    await api.saveFile(path, '');
    expanded.add(dir);
    saveExpanded();
    emit('tree:refresh');
    openFile(path);
    toast('Created: ' + path, { type: 'ok' });
  } catch (e) { toast(e.message, { type: 'err' }); }
}

export async function newFolder(dir = '') {
  const name = await promptDialog('New folder', 'Folder name', '', 'chapter');
  if (!name) return;
  const base = dir || state.project || '';
  const path = (base ? base + '/' : '') + name.trim();
  try {
    await api.fs({ op: 'mkdir', path });
    if (dir) expanded.add(dir);
    saveExpanded();
    emit('tree:refresh');
  } catch (e) { toast(e.message, { type: 'err' }); }
}

async function rename(node) {
  const name = await promptDialog('Rename', 'Neuer Name', node.name);
  if (!name || name === node.name) return;
  const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
  const to = (parent ? parent + '/' : '') + name.trim();
  try {
    await api.fs({ op: 'rename', from: node.path, to });
    emit('tree:refresh');
    toast('Renamed: ' + name, { type: 'ok' });
  } catch (e) { toast(e.message, { type: 'err' }); }
}

async function duplicate(node) {
  const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
  const dot = node.name.lastIndexOf('.');
  const base = dot > 0 ? node.name.slice(0, dot) : node.name;
  const ext = dot > 0 ? node.name.slice(dot) : '';
  const to = (parent ? parent + '/' : '') + base + '-copy' + ext;
  try {
    await api.fs({ op: 'copy', from: node.path, to });
    emit('tree:refresh');
  } catch (e) { toast(e.message, { type: 'err' }); }
}

async function remove(node) {
  const ok = await confirmDialog('Delete', `${node.path} delete ${node.type === 'dir' ? 'including its contents ' : ''}?`, 'Delete');
  if (!ok) return;
  try {
    await api.fs({ op: 'delete', path: node.path });
    emit('tree:refresh');
    toast('Deleted: ' + node.path, { type: 'ok' });
  } catch (e) { toast(e.message, { type: 'err' }); }
}

/* -------------------------------------------------------------- Upload */

export async function uploadFiles(fileList, dir = '') {
  const base = dir || state.project || '';
  for (const file of fileList) {
    const name = file.name.replace(/[\\/]/g, '_');
    const path = (base ? base + '/' : '') + name;
    try {
      const buf = await file.arrayBuffer();
      await api.saveBinary(path, buf);
      toast(`Hochgeladen: ${name} (${fmtBytes(file.size)})`, { type: 'ok' });
    } catch (e) {
      toast(`Upload failed (${name}): ${e.message}`, { type: 'err' });
    }
  }
  if (dir) { expanded.add(dir); saveExpanded(); }
  emit('tree:refresh');
}

/* ------------------------------------------------------------- Globale */

export function initTree() {
  $('#btn-new-file').addEventListener('click', () => newFile(selectedIsDir() ? selected : ''));
  $('#btn-new-folder').addEventListener('click', () => newFolder(selectedIsDir() ? selected : ''));
  $('#btn-refresh-tree').addEventListener('click', refreshTree);
  $('#btn-upload').addEventListener('click', () => $('#file-upload-input').click());
  $('#file-upload-input').addEventListener('change', (e) => {
    uploadFiles(e.target.files, selectedIsDir() ? selected : '');
    e.target.value = '';
  });

  treeEl.addEventListener('contextmenu', (e) => {
    if (e.target === treeEl) {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: 'New file', icon: '＋', action: () => newFile('') },
        { label: 'New folder', icon: '＋', action: () => newFolder('') },
        '-',
        { label: 'Toggle generated files', icon: '👁', action: () => { state.treeAll = !state.treeAll; refreshTree(); } },
      ]);
    }
  });

  // Ganzes Project per Drag & Drop hochladen
  treeEl.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  treeEl.addEventListener('drop', async (e) => {
    if (e.dataTransfer.files?.length) {
      e.preventDefault();
      await uploadFiles(e.dataTransfer.files, '');
    }
  });

  on('tree:refresh', () => refreshTree());
  on('dirty', () => markDirty());
  on('saved', () => markDirty());
  on('active-file', () => { selected = currentPath(); render(); });
  on('project', () => { expanded.clear(); saveExpanded(); refreshTree(); });

  refreshTree();
}

function selectedIsDir() {
  if (!selected) return false;
  const find = (nodes) => {
    for (const n of nodes) {
      if (n.path === selected) return n.type === 'dir';
      if (n.children) { const r = find(n.children); if (r != null) return r; }
    }
    return null;
  };
  return find(treeData) === true;
}

const markDirty = debounce(() => render(), 250);

export function revealPath(path) {
  if (path) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    selected = path;
    saveExpanded();
  }
  render();
  const row = path ? treeEl.querySelector('.tree-item[data-path="' + cssEsc(path) + '"]') : treeEl.querySelector('.tree-item');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function cssEsc(s) { return String(s).replace(/"/g, '\\"'); }

export function expandPath(path) {
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
  saveExpanded();
  render();
}

export { treeData };
