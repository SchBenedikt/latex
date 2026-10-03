/* One stroke-based icon family for the workspace and its menus. */
const paths = {
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.8 2.8 0 0 1 5.6 0c0 2-2.8 2-2.8 4M12 17h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>',
  source: '<path d="M8 5H6a2 2 0 0 0-2 2v3l-2 2 2 2v3a2 2 0 0 0 2 2h2M16 5h2a2 2 0 0 1 2 2v3l2 2-2 2v3a2 2 0 0 1-2 2h-2"/>',
  book: '<path d="M4 4h7a2 2 0 0 1 2 2v15a3 3 0 0 0-3-2H4ZM20 4h-5a2 2 0 0 0-2 2v15a3 3 0 0 1 3-2h4Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  symbols: '<path d="M5 19h4v-3a7 7 0 1 1 6 0v3h4"/>',
  previous: '<path d="m15 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  first: '<path d="M5 5v14m13-13-6 6 6 6"/>',
  last: '<path d="M19 5v14M6 6l6 6-6 6"/>',
  minus: '<path d="M5 12h14"/>',
  sync: '<path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-1-2.6c3.3-.4 6.8-1.6 6.8-7.2a5.6 5.6 0 0 0-1.5-3.9 5.2 5.2 0 0 0-.1-3.9S18 1.1 15 3a13.5 13.5 0 0 0-7 0C5 1.1 3.8 1.5 3.8 1.5a5.2 5.2 0 0 0-.1 3.9 5.6 5.6 0 0 0-1.5 3.9c0 5.6 3.5 6.8 6.8 7.2a3.4 3.4 0 0 0-1 2.6V22"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.3 6a8 8 0 0 1 13 2M4.7 16a8 8 0 0 0 13 2"/>',
  package: '<path d="m12 3 9 5v9l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
};

export function icon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.file}</svg>`;
}

export function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  return icon(['tex', 'sty', 'cls', 'json'].includes(ext) ? 'source'
    : ext === 'bib' ? 'book' : ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext) ? 'image' : 'file');
}

export function initIcons() {
  for (const node of document.querySelectorAll('[data-icon]')) {
    const markup = icon(node.dataset.icon);
    if (node.dataset.iconLabel) node.innerHTML = markup + '<span></span>';
    else node.innerHTML = markup;
    if (node.dataset.iconLabel) node.lastElementChild.textContent = node.dataset.iconLabel;
    if (!node.hasAttribute('aria-label') && node.title) node.setAttribute('aria-label', node.title);
  }
}

const legacyIcons = { '＋': 'plus', '✕': 'close', '↗': 'external', '★': 'star', '✎': 'edit', '⧉': 'copy', '⭳': 'download', '🗑': 'trash', '👁': 'eye', '💾': 'save' };
export function menuIcon(value) { return icon(legacyIcons[value] || value); }

export function commandIcon(command) {
  const label = command.label;
  if (/Paket/.test(label)) return icon('package');
  if (/speichern/.test(label)) return icon('save');
  if (/Engine|Einstellungen/.test(label)) return icon('settings');
  if (/aktualisieren|new laden|initialisieren|umschalten/.test(label)) return icon('refresh');
  if (/Konsole|Konsolen/.test(label)) return icon('terminal');
  if (/schließen|löschen/.test(label)) return icon('close');
  if (/herunterladen|exportieren/.test(label)) return icon('download');
  if (/duplizieren/.test(label)) return icon('copy');
  if (/umbenennen/.test(label)) return icon('edit');
  if (/Symbol|Umgebung/.test(label)) return icon('symbols');
  return icon(({ Build: 'play', files: 'file', Project: 'folder', 'Navigation & Search': 'search', View: 'eye' })[command.grp] || 'file');
}
