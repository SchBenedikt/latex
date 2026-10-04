/* Read-only Zotero library browser with incremental, browser-local sync. */
import { browserWorkspace } from './browser-workspace.js';
import { api } from './api.js';
import { state, emit } from './state.js';
import { $, el, clear, openModal, closeModal, toast } from './util.js';
import { insertText, insertTextAt, reloadFile, currentPath, currentText } from './editor/index.js';

const CONFIG_KEY = 'zotero/config';
const POLL_MS = 30_000;
let config = null;
let libraryState = null;
let currentItems = [];
let selectedItem = null;
let syncing = false;
let timer = null;
let previewObjectUrl = null;
let retryAfter = 0;

function libraryKey(c = config) { return c ? `${c.libraryType}:${c.libraryId}` : ''; }
function itemPrefix(c = config) { return `zotero/item/${libraryKey(c)}/`; }
function collectionPrefix(c = config) { return `zotero/collection/${libraryKey(c)}/`; }
function rootPath(c = config) { return `${c.libraryType === 'group' ? 'groups' : 'users'}/${c.libraryId}`; }

async function readConfig() {
  config = await browserWorkspace.integrationGet(CONFIG_KEY);
  if (!config?.libraryType || !/^\d+$/.test(String(config.libraryId))) config = null;
  if (config) libraryState = await browserWorkspace.integrationGet(`zotero/state/${libraryKey()}`);
}

function requestHeaders(c = config, extra = {}) {
  const headers = new Headers({ 'Zotero-API-Version': '3', ...extra });
  if (c?.apiKey) headers.set('Zotero-API-Key', c.apiKey);
  return headers;
}

async function zoteroRequest(path, c = config, extra = {}) {
  const response = await fetch(`https://api.zotero.org/${path.replace(/^\//, '')}`, {
    headers: requestHeaders(c, extra),
  });
  const backoff = Number(response.headers.get('backoff') || 0);
  if (backoff > 0) retryAfter = Math.max(retryAfter, Date.now() + backoff * 1000);
  if (response.status === 304) return { response, data: null };
  if (!response.ok) {
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after') || 60);
      retryAfter = Math.max(retryAfter, Date.now() + seconds * 1000);
    }
    const messages = {
      403: 'Zotero denied access. Check the library ID and use an API key with read access to this library.',
      404: 'Zotero could not find that user or group library.',
      429: `Zotero rate limited this connection. Wait ${response.headers.get('retry-after') || 'a little'} seconds and try again.`,
    };
    throw new Error(messages[response.status] || `Zotero request failed (${response.status}).`);
  }
  return { response, data: await response.json() };
}

async function fetchAll(path, c, { since = null } = {}) {
  const rows = [];
  let start = 0;
  let version = null;
  let total = 0;
  do {
    const query = new URLSearchParams({ limit: '100', start: String(start), v: '3' });
    if (path.startsWith('items')) { query.set('include', 'data,bibtex'); query.set('includeTrashed', '1'); }
    if (since != null) query.set('since', String(since));
    const { response, data } = await zoteroRequest(`${rootPath(c)}/${path}?${query}`, c);
    version ||= response.headers.get('last-modified-version');
    total = Number(response.headers.get('total-results') || 0);
    rows.push(...(Array.isArray(data) ? data : []));
    start += data?.length || 0;
    if (!data?.length) break;
  } while (start < total);
  return { rows, version };
}

async function saveObjects(items, c, { full = false } = {}) {
  const prefix = itemPrefix(c);
  const existing = await browserWorkspace.integrationList(prefix);
  const seen = new Set();
  for (const item of items) {
    const data = item.data || {};
    if (!item.key || ['attachment', 'note'].includes(data.itemType)) continue;
    if (data.deleted) { await browserWorkspace.integrationDelete(`${prefix}${item.key}`); continue; }
    seen.add(item.key);
    await browserWorkspace.integrationSet(`${prefix}${item.key}`, item);
  }
  if (full) for (const row of existing) {
    const key = row.id.slice(`@integration/${prefix}`.length);
    if (!seen.has(key)) await browserWorkspace.integrationDelete(`${prefix}${key}`);
  }
}

async function syncCollections(c) {
  const { rows } = await fetchAll('collections', c);
  const prefix = collectionPrefix(c);
  const previous = await browserWorkspace.integrationList(prefix);
  const nextKeys = new Set(rows.map((row) => row.key));
  for (const row of previous) {
    const key = row.id.slice(`@integration/${prefix}`.length);
    if (!nextKeys.has(key)) await browserWorkspace.integrationDelete(`${prefix}${key}`);
  }
  for (const row of rows) await browserWorkspace.integrationSet(`${prefix}${row.key}`, row);
  return rows;
}

async function syncLibrary({ force = false, quiet = false } = {}) {
  if (!config || syncing) return;
  if (!force && Date.now() < retryAfter) { setSyncLabel('Waiting for Zotero rate limit'); return; }
  syncing = true;
  const syncButton = $('#zotero-sync');
  if (syncButton) syncButton.disabled = true;
  setSyncLabel('Syncing…');
  try {
    const c = { ...config };
    let changed = 0;
    let version = libraryState?.version || null;
    if (!version || force) {
      const result = await fetchAll('items/top', c);
      await saveObjects(result.rows, c, { full: true });
      version = result.version || version;
      changed = result.rows.length;
      await syncCollections(c);
    } else {
      const check = await zoteroRequest(`${rootPath(c)}/items/top?limit=1&v=3`, c, { 'If-Modified-Since-Version': String(version) });
      if (check.response.status !== 304) {
        const result = await fetchAll('items/top', c, { since: version });
        await saveObjects(result.rows, c);
        changed = result.rows.length;
        version = check.response.headers.get('last-modified-version') || result.version || version;
        await syncCollections(c);
      }
    }
    libraryState = { ...(libraryState || {}), version, lastSync: Date.now() };
    await browserWorkspace.integrationSet(`zotero/state/${libraryKey(c)}`, libraryState);
    await refreshZoteroPanel({ quiet });
    if (changed && !quiet) toast(`Zotero synced · ${changed} source${changed === 1 ? '' : 's'} updated`, { type: 'ok', ms: 4500 });
    return changed;
  } catch (error) {
    setSyncLabel('Sync paused');
    if (!quiet) toast(error.message, { type: 'err', ms: 8000 });
    throw error;
  } finally {
    syncing = false;
    if (syncButton) syncButton.disabled = false;
  }
}

function displayCreators(item) {
  const data = item?.data || {};
  const creators = data.creators || [];
  return creators.map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')).filter(Boolean).join(', ')
    || item?.meta?.creatorSummary || 'Unknown creator';
}

function citationKey(item) {
  if (item?._latexStudioCitationKey) return item._latexStudioCitationKey;
  const fromData = item?.data?.citationKey?.trim();
  if (fromData) return fromData;
  return item?.bibtex?.match(/@[\w-]+\s*[({]\s*([^,\s]+)/)?.[1] || '';
}

function bibEntryForKey(source, key) {
  const text = String(source || '');
  const pattern = /@([\w-]+)\s*([({])\s*([^,\s]+)\s*,/g;
  let match;
  while ((match = pattern.exec(text))) {
    const opener = match[2], closer = opener === '{' ? '}' : ')';
    let depth = 1, quoted = false, escaped = false, end = match.index + match[0].length;
    for (; end < text.length && depth; end++) {
      const ch = text[end];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') quoted = !quoted;
      if (!quoted && ch === opener) depth++;
      else if (!quoted && ch === closer) depth--;
    }
    if (match[3].toLocaleLowerCase() === key.toLocaleLowerCase()) return text.slice(match.index, end);
    pattern.lastIndex = end;
  }
  return '';
}

function bibEntryMatchesSource(entry, item) {
  const normalize = (value) => String(value || '').replace(/\\[a-zA-Z]+(?:\s*\{[^{}]*\})?/g, ' ').replace(/[{}]/g, ' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const title = normalize(item?.data?.title);
  const doi = normalize(item?.data?.DOI);
  const candidate = normalize(entry);
  return (title && candidate.includes(title)) || (doi && candidate.includes(doi));
}

function rewriteBibtexKey(item, key) {
  return String(item?.bibtex || '').replace(/^(\s*@[\w-]+\s*[({]\s*)[^,\s]+/, `$1${key}`);
}

function filteredItems() {
  const query = ($('#zotero-search')?.value || '').trim().toLocaleLowerCase();
  const collection = $('#zotero-collection')?.value || '';
  return currentItems.filter((item) => {
    const data = item.data || {};
    if (collection && !(data.collections || []).includes(collection)) return false;
    if (!query) return true;
    return [data.title, displayCreators(item), data.date, data.DOI, data.publicationTitle, ...(data.tags || []).map((tag) => tag.tag)]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
}

function setSyncLabel(text) {
  const node = $('#zotero-sync-state');
  if (node) node.textContent = text;
}

async function renderCollections() {
  const select = $('#zotero-collection');
  if (!select) return;
  const chosen = select.value;
  clear(select);
  select.append(el('option', { value: '', text: 'All collections' }));
  const entries = await browserWorkspace.integrationList(collectionPrefix());
  const rows = entries.map((entry) => entry.value).sort((a, b) => (a.data?.name || '').localeCompare(b.data?.name || ''));
  const byKey = new Map(rows.map((row) => [row.key, row.data]));
  const labelFor = (row) => {
    const names = [row.name];
    let parent = row.parentCollection;
    while (parent && byKey.has(parent)) { const item = byKey.get(parent); names.unshift(item.name); parent = item.parentCollection; }
    return names.join(' / ');
  };
  for (const row of rows) select.append(el('option', { value: row.key, text: labelFor(row.data) }));
  if (rows.some((row) => row.key === chosen)) select.value = chosen;
}

export async function refreshZoteroPanel({ quiet = true } = {}) {
  const list = $('#zotero-source-list');
  if (!list) return;
  await readConfig();
  const connect = $('#zotero-connect-open');
  if (!config) {
    $('#zotero-connection-state').textContent = 'Not connected';
    setSyncLabel('');
    connect.hidden = false;
    clear(list);
    list.append(el('div', { class: 'zotero-empty' },
      el('div', { class: 'zotero-empty-mark', text: 'Z' }),
      el('strong', { text: 'Your research library, in context' }),
      el('p', { text: 'Connect a Zotero library to browse sources, inspect details, and add citations without leaving your document.' }),
    ));
    return;
  }
  connect.hidden = true;
  const name = config.libraryType === 'group' ? 'Group' : 'Personal';
  $('#zotero-connection-state').textContent = `${name} library · ${config.libraryId}`;
  setSyncLabel(libraryState?.lastSync ? `Synced ${new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.max(0, Math.round((Date.now() - libraryState.lastSync) / 60000)), 'minute')}` : 'Waiting for first sync');
  await renderCollections();
  const entries = await browserWorkspace.integrationList(itemPrefix());
  currentItems = entries.map((entry) => entry.value).sort((a, b) => String(b.data?.dateAdded || '').localeCompare(String(a.data?.dateAdded || '')));
  clear(list);
  const filtered = filteredItems();
  if (!filtered.length) {
    list.append(el('div', { class: 'zotero-list-empty', text: currentItems.length ? 'No sources match this filter.' : 'No sources cached yet. Sync to load your library.' }));
    return;
  }
  for (const item of filtered) {
    const data = item.data || {};
    const row = el('button', { class: 'zotero-source-row', title: 'View source details', onclick: () => openSource(item) },
      el('span', { class: 'zotero-source-title', text: data.title || '(Untitled source)' }),
      el('span', { class: 'zotero-source-meta', text: `${displayCreators(item)} · ${(data.date || '').slice(0, 4) || 'n.d.'}` }),
      el('span', { class: 'zotero-source-type', text: String(data.itemType || 'source').replace(/([a-z])([A-Z])/g, '$1 $2') }),
    );
    list.append(row);
  }
  if (!quiet) list.scrollTop = 0;
}

function openSettings() {
  $('#zotero-library-type').value = config?.libraryType || 'user';
  $('#zotero-library-id').value = config?.libraryId || '';
  $('#zotero-api-key').value = config?.apiKey || '';
  $('#zotero-disconnect').hidden = !config;
  openModal('zotero-settings');
}

async function disconnectLibrary() {
  const prefix = itemPrefix();
  const collections = collectionPrefix();
  for (const entry of await browserWorkspace.integrationList(prefix)) await browserWorkspace.integrationDelete(entry.id.slice('@integration/'.length));
  for (const entry of await browserWorkspace.integrationList(collections)) await browserWorkspace.integrationDelete(entry.id.slice('@integration/'.length));
  await browserWorkspace.integrationDelete(`zotero/state/${libraryKey()}`);
  await browserWorkspace.integrationDelete(CONFIG_KEY);
  config = null; libraryState = null; currentItems = [];
  revokePreview(); closeModal(null);
  await refreshZoteroPanel();
  toast('Zotero disconnected and its local cache was removed.', { type: 'ok' });
}

function sourceMetadata(item) {
  const d = item.data || {};
  const fields = [
    ['Year', d.date], ['Publication', d.publicationTitle || d.bookTitle || d.websiteTitle || d.publisher],
    ['DOI', d.DOI], ['Citation key', citationKey(item)], ['Zotero key', item.key],
  ].filter(([, value]) => value);
  return fields;
}

async function openSource(item) {
  selectedItem = item;
  revokePreview();
  const data = item.data || {};
  $('#zotero-detail-title').textContent = data.title || '(Untitled source)';
  $('#zotero-detail-type').textContent = String(data.itemType || 'Source').replace(/([a-z])([A-Z])/g, '$1 $2');
  $('#zotero-detail-creators').textContent = displayCreators(item);
  const meta = $('#zotero-detail-meta'); clear(meta);
  for (const [label, value] of sourceMetadata(item)) {
    const field = el('div', { class: 'zotero-meta-field' }, el('span', { text: label }), el('strong', { text: value }));
    if (label === 'DOI') { clear(field); field.append(el('span', { text: label }), el('a', { href: `https://doi.org/${encodeURIComponent(value)}`, target: '_blank', rel: 'noopener noreferrer', text: value })); }
    meta.append(field);
  }
  $('#zotero-detail-abstract').textContent = data.abstractNote || 'No abstract is available for this source.';
  const tags = $('#zotero-detail-tags'); clear(tags);
  for (const tag of data.tags || []) tags.append(el('span', { class: 'zotero-tag', text: tag.tag }));
  const alt = item.links?.alternate?.href || '';
  const openWeb = $('#zotero-open-web');
  const validWebLink = /^https:\/\/www\.zotero\.org\//i.test(alt);
  openWeb.hidden = !validWebLink;
  if (validWebLink) openWeb.href = alt;
  $('#zotero-pdf-wrap').hidden = true;
  $('#zotero-pdf-frame').removeAttribute('src');
  $('#zotero-image-frame').hidden = true;
  $('#zotero-image-frame').removeAttribute('src');
  const attachments = $('#zotero-attachments'); clear(attachments);
  const hasChildren = Number(item.meta?.numChildren || 0) > 0;
  attachments.append(el('span', { class: 'zotero-attachment-muted', text: hasChildren ? 'Loading attachments…' : 'No attached files.' }));
  openModal('zotero-source');
  if (!hasChildren) return;
  try {
    const { data: children } = await zoteroRequest(`${rootPath()}/items/${encodeURIComponent(item.key)}/children?include=data&limit=100&v=3`);
    if (selectedItem?.key !== item.key) return;
    clear(attachments);
    const files = (children || []).filter((child) => child.data?.itemType === 'attachment');
    if (!files.length) attachments.append(el('span', { class: 'zotero-attachment-muted', text: 'No attached files.' }));
    for (const file of files) {
      const d = file.data || {};
      const isPdf = d.contentType === 'application/pdf' || /\.pdf$/i.test(d.filename || '');
      const isImage = String(d.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(d.filename || '');
      const isSnapshot = d.contentType === 'text/html' || d.linkMode === 'imported_url' || /\.html?$/i.test(d.filename || '');
      const previewable = isPdf || isImage || isSnapshot;
      const action = d.linkMode === 'linked_url' && d.url
        ? el('a', { class: 'tb-btn', href: d.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open link' })
        : previewable
          ? el('button', { class: 'tb-btn', text: isPdf ? 'Preview PDF' : isImage ? 'Preview image' : 'Preview snapshot', onclick: () => previewAttachment(file) })
          : el('button', { class: 'tb-btn', text: 'Download', onclick: () => previewAttachment(file, { download: true }) });
      attachments.append(el('div', { class: 'zotero-attachment-row' },
        el('span', { class: 'zotero-attachment-name', text: d.title || d.filename || 'Attachment' }),
        action,
      ));
    }
  } catch (error) {
    clear(attachments);
    attachments.append(el('span', { class: 'zotero-attachment-muted', text: `Attachments could not be loaded: ${error.message}` }));
  }
}

async function previewAttachment(item, { download = false } = {}) {
  const sourceKey = selectedItem?.key;
  revokePreview();
  const frame = $('#zotero-pdf-frame');
  const image = $('#zotero-image-frame');
  const wrap = $('#zotero-pdf-wrap');
  const metadata = item.data || {};
  const filename = metadata.filename || metadata.title || 'zotero-attachment';
  wrap.hidden = false;
  frame.title = filename;
  frame.src = 'about:blank';
  frame.hidden = false;
  image.hidden = true;
  image.removeAttribute('src');
  try {
    const response = await fetch(`https://api.zotero.org/${rootPath()}/items/${encodeURIComponent(item.key)}/file`, { headers: requestHeaders() });
    if (!response.ok) throw new Error(response.status === 403 ? 'Enable file access for this API key.' : `Zotero returned ${response.status}.`);
    if (selectedItem?.key !== sourceKey) return;
    const blob = await response.blob();
    previewObjectUrl = URL.createObjectURL(blob);
    if (download) {
      const link = document.createElement('a'); link.href = previewObjectUrl; link.download = filename; link.click();
      return;
    }
    const type = metadata.contentType || blob.type;
    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(filename)) {
      frame.hidden = true; image.hidden = false; image.alt = filename; image.src = previewObjectUrl;
    } else {
      frame.hidden = false;
      // Sandboxed iframe keeps saved HTML snapshots from running scripts.
      if (type === 'text/html' || /\.html?$/i.test(filename)) frame.setAttribute('sandbox', '');
      else frame.removeAttribute('sandbox');
      frame.src = previewObjectUrl;
    }
  } catch (error) { toast(`Attachment preview failed: ${error.message}`, { type: 'err', ms: 7000 }); }
}

function revokePreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
  const frame = $('#zotero-pdf-frame');
  const image = $('#zotero-image-frame');
  if (frame) { frame.hidden = false; frame.removeAttribute('src'); frame.removeAttribute('sandbox'); }
  if (image) { image.hidden = true; image.removeAttribute('src'); }
}

async function addBibtexToProject(item) {
  if (!state.project || !item?.bibtex) { toast('Open a project and choose a source with a BibTeX export.', { type: 'warn' }); return null; }
  const files = (await api.projectFiles(state.project)).files || [];
  const mainPath = `${state.project}/${state.settings.mainFile || 'main.tex'}`;
  const mainDoc = state.docs.get(mainPath);
  const mainSource = currentPath() === mainPath ? currentText() : mainDoc?.content || (await api.file(mainPath).catch(() => ({ content: '' }))).content;
  const requestedBib = mainSource.match(/\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\s*\{([^}]+)\}/i)?.[1]?.split(',')[0]?.trim();
  const requestedFile = requestedBib ? (/\.bib$/i.test(requestedBib) ? requestedBib : `${requestedBib}.bib`).replace(/^\.\//, '') : '';
  const target = (requestedFile && files.find((name) => name.toLocaleLowerCase() === requestedFile.toLocaleLowerCase()))
    || requestedFile
    || files.find((name) => name.toLocaleLowerCase() === 'references.bib')
    || files.find((name) => /\.bib$/i.test(name)) || 'references.bib';
  const path = `${state.project}/${target}`;
  const openDoc = state.docs.get(path);
  if (openDoc && !openDoc.saved) { toast(`Save ${target} before adding a Zotero entry.`, { type: 'warn', ms: 6000 }); return null; }
  const existing = files.includes(target) ? (await api.file(path)).content : '';
  const baseKey = citationKey(item);
  if (!baseKey) { toast('Zotero did not provide a BibTeX citation key for this source.', { type: 'err' }); return null; }
  const existingKeys = new Set([...String(existing).matchAll(/@[\w-]+\s*[\{(]\s*([^,\s]+)/g)].map((match) => match[1].toLocaleLowerCase()));
  let key = baseKey;
  let collision = false;
  if (existingKeys.has(key.toLocaleLowerCase())) {
    const previous = bibEntryForKey(existing, key);
    if (bibEntryMatchesSource(previous, item)) {
      item._latexStudioCitationKey = key;
      return { target, key, added: false };
    }
    collision = true;
    const suffix = String(item.key || 'zotero').toLocaleLowerCase();
    key = `${baseKey}_${suffix}`;
    let number = 2;
    while (existingKeys.has(key.toLocaleLowerCase())) {
      const scoped = bibEntryForKey(existing, key);
      if (bibEntryMatchesSource(scoped, item)) {
        item._latexStudioCitationKey = key;
        return { target, key, added: false, collision };
      }
      key = `${baseKey}_${suffix}_${number++}`;
    }
  }
  const sourceKey = String(item.bibtex || '').match(/@[\w-]+\s*[({]\s*([^,\s]+)/)?.[1];
  const bibtex = sourceKey?.toLocaleLowerCase() === key.toLocaleLowerCase() ? String(item.bibtex) : rewriteBibtexKey(item, key);
  if (!sourceKey || (sourceKey.toLocaleLowerCase() !== key.toLocaleLowerCase() && bibtex === String(item.bibtex || ''))) { toast('Could not safely update the Zotero BibTeX key.', { type: 'err' }); return null; }
  item._latexStudioCitationKey = key;
  const next = `${String(existing).trimEnd()}${String(existing).trim() ? '\n\n' : ''}${bibtex.trim()}\n`;
  await api.saveFile(path, next);
  await reloadFile(path);
  emit('tree:refresh'); emit('meta:refresh');
  return { target, key, added: true, collision };
}

async function addToBibliography() {
  const result = await addBibtexToProject(selectedItem);
  if (!result) return;
  toast(result.collision ? `The original Zotero key was already used; added this source with unique key “${result.key}” in ${result.target}.` : result.added ? `Added ${result.key} to ${result.target}.` : `Citation key “${result.key}” is already in ${result.target}; nothing was overwritten.`, { type: result.collision ? 'warn' : result.added ? 'ok' : 'warn', ms: 6000 });
}

async function ensureMainBibliography(target, citationCommand = 'cite') {
  if (!state.project) return;
  const relativeMain = state.settings.mainFile || 'main.tex';
  const path = `${state.project}/${relativeMain}`;
  const active = currentPath() === path;
  const openDoc = state.docs.get(path);
  if (!active && openDoc && !openDoc.saved) {
    toast(`Save ${relativeMain} before Zotero can add the bibliography command.`, { type: 'warn', ms: 6000 });
    return false;
  }
  let source;
  if (active) source = currentText();
  else if (openDoc) source = openDoc.content;
  else source = (await api.file(path)).content;
  const hasBiblatex = /\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b/i.test(source);
  const wantsBiblatex = ['parencite', 'textcite', 'autocite'].includes(citationCommand);
  const biblatex = hasBiblatex || wantsBiblatex;
  const bibName = target.replace(/\.bib$/i, '');
  const insertions = [];
  if (biblatex) {
    if (!hasBiblatex) {
      const begin = source.search(/\\begin\s*\{document\}/i);
      const packageLine = '\\usepackage[backend=biber,style=numeric]{biblatex}\n';
      insertions.push({ position: begin >= 0 ? begin : 0, text: packageLine });
    }
    if (!/\\addbibresource(?:\[[^\]]*\])?\s*\{/i.test(source)) {
      const begin = source.search(/\\begin\s*\{document\}/i);
      const resource = `\\addbibresource{${target}}\n`;
      insertions.push({ position: begin >= 0 ? begin : 0, text: resource });
    }
    if (!/\\printbibliography\b/i.test(source)) {
      const end = source.search(/\\end\s*\{document\}/i);
      insertions.push({ position: end >= 0 ? end : source.length, text: `${end >= 0 ? '' : '\n'}\\printbibliography\n` });
    }
  } else {
    if (['citep', 'citet'].includes(citationCommand) && !/\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bnatbib\b/i.test(source)) {
      const begin = source.search(/\\begin\s*\{document\}/i);
      insertions.push({ position: begin >= 0 ? begin : 0, text: '\\usepackage{natbib}\n' });
    }
    if (!/\\bibliography\s*\{/i.test(source)) {
      const style = /\\bibliographystyle\s*\{/i.test(source) ? '' : '\\bibliographystyle{plain}\n';
      const command = `${style}\\bibliography{${bibName}}\n`;
      const end = source.search(/\\end\s*\{document\}/i);
      insertions.push({ position: end >= 0 ? end : source.length, text: `${end >= 0 ? '' : '\n'}${command}` });
    }
  }
  if (!insertions.length) return true;
  let next = source;
  for (const item of [...insertions].sort((a, b) => b.position - a.position)) next = `${next.slice(0, item.position)}${item.text}${next.slice(item.position)}`;
  if (active) for (const item of [...insertions].sort((a, b) => b.position - a.position)) insertTextAt(item.text, item.position);
  else {
    await api.saveFile(path, next);
    await reloadFile(path);
  }
  return true;
}

async function insertCitation() {
  const item = selectedItem;
  let key = citationKey(item);
  if (!key) { toast('This source has no citation key.', { type: 'err' }); return; }
  if (!/\.tex$/i.test(currentPath() || '')) { toast('Open a .tex document before inserting a citation.', { type: 'warn' }); return; }
  const bibliography = await addBibtexToProject(item);
  if (!bibliography) return;
  key = bibliography.key;
  closeModal(null);
  let command = $('#zotero-citation-command')?.value || 'cite';
  const mainPath = `${state.project}/${state.settings.mainFile || 'main.tex'}`;
  const mainText = currentPath() === mainPath ? currentText() : state.docs.get(mainPath)?.content || (await api.file(mainPath).catch(() => ({ content: '' }))).content;
  const usesBiblatex = /\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b/i.test(mainText);
  if (usesBiblatex && command === 'citep') command = 'parencite';
  if (usesBiblatex && command === 'citet') command = 'textcite';
  insertText(`\\${command}{${key}}`);
  const configured = await ensureMainBibliography(bibliography.target, command);
  const keyNotice = bibliography.collision ? ` Zotero's original key was already used, so the source now uses ${key}.` : '';
  toast(`Inserted citation and ${bibliography.added ? 'added its BibTeX entry' : 'confirmed its BibTeX entry'} in ${bibliography.target}.${keyNotice}${configured === false ? ` Save ${state.settings.mainFile} and add a bibliography command before building.` : ' Build the project to update the PDF.'}`, { type: configured === false || bibliography.collision ? 'warn' : 'ok', ms: 7000 });
}

async function copyBibtex() {
  if (!selectedItem?.bibtex) { toast('No BibTeX export is available for this source.', { type: 'warn' }); return; }
  try {
    await navigator.clipboard.writeText(selectedItem.bibtex.trim());
    toast('BibTeX entry copied to clipboard.', { type: 'ok' });
  } catch (error) {
    toast(`Clipboard access failed: ${error.message}`, { type: 'err' });
  }
}

async function connectFromForm(event) {
  event.preventDefault();
  const next = {
    libraryType: $('#zotero-library-type').value,
    libraryId: $('#zotero-library-id').value.trim(),
    apiKey: $('#zotero-api-key').value.trim(),
  };
  if (!/^\d+$/.test(next.libraryId)) { toast('Enter the numeric Zotero user or group library ID.', { type: 'err' }); return; }
  const previousConfig = config;
  const previousState = libraryState;
  config = next;
  await browserWorkspace.integrationSet(CONFIG_KEY, config);
  libraryState = null;
  closeModal(null);
  try {
    await syncLibrary({ force: true });
    toast('Zotero library connected in this browser.', { type: 'ok' });
  } catch {
    config = previousConfig;
    libraryState = previousState;
    if (previousConfig) await browserWorkspace.integrationSet(CONFIG_KEY, previousConfig);
    else await browserWorkspace.integrationDelete(CONFIG_KEY);
    await refreshZoteroPanel();
  }
}

export function initZotero() {
  $('#zotero-settings-open')?.addEventListener('click', openSettings);
  $('#zotero-connect-open')?.addEventListener('click', openSettings);
  $('#zotero-sync')?.addEventListener('click', () => syncLibrary({ force: !libraryState?.version }).catch(() => {}));
  $('#zotero-settings-form')?.addEventListener('submit', connectFromForm);
  $('#zotero-disconnect')?.addEventListener('click', disconnectLibrary);
  $('#zotero-search')?.addEventListener('input', () => refreshZoteroPanel());
  $('#zotero-collection')?.addEventListener('change', () => refreshZoteroPanel());
  $('#zotero-add-bib')?.addEventListener('click', addToBibliography);
  $('#zotero-copy-bib')?.addEventListener('click', copyBibtex);
  $('#zotero-insert-cite')?.addEventListener('click', insertCitation);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || timer || !config) return;
    timer = setInterval(() => { if (!document.hidden) syncLibrary({ quiet: true }).catch(() => {}); }, POLL_MS);
  });
  if (!document.hidden) timer = setInterval(() => { if (config && !document.hidden) syncLibrary({ quiet: true }).catch(() => {}); }, POLL_MS);
  refreshZoteroPanel().then(() => { if (config && !libraryState?.version) syncLibrary({ force: true, quiet: true }).catch(() => {}); });
}
