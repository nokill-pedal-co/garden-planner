// Yard: top-down pixel view of the lot. The canvas is rendered at low resolution ("art pixels")
// and scaled up with image-rendering: pixelated, so everything — including the optional satellite
// photo underlay — comes out chunky. World units are feet; see ARCHITECTURE.md "Coordinates".

import * as store from '../store.js';
import { h, icon, plantSprite, sprite, clear, fill, toast } from '../ui.js';
import { spriteCanvas } from '../sprites.js';
import { getPlant } from '../plants.js';
import { bedCorners, bedToGarden, pointInPolygon, bbox, toLatLng, fromLatLng } from '../geo.js';
import { editBedSheet, newBedSheet } from './common.js';
import { progress, todayStr } from '../season.js';

const ART = 2;                                   // CSS px per art pixel
const ZOOMS = [2, 3, 4, 6, 8, 12, 16, 24, 32];  // art px per foot
const PREFS = 'gp2.yard';
const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const COLORS = {
  outside: '#2a7a48', lotLine: '#1a1c2c', house: '#94b0c2', houseRoof: '#566c86',
  wood: '#b07a4a', woodDark: '#734c3b', pot: '#ef7d57', soil: '#4a2f25', ink: '#1a1c2c',
  select: '#ffcd75', label: '#f4f4f4',
};

export function mount(main) {
  const prefs = store.storage.get(PREFS, { photo: false, opacity: 0.8, zoomIndex: null, cx: null, cy: null });
  const view = h('div.yard');
  const canvas = h('canvas.world', { 'aria-label': 'Yard map. Beds are listed in the Beds tab.' });
  const ctx = canvas.getContext('2d');
  const hud = h('div.hud');
  const card = h('div.bed-card.px', { hidden: true });
  const zoomBox = h('div.zoom',
    h('button.btn.icon', { 'aria-label': 'Zoom in', onclick: () => zoomBy(1) }, icon('plus', 24)),
    h('button.btn.icon', { 'aria-label': 'Zoom out', onclick: () => zoomBy(-1) }, h('b', { style: { fontSize: '22px' } }, '–')));
  view.append(canvas, hud, card, zoomBox);
  main.append(view);
  main.style.overflow = 'hidden';

  let W = 0, H = 0;                // canvas size in art px
  let zi = prefs.zoomIndex ?? 4;
  let cam = { x: prefs.cx ?? 0, y: prefs.cy ?? 0 };
  let selected = null;
  let arrange = false;
  let dirty = true;
  const sprites = new Map();
  const tiles = new Map();
  let patterns = null;

  const ppf = () => ZOOMS[zi];
  const state = () => store.getState();
  const visibleBeds = () => state().beds.filter(b => !b.archived && b.kind !== 'tray' && b.kind !== 'plan');

  // ---------------------------------------------------------- sizing + camera

  function resize() {
    const r = view.getBoundingClientRect();
    W = Math.max(1, Math.ceil(r.width / ART));
    H = Math.max(1, Math.ceil(r.height / ART));
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;
    patterns = null;
    invalidate();
  }

  function fit() {
    const g = state().garden;
    const pts = g?.lot?.length ? g.lot : visibleBeds().flatMap(bedCorners);
    if (!pts.length) { cam = { x: 0, y: 0 }; zi = 5; return invalidate(); }
    const b = bbox(pts);
    cam = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const need = Math.min((W - 20) / (b.maxX - b.minX || 1), (H - 60) / (b.maxY - b.minY || 1));
    zi = Math.max(0, ZOOMS.findLastIndex(z => z <= need));
    invalidate();
  }

  const toScreen = (x, y) => [Math.round((x - cam.x) * ppf() + W / 2), Math.round((y - cam.y) * ppf() + H / 2)];
  const toWorld = (sx, sy) => [(sx - W / 2) / ppf() + cam.x, (sy - H / 2) / ppf() + cam.y];
  const eventWorld = e => {
    const r = canvas.getBoundingClientRect();
    return toWorld((e.clientX - r.left) / ART, (e.clientY - r.top) / ART);
  };

  function zoomBy(step, anchor) {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, zi + step));
    if (next === zi) return;
    if (anchor) {
      const [ax, ay] = anchor;
      const k = ZOOMS[zi] / ZOOMS[next];
      cam = { x: ax - (ax - cam.x) * k, y: ay - (ay - cam.y) * k };
    }
    zi = next;
    savePrefs();
    invalidate();
  }

  function savePrefs() {
    store.storage.set(PREFS, { ...prefs, zoomIndex: zi, cx: cam.x, cy: cam.y });
  }

  // ---------------------------------------------------------- drawing

  function invalidate() {
    if (dirty === 'queued') return;
    dirty = 'queued';
    requestAnimationFrame(draw);
  }

  function spr(key, tint) {
    const id = key + JSON.stringify(tint || {});
    if (!sprites.has(id)) sprites.set(id, spriteCanvas(key, tint, 1));
    return sprites.get(id);
  }

  function pattern(key) {
    patterns ||= {};
    return (patterns[key] ||= ctx.createPattern(spr(key), 'repeat'));
  }

  function worldPattern(key) {
    // Anchor textures to the world so they don't swim while panning.
    const p = pattern(key);
    const [ox, oy] = toScreen(0, 0);
    p.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]));
    return p;
  }

  function path(pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const [sx, sy] = toScreen(x, y);
      if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
    });
    ctx.closePath();
  }

  function draw() {
    dirty = false;
    const g = state().garden;
    if (!g) return;
    ctx.imageSmoothingEnabled = false;

    // Ground outside the lot.
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = worldPattern('tile_grass2');
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    if (prefs.photo && g.origin_lat != null) drawPhoto(g);

    if (g.lot?.length) {
      path(g.lot);
      if (!prefs.photo) {
        ctx.fillStyle = worldPattern('tile_grass');
        ctx.fill();
      }
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = COLORS.lotLine;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const s of g.structures || []) drawStructure(s);
    const today = todayStr();
    const beds = visibleBeds();
    for (const bed of beds) drawBed(bed);
    for (const bed of beds) drawPlants(bed, today);
    for (const bed of beds) drawLabel(bed);
    if (selected) {
      const bed = beds.find(b => b.id === selected);
      if (bed) {
        path(bedCorners(bed));
        ctx.strokeStyle = COLORS.select;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function drawStructure(s) {
    if (s.kind !== 'house') return;
    const pts = [[s.x - s.w / 2, s.y - s.h / 2], [s.x + s.w / 2, s.y - s.h / 2], [s.x + s.w / 2, s.y + s.h / 2], [s.x - s.w / 2, s.y + s.h / 2]];
    path(pts);
    ctx.fillStyle = prefs.photo ? 'rgba(148,176,194,0.35)' : COLORS.house;
    ctx.fill();
    if (!prefs.photo) {
      // Roof shingles: a row every 2 ft.
      ctx.save();
      ctx.clip();
      ctx.fillStyle = COLORS.houseRoof;
      const [x0, y0] = toScreen(s.x - s.w / 2, s.y - s.h / 2);
      const [x1, y1] = toScreen(s.x + s.w / 2, s.y + s.h / 2);
      const step = Math.max(2, Math.round(2 * ppf()));
      for (let y = y0; y < y1; y += step) ctx.fillRect(x0, y, x1 - x0, 1);
      ctx.restore();
    }
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (ppf() >= 3) {
      const [cx, cy] = toScreen(s.x, s.y);
      text('HOUSE', cx, cy, COLORS.ink, prefs.photo ? COLORS.label : null);
    }
  }

  function drawBed(bed) {
    const corners = bedCorners(bed);
    const frame = Math.max(1, Math.round(0.25 * ppf()));
    path(corners);
    ctx.fillStyle = bed.kind === 'container' ? COLORS.pot : bed.kind === 'ground' ? COLORS.soil : COLORS.wood;
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (bed.kind === 'ground') return;
    // Soil: an inset copy of the bed.
    const inset = { ...bed, length_ft: Math.max(0.1, bed.length_ft - (2 * frame) / ppf()), width_ft: Math.max(0.1, bed.width_ft - (2 * frame) / ppf()) };
    path(bedCorners(inset));
    ctx.fillStyle = worldPattern('tile_soil');
    ctx.fill();
  }

  function drawPlants(bed, today) {
    const custom = store.customPlants();
    const size = ppf() >= 16 ? 16 : ppf() >= 6 ? 8 : 0;
    for (const p of state().plantings) {
      if (p.bed_id !== bed.id || p.x_ft == null || ['done', 'failed'].includes(p.status)) continue;
      const plant = getPlant(p.plant_key, custom);
      const [x, y] = bedToGarden(bed, p.x_ft, p.y_ft);
      const [sx, sy] = toScreen(x, y);
      if (!size) {
        ctx.fillStyle = plant.tint?.A || '#38b764';
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
        continue;
      }
      const pr = progress(p, plant, today);
      const key = pr.stage === 'started' ? 'seedling' : plant.sprite;
      ctx.globalAlpha = p.status === 'planned' ? 0.5 : 1;
      ctx.drawImage(spr(key, plant.tint), sx - size / 2, sy - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
  }

  function drawLabel(bed) {
    if (ppf() < 4) return;
    const b = bbox(bedCorners(bed));
    const [cx] = toScreen((b.minX + b.maxX) / 2, 0);
    const [, top] = toScreen(0, b.minY);
    text(bed.name.toUpperCase(), cx, top - 5, COLORS.label, COLORS.ink);
  }

  function text(str, x, y, color, outline) {
    ctx.font = '8px Silkscreen, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.fillStyle = outline;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(str, x + dx, y + dy);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  // ---------------------------------------------------------- satellite underlay

  function drawPhoto(g) {
    const origin = { lat: g.origin_lat, lng: g.origin_lng };
    const nw = toLatLng(origin, ...toWorld(0, 0));
    const se = toLatLng(origin, ...toWorld(W, H));
    const metersPerPxZ0 = 156543.03 * Math.cos((origin.lat * Math.PI) / 180);
    const z = Math.max(12, Math.min(19, Math.round(Math.log2((metersPerPxZ0 * 3.28084 * ppf()) / 1.5))));
    const [x0, y0] = lngLatToTile(nw.lng, nw.lat, z);
    const [x1, y1] = lngLatToTile(se.lng, se.lat, z);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return;
    ctx.globalAlpha = prefs.opacity;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const img = tile(z, tx, ty);
        if (!img.complete || !img.naturalWidth) continue;
        const a = fromLatLng(origin, tileLat(ty, z), tileLng(tx, z));
        const b = fromLatLng(origin, tileLat(ty + 1, z), tileLng(tx + 1, z));
        const [sx0, sy0] = toScreen(a.x, a.y);
        const [sx1, sy1] = toScreen(b.x, b.y);
        ctx.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0);
      }
    }
    ctx.globalAlpha = 1;
  }

  function tile(z, x, y) {
    const id = `${z}/${x}/${y}`;
    let img = tiles.get(id);
    if (!img) {
      img = new Image();
      img.onload = invalidate;
      img.src = TILE_URL(z, x, y);
      tiles.set(id, img);
    }
    return img;
  }

  // ---------------------------------------------------------- input

  const pointers = new Map();
  let gesture = null;

  function hitBed([x, y]) {
    const beds = visibleBeds();
    for (let i = beds.length - 1; i >= 0; i--) if (pointInPolygon([x, y], bedCorners(beds[i]))) return beds[i];
    return null;
  }

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), zi };
      return;
    }
    const w = eventWorld(e);
    const bed = hitBed(w);
    if (bed) {
      select(bed.id);
      if (arrange) {
        gesture = { kind: 'bed', id: bed.id, dx: bed.x_ft - w[0], dy: bed.y_ft - w[1], moved: false };
        return;
      }
    } else {
      select(null);
    }
    gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...cam }, bed: bed?.id ?? null, moved: false };
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const steps = Math.round(Math.log2(d / gesture.dist) * 2);
      const target = Math.max(0, Math.min(ZOOMS.length - 1, gesture.zi + steps));
      if (target !== zi) { zi = target; invalidate(); }
    } else if (gesture.kind === 'pan') {
      const dx = (e.clientX - gesture.sx) / ART / ppf(), dy = (e.clientY - gesture.sy) / ART / ppf();
      if (Math.abs(dx) + Math.abs(dy) > 0.2) gesture.moved = true;
      cam = { x: gesture.cam.x - dx, y: gesture.cam.y - dy };
      invalidate();
    } else if (gesture.kind === 'bed') {
      const [x, y] = eventWorld(e);
      const bed = state().beds.find(b => b.id === gesture.id);
      const nx = snap(x + gesture.dx), ny = snap(y + gesture.dy);
      if (bed && (nx !== bed.x_ft || ny !== bed.y_ft)) {
        gesture.moved = true;
        // Live preview without writing every frame: mutate a local copy the renderer reads.
        Object.assign(bed, { x_ft: nx, y_ft: ny });
        invalidate();
      }
    }
  });

  const end = e => {
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (!gesture) return;
    if (gesture.kind === 'bed' && gesture.moved) {
      const bed = state().beds.find(b => b.id === gesture.id);
      store.updateBed(bed.id, { x_ft: bed.x_ft, y_ft: bed.y_ft });
    }
    if (gesture.kind === 'pan') savePrefs();
    if (pointers.size === 0) gesture = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('dblclick', e => {
    const bed = hitBed(eventWorld(e));
    if (bed) location.hash = `#/bed/${bed.id}`;
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1, eventWorld(e));
  }, { passive: false });

  const snap = v => Math.round(v * 2) / 2;

  // ---------------------------------------------------------- HUD + bed card

  function renderHud() {
    const g = state().garden;
    fill(hud, 
      h('button.btn.sm', { 'aria-pressed': String(arrange), onclick: () => { arrange = !arrange; renderHud(); renderCard(); } },
        icon(arrange ? 'unlock' : 'lock', 16), arrange ? 'Arranging' : 'Arrange'),
      g?.origin_lat != null
        ? h('button.btn.sm', { 'aria-pressed': String(prefs.photo), onclick: () => { prefs.photo = !prefs.photo; savePrefs(); renderHud(); invalidate(); } },
          icon('map', 16), 'Photo')
        : null,
      prefs.photo ? h('label.opacity.px.flat.small', 'Fade',
        h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: prefs.opacity,
          oninput: e => { prefs.opacity = Number(e.target.value); savePrefs(); invalidate(); } })) : null,
      h('button.btn.sm', { onclick: async () => {
        const [x, y] = [snap(cam.x), snap(cam.y)];
        const bed = await newBedSheet({ x_ft: x, y_ft: y });
        if (bed) select(bed.id);
      } }, icon('plus', 16), 'Bed'),
      h('button.btn.sm', { onclick: fit }, 'Fit'),
      arrange ? h('span.hint.px.flat', 'Drag beds to move. Select one to rotate.') : null,
    );
  }

  function select(id) {
    selected = id;
    renderCard();
    invalidate();
  }

  function renderCard() {
    const bed = state().beds.find(b => b.id === selected);
    card.hidden = !bed;
    if (!bed) return;
    const custom = store.customPlants();
    const here = state().plantings.filter(p => p.bed_id === bed.id && !['done', 'failed'].includes(p.status));
    const kinds = [...new Set(here.map(p => p.plant_key))];
    const rotate = d => store.updateBed(bed.id, { rotation_deg: ((bed.rotation_deg || 0) + d + 360) % 360 });
    fill(card, 
      h('h3', bed.name),
      h('div.small.muted', `${fmtFt(bed.length_ft)} × ${fmtFt(bed.width_ft)}${bed.area ? ` · ${bed.area}` : ''} · ${here.length} planting${here.length === 1 ? '' : 's'}`),
      kinds.length ? h('div.sprites', kinds.slice(0, 14).map(k => plantSprite(k, custom, { size: 32 }))) : h('p.small.muted', 'Empty bed.'),
      h('div.row.wrap',
        h('a.btn.primary.sm', { href: `#/bed/${bed.id}` }, icon('bed', 16), 'Open'),
        arrange ? h('button.btn.sm', { 'aria-label': 'Rotate left 15°', onclick: () => rotate(-15) }, '⟲ 15°') : null,
        arrange ? h('button.btn.sm', { 'aria-label': 'Rotate right 15°', onclick: () => rotate(15) }, '⟳ 15°') : null,
        h('button.btn.sm', { onclick: () => editBedSheet(bed) }, icon('edit', 16), 'Edit')),
    );
  }

  // ---------------------------------------------------------- lifecycle

  const ro = new ResizeObserver(() => resize());
  ro.observe(view);
  resize();
  if (prefs.cx == null) fit();
  renderHud();
  document.fonts?.load('8px Silkscreen').then(invalidate, () => {});

  const unsub = store.watch(s => [s.garden, s.beds, s.plantings, s.custom], () => {
    if (gesture?.kind === 'bed') return;
    renderHud();
    renderCard();
    invalidate();
  });

  if (!visibleBeds().length) toast('No beds yet — tap “+ Bed” to add one.');

  return () => {
    unsub();
    ro.disconnect();
    main.style.overflow = '';
  };
}

// ------------------------------------------------------------ helpers

export function fmtFt(n) {
  return `${Math.round(n * 10) / 10}ft`;
}

function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
}

function tileLng(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function tileLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
