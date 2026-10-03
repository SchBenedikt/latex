/* Autocomplete: Befehle, Umgebungen, Labels, Zitate, files, Math-Symbole */

import { snippetCompletion } from '@codemirror/autocomplete';
import { COMMANDS, ENVIRONMENTS, DOC_SNIPPETS, SYMBOLS } from './catalog.js';
import { state } from '../state.js';

const CITE_CMDS = '(?:cite|citep|citet|autocite|parencite|textcite|footcite|Cite|citeauthor|citeyear)';
const REF_CMDS = '(?:ref|eqref|autoref|cref|Cref|pageref|vref|Vref|fref)';
const FILE_CMDS = '(?:input|include|subfile|includegraphics|bibliography|addbibresource|includeonly)';

const cmdIndex = COMMANDS.map((c) => ({ ...c, type: 'keyword', apply: c.apply || c.label }));
for (const e of ENVIRONMENTS) {
  cmdIndex.push({ label: e.label, detail: e.detail, type: 'namespace', apply: e.snippet, boost: 3, env: true });
}
for (const [, [display, latex]] of SYMBOLS.map((s) => s.items)) {
  if (!latex.startsWith('\\')) continue;
  cmdIndex.push({ label: latex, detail: display, type: 'constant', section: 'Symbole' });
}

const symbolNames = SYMBOLS.flatMap((s) => s.items)
  .filter(([, l]) => l.startsWith('\\'))
  .map(([display, latex]) => ({ name: latex.slice(1), latex, display }));

/* ------------------------------------------------------- Mathe-Erkennung */

export function inMath(doc, pos) {
  const text = doc.sliceString(0, pos);
  const clean = text.replace(/(^|[^\\])%.*$/gm, '$1');
  const dollars = (clean.match(/(?<!\\)\$(?!$)/g) || []).length;
  const open = (clean.match(/\\\(/g) || []).length - (clean.match(/\\\)/g) || []).length;
  const block = (clean.match(/\\\[/g) || []).length - (clean.match(/\\\]/g) || []).length;
  return dollars % 2 === 1 || open > 0 || block > 0;
}

/* --------------------------------------------------------- Quellen-Router */

export function latexCompletion(context) {
  const { pos, state: st, explicit } = context;
  const line = st.doc.lineAt(pos);
  const before = st.doc.sliceString(Math.max(line.from, pos - 300), pos);
  const word = context.matchBefore(/[\w.*/-]*$/);

  /* \begin{ / \end{ */
  let m = before.match(/\\(begin|end)\s*\{([^}]*)$/);
  if (m) {
    const kind = m[1];
    const openEnvs = kind === 'end' ? openEnvironments(st, pos) : null;
    const list = (openEnvs && openEnvs.length ? ENVIRONMENTS.filter((e) => openEnvs.includes(e.label)) : ENVIRONMENTS)
      .map((e) => ({
        label: e.label,
        detail: e.detail,
        type: 'namespace',
        apply: kind === 'end' ? e.label : undefined,
        snippet: kind === 'end' ? undefined : e.snippet,
        boost: kind === 'end' ? 9 : 4,
      }))
      .map((o) => (o.snippet ? snippetCompletion(o.snippet, { ...o, snippet: undefined }) : o))
      .map((o) => { if (o.apply || o.snippet) return o; return o; });
    return {
      from: pos - (m[2] ? m[2].length : 0),
      options: list,
      validFor: /^[\w*]*$/,
    };
  }

  /* Zitate */
  m = before.match(new RegExp(`\\\\${CITE_CMDS}(?:\\[[^\\]]*\\])*\\{([^},]*)$`));
  if (m) {
    const typed = m[1];
    const cites = state.meta.cites || [];
    const bib = state.meta.bib || [];
    const opts = bib.map((b) => ({
      label: b.key,
      detail: [b.author ? b.author.split(/ and /)[0] : '', b.year].filter(Boolean).join(', '),
      type: 'text',
      info: `<b>${escape(b.title || b.key)}</b><br><span style="opacity:.7">${escape(b.journal || b.type || '')}</span>`,
      boost: cites.includes(b.key) ? 6 : 0,
    }));
    if (!opts.length && cites.length) {
      for (const c of cites) opts.push({ label: c, detail: 'aus .aux', type: 'text' });
    }
    return { from: pos - typed.length, options: opts, validFor: /^[\w:.\-]*$/ };
  }

  /* Referenzen */
  m = before.match(new RegExp(`\\\\${REF_CMDS}(?:\\[[^\\]]*\\])*\\{([^}]*)$`));
  if (m) {
    const typed = m[1];
    const seen = new Map();
    for (const l of state.meta.labels || []) seen.set(l.name, { ...l });
    for (const l of state.meta.auxLabels || []) if (!seen.has(l.name)) seen.set(l.name, l);
    const opts = [...seen.values()].map((l) => ({
      label: l.name,
      detail: l.number ? `Nr. ${l.number} (S. ${l.page || '?'})` : (l.file ? l.file + ':' + (l.line || '?') : 'Label'),
      type: 'reference',
      boost: (state.meta.refs || []).includes(l.name) ? 5 : 0,
    }));
    return { from: pos - typed.length, options: opts, validFor: /^[\w:.\-]*$/ };
  }

  /* files */
  m = before.match(new RegExp(`\\\\${FILE_CMDS}(?:\\[[^\\]]*\\])?\\{([^}]*)$`));
  if (m) {
    const typed = m[1];
    const cmd = before.match(new RegExp(`\\\\(${FILE_CMDS.split('|').join('|')})`))?.[1] || '';
    const files = state.files || [];
    let allow;
    if (cmd === 'includegraphics') allow = /\.(png|jpe?g|gif|svg|pdf|eps|bmp|tiff?)$/i;
    else if (cmd === 'bibliography' || cmd === 'addbibresource') allow = /\.bib$/i;
    else allow = /\.tex$/i;
    const opts = files.filter((f) => allow.test(f)).map((f) => ({
      label: f,
      detail: 'File',
      type: 'file',
      apply: f.replace(/\.tex$/i, cmd === 'includegraphics' || cmd === 'bibliography' || cmd === 'addbibresource' ? '' : ''),
      boost: 4,
    }));
    return { from: pos - typed.length, options: opts, validFor: /^[\w./\-]*$/ };
  }

  /* Nach Befehlspräfix */
  const cmdPrefix = before.match(/\\[a-zA-Z@]*$/);
  if (cmdPrefix) {
    const from = pos - cmdPrefix[0].length;
    const opts = cmdIndex
      .filter((c) => !c.env)
      .map((c) => ({ ...c }));
    return { from, options: opts, validFor: /^\\[\w@]*$/ };
  }

  /* Mathe: nackte Wörter wie "alpha" → \alpha */
  if (inMath(st.doc, pos) && word && word.from < pos) {
    const typed = word.text;
    if (/^[a-zA-Z][a-zA-Z]*$/.test(typed) && typed.length >= 2) {
      const opts = symbolNames
        .filter((s) => s.name.startsWith(typed) || s.name.toLowerCase().startsWith(typed.toLowerCase()))
        .slice(0, 40)
        .map((s) => ({ label: s.name, detail: s.display, type: 'constant', apply: s.latex, boost: 2 }));
      if (opts.length) return { from: word.from, options: opts, validFor: /^[a-zA-Z]*$/ };
    }
  }

  /* Explizit (Strg+Leertaste): Dokumentsnippets anbieten */
  if (explicit) {
    const from = word ? word.from : pos;
    const opts = DOC_SNIPPETS.map((s) =>
      snippetCompletion(s.snippet, { label: s.label, detail: s.detail, type: 'text', boost: 7 }));
    return { from, options: opts, validFor: /^[\w]*$/ };
  }

  return null;
}

function openEnvironments(st, pos) {
  const text = st.doc.sliceString(0, pos);
  const stack = [];
  const re = /\\(begin|end)\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[2].replace(/\*$/, '');
    if (m[1] === 'begin') stack.push(name);
    else {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === name) { stack.length = i; break; }
      }
    }
  }
  return stack;
}

function escape(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ------------------------------------------------------ Befehlsübersicht */

export function commandSections() {
  const map = new Map();
  for (const c of COMMANDS) {
    if (!map.has(c.section)) map.set(c.section, []);
    map.get(c.section).push(c);
  }
  return [...map.entries()];
}
