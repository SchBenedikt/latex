/* Kleine DOM- und Helfer-Bibliothek ohne Framework */
import { icon, menuIcon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function throttle(fn, ms) {
  let last = 0, timer = null, lastArgs;
  return (...a) => {
    lastArgs = a;
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else if (!timer) {
      timer = setTimeout(() => { timer = null; last = Date.now(); fn(...lastArgs); }, ms - (now - last));
    }
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function basename(p) { return String(p).split('/').pop(); }
export function dirname(p) { const s = String(p); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); }

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function fmtDuration(ms) {
  if (ms < 1000) return ms + ' ms';
  return (ms / 1000).toFixed(1) + ' s';
}

/** Einfacher Fuzzy-Matcher: liefert Score + Matchindizes */
export function fuzzy(query, target) {
  const q = query.toLowerCase(), t = target.toLowerCase();
  if (!q) return { score: 0, idx: [] };
  if (t.includes(q)) return { score: 100 - t.indexOf(q), idx: indexOfCI(target, query) };
  let qi = 0, score = 0; const idx = [];
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { idx.push(i); qi++; score += 2; if (i === 0 || t[i - 1] === ' ' || t[i - 1] === '/' || t[i - 1] === '-') score += 3; }
  }
  if (qi < q.length) return null;
  return { score, idx };
}

function indexOfCI(hay, needle) {
  const i = hay.toLowerCase().indexOf(needle.toLowerCase());
  return i < 0 ? [] : [...Array(needle.length)].map((_, k) => i + k);
}

export function fuzzyHighlight(text, idx, markTag = 'mark') {
  if (!idx || !idx.length) return escapeHtml(text);
  const set = new Set(idx);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (set.has(i)) out += `<${markTag}>${escapeHtml(text[i])}</${markTag}>`;
    else out += escapeHtml(text[i]);
  }
  return out;
}

/* ------------------------------------------------------------- Toasts */

export function toast(message, { title = '', type = '', ms = 3400 } = {}) {
  const root = $('#toasts');
  const node = el('div', { class: 'toast ' + type, role: type === 'err' ? 'alert' : 'status' },
    el('span', { class: 'toast-body' },
      title ? el('b', { text: title }) : null,
      el('span', { text: message }),
    ),
  );
  node.style.setProperty('--toast-ms', ms + 'ms');
  root.append(node);
  const kill = () => { node.style.transition = 'opacity .25s, transform .25s'; node.style.opacity = '0'; node.style.transform = 'translateX(20px)'; setTimeout(() => node.remove(), 260); };
  setTimeout(kill, ms);
  node.addEventListener('click', kill);
  return node;
}

/* ------------------------------------------------------------- Modals */

let modalResolve = null;
let modalReturnFocus = null;
let modalFocusTimer = null;

export function openModal(name) {
  const root = $('#modal-root');
  const modal = $(`.modal[data-modal="${name}"]`, root);
  if (!modal) return null;
  if (root.classList.contains('hidden')) {
    modalReturnFocus = document.activeElement;
    const closedMenu = modalReturnFocus?.closest('details:not([open])');
    if (closedMenu) modalReturnFocus = $('summary', closedMenu);
  }
  clearTimeout(modalFocusTimer);
  root.classList.remove('hidden');
  $('#app').inert = true;
  $$('.modal', root).forEach((m) => m.classList.toggle('active', m.dataset.modal === name));
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const heading = $('h2', modal);
  if (heading) {
    heading.id ||= `dialog-title-${name}`;
    modal.setAttribute('aria-labelledby', heading.id);
  } else {
    modal.setAttribute('aria-label', name === 'quickopen' ? 'Open file' : 'Command palette');
  }
  const card = $('.modal-card', modal);
  if (heading && !$('.modal-dismiss', card)) {
    card.append(el('button', { class: 'modal-dismiss', 'data-close': '',
      'aria-label': 'Close dialog', title: 'Close (Esc)', html: icon('close') }));
  }
  const focusable = $('input:not([disabled]), select:not([disabled]), button:not([disabled])', modal);
  if (focusable) modalFocusTimer = setTimeout(() => {
    if (!modal.classList.contains('active')) return;
    focusable.focus();
    if (focusable.select && focusable.tagName === 'INPUT') focusable.select();
  }, 30);
  return modal;
}

export function closeModal(result) {
  clearTimeout(modalFocusTimer);
  $('#modal-root').classList.add('hidden');
  $('#app').inert = false;
  $$('.modal').forEach((m) => m.classList.remove('active'));
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
  modalReturnFocus = null;
  if (modalResolve) { const r = modalResolve; modalResolve = null; r(result); }
}

document.addEventListener('keydown', (e) => {
  const active = $('.modal.active');
  if (!active) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(null); return; }
  if (e.key !== 'Tab') return;
  const nodes = $$('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]', active)
    .filter((node) => node.getClientRects().length);
  if (!nodes.length) { e.preventDefault(); return; }
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && (document.activeElement === first || !active.contains(document.activeElement))) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !active.contains(document.activeElement))) {
    e.preventDefault(); first.focus();
  }
});

export function modal(name) {
  openModal(name);
  return new Promise((resolve) => { modalResolve = resolve; });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeModal(null);
  if (e.target.id === 'modal-root') closeModal(null);
});

export function promptDialog(title, label = '', value = '', placeholder = '') {
  $('#prompt-title').textContent = title;
  $('#prompt-label').textContent = label;
  const input = $('#prompt-input');
  input.value = value;
  input.placeholder = placeholder;
  const ok = $('#prompt-ok');
  const handler = () => closeModal(input.value);
  ok.onclick = handler;
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handler(); } };
  // Rückgabe ist entscheidend: alle Aufrufer warten auf den Wert
  return modal('prompt');
}

export function confirmDialog(title, text, okLabel = 'OK') {
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  const ok = $('#confirm-ok');
  ok.textContent = okLabel;
  const p = modal('confirm');
  ok.onclick = () => closeModal(true);
  return p;
}

/* --------------------------------------------------------- Kontextmenü */

let ctxNode = null;
export function contextMenu(x, y, items) {
  closeContextMenu();
  const menu = el('div', { class: 'ctx-menu' });
  for (const it of items) {
    if (it === '-') { menu.append(el('hr')); continue; }
    menu.append(el('button', {
      class: it.danger ? 'danger' : '',
      onclick: () => { closeContextMenu(); it.action(); },
    }, it.icon ? el('span', { class: 'ctx-icon', html: menuIcon(it.icon) }) : null, el('span', { text: it.label })));
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  ctxNode = menu;
  setTimeout(() => document.addEventListener('mousedown', outside, { once: true }), 0);
  function outside(e) { if (!menu.contains(e.target)) closeContextMenu(); }
}

export function closeContextMenu() { if (ctxNode) { ctxNode.remove(); ctxNode = null; } }

/* -------------------------------------------------------------- Flags */

export function flash(text, ms = 1400) {
  const f = $('#sync-flash');
  f.textContent = text;
  f.classList.remove('hidden');
  clearTimeout(f._t);
  f._t = setTimeout(() => f.classList.add('hidden'), ms);
}
