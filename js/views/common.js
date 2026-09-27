// Sheets shared across views: bed editor, planting editor, harvest logger, plant picker.

import * as store from '../store.js';
import { h, icon, plantSprite, sprite, sheet, field, select, formData, confirmSheet, toast } from '../ui.js';
import { getPlant, allPlants, CATEGORIES } from '../plants.js';
import { displayName, expectedHarvest, progress, todayStr, prettyDate, sowingWindows, addDays } from '../season.js';

export const STATUS_LABELS = {
  planned: 'Planned', started: 'Started indoors', planted: 'In the ground',
  harvesting: 'Harvesting', done: 'Done', failed: 'Failed',
};
const METHOD_LABELS = { '': '—', direct: 'Direct sow', start: 'Start indoors', transplant: 'Transplant', perennial: 'Perennial' };
const KIND_LABELS = { raised: 'Raised bed', container: 'Container / pot', ground: 'In-ground patch', tray: 'Seed tray (indoors)' };

// ------------------------------------------------------------ beds

function bedForm(bed, submitLabel) {
  return close => {
    const form = h('form.stack', {
      onsubmit: e => {
        e.preventDefault();
        const d = formData(form);
        if (!d.name) return toast('Give it a name', { error: true });
        close({
          name: d.name, kind: d.kind, area: d.area,
          length_ft: clampPos(d.length_ft, 4), width_ft: clampPos(d.width_ft, 4), height_ft: d.height_ft,
          notes: d.notes,
        });
      },
    },
    h('header', sprite('icon_bed', { size: 48 }), h('h2', bed.id ? 'Edit bed' : 'New bed')),
    field('Name', h('input', { type: 'text', name: 'name', value: bed.name || '', required: true, autofocus: true })),
    h('div.grid2',
      field('Kind', select(Object.entries(KIND_LABELS), bed.kind || 'raised', { name: 'kind' })),
      field('Area', h('input', { type: 'text', name: 'area', value: bed.area || '', placeholder: 'Backyard', list: 'areas' })),
      field('Length (ft)', h('input', { type: 'number', name: 'length_ft', value: bed.length_ft ?? 4, min: 0.5, step: 0.5 })),
      field('Width (ft)', h('input', { type: 'number', name: 'width_ft', value: bed.width_ft ?? 4, min: 0.5, step: 0.5 })),
      field('Height (ft)', h('input', { type: 'number', name: 'height_ft', value: bed.height_ft ?? '', min: 0, step: 0.25 })),
    ),
    h('datalist', { id: 'areas' }, [...new Set(store.getState().beds.map(b => b.area).filter(Boolean))].map(a => h('option', { value: a }))),
    field('Notes', h('textarea', { name: 'notes' }, bed.notes || '')),
    h('div.actions',
      h('button.btn.primary', { type: 'submit' }, submitLabel),
      bed.id ? h('button.btn.danger', { type: 'button', onclick: () => close('delete') }, icon('trash', 16), 'Delete') : null,
      h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel')));
    return form;
  };
}

function clampPos(n, fallback) {
  return n && n > 0 ? n : fallback;
}

export async function newBedSheet(fields = {}) {
  const res = await sheet(bedForm({ name: `Bed ${store.getState().beds.length + 1}`, ...fields }, 'Add bed'), { label: 'New bed' });
  return res ? store.addBed({ ...fields, ...res }) : null;
}

export async function editBedSheet(bed) {
  const res = await sheet(bedForm(bed, 'Save'), { label: 'Edit bed' });
  if (res === 'delete') {
    const n = store.getState().plantings.filter(p => p.bed_id === bed.id).length;
    const ok = await confirmSheet(`Delete ${bed.name}?${n ? ` Its ${n} planting${n === 1 ? '' : 's'} will move to the unplaced tray.` : ''}`, { ok: 'Delete', danger: true });
    if (ok) {
      store.deleteBed(bed.id);
      if (location.hash.includes(bed.id)) location.hash = '#/bed';
    }
    return null;
  }
  return res ? store.updateBed(bed.id, res) : null;
}

// ------------------------------------------------------------ plantings

export async function plantingSheet(planting) {
  const custom = store.customPlants();
  const plant = getPlant(planting.plant_key, custom);
  const today = todayStr();
  const { beds, garden } = store.getState();
  const climate = { lastFrost: garden.last_frost, firstFrost: garden.first_frost };
  const pr = progress(planting, plant, today);
  const eh = expectedHarvest(planting, plant);

  const res = await sheet(close => {
    const form = h('form.stack', {
      onsubmit: e => {
        e.preventDefault();
        const d = formData(form);
        close({ action: 'save', patch: {
          variety: d.variety, qty: Math.max(1, d.qty || 1), status: d.status, method: d.method,
          bed_id: d.bed_id, season: d.season || planting.season,
          sow_date: d.sow_date, transplant_date: d.transplant_date, expected_harvest: d.expected_harvest,
          done_date: d.done_date, source: d.source, notes: d.notes, locked: d.locked,
          ...(d.bed_id !== planting.bed_id ? { x_ft: null, y_ft: null } : {}),
        } });
      },
    },
    h('header', plantSprite(plant.key, custom, { size: 48 }),
      h('div', h('h2', displayName(planting, plant)), h('div.small.muted', `${plant.category || ''} · ${STATUS_LABELS[planting.status]}`))),
    progressLine(pr, eh, plant),
    h('div.grid2',
      field('Variety', h('input', { type: 'text', name: 'variety', value: planting.variety || '', placeholder: plant.name })),
      field('Quantity', h('input', { type: 'number', name: 'qty', value: planting.qty, min: 1, step: 1 })),
      field('Status', select(Object.entries(STATUS_LABELS), planting.status, { name: 'status' })),
      field('Method', select(Object.entries(METHOD_LABELS), planting.method || '', { name: 'method' })),
      field('Bed', select([['', 'Unplaced'], ...beds.map(b => [b.id, b.name])], planting.bed_id || '', { name: 'bed_id' })),
      field('Season', h('input', { type: 'number', name: 'season', value: planting.season, min: 2000, max: 2100 })),
      field('Sown', h('input', { type: 'date', name: 'sow_date', value: planting.sow_date || '' })),
      field('Planted out', h('input', { type: 'date', name: 'transplant_date', value: planting.transplant_date || '' })),
      field('Harvest (override)', h('input', { type: 'date', name: 'expected_harvest', value: planting.expected_harvest || '' })),
      field('Finished', h('input', { type: 'date', name: 'done_date', value: planting.done_date || '' })),
    ),
    field('Source', h('input', { type: 'text', name: 'source', value: planting.source || '', placeholder: 'Seed packet, nursery start…' })),
    field('Notes', h('textarea', { name: 'notes' }, planting.notes || '')),
    h('label.row', h('input', { type: 'checkbox', name: 'locked', checked: planting.locked }), 'Lock position in bed'),
    windowsLine(plant, climate, planting.season),
    h('div.actions',
      h('button.btn.primary', { type: 'submit' }, 'Save'),
      h('button.btn.warn', { type: 'button', onclick: () => close({ action: 'harvest' }) }, icon('basket', 16), 'Log harvest'),
      h('button.btn', { type: 'button', onclick: () => close({ action: 'duplicate' }) }, 'Duplicate'),
      h('button.btn.danger', { type: 'button', onclick: () => close({ action: 'delete' }) }, icon('trash', 16), 'Delete')));
    return form;
  }, { label: displayName(planting, plant) });

  if (!res) return;
  if (res.action === 'save') {
    const patch = { ...res.patch, bed_id: res.patch.bed_id || null };
    if (patch.status === 'done' && !patch.done_date) patch.done_date = today;
    store.updatePlanting(planting.id, patch);
  } else if (res.action === 'harvest') {
    await harvestSheet(planting);
  } else if (res.action === 'duplicate') {
    const { id, created_at, updated_at, ...rest } = planting;
    store.addPlanting({ ...rest, x_ft: planting.x_ft != null ? planting.x_ft + 0.5 : null, locked: false });
    toast('Duplicated');
  } else if (res.action === 'delete') {
    if (await confirmSheet(`Delete ${displayName(planting, plant)}?`, { ok: 'Delete', danger: true })) store.deletePlanting(planting.id);
  }
}

function progressLine(pr, eh, plant) {
  const bits = [];
  if (pr.stage === 'growing' && pr.daysLeft != null) bits.push(`${pr.daysLeft} days to harvest (${prettyDate(eh)})`);
  else if (pr.stage === 'ready') bits.push('Ready to harvest now');
  else if (pr.stage === 'late') bits.push(`Harvest window passed ${prettyDate(eh)}`);
  else if (eh) bits.push(`Harvest ~${prettyDate(eh)}`);
  if (plant.days) bits.push(`${plant.days} days from ${plant.daysFrom === 'transplant' ? 'transplant' : 'sowing'}`);
  if (plant.spacingIn) bits.push(`${plant.spacingIn}" spacing`);
  const meter = pr.pct > 0 ? h('div.meter', h('i', { style: { width: `${Math.round(pr.pct * 100)}%` } }), h('b', `${Math.round(pr.pct * 100)}%`)) : null;
  return h('div.stack', { style: { gap: '6px' } }, h('div.small.muted', bits.join(' · ')), meter);
}

function windowsLine(plant, climate, season) {
  const wins = sowingWindows(plant, climate, season);
  if (!wins.length) return null;
  return h('div.small.muted', wins.map(w => `${w.label}: ${prettyDate(w.start)}–${prettyDate(w.end)}`).join(' · '));
}

// ------------------------------------------------------------ harvest

export async function harvestSheet(planting = null, { plantKey = null } = {}) {
  const custom = store.customPlants();
  const key = planting?.plant_key || plantKey;
  const plant = key ? getPlant(key, custom) : null;
  const lastUnit = store.getState().events.find(e => e.type === 'harvest' && e.plant_key === key)?.unit;
  const res = await sheet(close => {
    const form = h('form.stack', {
      onsubmit: e => {
        e.preventDefault();
        close(formData(form));
      },
    },
    h('header', plant ? plantSprite(plant.key, custom, { size: 48 }) : sprite('icon_basket', { size: 48 }),
      h('h2', plant ? `Harvest: ${planting ? displayName(planting, plant) : plant.name}` : 'Log harvest')),
    h('div.grid2',
      field('Amount', h('input', { type: 'number', name: 'amount', min: 0, step: 'any', autofocus: true })),
      field('Unit', select(['count', 'lb', 'oz', 'g', 'kg', 'bunch', 'cup', 'handful'], lastUnit || 'count', { name: 'unit' })),
      field('Date', h('input', { type: 'date', name: 'date', value: todayStr() })),
      planting ? field('Mark as', select([['', 'Keep harvesting'], ['harvesting', 'Harvesting'], ['done', 'Finished (pull it)']], '', { name: 'mark' })) : null,
    ),
    field('Notes', h('textarea', { name: 'text', placeholder: 'Taste, size, pests…' })),
    h('div.actions', h('button.btn.primary', { type: 'submit' }, icon('basket', 16), 'Log it'), h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel')));
    return form;
  }, { label: 'Log harvest' });
  if (!res) return null;
  const ev = store.logEvent({
    type: 'harvest', date: res.date || todayStr(), planting_id: planting?.id ?? null, bed_id: planting?.bed_id ?? null,
    plant_key: key, amount: res.amount, unit: res.unit, text: res.text,
  });
  if (planting && res.mark) {
    store.updatePlanting(planting.id, { status: res.mark, ...(res.mark === 'done' ? { done_date: res.date || todayStr() } : {}) });
  } else if (planting && planting.status === 'planted') {
    store.updatePlanting(planting.id, { status: 'harvesting' });
  }
  toast('Harvest logged');
  return ev;
}

// ------------------------------------------------------------ plant picker

/** Choose a plant from the library. Resolves to a plant key or null. */
export function pickPlantSheet({ title = 'Pick a plant' } = {}) {
  const custom = store.customPlants();
  const plants = allPlants(custom);
  return sheet(close => {
    const list = h('div.palette');
    const grid = h('div.grid');
    const search = h('input', { type: 'search', placeholder: 'Search plants…', autofocus: true, oninput: render });
    function render() {
      const q = search.value.trim().toLowerCase();
      grid.replaceChildren(...plants
        .filter(p => !q || p.name.toLowerCase().includes(q) || (p.aliases || []).some(a => a.toLowerCase().includes(q)))
        .slice(0, 120)
        .map(p => h('button.chip', { type: 'button', onclick: () => close(p.key) }, plantSprite(p.key, custom, { size: 32 }), p.name)));
    }
    render();
    list.append(search, grid);
    return h('div.stack', h('h2', title), list, h('div.actions', h('button.btn', { onclick: () => close(null) }, 'Cancel')));
  }, { label: title });
}

export { CATEGORIES, addDays };
