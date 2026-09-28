// Supabase: auth, initial fetch, write outbox, realtime. In local mode the outbox is ignored.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as store from './store.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const OUTBOX_KEY = 'gp2.outbox';

// Columns the server accepts per table; anything else on a row is client-only and stripped.
const COLUMNS = {
  gardens: ['id', 'name', 'place', 'zone', 'last_frost', 'first_frost', 'origin_lat', 'origin_lng', 'lot', 'structures', 'is_public'],
  beds: ['id', 'garden_id', 'name', 'kind', 'area', 'length_ft', 'width_ft', 'height_ft', 'x_ft', 'y_ft', 'rotation_deg', 'color', 'notes', 'sort', 'archived', 'locked'],
  plantings: ['id', 'garden_id', 'bed_id', 'plant_key', 'variety', 'qty', 'x_ft', 'y_ft', 'status', 'season', 'method',
    'sow_date', 'transplant_date', 'expected_harvest', 'done_date', 'source', 'notes', 'locked'],
  events: ['id', 'garden_id', 'type', 'date', 'planting_id', 'bed_id', 'plant_key', 'amount', 'unit', 'text', 'meta'],
  custom_plants: ['id', 'garden_id', 'key', 'data'],
};
const CHILD_TABLES = ['beds', 'plantings', 'events', 'custom_plants'];

let client = null;
// Read directly (not via store.storage): store.js imports this module, so store isn't
// initialised yet while this top level runs.
let outbox = readOutbox();

function readOutbox() {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
  } catch {
    return [];
  }
}
let flushing = false;
let inFlight = 0;           // leading outbox ops currently being sent
let flushTimer = null;
let channel = null;

export const configured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const getClient = () => client;

function isCloud() {
  return store.getState().mode === 'cloud';
}

function setStatus(status, error = null) {
  store.set({ sync: { status, pending: outbox.length, error } });
}

// ------------------------------------------------------------ client + auth

export async function init() {
  if (!configured()) return null;
  const { createClient } = await import(SUPABASE_ESM);
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  addEventListener('online', () => flushSoon(0));
  addEventListener('offline', () => setStatus('offline'));
  return client;
}

export async function currentUser() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}

export function onAuthChange(fn) {
  return client?.auth.onAuthStateChange((event, session) => fn(event, session?.user ?? null));
}

export async function sendMagicLink(email) {
  const redirect = location.origin + location.pathname;
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  if (error) throw error;
}

export async function signOut() {
  await client?.auth.signOut();
  unsubscribe();
}

export function ping() {
  client?.rpc('ping').then(() => {}, () => {});
}

// ------------------------------------------------------------ fetch

export async function listGardens(userId) {
  const { data, error } = await client
    .from('garden_members')
    .select('role, gardens(id, name)')
    .eq('user_id', userId);
  if (error) throw error;
  return data.filter(r => r.gardens).map(r => ({ id: r.gardens.id, name: r.gardens.name, role: r.role }));
}

export async function fetchGarden(id) {
  const one = t => client.from(t).select('*').eq('garden_id', id);
  const [g, beds, plantings, events, custom] = await Promise.all([
    client.from('gardens').select('*').eq('id', id).single(),
    one('beds'), one('plantings'), one('events').order('date', { ascending: false }), one('custom_plants'),
  ]);
  for (const r of [g, beds, plantings, events, custom]) if (r.error) throw r.error;
  return overlayPending({
    garden: g.data, beds: beds.data, plantings: plantings.data, events: events.data, custom: custom.data,
  });
}

/** Re-apply queued local edits on top of freshly fetched rows so nothing unsynced is lost. */
function overlayPending(data) {
  const keyOf = { beds: 'beds', plantings: 'plantings', events: 'events', custom_plants: 'custom' };
  for (const op of outbox) {
    if (op.table === 'gardens') {
      if (op.row.id === data.garden.id) data.garden = { ...data.garden, ...op.row };
      continue;
    }
    const k = keyOf[op.table];
    if (!k) continue;
    const id = op.op === 'delete' ? op.id : op.row.id;
    data[k] = data[k].filter(r => r.id !== id);
    if (op.op === 'upsert' && op.row.garden_id === data.garden.id) data[k].push(op.row);
  }
  return data;
}

// ------------------------------------------------------------ realtime

export function subscribe(gardenId) {
  unsubscribe();
  if (!client) return;
  channel = client.channel(`garden:${gardenId}`);
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'gardens', filter: `id=eq.${gardenId}` },
    msg => store.applyRemote('gardens', msg.new, msg.eventType === 'DELETE'));
  for (const table of CHILD_TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `garden_id=eq.${gardenId}` }, msg => {
      if (msg.eventType === 'DELETE') store.applyRemote(table, msg.old, true);
      else store.applyRemote(table, msg.new);
    });
  }
  channel.subscribe();
}

export function unsubscribe() {
  if (channel) client?.removeChannel(channel);
  channel = null;
}

// ------------------------------------------------------------ outbox

export function hasPending(table, id) {
  return outbox.some(op => op.table === table && (op.op === 'delete' ? op.id : op.row.id) === id);
}

export function pendingCount() {
  return outbox.length;
}

export function enqueue(op) {
  if (store.getState().mode === 'local') return;
  const id = op.op === 'delete' ? op.id : op.row.id;
  const start = inFlight; // never rewrite ops currently in flight
  if (op.op === 'upsert') {
    const i = outbox.findIndex((o, j) => j >= start && o.op === 'upsert' && o.table === op.table && o.row.id === id);
    if (i !== -1) outbox[i] = { ...op, row: clean(op.table, op.row) };
    else outbox.push({ ...op, row: clean(op.table, op.row) });
  } else {
    outbox = outbox.filter((o, j) => j < start || !(o.table === op.table && o.op === 'upsert' && o.row.id === id));
    outbox.push(op);
  }
  saveOutbox();
  flushSoon();
}

function clean(table, row) {
  const out = {};
  for (const c of COLUMNS[table]) if (row[c] !== undefined) out[c] = row[c];
  return out;
}

function saveOutbox() {
  store.storage.set(OUTBOX_KEY, outbox);
  const s = store.getState().sync;
  if (s.pending !== outbox.length) store.set({ sync: { ...s, pending: outbox.length } });
}

export function clearOutbox() {
  outbox = [];
  saveOutbox();
}

function flushSoon(ms = 400) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, ms);
}

function isNetworkError(error) {
  return !error.code && /fetch|network|load failed|timeout/i.test(error.message || '');
}

const BATCH = 200;

/** Leading run of upserts to the same table: sent as one bulk request. */
function nextBatch() {
  const first = outbox[0];
  if (first.op !== 'upsert') return [first];
  let n = 1;
  while (n < outbox.length && n < BATCH && outbox[n].op === 'upsert' && outbox[n].table === first.table) n++;
  return outbox.slice(0, n);
}

function send(ops) {
  const { table, op } = ops[0];
  if (op === 'delete') return client.from(table).delete().eq('id', ops[0].id);
  return client.from(table).upsert(ops.map(o => o.row));
}

export async function flush() {
  if (flushing || !client || !isCloud()) return;
  if (!navigator.onLine) return setStatus('offline');
  if (!outbox.length) return setStatus('synced');
  flushing = true;
  setStatus('syncing');
  let lastError = null;
  try {
    while (outbox.length) {
      let ops = nextBatch();
      inFlight = ops.length;
      let { error } = await send(ops);
      if (error && !isNetworkError(error) && ops.length > 1) {
        // One bad row fails the whole bulk request; retry just the first so the rest can go.
        ops = ops.slice(0, 1);
        inFlight = 1;
        ({ error } = await send(ops));
      }
      if (error) {
        if (isNetworkError(error)) {
          setStatus('offline');
          flushSoon(15_000);
          return;
        }
        // A rejected write (RLS, constraint) would block the queue forever; drop it and report.
        console.error('sync rejected', ops[0], error);
        lastError = `${ops[0].table}: ${error.message}`;
      }
      outbox.splice(0, ops.length);
      inFlight = 0;
      saveOutbox();
    }
  } finally {
    flushing = false;
    inFlight = 0;
  }
  setStatus(lastError ? 'error' : 'synced', lastError);
}
