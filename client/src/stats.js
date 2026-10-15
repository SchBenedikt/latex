/* Document statistics: words, structure, math, floats, citations and reading time. */

import { $ , el, clear, openModal } from './util.js';
import { currentText, currentPath } from './editor/index.js';
import { basename } from './util.js';
import { api } from './api.js';
import { state } from './state.js';

export function computeStats(text = '') {
  const noComments = text.replace(/(^|[^\\])%.*$/gm, '$1');
  const words = (noComments.replace(/\\[a-zA-Z@]+/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const chars = text.length;
  const charsNoSpace = text.replace(/\s/g, '').length;
  const lines = text ? text.split('\n').length : 0;
  const count = (re) => (text.match(re) || []).length;
  return {
    words,
    chars,
    charsNoSpace,
    lines,
    sections: count(/\\(sub)*section\{/g) + count(/\\chapter\{/g) + count(/\\paragraph\{/g),
    math: count(/\$\$|\\\[|\\begin\{(equation|align|gather|multline|math|displaymath)/g),
    figures: count(/\\begin\{figure/g),
    tables: count(/\\begin\{(table|tabular|tabularx|longtable)/g),
    cites: count(/\\cite[a-z]*\{/g),
    refs: count(/\\(label|ref|cref|autoref|eqref)\{/g),
    todos: count(/%.*TODO|\\todo\{/gi),
    minutes: Math.max(1, Math.round(words / 200)),
  };
}

const projectCache = { key: '', at: 0, stats: null };

/** Drops the cached project totals (call after saves or project switches). */
export function invalidateProjectStats() {
  projectCache.at = 0;
  projectCache.stats = null;
}

/** Aggregated statistics over every text file of the project (15 s cache). */
export async function computeProjectStats(project = state.project) {
  if (!project) return null;
  if (projectCache.key === project && projectCache.stats && Date.now() - projectCache.at < 15000) {
    return projectCache.stats;
  }
  let files = [];
  try {
    files = (await api.projectFiles(project)).files || [];
  } catch {
    return null;
  }
  const textFiles = files.filter((f) => /\.(tex|md|txt)$/i.test(f));
  const total = computeStats('');
  for (const f of textFiles) {
    try {
      const res = await api.file(`${project}/${f}`);
      const content = typeof res === 'string' ? res : (res?.content ?? '');
      const s = computeStats(content);
      for (const k of Object.keys(total)) {
        if (k !== 'minutes') total[k] += s[k];
      }
    } catch { /* skip unreadable files */ }
  }
  total.files = textFiles.length;
  total.minutes = Math.max(1, Math.round(total.words / 200));
  projectCache.key = project;
  projectCache.at = Date.now();
  projectCache.stats = total;
  return total;
}

export function openDocumentStats() {
  const text = currentText() || '';
  const s = computeStats(text);
  const path = currentPath() ? basename(currentPath()) : 'No file open';
  const grid = $('#stats-grid');
  if (!grid) return;
  clear(grid);
  const rows = [
    ['File', path],
    ['Words', s.words.toLocaleString('en-US')],
    ['Characters', `${s.chars.toLocaleString('en-US')} (${s.charsNoSpace.toLocaleString('en-US')} without spaces)`],
    ['Lines', s.lines.toLocaleString('en-US')],
    ['Reading time', `≈ ${s.minutes} min`],
    ['Sections & chapters', String(s.sections)],
    ['Math blocks', String(s.math)],
    ['Figures', String(s.figures)],
    ['Tables', String(s.tables)],
    ['Citations', String(s.cites)],
    ['Labels & references', String(s.refs)],
    ['TODO notes', String(s.todos)],
  ];
  for (const [k, v] of rows) {
    grid.append(el('div', { class: 'stat-row' }, el('span', { class: 'stat-key', text: k }), el('span', { class: 'stat-val', text: v })));
  }
  openModal('stats');

  // Project totals arrive asynchronously and are appended below the file rows.
  const project = state.project;
  computeProjectStats(project).then((p) => {
    if (!p || state.project !== project || $('#stats-grid') !== grid) return;
    grid.append(el('div', { class: 'stat-sep', text: `Project totals · ${project}` }));
    const projectRows = [
      ['Files counted', String(p.files)],
      ['Words (project)', p.words.toLocaleString('en-US')],
      ['Characters (project)', p.chars.toLocaleString('en-US')],
      ['Lines (project)', p.lines.toLocaleString('en-US')],
      ['Reading time (project)', `≈ ${p.minutes} min`],
      ['Sections & chapters', String(p.sections)],
      ['Math blocks', String(p.math)],
      ['Figures', String(p.figures)],
      ['Tables', String(p.tables)],
      ['Citations', String(p.cites)],
      ['Labels & references', String(p.refs)],
      ['TODO notes', String(p.todos)],
    ];
    for (const [k, v] of projectRows) {
      grid.append(el('div', { class: 'stat-row project' }, el('span', { class: 'stat-key', text: k }), el('span', { class: 'stat-val', text: v })));
    }
  }).catch(() => { /* totals are optional */ });
}
