/* Outlines-Outline */

import { state, on, emit, projectRelPath } from './state.js';
import { $, el, clear } from './util.js';
import { openFile, currentPath, currentLine } from './editor/index.js';

const outlineEl = $('#outline');
const KIND_ICON = { chapter: '▤', part: '▣', section: '▸', subsection: '·', subsubsection: '·', paragraph: '·', subparagraph: '·', title: '★', author: '✎', todo: '!', bib: '≡' };

export function renderOutline() {
  clear(outlineEl);
  const nodes = state.meta.outline || [];
  if (!nodes.length) {
    outlineEl.append(el('div', { class: 'problems-empty', text: 'No outline found.\n\nBuild the project (Ctrl+B) to see sections, labels, and tasks.' }, el('br')));
    return;
  }
  const root = el('ul', { class: 'tree-root' });
  for (const n of nodes) root.append(renderNode(n, 0));
  outlineEl.append(root);
  highlightCurrent();
}

function renderNode(node, depth) {
  const li = el('li', { class: 'out-node' });
  const row = el('div', {
    class: 'out-row lvl-' + Math.min(node.level, 4) + (node.todo ? ' todo' : ''),
    style: { paddingLeft: (8 + depth * 14) + 'px' },
    title: `${node.file}:${node.line}`,
    onclick: () => openFile(node.file, { line: node.line }),
  },
    el('span', { class: 'onum', text: KIND_ICON[node.kind] || '▸' }),
    el('span', { class: 'otitle', text: node.title || '(untitled)' }),
    node.label ? el('span', { class: 'out-kind', text: ' #' + node.label }) : null,
  );
  li.append(row);
  if (node.children?.length) {
    const ul = el('ul', { class: 'tree-children' });
    for (const c of node.children) ul.append(renderNode(c, depth + 1));
    li.append(ul);
  }
  return li;
}

function highlightCurrent() {
  const file = projectRelPath(currentPath());
  const line = currentLine().line;
  let best = null;
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.file === file && n.line <= line && (!best || n.line > best.line)) best = n;
      walk(n.children || []);
    }
  };
  walk(state.meta.outline || []);
  for (const r of outlineEl.querySelectorAll('.out-row.current')) r.classList.remove('current');
  if (best) {
    const idx = allNodes().indexOf(best);
    const rows = outlineEl.querySelectorAll('.out-row');
    if (rows[idx]) rows[idx].classList.add('current');
  }
}

function allNodes() {
  const out = [];
  const walk = (nodes) => { for (const n of nodes) { out.push(n); walk(n.children || []); } };
  walk(state.meta.outline || []);
  return out;
}

export function initOutline() {
  on('meta', renderOutline);
  on('active-file', renderOutline);
  const hl = () => highlightCurrent();
  on('cursor', hl);
  renderOutline();
}
