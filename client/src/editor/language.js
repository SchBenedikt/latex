/* LaTeX-Sprachdefinition: Tokenizer, Highlighting, Faltung, Einrückung */

import { StreamLanguage, HighlightStyle, syntaxHighlighting, foldService, indentService } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const VERBATIM_ENVS = new Set([
  'verbatim', 'Verbatim', 'lstlisting', 'minted', 'alltt', 'comment', 'BVerbatim', 'LVerbatim', 'fvextra',
]);

const PENDING_PKG_CMDS = new Set(['usepackage', 'RequirePackage', 'documentclass', 'LoadClass', 'bibliographystyle']);
const PENDING_ARG_CMDS = new Set([
  'label', 'ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref', 'cite', 'citep', 'citet', 'autocite',
  'parencite', 'textcite', 'footcite', 'Cite', 'input', 'include', 'includegraphics', 'subfile',
  'bibliography', 'addbibresource', 'newcommand', 'renewcommand', 'providecommand', 'newenvironment',
  'title', 'author', 'section', 'subsection', 'subsubsection', 'chapter', 'part', 'caption',
  'hspace', 'vspace', 'setlength', 'operatorname', 'DeclareMathOperator',
]);

const latexParser = {
  name: 'latex',

  startState() {
    return {
      mode: 'normal',      // normal | math | verbatim
      verbatim: null,
      pending: null,       // env | pkg | arg
      mathClose: null,
    };
  },

  token(stream, state) {
    /* ---------------------------------------------------------- verbatim */
    if (state.mode === 'verbatim') {
      const endRe = new RegExp(`\\\\end\\{${state.verbatim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?\\}`);
      const rest = stream.string.slice(stream.pos);
      const m = rest.match(endRe);
      if (m && m.index === 0) {
        stream.match(endRe);
        state.mode = 'normal';
        state.verbatim = null;
        return 'keyword';
      }
      if (stream.eatSpace()) return null;
      stream.skipToEnd();
      return 'string';
    }

    if (stream.eol()) return null;

    const ch = stream.peek();

    /* Kommentar (nicht escaptes %) */
    if (ch === '%' && !isEscaped(stream)) {
      stream.skipToEnd();
      return 'comment';
    }

    /* --------------------------------------------------------- Math-Modus */
    if (state.mode === 'math') {
      if (ch === '\\') {
        const next = stream.string.charAt(stream.pos + 1);
        if (next === state.mathClose && state.mathClose !== '$') {
          stream.next(); stream.next();
          state.mode = 'normal';
          state.mathClose = null;
          return 'operator.special';
        }
        stream.next();
        if (stream.match(/^[a-zA-Z@]+/)) return 'keyword';
        if (!stream.eol()) stream.next();
        return 'keyword';
      }
      if (ch === '$' && !isEscaped(stream)) {
        stream.next();
        if (stream.peek() === '$') stream.next();
        state.mode = 'normal';
        state.mathClose = null;
        return 'operator.special';
      }
      if (stream.match(/^[{}]/)) return 'bracket';
      if (stream.match(/^[0-9]+([.,][0-9]+)?/)) return 'number';
      if (stream.match(/^[+\-*/=<>!&|;:.,^_^~?'@]+/)) return 'operator.special';
      if (stream.match(/^[A-Za-zÄÖÜäöüß]+/)) return 'variableName';
      stream.next();
      return 'operator.special';
    }

    /* Math-Start */
    if (ch === '$' && !isEscaped(stream)) {
      stream.next();
      if (stream.peek() === '$') stream.next();
      state.mode = 'math';
      state.mathClose = '$';
      return 'operator.special';
    }
    if (ch === '\\' && (stream.string.charAt(stream.pos + 1) === '(' || stream.string.charAt(stream.pos + 1) === '[')) {
      stream.next();
      const c = stream.next();
      state.mode = 'math';
      state.mathClose = c === '(' ? ')' : ']';
      return 'operator.special';
    }

    /* ---------------------------------------------------------- Befehle */
    if (ch === '\\') {
      stream.next();
      if (stream.match(/^[a-zA-Z@]+/)) {
        const cmd = stream.current().slice(1);
        if (cmd === 'begin' || cmd === 'end') state.pending = 'env';
        else if (PENDING_PKG_CMDS.has(cmd)) state.pending = 'pkg';
        else if (PENDING_ARG_CMDS.has(cmd)) state.pending = 'arg';
        else state.pending = null;
        return 'keyword';
      }
      const c = stream.next();
      if (c === '%' || c === '$' || c === '#' || c === '&' || c === '_' || c === '{' || c === '}' || c === '\\') {
        state.pending = null;
        return 'keyword';
      }
      return 'keyword';
    }

    /* ----------------------------------------------------------- Gruppen */
    if (ch === '[') {
      if (stream.match(/^[^\]]*\]/)) return state.pending ? 'bracket' : 'bracket';
      stream.next();
      return 'bracket';
    }

    if (ch === '{') {
      if (state.pending) {
        const style = state.pending === 'env' ? 'string.special'
          : state.pending === 'pkg' ? 'string'
          : 'labelName';
        const prev = stream.string.slice(0, stream.start);
        const isEnv = state.pending === 'env' && /\\(begin|end)\s*$/.test(prev);
        if (stream.match(/^[^}]*}/)) {
          if (isEnv) {
            const name = stream.current().replace(/^\{|\}$/g, '').replace(/\*$/, '');
            const cmdIsBegin = /\\begin\s*$/.test(prev);
            if (cmdIsBegin && VERBATIM_ENVS.has(name)) {
              state.mode = 'verbatim';
              state.verbatim = name.replace(/\*$/, '');
            }
          }
          state.pending = null;
          return style;
        }
      }
      stream.next();
      return 'bracket';
    }

    if (ch === '}' || ch === ')' || ch === ']') {
      stream.next();
      state.pending = null;
      return 'bracket';
    }

    if (stream.match(/^[0-9]+(\.[0-9]+)?/)) return 'number';
    if (stream.match(/^[&~^_]/)) return 'keyword';
    if (stream.match(/^[,;:!]/)) return 'operator';
    if (stream.match(/^[A-Za-zÄÖÜäöüß]+/)) return 'variableName';

    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: '%' },
    indentOnInput: /^\s*\\(end|item|\}|group|right)/,
    wordChars: '-_',
  },
};

function isEscaped(stream) {
  const before = stream.string.slice(0, stream.pos);
  let i = before.length - 1, n = 0;
  while (i >= 0 && before[i] === '\\') { n++; i--; }
  return n % 2 === 1;
}

export const latexLanguage = StreamLanguage.define(latexParser);

/* ------------------------------------------------------------ Highlight */

export const latexHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.comment, class: 'tok-comment' },
  { tag: tags.keyword, class: 'tok-command' },
  { tag: tags.special(tags.string), class: 'tok-env' },
  { tag: tags.labelName, class: 'tok-arg' },
  { tag: tags.string, class: 'tok-string' },
  { tag: tags.special(tags.operator), class: 'tok-math' },
  { tag: tags.bracket, class: 'tok-bracket' },
  { tag: tags.number, class: 'tok-number' },
  { tag: tags.operator, class: 'tok-meta' },
  { tag: tags.variableName, class: 'tok-var' },
  { tag: tags.invalid, class: 'tok-error' },
]));

/* ------------------------------------------------------------ Einrückung */

const BEGIN_RE = /\\begin\s*\{/g;
const END_RE = /\\end\s*\{/g;

export function latexIndent(tabSize = 2) {
  return indentService.of((context, pos) => {
    const { state } = context;
    const line = state.doc.lineAt(pos);
    const unit = tabSize;
    const text = line.text;

    if (/^\s*(\\end\b|\\item\b|\}|\\right\b)/.test(text)) {
      const before = context.lineIndent(Math.max(0, line.from - 1), -1);
      return Math.max(0, before - unit);
    }

    let depth = 0;
    for (let i = 1; i < line.number; i++) {
      const t = state.doc.line(i).text;
      if (t.trimStart().startsWith('%')) continue;
      depth += (t.match(BEGIN_RE) || []).length;
      depth -= (t.match(END_RE) || []).length;
      if (depth < 0) depth = 0;
    }
    let ind = depth * unit;
    if (/^\s*\\item\b/.test(text)) ind += unit;
    return ind;
  });
}

/* --------------------------------------------------------------- Faltung */

export function latexFolding() {
  return foldService.of((state, lineStart, lineEnd) => {
    const line = state.doc.lineAt(lineStart);
    const text = line.text;
    const begin = text.match(/^\s*\\begin\s*\{([^}*]+)/);
    if (begin) {
      const envName = begin[1];
      const endRe = new RegExp(`^\\s*\\\\end\\{${escapeRe(envName)}\\*?\\}`);
      for (let n = line.number + 1; n <= state.doc.lines; n++) {
        const l = state.doc.line(n);
        if (endRe.test(l.text)) return { from: lineEnd, to: l.from };
      }
      return null;
    }
    const sec = text.match(/^\s*\\(chapter|part|section|subsection|subsubsection|title)\s*(\[[^\]]*\])?\s*\{/);
    if (sec) {
      for (let n = line.number + 1; n <= state.doc.lines; n++) {
        const l = state.doc.line(n);
        if (/^\s*\\(chapter|part|section|subsection|subsubsection|title)\s*(\[[^\]]*\])?\s*\{/.test(l.text) ||
            /^\s*\\(bibliography|printbibliography)\b/.test(l.text)) {
          if (l.from > lineEnd) return { from: lineEnd, to: l.from };
          return null;
        }
      }
      if (state.doc.length > lineEnd) return { from: lineEnd, to: state.doc.length };
    }
    return null;
  });
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export { escapeRe };
