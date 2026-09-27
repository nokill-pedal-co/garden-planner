// Settings (garden, climate, location, data, account) and the first-run setup screen.

import * as store from '../store.js';
import * as sync from '../sync.js';
import { h, icon, sprite, clear, fill, field, select, formData, toast, download, readFile, confirmSheet, sheet } from '../ui.js';
import { spriteURL } from '../sprites.js';
import { importV1, makeBackup, restoreBackup } from '../importer.js';
import { APP_VERSION } from '../config.js';

// ------------------------------------------------------------ shared: adopt a garden

/** Make `data` the current garden; in cloud mode also upload it. */
function adoptGarden(data) {
  const { mode, gardens } = store.getState();
  store.loadGardenData(data);
  if (mode === 'cloud') {
    store.pushEverything();
    store.set({ gardens: [...gardens.filter(g => g.id !== data.garden.id), { id: data.garden.id, name: data.garden.name, role: 'owner' }] });
    sync.subscribe(data.garden.id);
  } else {
    store.storage.set(store.storage.keys.localGarden, data.garden.id);
  }
  store.persistNow();
}

async function importV1Files(dbFile, exportFile) {
  const db = JSON.parse(await readFile(dbFile));
  const exported = exportFile ? JSON.parse(await readFile(exportFile)) : null;
  if (!db.beds || !db.containers) throw new Error('That doesn\'t look like a v1 garden-db.json');
  const { garden, beds, plantings, report } = importV1(db, exported);
  adoptGarden({ garden, beds, plantings, events: [], custom: [] });
  toast(`Imported ${report.beds} beds, ${report.plantings} plantings${report.unmatched.length ? ` (${report.unmatched.length} unknown plants)` : ''}`);
  if (report.unmatched.length) console.warn('Unmatched v1 plants:', report.unmatched);
}

function v1ImportForm(onDone) {
  const db = h('input', { type: 'file', accept: '.json,application/json', required: true });
  const ex = h('input', { type: 'file', accept: '.json,application/json' });
  const form = h('form.stack', {
    onsubmit: async e => {
      e.preventDefault();
      try {
        await importV1Files(db.files[0], ex.files[0]);
        onDone?.();
      } catch (err) {
        toast(err.message, { error: true });
      }
    },
  },
  field('garden-db.json (from the old Garden Planner folder)', db),
  field('Optional: v1 “Export” file, to keep your hand-placed positions', ex),
  h('button.btn.primary', { type: 'submit' }, icon('shovel', 16), 'Import v1 garden'));
  return form;
}

// ------------------------------------------------------------ setup (first run)

export function renderSetup({ onDone }) {
  const { mode } = store.getState();
  const localId = store.storage.get(store.storage.keys.localGarden);
  const local = mode === 'cloud' && localId ? store.readCache(localId) : null;

  const name = h('input', { type: 'text', name: 'name', value: 'Home Garden', required: true });
  const fresh = h('form.stack', {
    onsubmit: e => {
      e.preventDefault();
      adoptGarden({ garden: store.newGarden({ name: name.value.trim() || 'My Garden' }), beds: [], plantings: [], events: [], custom: [] });
      onDone();
    },
  }, field('Garden name', name), h('button.btn.primary', { type: 'submit' }, icon('plus', 16), 'Start a fresh garden'));

  const screen = h('div.title-screen',
    h('div.title-card.px.stack', { style: { textAlign: 'left', width: 'min(520px, 100%)' } },
      h('div.row', sprite('icon_sprout', { size: 64 }), h('div', h('h1', { style: { margin: 0 } }, 'New game'),
        h('p.muted', { style: { margin: 0 } }, mode === 'cloud' ? `Signed in as ${store.getState().user?.email}` : 'Playing offline on this device'))),
      local ? h('section.card.px.flat.stack',
        h('h3', `Bring “${local.garden.name}” to your account`),
        h('p.small.muted', `${local.beds.length} beds and ${local.plantings.length} plantings saved on this device.`),
        h('button.btn.primary', { onclick: () => { adoptGarden(local); store.storage.set(store.storage.keys.localGarden, null); onDone(); } }, icon('cloud', 16), 'Upload it')) : null,
      h('section.card.px.flat', v1ImportForm(onDone)),
      h('section.card.px.flat', fresh),
      mode === 'cloud' ? h('button.btn.sm.ghost', { onclick: () => sync.signOut() }, 'Sign out') : null));
  screen.style.backgroundImage = `url(${spriteURL('tile_grass')})`;
  return screen;
}

// ------------------------------------------------------------ settings view

export function mount(main) {
  const view = h('div.view');
  main.append(view);

  function render() {
    const { garden, mode, user, theme } = store.getState();
    if (!garden) return;
    const gForm = h('form.stack', {
      onsubmit: e => {
        e.preventDefault();
        const d = formData(gForm);
        store.updateGarden({
          name: d.name || garden.name, place: d.place, zone: d.zone,
          last_frost: mmdd(d.last_frost) || garden.last_frost, first_frost: mmdd(d.first_frost) || garden.first_frost,
          origin_lat: d.origin_lat, origin_lng: d.origin_lng,
        });
        toast('Saved');
      },
    },
    h('h2', 'Garden'),
    field('Name', h('input', { type: 'text', name: 'name', value: garden.name })),
    h('div.grid2', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' } },
      field('Place', h('input', { type: 'text', name: 'place', value: garden.place || '', placeholder: 'Portland, OR' })),
      field('USDA zone', h('input', { type: 'text', name: 'zone', value: garden.zone || '', placeholder: '8b' })),
      field('Average last frost', h('input', { type: 'date', name: 'last_frost', value: `2026-${garden.last_frost}` })),
      field('Average first frost', h('input', { type: 'date', name: 'first_frost', value: `2026-${garden.first_frost}` })),
      field('Latitude', h('input', { type: 'number', name: 'origin_lat', value: garden.origin_lat ?? '', step: 'any' })),
      field('Longitude', h('input', { type: 'number', name: 'origin_lng', value: garden.origin_lng ?? '', step: 'any' }))),
    h('p.small.muted', 'Frost dates drive every sowing window and task. Location centres the yard\'s satellite photo layer (only the year is ignored on the date pickers).'),
    h('div.row.wrap',
      h('button.btn.primary', { type: 'submit' }, 'Save'),
      h('button.btn', { type: 'button', onclick: useMyLocation }, icon('map', 16), 'Use my location')));

    fill(view, 
      h('h1', 'Settings'),
      h('section.card.px', gForm),
      h('section.card.px.stack',
        h('h2', 'Look'),
        h('label.field', h('span', 'Theme'), select([['auto', 'Match device'], ['day', 'Day'], ['night', 'Night']], theme, { onchange: e => store.applyTheme(e.target.value) }))),
      h('section.card.px.stack',
        h('h2', 'Data'),
        h('div.row.wrap',
          h('button.btn', { onclick: exportBackup }, icon('seed', 16), 'Download backup'),
          h('label.btn', icon('shovel', 16), 'Restore backup as new garden',
            h('input.sr-only', { type: 'file', accept: '.json,application/json', onchange: e => restore(e.target.files[0]) }))),
        h('details', h('summary', 'Import from Garden Planner v1'), h('div', { style: { marginTop: '10px' } }, v1ImportForm(() => { location.hash = '#/yard'; })))),
      h('section.card.px.stack',
        h('h2', 'Account'),
        mode === 'cloud'
          ? [h('p', `Signed in as ${user?.email}. Changes sync to every device you sign in on.`),
            h('div.row.wrap',
              h('button.btn', { onclick: newGarden }, icon('plus', 16), 'New garden'),
              h('button.btn', { onclick: () => sync.signOut() }, 'Sign out'),
              garden && store.getState().gardens.find(g => g.id === garden.id)?.role === 'owner'
                ? h('button.btn.danger', { onclick: deleteGarden }, icon('trash', 16), 'Delete garden') : null)]
          : [h('p', 'Offline mode: this garden lives only in this browser.'),
            sync.configured()
              ? h('button.btn.primary', { onclick: async () => { store.persistNow(); (await import('../main.js')).showTitle(); } }, icon('cloud', 16), 'Sign in to sync')
              : h('p.small.muted', 'Cloud sync isn\'t configured in js/config.js yet.')]),
      h('p.small.muted', `Garden Planner v${APP_VERSION}`),
    );
  }

  function useMyLocation() {
    if (!navigator.geolocation) return toast('Location not available', { error: true });
    navigator.geolocation.getCurrentPosition(
      pos => { store.updateGarden({ origin_lat: round6(pos.coords.latitude), origin_lng: round6(pos.coords.longitude) }); toast('Location set'); },
      err => toast(err.message, { error: true }),
      { enableHighAccuracy: true, timeout: 10_000 });
  }

  function exportBackup() {
    const s = store.getState();
    const name = s.garden.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    download(`${name}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(makeBackup(s), null, 2));
  }

  async function restore(file) {
    if (!file) return;
    try {
      const data = restoreBackup(JSON.parse(await readFile(file)));
      data.garden.name = `${data.garden.name} (restored)`;
      if (store.getState().mode === 'local' && !(await confirmSheet('Replace the garden on this device with the backup?', { ok: 'Replace', danger: true }))) return;
      adoptGarden(data);
      toast('Backup restored');
      location.hash = '#/yard';
    } catch (e) {
      toast(e.message, { error: true });
    }
  }

  async function newGarden() {
    const name = await sheet(close => {
      const input = h('input', { type: 'text', value: 'New Garden', autofocus: true });
      return h('form.stack', { onsubmit: e => { e.preventDefault(); close(input.value.trim()); } },
        h('h2', 'New garden'), field('Name', input),
        h('div.actions', h('button.btn.primary', { type: 'submit' }, 'Create'), h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel')));
    });
    if (!name) return;
    adoptGarden({ garden: store.newGarden({ name }), beds: [], plantings: [], events: [], custom: [] });
    location.hash = '#/yard';
  }

  async function deleteGarden() {
    const { garden, gardens } = store.getState();
    if (!(await confirmSheet(`Permanently delete “${garden.name}” with all its beds, plantings and logs? This can't be undone. (Download a backup first if unsure.)`, { ok: 'Delete forever', danger: true }))) return;
    const { error } = await sync.getClient().from('gardens').delete().eq('id', garden.id);
    if (error) return toast(error.message, { error: true });
    store.storage.set(store.storage.keys.data(garden.id), null);
    const rest = gardens.filter(g => g.id !== garden.id);
    store.set({ gardens: rest, garden: null });
    const main = await import('../main.js');
    if (rest[0]) main.openGarden(rest[0].id); else main.showSetup();
  }

  render();
  return store.watch(s => [s.garden?.id, s.garden?.name, s.theme, s.mode, s.gardens], render);
}

function mmdd(dateStr) {
  return dateStr ? dateStr.slice(5, 10) : null;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}
