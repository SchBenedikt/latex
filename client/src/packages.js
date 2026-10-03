/* Paketstatus des aktiven LaTeX-Projects und gezielte Reparatur fehlender Pakete. */

import { api } from './api.js';
import { state } from './state.js';
import { $, el, clear, openModal, toast } from './util.js';

let packageData = null;
let pending = new Set();

export async function openPackageManager() {
  if (!state.project) {
    toast('Select a project first.', { type: 'warn' });
    return;
  }
  $('#package-filter').value = '';
  openModal('packages');
  await refreshPackages();
}

export async function refreshPackages() {
  const list = $('#package-list');
  if (!list || !state.project) return;
  $('#package-summary').textContent = 'Checking packages …';
  clear(list);
  try {
    packageData = await api.packages(state.project, state.settings.mainFile);
    renderPackages();
  } catch (error) {
    packageData = null;
    $('#package-summary').textContent = 'Package check failed';
    list.append(el('div', { class: 'package-empty', text: error.message }));
  }
}

function renderPackages() {
  const list = $('#package-list');
  clear(list);
  const all = packageData?.packages || [];
  const query = $('#package-filter').value.trim().toLocaleLowerCase();
  const shown = all.filter((item) => `${item.name} ${item.file}`.toLocaleLowerCase().includes(query));
  const ready = all.filter((item) => item.installed).length;
  const missing = all.length - ready;
  const managerLabel = packageData?.manager === 'tlmgr' ? 'TeX Live' : packageData?.manager === 'miktex' ? 'MiKTeX' : null;
  $('#package-summary').textContent = `${all.length} gefunden · ${ready} verfügbar · ${missing} fehlen${managerLabel ? ` · ${managerLabel}` : ''}`;
  const installAll = $('#package-install-missing');
  installAll.hidden = !packageData?.packageManagerAvailable || missing === 0;
  installAll.disabled = pending.has('@all');

  if (!packageData?.resolverAvailable) {
    list.append(el('div', { class: 'package-empty', text: 'kpsewhich is unavailable. Package files cannot be reliably checked with this TeX installation.' }));
  }
  if (!shown.length) {
    list.append(el('div', { class: 'package-empty', text: all.length ? 'No matching packages.' : 'No packages were found in the main document or its included files.' }));
    return;
  }
  for (const item of shown) {
    const status = item.installed ? 'available' : 'missing';
    const row = el('article', { class: `package-row ${status}` },
      el('div', { class: 'package-copy' },
        el('strong', { text: item.name }),
        el('span', { text: `${item.kind === 'class' ? 'Document class' : 'Package'} · ${item.file}` }),
      ),
      item.installed
        ? el('span', { class: 'package-status', text: 'Available' })
        : packageData?.packageManagerAvailable
          ? el('button', {
              class: 'tb-btn package-install',
              disabled: pending.has(item.name),
              text: pending.has(item.name) ? 'Installing …' : 'Install',
              onclick: () => installPackage(item.name),
            })
          : el('span', { class: 'package-status', text: 'Package manager unavailable' }),
    );
    list.append(row);
  }
}

export async function installPackage(name, { rebuild = false } = {}) {
  if (pending.has(name)) return;
  pending.add(name);
  renderPackages();
  toast(`Installing “${name}” with the TeX package manager …`, { type: 'warn', ms: 5000 });
  try {
    const result = await api.installPackage(name);
    toast(`“${name}” was installed.`, { type: 'ok', ms: 4000 });
    await refreshPackages();
    if (rebuild) {
      const { buildProject } = await import('./build.js');
      await buildProject();
    }
    return result;
  } catch (error) {
    toast(error.message, { type: 'err', ms: 9000 });
    return null;
  } finally {
    pending.delete(name);
    renderPackages();
  }
}

async function installMissingPackages() {
  if (pending.has('@all')) return;
  const names = (packageData?.packages || []).filter((item) => item.installed === false).map((item) => item.name);
  if (!names.length) { toast('All detected packages are already available.', { type: 'ok' }); return; }
  pending.add('@all');
  renderPackages();
  let installed = 0;
  try {
    for (const name of names) {
      if (await installPackage(name)) installed++;
    }
  } finally {
    pending.delete('@all');
    await refreshPackages();
  }
  toast(`${installed} of ${names.length} missing packages installed.`, { type: installed === names.length ? 'ok' : 'warn', ms: 6000 });
}

export function initPackages() {
  $('#btn-packages').addEventListener('click', openPackageManager);
  $('#package-refresh').addEventListener('click', refreshPackages);
  $('#package-install-missing').addEventListener('click', installMissingPackages);
  $('#package-filter').addEventListener('input', renderPackages);
  $('#package-install-custom').addEventListener('click', () => {
    const field = $('#package-name');
    const name = field.value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,99}$/.test(name)) {
      toast('Enter a valid package name.', { type: 'warn' });
      field.focus();
      return;
    }
    installPackage(name).then((result) => { if (result) field.value = ''; });
  });
  $('#package-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('#package-install-custom').click();
  });
}
