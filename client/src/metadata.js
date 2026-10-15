/* Document metadata editor: reads and writes \title, \author, \date and
 * hyperref PDF metadata (pdfsubject, pdfkeywords) in the main document. */

import { api } from './api.js';
import { state, emit } from './state.js';
import { $, el, clear, openModal, closeModal, toast } from './util.js';
import { reloadFile } from './editor/index.js';

/* --------------------------------------------------- Source text helpers */

/** Finds the closing brace of the {...} starting at `open` (index of '{'). */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function readCommand(src, cmd) {
  const re = new RegExp('\\\\' + cmd + '\\s*(?:\\[[^\\]]*\\])?\\s*\\{');
  const m = re.exec(src);
  if (!m) return '';
  const open = m.index + m[0].length - 1;
  const close = matchBrace(src, open);
  return close > open ? src.slice(open + 1, close).trim() : '';
}

function writeCommand(src, cmd, value) {
  const re = new RegExp('\\\\' + cmd + '\\s*(?:\\[[^\\]]*\\])?\\s*\\{');
  const m = re.exec(src);
  if (m) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(src, open);
    if (close > open) return src.slice(0, open + 1) + value + src.slice(close);
  }
  if (!value) return src;
  const docIdx = src.search(/\\begin\s*\{document\}/);
  const line = `\\${cmd}{${value}}`;
  if (docIdx >= 0) {
    const head = src.slice(0, docIdx).replace(/\s*$/, '\n\n');
    return head + line + '\n\n' + src.slice(docIdx);
  }
  return `${src.trimEnd()}\n\n${line}\n`;
}

function readPdfField(src, field) {
  const m = new RegExp(field + '\\s*=\\s*\\{').exec(src);
  if (!m) return '';
  const open = m.index + m[0].length - 1;
  const close = matchBrace(src, open);
  return close > open ? src.slice(open + 1, close).trim() : '';
}

function writePdfField(src, field, value) {
  const m = new RegExp(field + '\\s*=\\s*\\{').exec(src);
  if (m) {
    if (!value) return src;
    const open = m.index + m[0].length - 1;
    const close = matchBrace(src, open);
    if (close > open) return src.slice(0, open + 1) + value + src.slice(close);
    return src;
  }
  if (!value) return src;
  // add to an existing \hypersetup{...} or create one before \begin{document}
  const hs = /\\hypersetup\s*\{/.exec(src);
  if (hs) {
    const open = hs.index + hs[0].length - 1;
    const close = matchBrace(src, open);
    if (close > open) {
      const inner = src.slice(open + 1, close);
      const sep = inner.trim() ? (inner.trimEnd().endsWith(',') ? ' ' : ', ') : '';
      return src.slice(0, open + 1) + inner + sep + `${field}={${value}}` + src.slice(close);
    }
  }
  const docIdx = src.search(/\\begin\s*\{document\}/);
  const line = `\\hypersetup{${field}={${value}}}`;
  if (docIdx >= 0) {
    const head = src.slice(0, docIdx).replace(/\s*$/, '\n\n');
    return head + line + '\n\n' + src.slice(docIdx);
  }
  return `${src.trimEnd()}\n\n${line}\n`;
}

/* -------------------------------------------------------------- Dialog */

const FIELDS = [
  ['meta-title', 'Title', 'title', 'cmd'],
  ['meta-author', 'Author', 'author', 'cmd'],
  ['meta-date', 'Date', 'date', 'cmd'],
  ['meta-subject', 'PDF subject', 'pdfsubject', 'pdf'],
  ['meta-keywords', 'PDF keywords', 'pdfkeywords', 'pdf'],
];

export async function openMetadata() {
  const project = state.project;
  if (!project) { toast('No project selected', { type: 'warn' }); return; }
  const mainPath = `${project}/${state.settings.mainFile || 'main.tex'}`;
  let src;
  try {
    const res = await api.file(mainPath);
    src = typeof res === 'string' ? res : (res?.content ?? '');
  } catch (e) {
    toast('Could not read the main file: ' + e.message, { type: 'err' });
    return;
  }

  for (const [id, , key, kind] of FIELDS) {
    const input = document.getElementById(id);
    if (!input) continue;
    input.value = kind === 'cmd' ? readCommand(src, key) : readPdfField(src, key);
  }
  $('#meta-file').textContent = state.settings.mainFile || 'main.tex';
  openModal('metadata');

  $('#meta-save').onclick = async () => {
    let next = src;
    for (const [id, , key, kind] of FIELDS) {
      const input = document.getElementById(id);
      if (!input) continue;
      const value = input.value.trim();
      next = kind === 'cmd' ? writeCommand(next, key, value) : writePdfField(next, key, value);
    }
    if (next === src) { closeModal(null); toast('Metadata unchanged', { type: 'ok', ms: 1600 }); return; }
    const openDoc = state.docs.get(mainPath);
    if (openDoc && !openDoc.saved) {
      toast(`Save ${state.settings.mainFile} first, then edit the metadata.`, { type: 'warn', ms: 6000 });
      return;
    }
    try {
      await api.saveFile(mainPath, next);
      await reloadFile(mainPath);
      emit('meta:refresh');
      emit('history:note', { note: 'project', label: 'Document metadata updated' });
      closeModal(null);
      toast('Metadata saved. Rebuild to update the PDF.', { type: 'ok', ms: 4000 });
    } catch (e) {
      toast('Could not save metadata: ' + e.message, { type: 'err', ms: 6000 });
    }
  };
}

export function initMetadata() {
  $('#btn-metadata')?.addEventListener('click', openMetadata);
}
