// Bed editor: a wood-framed soil plot (round for pots) with light 6" guides. Pick a plant from the
// seed box (or the unplaced tray) and tap the soil to place it. Every individual plant is drawn at
// its real spacing and can be dragged on its own; tap one to select its planting.

import * as store from '../store.js';
import { h, icon, plantSprite, sprite, clear, toast, confirmSheet } from '../ui.js';
import { spriteURL } from '../sprites.js';
import { getPlant, allPlants, CATEGORIES } from '../plants.js';
import {
  progress, displayName, todayStr, companionIssues, rotationIssues, bedCapacity, expectedHarvest, prettyDate,
} from '../season.js';
import { unitPositions, plantSpots, isSolo } from '../geo.js';
import { editBedSheet, newBedSheet, plantingSheet, harvestSheet, STATUS_LABELS } from './common.js';
import { fmtFt } from './yard.js';

const LAST_BED = 'gp2.lastBed';
const isPot = isSolo; // pots and single-plant patches behave the same here
const SNAP = 1 / 12;   // ft: placement snaps to the inch, i.e. effectively free
const KEY_STEP = 0.25; // ft per arrow-key press

export const spacingFtOf = plant => Math.max(1 / 6, (plant.spacingIn || 12) / 12);

export function mount(main, bedId) {
  const view = h('div.view');
  main.append(view);

  const ui = {
    armed: null,          // { plantKey } | { plantingId }
    selected: null,       // planting id
    cat: 'all',
    q: '',
    placeAs: store.storage.get('gp2.placeAs', 'planted'),
    showDone: false,
  };

  const state = () => store.getState();
  const custom = () => store.customPlants();

  function currentBed() {
    const beds = state().beds.filter(b => !b.archived);
    const want = bedId || store.storage.get(LAST_BED);
    return beds.find(b => b.id === want) || beds[0] || null;
  }

  // ---------------------------------------------------------- render

  let dragging = false; // suppress re-renders mid-drag (they'd drop pointer capture)

  function render() {
    const bed = currentBed();
    clear(view);
    view.append(bedTabs(bed));
    if (!bed) {
      view.append(h('div.empty', sprite('icon_bed', { size: 64 }), h('p', 'No beds yet.'),
        h('button.btn.primary', { onclick: () => newBedSheet().then(b => b && (location.hash = `#/bed/${b.id}`)) }, icon('plus', 16), 'Add a bed')));
      return;
    }
    store.storage.set(LAST_BED, bed.id);
    const season = Number(todayStr().slice(0, 4));
    const plantings = state().plantings.filter(p => p.bed_id === bed.id && (ui.showDone || !['done', 'failed'].includes(p.status)));
    const plants = plantings.reduce((n, p) => n + (p.qty || 1), 0);
    const cap = bedCapacity(bed, state().plantings, custom());
    const issues = companionIssues(plantings, custom());
    const rot = rotationIssues(bed, state().plantings, season, custom());
    const size = bed.shape === 'round'
      ? `${fmtFt(bed.length_ft)} round${bed.volume_gal ? ` · ${bed.volume_gal} gal` : ''}`
      : `${fmtFt(bed.length_ft)} × ${fmtFt(bed.width_ft)}${bed.height_ft ? ` × ${fmtFt(bed.height_ft)}` : ''}`;

    view.append(
      h('div.bed-head',
        h('div.grow',
          h('h1', bed.name),
          h('div.small.muted', `${size} · ${bed.area || 'No area'} · ${plants} plant${plants === 1 ? '' : 's'}`)),
        h('div', { style: { width: '220px' } },
          h('div.small.muted', `Space used ${Math.round(cap.usedSqFt * 10) / 10} / ${Math.round(cap.areaSqFt * 10) / 10} sq ft`),
          h(`div.meter${cap.pct > 1 ? '.over' : ''}`, h('i', { style: { width: `${Math.min(100, Math.round(cap.pct * 100))}%` } }), h('b', `${Math.round(cap.pct * 100)}%`))),
        h('button.btn.sm', { onclick: () => editBedSheet(bed) }, icon('edit', 16), bed.kind === 'container' ? 'Edit pot' : 'Edit bed'),
      ),
      h('div.bed-layout',
        h('div.stack', stage(bed, plantings, issues), issuesCard(issues, rot, cap)),
        h('div.stack', selectedCard(bed), paletteCard(), trayCard(season)),
      ),
    );
  }

  function bedTabs(active) {
    const all = state().beds.filter(b => !b.archived);
    const beds = all.filter(b => !isSolo(b));
    const pots = all.filter(isSolo).sort((a, b) => a.name.localeCompare(b.name));
    // Pots get their own picker so thirty of them don't crowd out the beds.
    const potPicker = pots.length ? h('select.pot-picker', {
      'aria-label': 'Pots',
      onchange: e => { if (e.target.value) location.hash = `#/bed/${e.target.value}`; },
    },
    h('option', { value: '' }, `Pots & shrubs (${pots.length})…`),
    pots.map(b => h('option', { value: b.id, selected: b.id === active?.id }, b.name))) : null;
    if (potPicker && isSolo(active)) potPicker.classList.add('active');
    return h('div.bed-tabs', { role: 'tablist', 'aria-label': 'Beds' },
      beds.map(b => h(`a.btn.sm${b.id === active?.id ? '.primary' : ''}`, {
        href: `#/bed/${b.id}`, role: 'tab', 'aria-selected': String(b.id === active?.id),
      }, b.name)),
      potPicker,
      h('button.btn.sm', { onclick: () => newBedSheet().then(b => b && (location.hash = `#/bed/${b.id}`)) }, icon('plus', 16), 'New'));
  }

  // ---------------------------------------------------------- stage

  function stage(bed, plantings, issues) {
    const round = bed.shape === 'round';
    const wrap = h(`div.bed-stage${bed.kind === 'container' ? '.container-kind' : ''}${round ? '.round' : ''}.px.flat`);
    const soil = h(`div.bed-soil${ui.armed ? '.arming' : ''}${round ? '.round' : ''}`, { tabindex: 0, 'aria-label': `${bed.name} soil. ${ui.armed ? 'Tap to place.' : ''}` });
    const grid = h('div.grid');
    soil.append(grid);
    wrap.append(soil);
    // Size after layout so we know the width available.
    requestAnimationFrame(() => layout(bed, wrap, soil, grid, plantings, issues));
    return wrap;
  }

  function layout(bed, wrap, soil, grid, plantings, issues) {
    // Round stages shrink-wrap the soil, so measure the column they sit in.
    const avail = (bed.shape === 'round' ? wrap.parentElement.clientWidth : wrap.clientWidth) - 36;
    const maxH = Math.max(180, innerHeight * 0.55);
    // Small things (pots) get zoomed in further so the plant is actually visible.
    const cap = bed.length_ft <= 2.5 ? 220 : 160;
    const ppf = Math.max(20, Math.min(cap, Math.floor(Math.min(avail / bed.length_ft, maxH / bed.width_ft))));
    const W = Math.round(bed.length_ft * ppf), H = Math.round(bed.width_ft * ppf);
    Object.assign(soil.style, {
      width: `${W}px`, height: `${H}px`,
      backgroundImage: `url(${spriteURL('tile_soil')})`, backgroundSize: '48px 48px',
    });
    // Guides: faint every 6", a little stronger every foot. They're only guides; placement is free.
    const half = ppf / 2;
    Object.assign(grid.style, {
      backgroundImage: [
        'linear-gradient(to right, rgba(242,230,201,.55) 1px, transparent 1px)',
        'linear-gradient(to bottom, rgba(242,230,201,.55) 1px, transparent 1px)',
        'linear-gradient(to right, rgba(242,230,201,.22) 1px, transparent 1px)',
        'linear-gradient(to bottom, rgba(242,230,201,.22) 1px, transparent 1px)',
      ].join(','),
      backgroundSize: `${ppf}px ${ppf}px, ${ppf}px ${ppf}px, ${half}px ${half}px, ${half}px ${half}px`,
    });

    const clash = new Set(), friend = new Set();
    for (const i of issues) for (const p of [i.a, i.b]) (i.kind === 'avoid' ? clash : friend).add(p.id);

    const today = todayStr();
    let focusEl = null;
    // Never draw a plant bigger than its bed (in a pot, keep a rim of soil showing).
    const maxSprite = Math.floor((Math.min(bed.length_ft, bed.width_ft) * ppf * (isPot(bed) ? 0.8 : 1)) / 8) * 8;
    for (const p of plantings) {
      if (p.x_ft == null) continue;
      const plant = getPlant(p.plant_key, custom());
      const units = plantSpots(p, bed, spacingFtOf(plant));
      units.forEach(([x, y], i) => {
        const el = plantEl(p, plant, i, x, y, ppf, today, clash.has(p.id), friend.has(p.id), maxSprite, isPot(bed));
        soil.append(el);
        if (ui.selected === p.id && i === 0) focusEl = el;
      });
    }
    if (ui.refocus) { ui.refocus = false; focusEl?.focus(); }
    bindSoil(bed, soil, ppf);
  }

  function plantEl(p, plant, i, x, y, ppf, today, isClash, isFriend, maxSprite, inPot) {
    const pr = progress(p, plant, today);
    const spacingFt = spacingFtOf(plant);
    // Every plant gets the same icon size (a whole-number multiple of the 16px sprite, so pixels
    // stay crisp); spacing is shown by the ring and the space meter instead. A lone plant in a
    // pot or patch fills it.
    const uniform = Math.max(32, Math.min(48, Math.round((ppf * 0.45) / 16) * 16));
    const size = inPot ? maxSprite : Math.min(uniform, maxSprite);
    const cls = ['plant', p.status === 'planned' && 'planned', ui.selected === p.id && 'selected', pr.stage === 'ready' && 'ready',
      isClash && 'clash', !isClash && isFriend && 'friend', p.locked && 'locked'].filter(Boolean).join('.');
    const key = pr.stage === 'started' ? 'seedling' : plant.sprite;
    const n = p.qty || 1;
    return h(`div.${cls}`, {
      role: 'button', tabindex: i === 0 ? 0 : -1,
      'aria-label': `${displayName(p, plant)}${n > 1 ? ` (${i + 1} of ${n})` : ''}, ${STATUS_LABELS[p.status]}`,
      title: `${displayName(p, plant)}${n > 1 ? ` · ${i + 1}/${n}` : ''}`,
      dataset: { id: p.id, i: String(i) },
      style: { left: `${x * ppf}px`, top: `${y * ppf}px`, width: `${size}px`, height: `${size}px` },
    },
    // Spacing ring (skipped in pots, where the pot itself is the plant's space).
    ui.selected === p.id && !inPot ? h('i.ring', { style: { width: `${spacingFt * ppf}px`, height: `${spacingFt * ppf}px` } }) : null,
    h('img', { src: spriteURL(key, plant.tint), alt: '' }),
    pr.stage === 'ready' ? h('i.spark') : null);
  }

  /** Move the i-th plant of planting p to (x, y), saving the full position list. */
  function moveUnit(bed, p, i, x, y) {
    const plant = getPlant(p.plant_key, custom());
    const units = unitPositions(p, bed, spacingFtOf(plant)).map(u => [...u]);
    units[i] = [x, y];
    store.updatePlanting(p.id, { positions: units, x_ft: units[0][0], y_ft: units[0][1] });
  }

  function bindSoil(bed, soil, ppf) {
    const toFt = e => {
      const r = soil.getBoundingClientRect();
      return [clampTo((e.clientX - r.left) / ppf, bed.length_ft), clampTo((e.clientY - r.top) / ppf, bed.width_ft)];
    };
    let drag = null;

    soil.addEventListener('pointerdown', e => {
      const el = e.target.closest('.plant');
      if (el) {
        const p = state().plantings.find(x => x.id === el.dataset.id);
        if (!p) return;
        e.preventDefault();
        // A potted plant *is* its pot: it stays centred (move the pot in the Yard instead).
        drag = { id: p.id, i: Number(el.dataset.i), el, sx: e.clientX, sy: e.clientY, moved: false, locked: p.locked || isPot(bed) };
        dragging = true;
        try { soil.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
        return;
      }
      if (ui.armed) place(bed, ...toFt(e));
      else if (ui.selected) { ui.selected = null; render(); }
    });

    soil.addEventListener('pointermove', e => {
      if (!drag || drag.locked) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < (e.pointerType === 'touch' ? 8 : 4)) return;
      drag.moved = true;
      const [x, y] = toFt(e).map(snap);
      drag.x = x; drag.y = y;
      drag.el.style.left = `${x * ppf}px`;
      drag.el.style.top = `${y * ppf}px`;
    });

    soil.addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      dragging = false;
      const p = state().plantings.find(x => x.id === d.id);
      if (!p) return render();
      if (d.moved && !d.locked) {
        ui.selected = d.id;
        moveUnit(bed, p, d.i, d.x, d.y);
      } else if (ui.selected === d.id) {
        plantingSheet(p);
      } else {
        ui.selected = d.id;
        render();
      }
    });

    soil.addEventListener('pointercancel', () => {
      if (!drag) return;
      drag = null;
      dragging = false;
      render();
    });

    soil.addEventListener('keydown', e => {
      const p = state().plantings.find(x => x.id === ui.selected);
      if (e.key === 'Escape') { ui.armed = null; ui.selected = null; return render(); }
      if (!p) return;
      const step = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[e.key];
      if (step && !p.locked) {
        // Arrow keys nudge the whole planting (every plant in it).
        e.preventDefault();
        ui.refocus = true;
        const plant = getPlant(p.plant_key, custom());
        const units = unitPositions(p, bed, spacingFtOf(plant))
          .map(([x, y]) => [clampTo(x + step[0], bed.length_ft), clampTo(y + step[1], bed.width_ft)]);
        store.updatePlanting(p.id, { positions: units, x_ft: units[0][0], y_ft: units[0][1] });
      } else if (e.key === 'Enter') {
        plantingSheet(p);
      }
    });

    soil.addEventListener('focusin', e => {
      const el = e.target.closest?.('.plant');
      if (el && ui.selected !== el.dataset.id) { ui.selected = el.dataset.id; }
    });
  }

  function place(bed, x, y) {
    [x, y] = isPot(bed) ? [bed.length_ft / 2, bed.width_ft / 2] : [snap(x), snap(y)];
    const today = todayStr();
    if (ui.armed.plantingId) {
      // A planting from the tray: its plants go in a row starting where you tapped.
      const p = state().plantings.find(q => q.id === ui.armed.plantingId);
      const plant = getPlant(p.plant_key, custom());
      const units = unitPositions({ ...p, x_ft: x, y_ft: y, positions: null }, bed, spacingFtOf(plant));
      store.updatePlanting(p.id, { bed_id: bed.id, x_ft: x, y_ft: y, positions: units });
      ui.selected = p.id;
      ui.armed = null;
      return;
    }
    const plant = getPlant(ui.armed.plantKey, custom());
    const planted = ui.placeAs === 'planted';
    const byTransplant = plant.daysFrom === 'transplant';
    const p = store.addPlanting({
      bed_id: bed.id, plant_key: plant.key, x_ft: x, y_ft: y, positions: [[x, y]],
      status: planted ? 'planted' : 'planned',
      method: plant.perennial ? 'perennial' : byTransplant ? 'transplant' : 'direct',
      sow_date: planted && !byTransplant ? today : null,
      transplant_date: planted && byTransplant ? today : null,
    });
    ui.selected = p.id;
  }

  /** Add or remove one plant from a planting, keeping everyone else where they are. */
  function changeQty(bed, p, delta) {
    const plant = getPlant(p.plant_key, custom());
    const units = unitPositions(p, bed, spacingFtOf(plant));
    const qty = Math.max(1, (p.qty || 1) + delta);
    const next = delta > 0 ? unitPositions({ ...p, qty, positions: units }, bed, spacingFtOf(plant)) : units.slice(0, qty);
    store.updatePlanting(p.id, { qty, positions: next });
  }

  // ---------------------------------------------------------- side panel

  function selectedCard(bed) {
    const p = state().plantings.find(x => x.id === ui.selected);
    if (!p) return null;
    const plant = getPlant(p.plant_key, custom());
    const pr = progress(p, plant, todayStr());
    const eh = expectedHarvest(p, plant);
    return h('section.card.px',
      h('div.row', plantSprite(p.plant_key, custom(), { size: 48 }),
        h('div.grow', h('h3', { style: { margin: 0 } }, displayName(p, plant)),
          h('div.small.muted', `${STATUS_LABELS[p.status]}${p.qty > 1 ? ` · ×${p.qty}` : ''}${eh ? ` · harvest ~${prettyDate(eh)}` : ''}`))),
      pr.pct > 0 && pr.stage !== 'done' ? h('div.meter', h('i', { style: { width: `${Math.round(pr.pct * 100)}%` } }), h('b', pr.stage === 'ready' ? 'READY' : `${pr.daysLeft}d left`)) : null,
      h('div.row.wrap', { style: { marginTop: '8px' } },
        h('button.btn.sm.primary', { onclick: () => plantingSheet(p) }, icon('edit', 16), 'Details'),
        h('button.btn.sm.warn', { onclick: () => harvestSheet(p) }, icon('basket', 16), 'Harvest'),
        h('button.btn.sm', { title: 'Add one more plant', onclick: () => changeQty(bed, p, 1) }, '+1'),
        p.qty > 1 ? h('button.btn.sm', { title: 'Remove the last plant', onclick: () => changeQty(bed, p, -1) }, '−1') : null,
        isPot(bed) ? null : h('button.btn.sm', { onclick: () => store.updatePlanting(p.id, { locked: !p.locked }) }, icon(p.locked ? 'lock' : 'unlock', 16), p.locked ? 'Locked' : 'Lock'),
        isPot(bed) ? null : h('button.btn.sm', { title: 'Move to unplaced tray', onclick: () => { store.updatePlanting(p.id, { bed_id: null, x_ft: null, y_ft: null, positions: null }); ui.selected = null; } }, 'Unplace'),
        h('button.btn.sm.danger', { 'aria-label': 'Delete planting', onclick: async () => {
          if (await confirmSheet(`Delete ${displayName(p, plant)}?`, { ok: 'Delete', danger: true })) { store.deletePlanting(p.id); ui.selected = null; }
        } }, icon('trash', 16))));
  }

  function paletteCard() {
    const plants = allPlants(custom());
    const q = ui.q.toLowerCase();
    const shown = plants.filter(p => (ui.cat === 'all' || p.category === ui.cat)
      && (!q || p.name.toLowerCase().includes(q) || (p.aliases || []).some(a => a.toLowerCase().includes(q))));
    const grid = h('div.grid', shown.slice(0, 150).map(p => h('button.chip', {
      type: 'button', 'aria-pressed': String(ui.armed?.plantKey === p.key), title: p.name,
      onclick: () => {
        ui.armed = ui.armed?.plantKey === p.key ? null : { plantKey: p.key };
        render();
        if (ui.armed) toast(`Tap the soil to place ${p.name}`);
      },
    }, plantSprite(p.key, custom(), { size: 32, alt: '' }), p.name)));
    const search = h('input', { type: 'search', placeholder: 'Search…', value: ui.q, 'aria-label': 'Search plants',
      oninput: e => { ui.q = e.target.value; const g = paletteCard(); card.replaceWith(g); g.querySelector('input').focus(); } });
    const card = h('section.card.px.palette',
      h('div.row', h('h3.grow', { style: { margin: 0 } }, 'Seed box'),
        h('label.row.small', 'Place as',
          h('select', { style: { width: 'auto', minHeight: '32px' }, onchange: e => { ui.placeAs = e.target.value; store.storage.set('gp2.placeAs', ui.placeAs); } },
            h('option', { value: 'planted', selected: ui.placeAs === 'planted' }, 'Planted today'),
            h('option', { value: 'planned', selected: ui.placeAs === 'planned' }, 'Planned')))),
      search,
      h('div.cats',
        [['all', 'All'], ...CATEGORIES.map(c => [c.key, c.name])].map(([k, n]) =>
          h(`button.btn.sm${ui.cat === k ? '.primary' : ''}`, { type: 'button', onclick: () => { ui.cat = k; render(); } }, n))),
      grid,
      ui.armed ? h('button.btn.sm', { onclick: () => { ui.armed = null; render(); } }, icon('close', 16), 'Stop placing') : null);
    return card;
  }

  function trayCard(season) {
    const loose = state().plantings.filter(p => !p.bed_id && !['done', 'failed'].includes(p.status) && p.season >= season - 0);
    const unpositioned = state().plantings.filter(p => p.bed_id === currentBed()?.id && p.x_ft == null && !['done', 'failed'].includes(p.status));
    const items = [...unpositioned, ...loose];
    return h('section.card.px',
      h('h3', 'Unplaced'),
      items.length
        ? h('div.tray', items.map(p => {
          const plant = getPlant(p.plant_key, custom());
          return h('button.chip', {
            type: 'button', 'aria-pressed': String(ui.armed?.plantingId === p.id),
            title: `${displayName(p, plant)} · ${STATUS_LABELS[p.status]} · ${p.season}`,
            onclick: () => { ui.armed = ui.armed?.plantingId === p.id ? null : { plantingId: p.id }; render(); if (ui.armed) toast('Tap the soil to place it'); },
          }, plantSprite(p.plant_key, custom(), { size: 32, alt: '' }), h('span', displayName(p, plant)), h('span.small.muted', `${p.season}`));
        }))
        : h('p.small.muted', 'Planned crops without a bed show up here.'),
      h('label.row.small', { style: { marginTop: '8px' } },
        h('input', { type: 'checkbox', checked: ui.showDone, onchange: e => { ui.showDone = e.target.checked; render(); } }), 'Show finished plantings in bed'));
  }

  function issuesCard(issues, rot, cap) {
    const items = [];
    for (const i of issues.filter(i => i.kind === 'avoid')) {
      items.push(h('li', icon('clash', 24), `${i.names[0]} and ${i.names[1]} don't like being neighbours.`));
    }
    for (const f of rot) items.push(h('li', icon('warn', 24), `Same family as last season here (${f}). Rotate if you can.`));
    if (cap.pct > 1.05) items.push(h('li', icon('warn', 24), `Crowded: ${Math.round(cap.pct * 100)}% of the bed by spacing.`));
    for (const i of issues.filter(i => i.kind === 'companion').slice(0, 4)) {
      items.push(h('li', icon('heart', 24), `${i.names[0]} + ${i.names[1]} are good companions.`));
    }
    if (!items.length) return null;
    return h('section.card.px', h('h3', 'Bed notes'), h('ul.issues', items));
  }

  // ---------------------------------------------------------- lifecycle

  render();
  const onResize = () => render();
  addEventListener('resize', onResize);
  const unsub = store.watch(s => [s.beds, s.plantings, s.custom], () => { if (!dragging) render(); });
  return () => {
    unsub();
    removeEventListener('resize', onResize);
  };
}

function snap(v) {
  return Math.round(Math.round(v / SNAP) * SNAP * 100) / 100;
}

function clampTo(v, max) {
  return Math.max(0, Math.min(max, v));
}
