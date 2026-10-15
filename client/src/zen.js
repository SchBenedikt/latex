/* Zen focus mode: hide side panels and keep only the editor. */

import { state, emit } from './state.js';
import { toast } from './util.js';

let previousView = null;

export function isZen() {
  return document.body.classList.contains('zen');
}

export function toggleZen(force) {
  const next = force !== undefined ? !!force : !isZen();
  document.body.classList.toggle('zen', next);
  if (next) {
    previousView = document.querySelector('#main')?.dataset.view || 'split';
    document.querySelector('#bottom-panel')?.classList.add('hidden');
  } else if (previousView) {
    const main = document.querySelector('#main');
    if (main && previousView !== 'source') {
      // restore a preview view only if a PDF exists
      main.dataset.view = state.pdf ? previousView : 'source';
    }
  }
  document.querySelector('#btn-zen')?.classList.toggle('toggle', next);
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('latex:resize'));
  emit('zen', next);
  toast(next ? 'Focus mode on — press Alt+Z to exit' : 'Focus mode off', { type: 'ok', ms: 1800 });
  return next;
}

export function initZen() {
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey) {
      const modalOpen = !document.querySelector('#modal-root')?.classList.contains('hidden');
      if (modalOpen) return;
      e.preventDefault();
      toggleZen();
    }
  });
}
