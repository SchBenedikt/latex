/* API communication with the local server or the browser-local Cloudflare workspace. */
import { browserWorkspace } from './browser-workspace.js';

let browserMode = false;
const unavailable = (feature) => { throw new Error(`${feature} needs the local LaTeX server. Your project files are still available in this browser.`); };

async function request(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    let isCloudflareQuota = false;
    try {
      const text = await res.clone().text();
      isCloudflareQuota = res.status === 429 && /error\s*1027|temporarily rate limited|workers? free plan/i.test(text);
      const j = JSON.parse(text);
      if (j.error) msg = j.error;
    } catch { /* */ }
    const err = new Error(msg);
    err.status = res.status;
    err.cloudflareQuota = isCloudflareQuota;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  isBrowserWorkspace: () => browserMode,
  state: async () => {
    if (browserMode) return browserWorkspace.state();
    try { return await request('/api/state'); }
    catch (error) {
      // Static hosting (including Cloudflare Workers) has no Node API. Use private,
      // per-browser IndexedDB storage instead of making a shared server public.
      if (error.status !== 404 && error.status !== 405 && !error.cloudflareQuota) throw error;
      browserMode = true;
      return browserWorkspace.state();
    }
  },

  tree: (path = '', all = false) => browserMode ? browserWorkspace.tree(path, all) : request(`/api/tree?path=${encodeURIComponent(path)}&all=${all ? 1 : 0}`),

  file: (path) => browserMode ? browserWorkspace.file(path) : request(`/api/file?path=${encodeURIComponent(path)}`),

  saveFile: (path, content) => browserMode ? browserWorkspace.saveFile(path, content) : request(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }),

  saveBinary: (path, buffer) => browserMode ? browserWorkspace.saveBinary(path, buffer) : request(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer,
  }),

  fs: (body) => browserMode ? browserWorkspace.fs(body) : request('/api/fs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),

  templates: () => browserMode ? browserWorkspace.templates() : request('/api/templates'),
  packages: (project, file = 'main.tex') => browserMode ? unavailable('Package diagnostics') : request(`/api/packages?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file)}`),
  mergeBibliography: (project, content, file = 'references.bib', updateExisting = false) => browserMode ? unavailable('Bibliography merging') : request('/api/bibliography/merge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, content, file, updateExisting }),
  }),
  githubImport: (url, name) => browserMode ? unavailable('GitHub import') : request('/api/github/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name }),
  }),
  installPackage: (name) => browserMode ? unavailable('TeX package installation') : request('/api/packages/install', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  createProject: (name, template) => browserMode ? browserWorkspace.createProject(name, template) : request('/api/project', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, template }),
  }),

  projectConfig: (project) => browserMode ? browserWorkspace.projectConfig(project) : request(`/api/project/config?project=${encodeURIComponent(project)}`),
  saveProjectConfig: (project, config) => browserMode ? browserWorkspace.saveProjectConfig(project, config) : request('/api/project/config', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, config }),
  }),

  renameProject: (name, to) => browserMode ? browserWorkspace.renameProject(name, to) : request('/api/project/rename', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, to }),
  }),
  duplicateProject: (name, to) => browserMode ? browserWorkspace.duplicateProject(name, to) : request('/api/project/duplicate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, to }),
  }),
  deleteProject: (name) => browserMode ? browserWorkspace.deleteProject(name) : request('/api/project/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  importProject: (name, buffer) => browserMode ? browserWorkspace.importProject(name, buffer) : request(`/api/project/import?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: buffer,
  }),

  demos: () => browserMode ? Promise.resolve({ demos: [] }) : request('/api/demos'),
  seedDemos: (names) => browserMode ? Promise.resolve({ ok: true, created: [], skipped: [] }) : request('/api/demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }),
  }),

  replace: (project, body) => browserMode ? browserWorkspace.replace(project, body) : request('/api/replace', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, ...body }),
  }),

  build: (project, body) => browserMode ? browserWorkspace.build(project, body) : request('/api/build', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, ...body }),
  }),

  buildStatus: (project) => browserMode ? unavailable('Build status') : request(`/api/build?project=${encodeURIComponent(project)}`),
  meta: (project, file) => browserMode ? unavailable('PDF metadata') : request(`/api/meta?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file || 'main.tex')}`),
  log: (project, file) => browserMode ? unavailable('Build logs') : request(`/api/log?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file || 'main.tex')}`),
  pdfUrl: (project, file) => `/api/pdf?project=${encodeURIComponent(project)}&file=${encodeURIComponent(file || 'main.pdf')}&t=${Date.now()}`,
  synctex: (project, params) => browserMode ? unavailable('SyncTeX') : request(`/api/synctex?project=${encodeURIComponent(project)}&${new URLSearchParams(params)}`),
  search: (project, body) => browserMode ? browserWorkspace.search(project, body) : request('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, ...body }),
  }),
  projectFiles: (project, all = false) => browserMode ? browserWorkspace.projectFiles(project, all) : request(`/api/projects/files?project=${encodeURIComponent(project)}&all=${all ? 1 : 0}`),
  exportUrl: (project) => `/api/export?project=${encodeURIComponent(project)}`,
  exportProject: (project) => browserMode ? browserWorkspace.exportProject(project) : (location.href = `/api/export?project=${encodeURIComponent(project)}`),
  importZip: (project, buffer) => browserMode ? browserWorkspace.importZip(project, buffer) : request(`/api/import?path=${encodeURIComponent(project)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: buffer,
  }),
};
