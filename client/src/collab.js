/* First collaboration features: presence and live file sync between editors
 * connected to the same local server and project. Identity is a local,
 * anonymous display name; nothing is sent anywhere else. */

import { api } from './api.js';
import { state, on } from './state.js';
import { $, toast, basename } from './util.js';
import { reloadFile } from './editor/index.js';

const ADJECTIVES = ['Swift', 'Quiet', 'Bright', 'Calm', 'Bold', 'Clever', 'Gentle', 'Keen', 'Lively', 'Merry', 'Noble', 'Wise'];
const ANIMALS = ['Otter', 'Falcon', 'Heron', 'Badger', 'Fox', 'Lynx', 'Owl', 'Robin', 'Stoat', 'Tern', 'Wolf', 'Wren'];
const IDENTITY_KEY = 'latex-collab-user-v1';
const RECONNECT_MS = 4000;

let ws = null;
let reconnectTimer = null;
let users = [];
let enabled = false;

function identity() {
  try {
    const saved = localStorage.getItem(IDENTITY_KEY);
    if (saved) return saved;
  } catch { /* */ }
  const name = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`;
  try { localStorage.setItem(IDENTITY_KEY, name); } catch { /* */ }
  return name;
}

function send(msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch { /* */ }
  }
}

function register() {
  if (!state.project) return;
  send({ type: 'hello', project: state.project, user: identity() });
}

function connect() {
  if (!enabled) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    ws = new WebSocket(`${proto}://${location.host}/ws`);
  } catch { scheduleReconnect(); return; }

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    register();
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'presence' && msg.project === state.project) {
      users = Array.isArray(msg.users) ? msg.users : [];
      renderPresence();
    } else if (msg.type === 'file:save' && msg.path && msg.user) {
      applyRemoteSave(msg);
    }
  };
  ws.onclose = () => { ws = null; scheduleReconnect(); };
  ws.onerror = () => { try { ws?.close(); } catch { /* */ } };
}

function scheduleReconnect() {
  if (!enabled || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, RECONNECT_MS);
}

async function applyRemoteSave(msg) {
  const projectPrefix = state.project + '/';
  const path = String(msg.path).startsWith(projectPrefix) ? String(msg.path) : projectPrefix + String(msg.path).replace(/^\.\//, '');
  const doc = state.docs.get(path);
  if (doc && !doc.saved) {
    toast(`${msg.user} saved ${basename(path)} — save your changes to load the latest version.`, { type: 'warn', ms: 7000 });
    return;
  }
  try {
    await reloadFile(path);
    toast(`${msg.user} updated ${basename(path)}`, { type: 'ok', ms: 3500 });
  } catch { /* the file may have been deleted remotely */ }
}

function renderPresence() {
  const node = $('#st-collab');
  if (!node) return;
  const others = users.filter((u) => u.user !== identity());
  const total = users.reduce((n, u) => n + (u.tabs || 1), 0);
  node.hidden = total <= 1 && !others.length;
  node.textContent = total > 1 ? `👥 ${total}` : '';
  node.title = users.length
    ? `Connected to this project: ${users.map((u) => `${u.user}${u.tabs > 1 ? ` (${u.tabs} tabs)` : ''}`).join(', ')}`
    : 'No collaborators';
}

export function initCollab() {
  enabled = !api.isBrowserWorkspace();
  if (!enabled) { const node = $('#st-collab'); if (node) node.hidden = true; return; }

  on('project', () => {
    users = [];
    renderPresence();
    register();
  });
  on('file-saved', (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    const content = typeof data === 'object' && data ? data.content : null;
    if (!path || content == null || content.length > 2_000_000) return;
    send({ type: 'file:save', path, content, user: identity() });
  });
  $('#st-collab')?.addEventListener('click', () => {
    if (!users.length) { toast('Nobody else is connected to this project.', { type: 'ok', ms: 2500 }); return; }
    toast(users.map((u) => `${u.user}${u.tabs > 1 ? ` (${u.tabs} tabs)` : ''}`).join(' · '), { title: 'In this project', ms: 6000 });
  });

  connect();
  renderPresence();
}
