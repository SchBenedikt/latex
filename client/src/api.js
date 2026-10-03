/* API-Kommunikation mit dem lokalen Server */

async function request(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  state: () => request('/api/state'),

  tree: (path = '', all = false) => request(`/api/tree?path=${encodeURIComponent(path)}&all=${all ? 1 : 0}`),

  file: (path) => request(`/api/file?path=${encodeURIComponent(path)}`),

  saveFile: (path, content) => request(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }),

  saveBinary: (path, buffer) => request(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer,
  }),

  fs: (body) => request('/api/fs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),

  templates: () => request('/api/templates'),
  packages: (project, file = 'main.tex') => request(`/api/packages?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`),
  mergeBibliography: (project, content, file = 'references.bib', updateExisting = false) => request('/api/bibliography/merge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, content, file, updateExisting }),
  }),
  githubImport: (url, name) => request('/api/github/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name }),
  }),
  installPackage: (name) => request('/api/packages/install', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  createProject: (name, template) => request('/api/project', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, template }),
  }),

  projectConfig: (project) => request(`/api/project/config?project=${encodeURIComponent(project)}`),
  saveProjectConfig: (project, config) => request('/api/project/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, config }),
  }),

  renameProject: (name, to) => request('/api/project/rename', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, to }),
  }),
  duplicateProject: (name, to) => request('/api/project/duplicate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, to }),
  }),
  deleteProject: (name) => request('/api/project/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  importProject: (name, buffer) => request(`/api/project/import?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: buffer,
  }),

  demos: () => request('/api/demos'),
  seedDemos: (names) => request('/api/demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }),
  }),

  replace: (project, body) => request('/api/replace', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, ...body }),
  }),

  build: (project, body) => request('/api/build', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, ...body }),
  }),

  buildStatus: (project) => request(`/api/build?project=${encodeURIComponent(project)}`),
  meta: (project, file) => request(`/api/meta?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file || 'main.tex')}`),
  log: (project, file) => request(`/api/log?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file || 'main.tex')}`),
  pdfUrl: (project, file) => `/api/pdf?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file || 'main.pdf')}&t=${Date.now()}`,
  synctex: (project, params) => request(`/api/synctex?project=${encodeURIComponent(project)}&${new URLSearchParams(params)}`),
  search: (project, body) => request('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, ...body }),
  }),
  projectFiles: (project, all = false) => request(`/api/projects/files?project=${encodeURIComponent(project)}&all=${all ? 1 : 0}`),
  exportUrl: (project) => `/api/export?project=${encodeURIComponent(project)}`,
  importZip: (project, buffer) => request(`/api/import?path=${encodeURIComponent(project)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: buffer,
  }),
};
