/* Document outline: numbered table of contents with file groups, hierarchy
 * guides, filter, collapse states and one-click jumps to the source line. */

import { state, on, projectRelPath } from './state.js';
import { $, el, clear, debounce, escapeHtml } from './util.js';
import { openFile, currentPath, currentLine } from './editor/index.js';

const outlineEl = $('#outline');

const KIND_ICON = {
  part: '▣', chapter: '▤', section: '▸', subsection: '▸', subsubsection: '▸',
  paragraph: '·', subparagraph: '·', title: '★', author: '✎',
  figure: '◫', table: '⊟', algorithm: '⚙', bib: '≡', todo: '!', env: '□',
};
const KIND_LABEL = {
  part: 'Part', chapter: 'Chapter', section: 'Section', subsection: 'Subsection',
  subsubsection: 'Subsubsection', paragraph: 'Paragraph', subparagraph: 'Subparagraph',
  title: 'Title', author: 'Author', figure: 'Figure', table: 'Table', algorithm: 'Algorithm',
  bib: 'Bibliography', todo: 'TODO', env: 'Environment',
};
const NUMBERED = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph']);

let filterText = '';
const collapsed = new Set();

const nodeKey = (n) => `${n.file}:${n.line}:${n.kind}`;

/* ------------------------------------------------------------- Rendering */

export function renderOutline() {
  clear(outlineEl);
  outlineEl.dataset.lastFile = '';
  const nodes = state.meta.outline || [];
  if (!nodes.length) {
    outlineEl.append(el('div', {
      class: 'problems-empty',
      text: 'No structure yet. Headings like \\section{…} and \\chapter{…} appear here as a table of contents.',
    }));
    return;
  }

  assignNumbers(nodes);

  const q = filterText.trim().toLowerCase();
  let visible;
  if (q) {
    visible = nodes.map((n) => filterNode(n, q)).filter(Boolean);
    if (!visible.length) {
      outlineEl.append(el('div', { class: 'problems-empty', text: `No outline entry matches “${filterText}”.` }));
      return;
    }
  } else {
    visible = nodes;
  }

  const root = el('ul', { class: 'tree-root outline-root' });
  let lastRootFile = null;
  for (const node of visible) {
    if (node.file !== lastRootFile) {
      lastRootFile = node.file;
      root.append(el('li', { class: 'out-group' },
        el('span', { class: 'out-group-icon', html: fileGlyph() }),
        el('span', { class: 'out-group-name', text: node.file }),
      ));
    }
    root.append(renderNode(node, 0, !!q));
  }
  outlineEl.append(root);
  highlightCurrent(false);
}

const fileGlyph = () => '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/></svg>';

/** Keeps a node when it matches or any descendant matches. */
function filterNode(node, q) {
  const hit = `${node.title || ''} ${node.label || ''} ${node.file || ''} ${node._num || ''}`.toLowerCase().includes(q);
  const kids = (node.children || []).map((c) => filterNode(c, q)).filter(Boolean);
  if (!hit && !kids.length) return null;
  return { ...node, children: kids, _match: hit };
}

/** Classic TOC numbering: 1, 1.1, 1.1.1 … across all included files. */
function assignNumbers(nodes) {
  let base = Infinity;
  const scan = (ns) => {
    for (const n of ns) {
      if (NUMBERED.has(n.kind)) base = Math.min(base, n.level ?? 9);
      scan(n.children || []);
    }
  };
  scan(nodes);
  if (!isFinite(base)) return;
  const counters = {};
  const walk = (ns) => {
    for (const n of ns) {
      const lvl = n.level ?? 9;
      if (NUMBERED.has(n.kind) && lvl >= base && lvl <= base + 6) {
        counters[lvl] = (counters[lvl] || 0) + 1;
        for (const k of Object.keys(counters)) if (Number(k) > lvl) delete counters[k];
        const parts = [];
        for (let k = base; k <= lvl; k++) if (counters[k]) parts.push(counters[k]);
        n._num = parts.join('.');
      } else {
        delete n._num;
      }
      walk(n.children || []);
    }
  };
  walk(nodes);
}

function renderNode(node, depth, forceOpen) {
  const hasKids = !!node.children?.length;
  const isCollapsed = !forceOpen && collapsed.has(nodeKey(node));
  const li = el('li', { class: 'out-node' });

  const jump = () => openFile(node.file, { line: node.line, col: 1 });

  const row = el('div', {
    class: 'out-row kind-' + (node.kind || 'section') + (node.todo ? ' todo' : '')
      + (node._match ? ' match' : '') + (hasKids ? ' has-kids' : ''),
    style: { '--depth': depth },
    title: `${KIND_LABEL[node.kind] || 'Entry'}${node._num ? ' ' + node._num : ''} · ${node.file}:${node.line} — click to open`,
    onclick: jump,
  },
    hasKids
      ? el('button', {
        class: 'out-twisty' + (isCollapsed ? ' closed' : ''),
        text: isCollapsed ? '▸' : '▾',
        'aria-label': isCollapsed ? 'Expand section' : 'Collapse section',
        onclick: (e) => {
          e.stopPropagation();
          if (collapsed.has(nodeKey(node))) collapsed.delete(nodeKey(node));
          else collapsed.add(nodeKey(node));
          renderOutline();
        },
      })
      : el('span', { class: 'out-twisty spacer' }),
    el('span', { class: 'out-num', text: node._num || '' }),
    el('span', { class: 'onum kind-' + (node.kind || 'section'), text: KIND_ICON[node.kind] || '▸' }),
    el('span', { class: 'otitle', html: escapeHtml(node.title || '(untitled)') }),
    node.label ? el('span', { class: 'out-label', text: '#' + node.label, title: `Label: ${node.label}` }) : null,
    node.todo ? el('span', { class: 'out-tag todo-tag', text: 'TODO' }) : null,
  );
  li.append(row);

  if (hasKids && !isCollapsed) {
    const ul = el('ul', { class: 'tree-children' });
    ul.style.setProperty('--guide-x', (12 + depth * 13) + 'px');
    for (const c of node.children) ul.append(renderNode(c, depth + 1, forceOpen));
    li.append(ul);
  } else if (hasKids && isCollapsed) {
    li.append(el('div', {
      class: 'out-collapsed-note',
      text: `${countDescendants(node)} more entries`,
    }));
  }
  return li;
}

function countDescendants(node) {
  let n = 0;
  const walk = (x) => { for (const c of x.children || []) { n++; walk(c); } };
  walk(node);
  return n;
}

/* -------------------------------------------------------- Highlight/jump */

function allVisibleRows() {
  return [...outlineEl.querySelectorAll('.out-row')];
}

function highlightCurrent(scroll = false) {
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

  for (const r of allVisibleRows()) r.classList.remove('current');
  if (!best) return;
  const idx = allNodes().indexOf(best);
  const rows = allVisibleRows();
  const row = rows[idx];
  if (row) {
    row.classList.add('current');
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }
}

function allNodes() {
  const out = [];
  const walk = (nodes) => { for (const n of nodes) { out.push(n); walk(n.children || []); } };
  walk(state.meta.outline || []);
  return out;
}

/* ----------------------------------------------------------- Collapse UI */

function expandAll() {
  collapsed.clear();
  renderOutline();
}

function collapseAll() {
  for (const n of allNodes()) if (n.children?.length) collapsed.add(nodeKey(n));
  renderOutline();
}

/* ------------------------------------------------------------------ Init */

export function initOutline() {
  const filter = $('#outline-filter');
  if (filter) {
    const apply = debounce(() => { filterText = filter.value; renderOutline(); }, 180);
    filter.addEventListener('input', apply);
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { filter.value = ''; filterText = ''; renderOutline(); }
      if (e.key === 'Enter') {
        const first = outlineEl.querySelector('.out-row');
        if (first) first.click();
      }
    });
  }
  $('#outline-collapse-all')?.addEventListener('click', collapseAll);
  $('#outline-expand-all')?.addEventListener('click', expandAll);
  $('#outline-sync')?.addEventListener('click', () => highlightCurrent(true));

  on('meta', renderOutline);
  on('active-file', () => { renderOutline(); highlightCurrent(true); });
  on('cursor', () => highlightCurrent(false));
  renderOutline();
}
