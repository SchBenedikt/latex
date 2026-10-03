/* PDF-Vorschau mit pdf.js: Rendern, Zoom, Suche, SyncTeX */

import * as pdfjsLib from 'pdfjs-dist';
import { api } from './api.js';
import { state, emit, on } from './state.js';
import { $, el, clear, toast, flash, debounce, basename } from './util.js';
import { openFile, gotoLine } from './editor/index.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs';

const viewerEl = $('#pdf-viewer');
const pagesEl = $('#pdf-pages');
const emptyEl = $('#pdf-empty');

let pdfDoc = null;
let loadToken = 0;
let pageViews = [];        // {div, canvas, textLayer, num, renderedScale, viewport}
let fitMode = state.settings.pdfZoom || 'fit-width';
let manualScale = 1;
let current = 1;
let baseViewport = null;   // Page 1 bei Scale 1
let textLayerPromises = new Map();

/* ------------------------------------------------------------- Laden */

export async function loadPdf(url, { keepScroll = false } = {}) {
  const token = ++loadToken;
  if (pdfDoc) {
    try { await pdfDoc.destroy(); } catch { /* */ }
    pdfDoc = null;
  }
  const scrollTop = keepScroll ? viewerEl.scrollTop : 0;
  clear(pagesEl);
  emptyEl.classList.add('hidden');
  current = 1;
  updatePageChip();
  pageViews = [];
  textLayerPromises.clear();
  fitMode = state.settings.pdfZoom || 'fit-width';
  $('#pdf-zoom').value = fitMode;

  try {
    const task = pdfjsLib.getDocument({
      url,
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      isEvalSupported: false,
    });
    pdfDoc = await task.promise;
    if (token !== loadToken) return;

    $('#pdf-pagecount').textContent = '/ ' + pdfDoc.numPages;
    const page1 = await pdfDoc.getPage(1);
    baseViewport = page1.getViewport({ scale: 1 });

    for (let n = 1; n <= pdfDoc.numPages; n++) pagesEl.append(createPage(n));
    applyScale(computeScale());

    // Seiten asynchron rendern (zuerst sichtbare)
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      if (token !== loadToken) return;
      await renderPage(n, token);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (token !== loadToken) return;
    if (keepScroll) viewerEl.scrollTop = scrollTop;
    setCurrentPage(1);
    emit('pdf:ready', { pages: pdfDoc.numPages });
  } catch (e) {
    if (token !== loadToken) return;
    console.error(e);
    clear(pagesEl);
    emptyEl.classList.remove('hidden');
    emptyEl.innerHTML = '<p>Could not load PDF.</p><p class="muted">' +
      (e && e.message ? String(e.message).slice(0, 200) : '') + '</p>';
    emit('pdf:error', e);
  }
}

function createPage(num) {
  const div = el('div', { class: 'pdf-page', dataset: { page: String(num) } });
  const canvas = el('canvas');
  const textLayer = el('div', { class: 'text-layer' });
  div.append(canvas, textLayer, el('div', { class: 'page-num', text: String(num) }));
  div.addEventListener('click', (e) => onPdfClick(e, num, div));
  pageViews[num - 1] = { div, canvas, textLayer, num, renderedScale: null, viewport: null };
  return div;
}

function computeScale() {
  if (fitMode === 'fit-width') {
    const w = viewerEl.clientWidth - 36;
    return Math.max(0.2, Math.min(4, w / (baseViewport?.width || 612)));
  }
  if (fitMode === 'fit-page') {
    const w = viewerEl.clientWidth - 36;
    const h = viewerEl.clientHeight - 46;
    const sw = w / (baseViewport?.width || 612);
    const sh = h / (baseViewport?.height || 792);
    return Math.max(0.2, Math.min(4, Math.min(sw, sh)));
  }
  return manualScale;
}

function applyScale(scale) {
  for (const pv of pageViews) {
    if (!pv) continue;
    pv.scale = scale;
    const w = (baseViewport?.width || 612) * scale;
    const h = (baseViewport?.height || 792) * scale;
    pv.div.style.width = w + 'px';
    pv.div.style.height = h + 'px';
    pv.canvas.style.width = w + 'px';
    pv.canvas.style.height = h + 'px';
    pv.textLayer.style.setProperty('--scale-factor', String(scale));
    pv.div.style.setProperty('--scale-factor', String(scale));
  }
}

async function renderPage(num, token) {
  const pv = pageViews[num - 1];
  if (!pv || token !== loadToken) return;
  // Layout changes and PDF loading can request the same canvas concurrently.
  // Queue the whole page render, including its text layer, before reusing it.
  const pending = (pv.renderPromise || Promise.resolve())
    .catch(() => {})
    .then(() => renderPageContent(num, token));
  pv.renderPromise = pending;
  return pending;
}

async function renderPageContent(num, token) {
  const pv = pageViews[num - 1];
  if (!pv || !pdfDoc || token !== loadToken) return;
  const scale = pv.scale || 1;
  if (pv.renderedScale === scale) return;
  const page = await pdfDoc.getPage(num);
  if (token !== loadToken) return;
  const viewport = page.getViewport({ scale });
  pv.viewport = viewport;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = pv.canvas;
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';

  const task = page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  });
  try { await task.promise; } catch (e) {
    if (token === loadToken && e?.name !== 'RenderingCancelledException') console.warn(e);
    return;
  }
  if (token !== loadToken) return;
  pv.renderedScale = scale;

  // Text-Ebene
  try {
    clear(pv.textLayer);
    const textContent = await page.getTextContent();
    if (token !== loadToken) return;
    const tl = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: pv.textLayer,
      viewport,
    });
    await tl.render();
  } catch (e) { console.warn('TextLayer', e); }
}

/* ------------------------------------------------------------- Steuerung */

export function setZoom(value) {
  if (value === 'fit-width' || value === 'fit-page') {
    fitMode = value;
    state.settings.pdfZoom = value;
    $('#pdf-zoom').value = value;
    reRender();
  } else {
    fitMode = 'custom';
    manualScale = Number(value) || 1;
    $('#pdf-zoom').value = String(value);
    reRender();
  }
}

export function zoomBy(factor) {
  const cur = pdfDoc ? pageViews[0]?.viewport.scale || 1 : 1;
  fitMode = 'custom';
  manualScale = Math.max(0.2, Math.min(5, cur * factor));
  const sel = $('#pdf-zoom');
  const opt = [...sel.options].find((o) => o.value === String(manualScale));
  sel.value = opt ? opt.value : '';
  if (!opt) sel.selectedIndex = 0;
  reRender();
}

const reRender = debounce(async () => {
  if (!pdfDoc) return;
  applyScale(computeScale());
  const token = loadToken;
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    if (token !== loadToken) return;
    await renderPage(n, token);
  }
  emit('pdf:scale', pageViews[0]?.viewport.scale || 1);
}, 120);

export function gotoPage(n) {
  if (!pdfDoc) return;
  const num = Math.max(1, Math.min(Number(n) || 1, pdfDoc.numPages));
  const pv = pageViews[num - 1];
  if (!pv) return;
  viewerEl.scrollTo({ top: pv.div.offsetTop - 12, behavior: 'smooth' });
  setCurrentPage(num);
}

export function stepPage(delta) { gotoPage(current + delta); }
export function firstPage() { gotoPage(1); }
export function lastPage() { gotoPage(pdfDoc ? pdfDoc.numPages : 1); }
export function currentPage() { return current; }
export function pageCount() { return pdfDoc ? pdfDoc.numPages : 0; }
export function hasPdf() { return !!pdfDoc; }

function setCurrentPage(n) {
  if (n === current) { updatePageChip(); return; }
  current = n;
  $('#pdf-page').value = String(n);
  updatePageChip();
  emit('pdf:page', n);
}

function updatePageChip() {
  const chip = document.getElementById('pdf-pagechip');
  if (!chip) return;
  const total = pdfDoc ? pdfDoc.numPages : 0;
  if (!total) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  chip.textContent = `${current} / ${total}`;
}

/* ------------------------------------------------------- Seitenverfolgung */

const io = new IntersectionObserver((entries) => {
  let best = null;
  for (const e of entries) {
    if (e.isIntersecting) {
      const n = Number(e.target.dataset.page);
      if (!best || n < best) best = n;
    }
  }
  if (best != null && Math.abs(best - current) >= 1) {
    // nur übernehmen, wenn die Seite wirklich dominanti sichtbar ist
    setCurrentPage(best);
  }
}, { root: viewerEl, threshold: 0.35 });

const obsDebounced = new MutationObserver(() => {
  for (const pv of pageViews) if (pv && !pv.observed) { pv.observed = true; io.observe(pv.div); }
});

function observePages() { obsDebounced.observe(pagesEl, { childList: true }); }
observePages();
on('pdf:ready', () => { for (const pv of pageViews) if (pv && !pv.observed) { pv.observed = true; io.observe(pv.div); } });

window.addEventListener('resize', debounce(() => {
  if ((fitMode === 'fit-width' || fitMode === 'fit-page') && pdfDoc) reRender();
}, 200));

/* -------------------------------------------------------------- SyncTeX */

function onPdfClick(e, page, div) {
  const mode = state.settings.syncMode;
  if (mode === 'off') return;
  if (mode === 'on' && !(e.ctrlKey || e.metaKey)) return;
  if (!pdfDoc) return;
  e.preventDefault();

  const vp = pageViews[page - 1]?.viewport;
  if (!vp) return;
  const rect = div.getBoundingClientRect();
  const [pdfX, pdfY] = vp.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top);
  const pageHeight = baseViewport?.viewBox?.[3] || vp.height;
  // synctex erwartet y mit Ursprung oben
  const yTop = pageHeight - pdfY;

  api.synctex(state.project, {
    op: 'edit', page, x: Math.round(pdfX), y: Math.round(yTop),
    file: state.settings.mainFile,
  }).then((res) => {
    if (!res.ok || !res.result || res.result.line == null) {
      flash('No SyncTeX information found');
      return;
    }
    const r = res.result;
    const file = r.file || state.settings.mainFile;
    if (String(file).startsWith('/')) {
      flash('Quelldatei liegt außerhalb des Projects');
      return;
    }
    openFile(file, { line: r.line, col: r.column || 1 });
    flash(`${basename(file)}:${r.line}  (SyncTeX)`);
  }).catch((err) => flash('SyncTeX: ' + err.message));
}

/** Vorwärts-Sprung: Zeile → PDF-Rechteck markieren */
export async function forwardSync(line, file) {
  if (!pdfDoc || !state.project) return false;
  try {
    const res = await api.synctex(state.project, {
      op: 'view', line, column: 1, file: file || state.settings.mainFile,
    });
    if (!res.ok || !res.result || !res.result.page) {
      flash('No PDF position for this line');
      return false;
    }
    const r = res.result;
    const pv = pageViews[r.page - 1];
    if (!pv) return false;
    gotoPage(r.page);
    await ensureRendered(r.page);
    const vp = pv.viewport;
    if (!vp) return false;
    const pageHeight = baseViewport?.viewBox?.[3] || vp.height;
    const h = r.h ?? r.x;
    const v = r.v ?? r.y;
    if (h == null || v == null) { flash('SyncTeX ohne Koordinaten'); return false; }
    // h/v sind Koordinaten mit Ursprung oben-links → in PDF-Koordinaten umrechnen
    const [vx, vy] = vp.convertToViewportPoint(h, pageHeight - v);
    const box = el('div', {
      class: 'sync-highlight',
      style: {
        left: vx + 'px',
        top: vy + 'px',
        width: Math.max(8, (r.width ?? 20) * vp.scale) + 'px',
        height: Math.max(10, (r.height ?? 12) * vp.scale) + 'px',
      },
    });
    pv.div.append(box);
    setTimeout(() => { box.style.opacity = '0'; setTimeout(() => box.remove(), 500); }, 3200);
    flash(`Seite ${r.page} (SyncTeX)`);
    return true;
  } catch (e) {
    flash('SyncTeX: ' + e.message);
    return false;
  }
}

/** wartet, bis die Seite gerendert wurde (Text-Ebene vorhanden) */
async function ensureRendered(page) {
  const pv = pageViews[page - 1];
  if (!pv || pv.renderedScale === (pv.scale || 1)) return;
  const token = loadToken;
  await renderPage(page, token);
}

/* ---------------------------------------------------------- PDF-Suche */

let searchHits = [];
let searchIndex = -1;

export async function searchInPdf(query) {
  searchHits = [];
  searchIndex = -1;
  $('#pdf-search-info').textContent = '';
  if (!query || !pdfDoc) return;
  const q = query.toLowerCase();
  for (const pv of pageViews) {
    if (!pv) continue;
    const spans = pv.textLayer.querySelectorAll('span');
    spans.forEach((span) => {
      const t = (span.textContent || '').toLowerCase();
      if (t.includes(q)) {
        searchHits.push({ pv, span });
      }
    });
  }
  if (searchHits.length) {
    $('#pdf-search-info').textContent = `${searchHits.length} Treffer`;
    nextSearchHit(1);
  } else {
    $('#pdf-search-info').textContent = 'No matches';
  }
}

function markSearchHit() {
  for (const h of searchHits) h.span.style.background = '';
  const h = searchHits[searchIndex];
  if (!h) return;
  h.span.style.background = 'rgba(255,214,0,.55)';
  h.span.style.borderRadius = '2px';
  const pageDiv = h.pv.div;
  viewerEl.scrollTo({ top: pageDiv.offsetTop - 40, behavior: 'smooth' });
  $('#pdf-search-info').textContent = `${searchIndex + 1} / ${searchHits.length}`;
}

export function nextSearchHit(delta) {
  if (!searchHits.length) return;
  searchIndex = (searchIndex + delta + searchHits.length) % searchHits.length;
  markSearchHit();
}

export function clearSearch() {
  for (const h of searchHits) h.span.style.background = '';
  searchHits = [];
  searchIndex = -1;
}

/* ------------------------------------------------------------- Aktionen */

export function openPdfInTab() {
  const pdf = state.pdf;
  if (!pdf) return;
  window.open(pdf.url || api.pdfUrl(state.project, pdf.file), '_blank');
}

export function downloadPdf() {
  const pdf = state.pdf;
  if (!pdf) return;
  const a = document.createElement('a');
  a.href = pdf.url || api.pdfUrl(state.project, pdf.file);
  a.download = pdf.file;
  document.body.append(a);
  a.click();
  a.remove();
}
