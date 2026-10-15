/* Insert wizards: guided snippets for tables, figures, math, lists and citations. */

import { promptDialog, toast } from './util.js';
import { insertSnippet, insertText, currentPath } from './editor/index.js';
import { state } from './state.js';

async function ask(title, label, value = '', placeholder = '') {
  const v = await promptDialog(title, label, value, placeholder);
  return v == null ? null : String(v).trim();
}

export async function insertTableWizard() {
  const cols = await ask('Insert table', 'Columns (e.g. lcc or 3)', 'lcc', 'lcc');
  if (cols == null || !cols) return;
  let n = 3;
  if (/^\d+$/.test(cols)) {
    n = Math.max(1, Math.min(8, parseInt(cols, 10)));
  } else {
    n = cols.replace(/[^lcrXpmb|]/g, '').replace(/\|/g, '').length || 3;
  }
  const rows = await ask('Insert table', 'Data rows (1–12)', '3', '3');
  if (rows == null) return;
  const r = Math.max(1, Math.min(12, parseInt(rows, 10) || 3));
  const spec = /^\d+$/.test(cols) ? 'c'.repeat(n) : cols;
  const header = Array.from({ length: n }, (_, i) => `Header ${i + 1}`).join(' & ') + ' \\\\';
  const body = Array.from({ length: r }, () => Array.from({ length: n }, () => '---').join(' & ') + ' \\\\').join('\n\t\t');
  insertSnippet(`\\begin{table}[htbp]\n\t\\centering\n\t\\caption{\${1:Caption}}\n\t\\label{tab:\${2:name}}\n\t\\begin{tabular}{${spec}}\n\t\t\\toprule\n\t\t${header}\n\t\t\\midrule\n\t\t${body}\n\t\t\\bottomrule\n\t\\end{tabular}\n\\end{table}`);
  toast('Table inserted', { type: 'ok', ms: 1500 });
}

export async function insertFigureWizard() {
  const path = await ask('Insert figure', 'Image path (e.g. figures/plot.pdf)', 'figures/', 'figures/plot.pdf');
  if (path == null || !path) return;
  const width = await ask('Insert figure', 'Width (fraction of line width)', '0.8\\linewidth', '0.8\\linewidth');
  if (width == null) return;
  insertSnippet(`\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=${width || '0.8\\linewidth'}]{${path}}\n\t\\caption{\${1:Caption}}\n\t\\label{fig:\${2:name}}\n\\end{figure}`);
  toast('Figure inserted', { type: 'ok', ms: 1500 });
}

export async function insertEquationWizard() {
  const kind = await ask('Insert math', 'Environment: equation, align, inline ($…$)', 'equation', 'equation | align | inline');
  if (kind == null || !kind) return;
  const k = kind.toLowerCase();
  if (k.startsWith('inline') || k === '$') {
    insertSnippet('$${1:x^2 + y^2 = z^2}$');
  } else if (k.startsWith('align')) {
    insertSnippet('\\begin{align}\n\t${1:a} &= ${2:b} \\\\\n\t$0\n\\end{align}');
  } else {
    insertSnippet('\\begin{equation}\n\t${1:E = mc^2}\n\t\\label{eq:${2:name}}\n\\end{equation}');
  }
  toast('Math inserted', { type: 'ok', ms: 1500 });
}

export async function insertListWizard() {
  const kind = await ask('Insert list', 'Type: itemize, enumerate, description', 'itemize', 'itemize | enumerate | description');
  if (kind == null || !kind) return;
  const k = kind.toLowerCase();
  if (k.startsWith('enum')) {
    insertSnippet('\\begin{enumerate}\n\t\\item ${1:First}\n\t\\item ${2:Second}\n\t$0\n\\end{enumerate}');
  } else if (k.startsWith('descr')) {
    insertSnippet('\\begin{description}\n\t\\item[${1:Term}] ${2:Definition}\n\t$0\n\\end{description}');
  } else {
    insertSnippet('\\begin{itemize}\n\t\\item ${1:First}\n\t\\item ${2:Second}\n\t$0\n\\end{itemize}');
  }
  toast('List inserted', { type: 'ok', ms: 1500 });
}

export async function insertCitationWizard() {
  const keys = (state.meta?.bib || []).map((b) => b.key).filter(Boolean);
  const hint = keys.length ? `Available keys: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ' …' : ''}` : 'No bibliography keys detected — build the project to refresh them.';
  const key = await ask('Insert citation', keys.length ? `Citation key (${hint})` : hint, keys[0] || '', 'doe2024');
  if (key == null || !key) return;
  const cmd = await ask('Insert citation', 'Command: cite, citep, citet, parencite, textcite, autocite', 'cite', 'cite');
  if (cmd == null) return;
  const c = (cmd || 'cite').replace(/[^a-z]/gi, '') || 'cite';
  insertText(`\\${c}{${key}}`);
  if (!currentPath()) toast('Citation inserted', { type: 'ok', ms: 1500 });
}

export async function insertTodoNote() {
  insertSnippet('% TODO: ${1:describe the open point}');
  toast('Note inserted', { type: 'ok', ms: 1500 });
}
