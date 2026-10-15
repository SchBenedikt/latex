/* Keyboard specialties for LaTeX: automatic \end closing */

import { EditorView } from '@codemirror/view';
import { escapeRe } from './language.js';

/**
 * When the user types `}` to close `\begin{xyz}` (the closing
 * brace was added by closeBrackets automatically), a line break,
 * indentation, and `\end{xyz}` are automatically generated.
 */
export function envCloseHandler(getTabSize) {
  return EditorView.domEventHandlers({
    keydown(e, view) {
      if (e.key !== '}' || e.ctrlKey || e.altKey || e.metaKey) return false;
      if (view.state.selection.ranges.length !== 1) return false;

      const pos = view.state.selection.main.head;
      const doc = view.state.doc;
      const line = doc.lineAt(pos);
      const before = doc.sliceString(line.from, pos);

      const m = before.match(/\\begin\s*\{([a-zA-Z*@]+)$/);
      if (!m) return false;

      const after = doc.sliceString(pos, Math.min(doc.length, pos + 80));
      if (!after.startsWith('}')) return false;

      const env = m[1];
      const rest = after.slice(1);
      if (new RegExp(`^\\s*\\\\end\\{${escapeRe(env)}\\*?\\}`).test(rest)) return false;

      const unit = ' '.repeat(Math.max(1, getTabSize ? getTabSize() : 2));
      const base = (line.text.match(/^\s*/) || [''])[0];
      const closing = `\n${base}${unit}\n${base}\\end{${env}}`;
      const cursorOffset = 1 + 1 + base.length + unit.length; // nach "\n<base><unit>"

      view.dispatch({
        changes: { from: pos + 1, insert: closing },
        selection: { anchor: pos + 1 + (1 + base.length + unit.length) },
        scrollIntoView: true,
      });
      void cursorOffset;
      return true;
    },
  });
}
