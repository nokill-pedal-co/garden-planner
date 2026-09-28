// App state + the only code that mutates garden data.
// Every mutation: update memory -> notify views -> persist cache -> enqueue for Supabase.

import * as sync from './sync.js';
import { todayStr } from './season.js';

const TABLE_KEYS = { beds: 'beds', plantings: 'plantings', events: 'events', custom_plants: 'custom' };

const state = {
  mode: 'boot',            // boot | auth | setup | local | cloud
  user: null,
  gardens: [],             // [{ id, name, role }] available to this user (cloud)
  garden: null,
  beds: [],
  plantings: [],
  events: [],
  custom: [],              // custom_plants rows
  sync: { status: 'idle', pending: 0, error: null },
  theme: 'auto',
};

const listeners = new Set();
let notifyQueued = false;

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Like subscribe, but only fires when one of the selected values changes (shallow, by identity).
 * Rows arrays are replaced on every change, so `s => [s.beds, s.plantings]` is a cheap diff.
 */
export function watch(select, fn) {
  let prev = select(state);
  return subscribe(s => {
    const next = select(s);
    if (next.length === prev.length && next.every((v, i) => v === prev[i])) return;
    prev = next;
    fn(s);
  });
}

function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const fn of listeners) fn(state);
  });
}

export function set(patch) {
  Object.assign(state, patch);
  notify();
}

export function customPlants() {
  return state.custom.map(r => ({ ...r.data, key: r.key }));
}

// ------------------------------------------------------------ cache (localStorage)

const LS = {
  data: id => `gp2.data.${id}`,
  lastGarden: 'gp2.lastGarden',
  localGarden: 'gp2.localGarden',
  mode: 'gp2.mode',
  theme: 'gp2.theme',
};

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('storage write failed', key, e);
    }
  },
  keys: LS,
};

let saveTimer = null;
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 250);
}

export function persistNow() {
  clearTimeout(saveTimer);
  if (!state.garden) return;
  const { garden, beds, plantings, events, custom } = state;
  storage.set(LS.data(garden.id), { garden, beds, plantings, events, custom, savedAt: Date.now() });
}

export function readCache(gardenId) {
  return storage.get(LS.data(gardenId));
}

/** Replace the loaded garden wholesale (from cache, remote fetch, or import). */
export function loadGardenData({ garden, beds = [], plantings = [], events = [], custom = [] }) {
  state.garden = garden;
  state.beds = sortBeds(beds);
  state.plantings = plantings;
  state.events = events;
  state.custom = custom;
  storage.set(LS.lastGarden, garden.id);
  persistSoon();
  notify();
}

function sortBeds(beds) {
  return [...beds].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------ generic row ops

function listFor(table) {
  return state[TABLE_KEYS[table]];
}

function putRow(table, row) {
  const key = TABLE_KEYS[table];
  const list = state[key];
  const i = list.findIndex(r => r.id === row.id);
  const next = i === -1 ? [...list, row] : list.map((r, j) => (j === i ? row : r));
  state[key] = table === 'beds' ? sortBeds(next) : next;
}

function dropRow(table, id) {
  const key = TABLE_KEYS[table];
  state[key] = state[key].filter(r => r.id !== id);
}

function commit(table, row) {
  putRow(table, row);
  persistSoon();
  notify();
  sync.enqueue({ op: 'upsert', table, row });
  return row;
}

function remove(table, id) {
  dropRow(table, id);
  persistSoon();
  notify();
  sync.enqueue({ op: 'delete', table, id });
}

/** Apply a row that arrived from Supabase (fetch or realtime). */
export function applyRemote(table, row, deleted = false) {
  if (table === 'gardens') {
    if (!deleted && state.garden?.id === row.id) state.garden = { ...state.garden, ...row };
  } else if (TABLE_KEYS[table]) {
    if (sync.hasPending(table, row.id)) return;
    if (deleted) dropRow(table, row.id);
    else putRow(table, row);
  }
  persistSoon();
  notify();
}

const uuid = () => crypto.randomUUID();

// ------------------------------------------------------------ garden

export function updateGarden(patch) {
  state.garden = { ...state.garden, ...patch };
  persistSoon();
  notify();
  sync.enqueue({ op: 'upsert', table: 'gardens', row: state.garden });
}

export function newGarden(fields = {}) {
  return {
    id: uuid(), name: 'My Garden', place: null, zone: null,
    last_frost: '04-15', first_frost: '10-25',
    origin_lat: null, origin_lng: null, lot: [], structures: [], is_public: false,
    ...fields,
  };
}

/** Queue every row of the loaded garden for upload (local -> cloud, or after import). */
export function pushEverything() {
  sync.enqueue({ op: 'upsert', table: 'gardens', row: state.garden });
  for (const b of state.beds) sync.enqueue({ op: 'upsert', table: 'beds', row: b });
  for (const p of state.plantings) sync.enqueue({ op: 'upsert', table: 'plantings', row: p });
  for (const e of state.events) sync.enqueue({ op: 'upsert', table: 'events', row: e });
  for (const c of state.custom) sync.enqueue({ op: 'upsert', table: 'custom_plants', row: c });
}

// ------------------------------------------------------------ beds

export function addBed(fields) {
  const maxSort = Math.max(0, ...state.beds.map(b => b.sort ?? 0));
  return commit('beds', {
    id: uuid(), garden_id: state.garden.id, name: 'New bed', kind: 'raised', area: null,
    length_ft: 4, width_ft: 4, height_ft: 1, x_ft: 0, y_ft: 0, rotation_deg: 0,
    color: null, notes: null, sort: maxSort + 1, archived: false, locked: false,
    ...fields,
  });
}

export function updateBed(id, patch) {
  const bed = state.beds.find(b => b.id === id);
  if (!bed) return null;
  return commit('beds', { ...bed, ...patch });
}

export function deleteBed(id) {
  // Plantings survive as unplaced (matches ON DELETE SET NULL server-side).
  for (const p of state.plantings.filter(p => p.bed_id === id)) {
    commit('plantings', { ...p, bed_id: null, x_ft: null, y_ft: null });
  }
  remove('beds', id);
}

// ------------------------------------------------------------ plantings

export function addPlanting(fields) {
  return commit('plantings', {
    id: uuid(), garden_id: state.garden.id, bed_id: null, plant_key: 'unknown', variety: null,
    qty: 1, x_ft: null, y_ft: null, status: 'planned', season: Number(todayStr().slice(0, 4)),
    method: null, sow_date: null, transplant_date: null, expected_harvest: null, done_date: null,
    source: null, notes: null, locked: false,
    ...fields,
  });
}

export function updatePlanting(id, patch) {
  const p = state.plantings.find(x => x.id === id);
  if (!p) return null;
  return commit('plantings', { ...p, ...patch });
}

export function deletePlanting(id) {
  remove('plantings', id);
}

// ------------------------------------------------------------ events

export function logEvent(fields) {
  return commit('events', {
    id: uuid(), garden_id: state.garden.id, type: 'note', date: todayStr(),
    planting_id: null, bed_id: null, plant_key: null, amount: null, unit: null, text: null, meta: {},
    ...fields,
  });
}

export function updateEvent(id, patch) {
  const e = state.events.find(x => x.id === id);
  return e ? commit('events', { ...e, ...patch }) : null;
}

export function deleteEvent(id) {
  remove('events', id);
}

// ------------------------------------------------------------ theme

export function applyTheme(choice = storage.get(LS.theme, 'auto')) {
  state.theme = choice;
  storage.set(LS.theme, choice);
  const night = choice === 'night' || (choice === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = night ? 'night' : 'day';
  notify();
}

export { listFor };
