// Boot, auth/mode selection, app chrome and hash router.

import * as store from './store.js';
import * as sync from './sync.js';
import { h, icon, sprite, clear, fill, sheet, toast } from './ui.js';

const root = document.getElementById('root');

const ROUTES = {
  yard: () => import('./views/yard.js'),
  bed: () => import('./views/bed.js'),
  almanac: () => import('./views/almanac.js'),
  library: () => import('./views/library.js'),
  log: () => import('./views/log.js'),
  settings: () => import('./views/settings.js'),
};

const NAV = [
  ['yard', 'Yard', 'yard'],
  ['bed', 'Beds', 'bed'],
  ['almanac', 'Almanac', 'calendar'],
  ['library', 'Library', 'book'],
  ['log', 'Log', 'basket'],
];

let shell = null;          // { main, nav, title, syncChip }
let current = null;        // { name, param, unmount }
let routeToken = 0;

// ------------------------------------------------------------ boot

async function boot() {
  store.applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => store.applyTheme(store.getState().theme));
  registerServiceWorker();

  if (sync.configured()) {
    try {
      await sync.init();
    } catch (e) {
      console.error('Supabase failed to load', e);
    }
  }

  const user = await sync.currentUser().catch(() => null);
  if (user) await enterCloud(user);
  else if (store.storage.get(store.storage.keys.mode) === 'local' || !sync.configured()) await enterLocal();
  else showTitle();

  sync.onAuthChange((event, user) => {
    const { mode } = store.getState();
    if (event === 'SIGNED_IN' && user && mode !== 'cloud') enterCloud(user);
    if (event === 'SIGNED_OUT' && mode === 'cloud') showTitle();
  });

  addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.flush();
  });
}

export async function enterCloud(user) {
  store.storage.set(store.storage.keys.mode, 'cloud');
  store.set({ mode: 'cloud', user });
  sync.ping();
  let gardens = [];
  try {
    gardens = await sync.listGardens(user.id);
  } catch (e) {
    console.warn('listGardens failed, trying cache', e);
    const last = store.storage.get(store.storage.keys.lastGarden);
    const cached = last && store.readCache(last);
    if (cached) {
      store.set({ gardens: [{ id: cached.garden.id, name: cached.garden.name, role: 'owner' }] });
      store.loadGardenData(cached);
      store.set({ sync: { status: 'offline', pending: sync.pendingCount(), error: null } });
      return showApp();
    }
  }
  store.set({ gardens });
  const last = store.storage.get(store.storage.keys.lastGarden);
  const pick = gardens.find(g => g.id === last) || gardens[0];
  if (!pick) return showSetup();
  await openGarden(pick.id);
}

export async function openGarden(id) {
  const cached = store.readCache(id);
  if (cached) {
    store.loadGardenData(cached);
    showApp();
  }
  try {
    const data = await sync.fetchGarden(id);
    store.loadGardenData(data);
    sync.subscribe(id);
    sync.flush();
    if (!cached) showApp();
  } catch (e) {
    console.error('fetchGarden failed', e);
    if (!cached) {
      toast(`Couldn't load garden: ${e.message}`, { error: true });
      return showSetup();
    }
    store.set({ sync: { status: 'offline', pending: sync.pendingCount(), error: null } });
  }
}

export async function enterLocal() {
  store.storage.set(store.storage.keys.mode, 'local');
  store.set({ mode: 'local', user: null, sync: { status: 'local', pending: 0, error: null } });
  const id = store.storage.get(store.storage.keys.localGarden);
  const cached = id && store.readCache(id);
  if (cached) {
    store.loadGardenData(cached);
    showApp();
  } else {
    showSetup();
  }
}

// ------------------------------------------------------------ screens

export async function showTitle() {
  teardown();
  const { renderTitle } = await import('./views/auth.js');
  fill(root, renderTitle({ enterLocal }));
}

export async function showSetup() {
  teardown();
  const { renderSetup } = await import('./views/settings.js');
  fill(root, renderSetup({ onDone: () => showApp() }));
}

function teardown() {
  current?.unmount?.();
  current = null;
  shell?.unsub();
  shell = null;
}

export function showApp() {
  if (!shell) buildShell();
  route();
}

function buildShell() {
  const title = h('span.title');
  const syncChip = h('span.sync-chip');
  const gear = h('a.btn.icon.sm', { href: '#/settings', title: 'Settings', 'aria-label': 'Settings' }, icon('gear', 24));
  const theme = h('button.btn.icon.sm', { title: 'Day / night', 'aria-label': 'Toggle day and night theme', onclick: toggleTheme }, icon('sun', 24));
  const top = h('header.topbar',
    sprite('icon_sprout', { size: 32, cls: 'logo', alt: '' }),
    h('button.btn.ghost.title-btn', { onclick: switchGarden, style: { color: 'inherit', padding: 0 } }, title),
    h('span.spacer'), syncChip, theme, gear);
  const main = h('main.main', { id: 'main' });
  const nav = h('nav.nav', { 'aria-label': 'Sections' },
    NAV.map(([r, label, ic]) => h('a', { href: `#/${r}`, dataset: { route: r } }, icon(ic, 32), label)));
  fill(root, h('div.app', top, nav, main));
  shell = { main, nav, title, syncChip, unsub: store.subscribe(updateChrome) };
  updateChrome(store.getState());
}

function updateChrome(state) {
  if (!shell) return;
  shell.title.textContent = state.garden?.name || 'Garden Planner';
  const s = state.sync;
  const labels = {
    local: ['cloud_off', 'Local only'],
    synced: ['cloud', 'Synced'],
    idle: ['cloud', 'Synced'],
    syncing: ['cloud', `Saving ${s.pending || ''}`],
    offline: ['cloud_off', `Offline${s.pending ? ` · ${s.pending} queued` : ''}`],
    error: ['cloud_off', 'Sync error'],
  };
  const [ic, text] = labels[s.status] || labels.idle;
  fill(shell.syncChip, icon(ic, 24), h('span.label', text));
  shell.syncChip.title = s.error || text;
}

function toggleTheme() {
  const night = document.documentElement.dataset.theme === 'night';
  store.applyTheme(night ? 'day' : 'night');
}

async function switchGarden() {
  const { gardens, garden, mode } = store.getState();
  if (mode !== 'cloud' || gardens.length < 2) return (location.hash = '#/settings');
  const id = await sheet(close => h('div.stack',
    h('h2', 'Switch garden'),
    gardens.map(g => h(`button.btn${g.id === garden?.id ? '.primary' : ''}`, { onclick: () => close(g.id) }, g.name))));
  if (id && id !== garden?.id) openGarden(id);
}

// ------------------------------------------------------------ router

async function route() {
  if (!shell) return;
  const [name = 'yard', param = null] = location.hash.replace(/^#\/?/, '').split('/');
  const key = ROUTES[name] ? name : 'yard';
  if (current && current.name === key && current.param === param) return;
  const token = ++routeToken;
  const mod = await ROUTES[key]();
  if (token !== routeToken) return;
  current?.unmount?.();
  shell.main.scrollTop = 0;
  clear(shell.main);
  for (const a of shell.nav.querySelectorAll('a')) {
    if (a.dataset.route === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const unmount = mod.mount(shell.main, param ? decodeURIComponent(param) : null);
  current = { name: key, param, unmount };
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
}

boot();
