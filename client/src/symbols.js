/* Symbolpalette: Kategorien + Suche, Insert per Klick */

import { SYMBOLS } from './editor/catalog.js';
import { $, el, clear, debounce } from './util.js';
import { insertText, insertSnippet, focusEditor } from './editor/index.js';

const catsEl = $('#symbol-cats');
const gridEl = $('#symbol-grid');
const filterEl = $('#symbol-filter');
let activeCat = 'Alle';

export function initSymbols() {
  const cats = ['Alle', ...SYMBOLS.map((s) => s.cat)];
  clear(catsEl);
  for (const c of cats) {
    catsEl.append(el('button', {
      class: 'chip' + (c === activeCat ? ' active' : ''),
      text: c,
      onclick: () => { activeCat = c; initSymbols(); filterEl.focus(); },
    }));
  }
  renderGrid(filterEl.value || '');
}

function renderGrid(filter) {
  clear(gridEl);
  const f = filter.trim().toLowerCase();
  for (const group of SYMBOLS) {
    if (activeCat !== 'Alle' && group.cat !== activeCat) continue;
    for (const [display, latex] of group.items) {
      if (f && !display.toLowerCase().includes(f) && !latex.toLowerCase().includes(f)) continue;
      gridEl.append(el('button', {
        class: 'sym',
        title: `${latex}  (${display}) – klicken zum Insert`,
        onclick: () => {
          if (latex.includes('\n')) insertSnippet(latex);
          else insertText(latex);
        },
      }, el('span', { text: display })));
    }
  }
  if (!gridEl.children.length) gridEl.append(el('div', { class: 'problems-empty', text: 'No symbols found' }));
}

export function initSymbolPanel() {
  initSymbols();
  filterEl.addEventListener('input', debounce(() => renderGrid(filterEl.value), 150));
  filterEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = gridEl.querySelector('.sym');
      if (first) first.click();
    }
    if (e.key === 'Escape') { filterEl.value = ''; renderGrid(''); }
  });
}
