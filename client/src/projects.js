/* Projectverwaltung: umbenennen, duplizieren, löschen, importieren, Demos */

import { api } from './api.js';
import { state, setProject, applyScope, emit, on, persist } from './state.js';
import { $, $$, el, clear, toast, promptDialog, confirmDialog, contextMenu, openModal, closeModal } from './util.js';
import { closeAllTabs, openFile, reloadFile } from './editor/index.js';

/** Baut das Project-Dropdown new auf und markiert ggf. das aktive Project */
export async function reloadProjects(selectTo = state.project) {
  try {
    const app = await api.state();
    state.app = app;
    window.__latexRoot = app.root;
    renderOptions(app.projects || [], selectTo);
    return app.projects || [];
  } catch (e) {
    toast('Could not load project list: ' + e.message, { type: 'err' });
    return [];
  }
}

function renderOptions(projects, selectTo) {
  const sel = $('#project-select');
  if (!sel) return;
  clear(sel);
  for (const p of projects) sel.append(el('option', { value: p, text: p }));
  if (!projects.length) sel.append(el('option', { value: '', text: '(no projects)' }));
  if (selectTo) sel.value = selectTo;
}

/* ------------------------------------------------------------ Aktionen */

export function projectMenu(anchor) {
  const integrations = [
    { label: 'Import public GitHub repository …', icon: 'github', action: importGithubProject },
    ...(state.project ? [{ label: 'Import Zotero / BibTeX bibliography …', icon: 'book', action: importBibliography }] : []),
  ];
  if (!state.project) {
    contextMenu(anchor.left, anchor.bottom + 4, [
      { label: 'New project …', icon: '＋', action: () => emit('cmd:new-project') },
      { label: 'Import ZIP …', icon: '⤓', action: importZip },
      ...integrations,
      { label: 'Add sample projects …', icon: '★', action: openDemos },
    ]);
    return;
  }
  contextMenu(anchor.left, anchor.bottom + 4, [
    { label: 'Rename project …', icon: '✎', action: renameProject },
    { label: 'Duplicate project …', icon: '⧉', action: duplicateProject },
    '-',
    { label: 'Export as ZIP', icon: '⭳', action: exportProject },
    { label: 'Import ZIP …', icon: '⤓', action: importZip },
    ...integrations,
    '-',
    { label: 'Add sample projects …', icon: '★', action: openDemos },
    { label: 'Project settings …', icon: '⚙', action: () => emit('cmd:settings') },
    '-',
    { label: 'Delete project …', icon: '🗑', danger: true, action: deleteProject },
  ]);
}

async function importGithubProject() {
  const url = await promptDialog('Import GitHub repository', 'Public repository URL', 'https://github.com/');
  if (!url?.trim()) return;
  const suggested = url.trim().match(/github\.com\/[^/]+\/([^/?#]+)/i)?.[1]?.replace(/\.git$/i, '') || 'GitHub-Project';
  const name = await promptDialog('Project name', 'Name in local workspace', suggested);
  if (!name?.trim()) return;
  try {
    const result = await api.githubImport(url.trim(), name.trim());
    await reloadProjects(result.project);
    toast(`GitHub project imported: ${result.project} · ${result.files} files`, { type: 'ok', ms: 5000 });
    emit('project:switch', result.project);
  } catch (error) {
    toast('GitHub import failed: ' + error.message, { type: 'err', ms: 8000 });
  }
}

async function importBibliography() {
  const input = $('#bib-upload-input');
  if (input) { input.value = ''; input.click(); }
}

async function handleBibliography(file) {
  const project = state.project;
  if (!project) return;
  try {
    const files = (await api.projectFiles(project)).files || [];
    const target = files.find((name) => name.toLocaleLowerCase() === 'references.bib') || files.find((name) => /\.bib$/i.test(name)) || 'references.bib';
    const path = `${project}/${target}`;
    if (state.docs.get(path) && !state.docs.get(path).saved) {
      toast(`Save the open changes in ${target}, then import the Zotero file again.`, { type: 'warn', ms: 7000 });
      return;
    }
    const content = await file.text();
    let result = await api.mergeBibliography(project, content, target);
    if (result.updateCandidates) {
      const replace = await confirmDialog(
        'Vorhandene Citekeys aktualisieren?',
        `${result.updateCandidates} Einträge existieren bereits. Sollen diese Einträge with den Zotero-/BibTeX-Export replaced werden? Manuelle Änderungen an genau diesen Literaturangaben werden überschrieben.`,
        'Update entries',
      );
      if (replace) result = await api.mergeBibliography(project, content, target, true);
    }
    const importedPath = `${project}/${result.file}`;
    if (!await reloadFile(importedPath)) {
      toast(`Import cancelled: ${result.file} is open with unsaved changes. Save or discard them, then import again.`, { type: 'warn', ms: 7000 });
      return;
    }
    await openFile(importedPath);
    emit('tree:refresh');
    emit('meta:refresh');
    toast(`Bibliography imported: ${result.added} new, ${result.updated} updated, ${result.unchanged} unchanged · ${result.file}`, { type: 'ok', ms: 7000 });
  } catch (error) {
    toast('Bibliography import failed: ' + error.message, { type: 'err', ms: 8000 });
  }
}

export async function renameProject() {
  const from = state.project;
  if (!from) return;
  const to = await promptDialog('Rename project', 'New project name', from);
  if (!to || !to.trim() || to.trim() === from) return;
  try {
    const res = await api.renameProject(from, to.trim());
    const scope = state.scopes[from];
    setProject(res.project);
    if (scope) {
      state.scopes[res.project] = scope;
      delete state.scopes[from];
      applyScope(res.project);
      persist();
      emit('settings', state.settings);
      emit('meta:refresh');
    }
    await reloadProjects(res.project);
    $('#project-select').value = res.project;
    emit('tree:refresh');
    toast('Project renamed: ' + res.project, { type: 'ok' });
  } catch (e) {
    toast('Rename failed: ' + e.message, { type: 'err', ms: 6000 });
  }
}

export async function duplicateProject() {
  const from = state.project;
  if (!from) return;
  const to = await promptDialog('Project duplizieren', 'Copy name', from + ' (copy)');
  if (!to || !to.trim()) return;
  try {
    const res = await api.duplicateProject(from, to.trim());
    await reloadProjects(res.project);
    toast('Copy created: ' + res.project, { type: 'ok' });
    emit('project:switch', res.project);
  } catch (e) {
    toast('Duplicate failed: ' + e.message, { type: 'err', ms: 6000 });
  }
}

export async function deleteProject() {
  const name = state.project;
  if (!name) return;
  const ok = await confirmDialog(
    'Project löschen',
    `Das Project “${name}“ samt aller files und PDFs wird in den Papierkorb verschoben und nach 30 Tagen endgültig entfernt.`,
    'In den Papierkorb',
  );
  if (!ok) return;
  try {
    await api.deleteProject(name);
    delete state.scopes[name];
    persist();
    closeAllTabs();
    const projects = await reloadProjects(null);
    const next = projects.find((p) => p !== name) || null;
    if (next) {
      renderOptions(projects, next);
      $('#project-select').value = next;
      emit('project:switch', next);
    } else {
      setProject(null);
      renderOptions([], null);
      $('#project-select').value = '';
      emit('project:none');
    }
    toast('Project deleted: ' + name, { type: 'ok' });
  } catch (e) {
    toast('Delete failed: ' + e.message, { type: 'err', ms: 6000 });
  }
}

export function exportProject() {
  if (!state.project) return;
  location.href = api.exportUrl(state.project);
}

/* --------------------------------------------------------- ZIP-Import */

export function importZip() {
  const input = $('#zip-upload-input');
  if (!input) return;
  input.value = '';
  input.click();
}

async function handleZipFile(file) {
  const suggested = file.name.replace(/\.zip$/i, '').replace(/[^\w\-. ÄÖÜäöü()+ ]/g, ' ').trim().slice(0, 80);
  const name = await promptDialog('Import ZIP', 'Name of the new project', suggested);
  if (!name || !name.trim()) return;
  try {
    const buf = await file.arrayBuffer();
    const res = await api.importProject(name.trim(), buf);
    await reloadProjects(res.project);
    toast(`Imported: ${res.project} (${res.files} files)`, { type: 'ok', ms: 4000 });
    emit('project:switch', res.project);
  } catch (e) {
    toast('Import failed: ' + e.message, { type: 'err', ms: 7000 });
  }
}

/* ------------------------------------------------------- Demo-Projecte */

export async function openDemos() {
  let demos = [];
  try {
    const res = await api.demos();
    demos = res.demos || [];
  } catch (e) {
    toast('Could not load sample projects: ' + e.message, { type: 'err' });
    return;
  }

  const list = $('#demo-list');
  clear(list);
  if (!demos.length) {
    list.append(el('div', { class: 'problems-empty', text: 'No sample projects available.' }));
  }
  for (const d of demos) {
    const card = el('label', { class: 'demo-card' + (d.exists ? ' done' : '') },
      el('input', { type: 'checkbox', value: d.name, disabled: d.exists ? 'disabled' : null }),
      el('span', { class: 'demo-body' },
        el('b', { text: d.title || d.name }),
        el('span', { text: d.description || '' }),
      ),
      el('span', { class: 'demo-flag', text: d.exists ? 'Already added' : 'new' }),
    );
    list.append(card);
  }

  openModal('demos');
  $('#demo-create').onclick = async () => {
    const picked = $$('#demo-list input[type=checkbox]').filter((c) => c.checked).map((c) => c.value);
    if (!picked.length) { toast('Select at least one sample project', { type: 'warn' }); return; }
    const btn = $('#demo-create');
    btn.disabled = true;
    try {
      const res = await api.seedDemos(picked);
      closeModal(null);
      await reloadProjects(res.created?.[0] || state.project);
      if (res.created.length) {
        toast(`Sample projects created: ${res.created.join(', ')}`, { type: 'ok', ms: 5000 });
        emit('project:switch', res.created[0]);
      }
    } catch (e) {
      toast('Could not create sample projects: ' + e.message, { type: 'err', ms: 7000 });
    } finally {
      btn.disabled = false;
    }
  };
}

/* --------------------------------------------------------------- Init */

export function initProjects() {
  const menuBtn = $('#btn-project-menu');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const r = menuBtn.getBoundingClientRect();
      projectMenu({ left: r.left, bottom: r.bottom + 4 });
    });
  }

  const zip = $('#zip-upload-input');
  if (zip) {
    zip.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) handleZipFile(f);
      e.target.value = '';
    });
  }

  const bibliography = $('#bib-upload-input');
  if (bibliography) bibliography.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) handleBibliography(file);
    event.target.value = '';
  });

  const importBtn = $('#btn-import');
  if (importBtn) importBtn.addEventListener('click', importZip);

  const demoBtn = $('#btn-demos');
  if (demoBtn) demoBtn.addEventListener('click', openDemos);

  on('cmd:project-rename', renameProject);
  on('cmd:project-duplicate', duplicateProject);
  on('cmd:project-delete', deleteProject);
  on('cmd:project-export', exportProject);
  on('cmd:project-import', importZip);
  on('cmd:project-demos', openDemos);
}
