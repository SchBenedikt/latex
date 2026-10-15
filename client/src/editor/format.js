/* Text tools for the editor: line comment toggle and LaTeX style wrappers.
 * They work on the current selection (or the word around the cursor). */

const STYLES = {
  textbf: ['\\textbf{', '}'],
  textit: ['\\textit{', '}'],
  emph: ['\\emph{', '}'],
  underline: ['\\underline{', '}'],
  math: ['$', '$'],
  quote: ['``', "''"],
};

/** Comments or uncomments every line touched by the selection with `%`. */
export function toggleLineComment(view) {
  const { state } = view;
  const lines = new Set();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  const numbers = [...lines].sort((a, b) => a - b);
  if (!numbers.length) return false;
  const allCommented = numbers.every((n) => /^\s*%/.test(state.doc.line(n).text));
  const changes = [];
  for (const n of numbers) {
    const line = state.doc.line(n);
    if (allCommented) {
      const m = line.text.match(/^(\s*)%\s?/);
      if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: m[1] });
    } else {
      const indent = (line.text.match(/^(\s*)/) || [''])[0];
      if (!/^\s*%/.test(line.text)) changes.push({ from: line.from + indent.length, insert: '% ' });
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes, scrollIntoView: true });
  return true;
}

/** Wraps the selection in a LaTeX command; wraps again to remove it. */
export function wrapSelection(view, style) {
  const [open, close] = STYLES[style] || [];
  if (!open) return false;
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  const before = view.state.sliceDoc(Math.max(0, range.from - open.length), range.from);
  const after = view.state.sliceDoc(range.to, Math.min(view.state.doc.length, range.to + close.length));

  if (text && before === open && after === close) {
    view.dispatch({
      changes: { from: range.from - open.length, to: range.to + close.length, insert: text },
      selection: { anchor: range.from - open.length, head: range.from - open.length + text.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }
  if (text) {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: open + text + close },
      selection: { anchor: range.from + open.length, head: range.from + open.length + text.length },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }
  view.dispatch({
    changes: { from: range.from, insert: open + close },
    selection: { anchor: range.from + open.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export const TEXT_STYLES = STYLES;
