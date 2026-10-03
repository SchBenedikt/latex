/* Statusleiste */

import { state, on } from './state.js';
import { $, debounce, basename } from './util.js';
import { currentPath, currentText } from './editor/index.js';

const wordStats = debounce(() => {
  const path = currentPath();
  if (!path) { $('#st-words').textContent = '0 words'; return; }
  const text = currentText() || '';
  const noComments = text.replace(/(^|[^\\])%.*$/gm, '$1');
  const words = (noComments.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const chars = text.length;
  const lines = text ? text.split('\n').length : 0;
  $('#st-words').textContent = `${words.toLocaleString('en-US')} words · ${chars.toLocaleString('en-US')} characters · ${lines.toLocaleString('en-US')} lines`;
  $('#st-words').title = `${words} words, ${chars} characters (excluding comments), ${lines} lines`;
}, 300);

export function initStatus() {
  on('cursor', (c) => {
    $('#st-cursor').textContent = `Line ${c.line}, column ${c.col}`;
  });
  on('dirty', wordStats);
  on('saved', wordStats);
  on('active-file', (p) => {
    $('#st-latex').textContent = p ? (p.endsWith('.bib') ? 'BibTeX' : p.endsWith('.tex') ? 'LaTeX' : 'Text') : 'LaTeX';
    wordStats();
  });
  on('project', (p) => { $('#st-project').textContent = p || '–'; $('#st-project').title = 'Project: ' + p; });
  on('settings', () => {
    $('#st-indent').textContent = `${state.settings.tabSize} spaces`;
    $('#st-wrap').textContent = state.settings.wrap === 'on' ? 'Word wrap: On' : 'Word wrap: Off';
  });
  $('#st-wrap').addEventListener('click', () => {
    const wrap = state.settings.wrap === 'on' ? 'off' : 'on';
    import('./settings.js').then((m) => m.applySettings({ wrap }));
  });

  $('#st-project').textContent = state.project || '–';
  $('#st-indent').textContent = `${state.settings.tabSize} spaces`;
  $('#st-wrap').textContent = state.settings.wrap === 'on' ? 'Word wrap: On' : 'Word wrap: Off';
  wordStats();
}
