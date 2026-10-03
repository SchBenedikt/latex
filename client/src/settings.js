/* Einstellungs-Dialog */

import { $, $$, modal, openModal, closeModal, toast } from './util.js';
import { state, setSettings, DEFAULT_SETTINGS, emit, on } from './state.js';
import { applyEditorSettings, reconfigureAllEditors } from './editor/index.js';
import { applyTheme } from './palette.js';

const MAP = {
  'set-theme': 'theme',
  'set-fontsize': 'fontSize',
  'set-tabsize': 'tabSize',
  'set-wrap': 'wrap',
  'set-autobuild': 'autoBuild',
  'set-autodelay': 'autoBuildDelay',
  'set-engine': 'engine',
  'set-mainfile': 'mainFile',
  'set-shellescape': 'shellEscape',
  'set-showall': 'showAll',
  'set-pdfzoom': 'pdfZoom',
  'set-sync': 'syncMode',
};

function fill() {
  for (const [id, key] of Object.entries(MAP)) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.value = String(state.settings[key]);
  }
}

function collect() {
  const out = {};
  for (const [id, key] of Object.entries(MAP)) {
    const node = document.getElementById(id);
    if (!node) continue;
    let v = node.value;
    if (key === 'fontSize' || key === 'tabSize' || key === 'autoBuildDelay') v = Number(v);
    out[key] = v;
  }
  return out;
}

export function openSettings() {
  fill();
  openModal('settings');
}

export function applySettings(patch) {
  setSettings(patch);
  const root = document.documentElement;

  if ('fontSize' in patch) root.style.setProperty('--editor-size', state.settings.fontSize + 'px');
  if ('theme' in patch) applyTheme();
  if ('wrap' in patch || 'tabSize' in patch) applyEditorSettings(patch);
  if ('showAll' in patch) emit('tree:refresh');
  if ('pdfZoom' in patch) emit('pdf:zoom-setting');
  if ('mainFile' in patch || 'engine' in patch) emit('meta:refresh');

  syncTopbar();
  emit('settings', state.settings);
}

export function syncTopbar() {
  const s = state.settings;
  const eng = $('#engine-select');
  if (eng) eng.value = s.engine;
  const auto = $('#btn-autobuild');
  if (auto) auto.classList.toggle('toggle', s.autoBuild === 'on');
  if (auto) auto.setAttribute('aria-pressed', String(s.autoBuild === 'on'));
}

export function initSettings() {
  $('#btn-settings').addEventListener('click', openSettings);

  $('#set-save').addEventListener('click', () => {
    const patch = collect();
    const prev = { ...state.settings };
    applySettings(patch);
    if (patch.mainFile !== prev.mainFile || patch.engine !== prev.engine) emit('meta:refresh');
    if (patch.tabSize !== prev.tabSize) reconfigureAllEditors();
    closeModal(null);
    toast('Settings saved', { type: 'ok', ms: 1800 });
  });

  $('#set-reset').addEventListener('click', () => {
    Object.assign(state.settings, DEFAULT_SETTINGS);
    fill();
    applySettings({ ...DEFAULT_SETTINGS });
    reconfigureAllEditors();
    toast('Settings reset to defaults', { type: 'warn' });
  });

  $('#set-mainfile').addEventListener('change', () => {
    emit('meta:refresh');
  });

  on('cmd:settings', openSettings);
}
