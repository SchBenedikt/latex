import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import JSZip from 'jszip';

// Uses disposable projects only. Run against an already running Studio server.
const base = process.env.STUDIO_URL || 'http://localhost:4180';
const project = 'QA-' + Date.now();
const created = new Set();
let passed = 0;
const messages = [];
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

async function request(route, body, method = 'POST') {
  const response = await fetch(base + route, body === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `${response.status} ${route}: ${await response.clone().text()}`);
  return response.json();
}
async function check(name, run) {
  await run(); passed++; console.log('OK ' + name);
}
const fileRoute = (file) => '/api/file?path=' + encodeURIComponent(project + '/' + file);
async function save(file, content) { return request(fileRoute(file), { content }, 'PUT'); }
async function build(engine, expected = 'ok') {
  const queued = await request('/api/build?project=' + project, { file: 'main.tex', engine });
  const deadline = Date.now() + 60000;
  let end;
  while (!(end = messages.find((m) => m.type === 'build:end' && m.job === queued.job))) {
    assert.ok(Date.now() < deadline, 'Build timeout: ' + engine);
    await delay(150);
  }
  assert.equal(end.status, expected, end.error || end.log?.slice(-2500));
  return end;
}

const source = String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage{hyperref}
\begin{document}
\section{Verification}\label{sec:verify}
Hello from the verification document.
\input{sections/content}
\end{document}
`;

try {
  await check('HTML and JavaScript assets', async () => {
    for (const route of ['/', '/studio', '/client/dist/app.js', '/client/styles/workspace.css']) {
      const response = await fetch(base + route); assert.equal(response.status, 200);
      if (route === '/') assert.match(await response.text(), /Write with focus/);
      if (route === '/studio') assert.match(await response.text(), /id="app"/);
    }
  });
  const state = await request('/api/state');
  await check('Project and template lists', async () => {
    assert.ok(Array.isArray(state.projects));
    const templates = await request('/api/templates');
    assert.ok(JSON.stringify(templates).includes('minimal'));
  });
  await check('Project creation and conflict handling', async () => {
    await request('/api/project', { name: project, template: 'minimal' }); created.add(project);
    const duplicate = await fetch(base + '/api/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: project, template: 'minimal' }) });
    assert.equal(duplicate.status, 409);
  });
  await check('Folder creation, file save and exact readback', async () => {
    await request('/api/fs', { op: 'mkdir', path: project + '/sections' });
    await save('main.tex', source);
    await save('sections/content.tex', 'A unique QA marker.\n');
    assert.equal((await request(fileRoute('main.tex'))).content, source);
  });
  await check('File copy, rename and delete', async () => {
    await request('/api/fs', { op: 'copy', from: project + '/sections/content.tex', to: project + '/copy.tex' });
    await request('/api/fs', { op: 'rename', from: project + '/copy.tex', to: project + '/renamed.tex' });
    assert.match((await request(fileRoute('renamed.tex'))).content, /QA marker/);
    await request('/api/fs', { op: 'delete', path: project + '/renamed.tex' });
    assert.equal((await fetch(base + fileRoute('renamed.tex'))).status, 404);
  });
  await check('Project configuration', async () => {
    await request('/api/project/config', { project, config: { mainFile: 'main.tex', engine: 'pdflatex', autoBuild: 'off' } }, 'PUT');
    assert.equal((await request('/api/project/config?project=' + project)).config.mainFile, 'main.tex');
  });
  await check('Tree and project file navigation', async () => {
    assert.match(JSON.stringify(await request('/api/tree?path=' + project)), /content.tex/);
    assert.ok((await request('/api/projects/files?project=' + project)).files.includes('sections/content.tex'));
  });
  await check('Search and project-wide replacement', async () => {
    assert.equal((await request('/api/search', { project, query: 'QA marker' })).results.length, 1);
    assert.equal((await request('/api/replace', { project, query: 'QA marker', replacement: 'verified marker' })).count, 1);
    assert.match((await request(fileRoute('sections/content.tex'))).content, /verified marker/);
  });
  await check('Packages and document class availability', async () => {
    const packages = await request('/api/packages?project=' + project + '&file=main.tex');
    assert.match(JSON.stringify(packages), /amsmath/);
    assert.match(JSON.stringify(packages), /hyperref/);
  });
  await check('Zotero/BibTeX merge, citekey deduplication and explicit updates', async () => {
    const url = base + '/api/bibliography/merge?project=' + project;
    const entry = (title) => `@article{stableKey,\n  title = {${title} with {nested} braces},\n  year = {2026}\n}\n`;
    const first = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, file: 'references.bib', content: entry('Original') }) });
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal((await first.json()).added, 1);
    const repeated = await request('/api/bibliography/merge?project=' + project, { project, file: 'references.bib', content: entry('Updated') });
    assert.equal(repeated.unchanged, 1);
    assert.match((await request(fileRoute('references.bib'))).content, /Original with \{nested\}/);
    const updated = await request('/api/bibliography/merge?project=' + project, { project, file: 'references.bib', content: entry('Updated'), updateExisting: true });
    assert.equal(updated.updated, 1);
    assert.match((await request(fileRoute('references.bib'))).content, /Updated with \{nested\}/);
  });
  for (const engine of ['pdflatex', 'xelatex', 'lualatex'].filter((name) => state.tools[name])) {
    await check(engine + ' compilation and WebSocket completion', async () => { await build(engine); });
  }
  await check('PDF download, log and document metadata', async () => {
    const pdf = await fetch(base + '/api/pdf?project=' + project + '&file=main.pdf');
    assert.match(pdf.headers.get('content-type'), /application\/pdf/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.match((await request('/api/log?project=' + project + '&file=main.tex')).log, /Output written/);
    assert.match(JSON.stringify(await request('/api/meta?project=' + project + '&file=main.tex')), /sec:verify/);
  });
  await check('SyncTeX source-to-PDF and PDF-to-source', async () => {
    const forward = await request('/api/synctex?project=' + project + '&file=main.tex&op=view&line=6');
    assert.equal(forward.ok, true);
    const position = forward.result;
    const reverse = await request('/api/synctex?project=' + project + '&file=main.tex&op=edit&page=' + position.page + '&x=' + (position.h ?? position.x) + '&y=' + (position.v ?? position.y));
    assert.equal(reverse.ok, true);
    assert.ok(reverse.result.line > 0);
  });
  await check('Compile error reporting and recovery', async () => {
    await save('main.tex', source.replace('Hello from', '\\ACommandThatDoesNotExist\nHello from'));
    const failed = await build('pdflatex', 'failed');
    assert.ok(failed.issues.some((i) => i.severity === 'error'));
    await save('main.tex', source); await build('pdflatex');
  });
  await check('ZIP export and import', async () => {
    const exported = await fetch(base + '/api/export?project=' + project);
    assert.equal(exported.status, 200);
    const bytes = Buffer.from(await exported.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    assert.ok(Object.keys(zip.files).some((name) => name.endsWith('main.tex')));
    const imported = project + '-Import';
    const response = await fetch(base + '/api/project/import?name=' + imported, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: bytes });
    assert.equal(response.status, 200, await response.clone().text()); created.add(imported);
    assert.equal((await request('/api/file?path=' + imported + '/main.tex')).content, source);
  });
  await check('Project duplicate and rename', async () => {
    const copy = project + '-Copy', renamed = project + '-Renamed';
    await request('/api/project/duplicate', { name: project, to: copy }); created.add(copy);
    await request('/api/project/rename', { name: copy, to: renamed }); created.delete(copy); created.add(renamed);
    assert.equal((await request('/api/file?path=' + renamed + '/main.tex')).content, source);
  });
  await check('Invalid regex, engine and traversal rejected', async () => {
    for (const [route, body] of [
      ['/api/search', { project, query: '[', regex: true }],
      ['/api/build?project=' + project, { file: '../outside.tex', engine: 'pdflatex' }],
      ['/api/build?project=' + project, { file: 'main.tex', engine: 'unknown' }],
    ]) {
      const res = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(res.status, 400);
    }
    assert.ok((await fetch(base + '/api/file?path=../package.json')).status >= 400);
    const github = await fetch(base + '/api/github/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.org/owner/repository', name: project + '-InvalidGitHub' }) });
    assert.equal(github.status, 400);
  });
  console.log(`\n${passed} checks passed.`);
} finally {
  ws.close();
  for (const name of created) await request('/api/fs', { op: 'delete', path: name });
  console.log('Disposable projects removed.');
}
