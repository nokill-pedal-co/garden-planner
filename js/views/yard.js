// Yard: top-down pixel view of the lot. The canvas is rendered at low resolution ("art pixels")
// and scaled up with image-rendering: pixelated, so everything — including the optional satellite
// photo underlay — comes out chunky. World units are feet; see ARCHITECTURE.md "Coordinates".
//
// Interaction: drag to pan, wheel/pinch to zoom. Tap a bed or structure to select it: a toolbar
// appears beside it (open, lock, rotate, edit, resize for rectangles) and the selection can then be
// dragged. Nothing moves unless it's selected first, so panning never nudges a bed by accident.

import * as store from '../store.js';
import { h, icon, fill, toast } from '../ui.js';
import { spriteCanvas } from '../sprites.js';
import { getPlant } from '../plants.js';
import { bedCorners, structureCorners, scaleStructure, bedToGarden, pointInPolygon, bbox, toLatLng, fromLatLng, rotate } from '../geo.js';
import { editBedSheet, newBedSheet, structureSheet, STRUCTURE_KINDS } from './common.js';
import { progress, todayStr } from '../season.js';

const ART = 2;                                   // CSS px per art pixel
const ZOOMS = [2, 3, 4, 6, 8, 12, 16, 24, 32];  // art px per foot
const PREFS = 'gp2.yard';
const HOLD_MS = 300;
const SLOP_PX = 6;                               // CSS px of movement before a press becomes a pan
const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const COLORS = {
  outside: '#2a7a48', lotLine: '#1a1c2c', wood: '#b07a4a', pot: '#ef7d57', soil: '#4a2f25',
  ink: '#1a1c2c', select: '#ffcd75', label: '#f4f4f4', lock: '#94b0c2',
};

// fill: flat colour, or pattern: sprite tile. roof: [shingle line colour, ridge colour].
const STRUCTURE_STYLE = {
  house: { fill: '#566c86', roof: ['#3b4a63', '#94b0c2'] },
  garage: { fill: '#566c86', roof: ['#3b4a63', '#94b0c2'] },
  shed: { fill: '#734c3b', roof: ['#4a2f25', '#b07a4a'] },
  driveway: { fill: '#aeb9bf', seams: '#8d9aa3' },
  patio: { pattern: 'tile_path' },
  path: { pattern: 'tile_path' },
  deck: { pattern: 'tile_wood' },
};

export function mount(main) {
  const prefs = store.storage.get(PREFS, { photo: false, opacity: 0.8, zoomIndex: null, cx: null, cy: null, hinted: false });
  const view = h('div.yard');
  const canvas = h('canvas.world', { 'aria-label': 'Yard map. Beds are listed in the Beds tab.' });
  const ctx = canvas.getContext('2d');
  const hud = h('div.hud');
  const bar = h('div.sel-bar.px', { hidden: true, role: 'toolbar', 'aria-label': 'Selected item' });
  const zoomBox = h('div.zoom',
    h('button.btn.icon', { 'aria-label': 'Zoom in', onclick: () => zoomBy(1) }, icon('plus', 24)),
    h('button.btn.icon', { 'aria-label': 'Zoom out', onclick: () => zoomBy(-1) }, h('b', { style: { fontSize: '22px' } }, '–')));
  view.append(canvas, hud, bar, zoomBox);
  main.append(view);
  main.style.overflow = 'hidden';

  let W = 0, H = 0;                // canvas size in art px
  let zi = prefs.zoomIndex ?? 4;
  let cam = { x: prefs.cx ?? 0, y: prefs.cy ?? 0 };
  let selected = null;             // { type: 'bed' | 'struct', id }
  let dirty = false;
  const sprites = new Map();
  const tiles = new Map();
  let patterns = null;

  const ppf = () => ZOOMS[zi];
  const state = () => store.getState();
  const visibleBeds = () => state().beds.filter(b => !b.archived && b.kind !== 'tray' && b.kind !== 'plan');
  const structures = () => state().garden?.structures || [];

  // ---------------------------------------------------------- items (beds + structures)

  const itemOf = sel => {
    if (!sel) return null;
    if (sel.type === 'bed') return state().beds.find(b => b.id === sel.id) || null;
    return structures().find(s => s.id === sel.id) || null;
  };
  const cornersOf = (type, it) => (type === 'bed' ? bedCorners(it) : structureCorners(it));
  const posOf = (type, it) => (type === 'bed' ? [it.x_ft, it.y_ft] : [it.x, it.y]);
  const rotOf = (type, it) => (type === 'bed' ? it.rotation_deg || 0 : it.rotation || 0);

  function hitItem([x, y]) {
    const beds = visibleBeds();
    for (let i = beds.length - 1; i >= 0; i--) {
      if (pointInPolygon([x, y], bedCorners(beds[i]))) return { type: 'bed', id: beds[i].id };
    }
    const ss = structures();
    for (let i = ss.length - 1; i >= 0; i--) {
      if (pointInPolygon([x, y], structureCorners(ss[i]))) return { type: 'struct', id: ss[i].id };
    }
    return null;
  }

  function saveStructures(list) {
    store.updateGarden({ structures: list });
  }

  function updateItem(sel, patch) {
    if (sel.type === 'bed') return store.updateBed(sel.id, patch);
    saveStructures(structures().map(s => (s.id === sel.id ? { ...s, ...patch } : s)));
  }

  function rotateItem(sel, deg) {
    const it = itemOf(sel);
    const r = ((rotOf(sel.type, it) + deg) % 360 + 360) % 360;
    updateItem(sel, sel.type === 'bed' ? { rotation_deg: r } : { rotation: r });
  }

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
    const pts = g?.lot?.length ? g.lot : [...visibleBeds().flatMap(bedCorners), ...structures().flatMap(structureCorners)];
    if (!pts.length) { cam = { x: 0, y: 0 }; zi = 5; return invalidate(); }
    const b = bbox(pts);
    cam = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const need = Math.min((W - 20) / (b.maxX - b.minX || 1), (H - 60) / (b.maxY - b.minY || 1));
    zi = Math.max(0, ZOOMS.findLastIndex(z => z <= need));
    savePrefs();
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
    if (dirty) return;
    dirty = true;
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

    for (const s of structures()) drawStructure(s);
    const today = todayStr();
    const beds = visibleBeds();
    for (const bed of beds) drawBed(bed);
    for (const bed of beds) drawPlants(bed, today);
    for (const s of structures()) drawStructureLabel(s);
    for (const bed of beds) drawLabel(bed);
    drawSelection();
    placeBar();
  }

  /** Run `fn` with the context in the item's local frame: origin at its centre, x along its length, 1 unit = 1 ft. */
  function inLocalFrame(cx, cy, deg, fn) {
    const [sx, sy] = toScreen(cx, cy);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.scale(ppf(), ppf());
    fn();
    ctx.restore();
  }

  function drawStructure(s) {
    const style = STRUCTURE_STYLE[s.kind] || STRUCTURE_STYLE.patio;
    const corners = structureCorners(s);
    ctx.globalAlpha = prefs.photo ? 0.6 : 1;
    path(corners);
    ctx.fillStyle = style.pattern ? worldPattern(style.pattern) : style.fill;
    ctx.fill();

    if (style.roof || style.seams) {
      ctx.save();
      path(corners);
      ctx.clip();
      inLocalFrame(s.x, s.y, s.rotation || 0, () => {
        const hw = s.w / 2, hh = s.h / 2;
        const px = 1 / ppf(); // one art pixel in local units
        if (style.roof) {
          // Shingle rows every 1.5 ft running along the length, ridge down the middle.
          const alongLength = s.w >= s.h;
          ctx.fillStyle = style.roof[0];
          if (alongLength) for (let y = -hh + 1.5; y < hh; y += 1.5) ctx.fillRect(-hw, y, s.w, px);
          else for (let x = -hw + 1.5; x < hw; x += 1.5) ctx.fillRect(x, -hh, px, s.h);
          ctx.fillStyle = style.roof[1];
          if (s.points?.length) return; // footprints aren't simple gables: shingles only
          if (alongLength) ctx.fillRect(-hw + hh * 0.5, -px, s.w - hh, 2 * px);
          else ctx.fillRect(-px, -hh + hw * 0.5, 2 * px, s.h - hw);
        } else {
          // Concrete slabs: an expansion joint every 10 ft along the length.
          ctx.fillStyle = style.seams;
          const long = s.w >= s.h;
          const len = long ? s.w : s.h;
          for (let d = -len / 2 + 10; d < len / 2 - 1; d += 10) {
            if (long) ctx.fillRect(d, -hh, px, s.h); else ctx.fillRect(-hw, d, s.w, px);
          }
        }
      });
      ctx.restore();
    }
    path(corners);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawStructureLabel(s) {
    if (ppf() < 3) return;
    const [cx, cy] = toScreen(s.x, s.y);
    text((s.name || STRUCTURE_KINDS[s.kind] || '').toUpperCase(), cx, cy, COLORS.label, COLORS.ink);
    if (s.locked && ppf() >= 6) text('LOCKED', cx, cy + 9, COLORS.lock, COLORS.ink);
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
    text(`${bed.locked ? '* ' : ''}${bed.name.toUpperCase()}`, cx, top - 5, COLORS.label, COLORS.ink);
  }

  function drawSelection() {
    const it = itemOf(selected);
    if (!it) return;
    path(cornersOf(selected.type, it));
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (resizing && canResize(it)) {
      const [hx, hy] = toScreen(...handlePos(it));
      ctx.fillStyle = COLORS.select;
      ctx.fillRect(hx - 3, hy - 3, 6, 6);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(hx - 3.5, hy - 3.5, 7, 7);
    }
  }

  const handlePos = s => rotate([s.x + s.w / 2, s.y + s.h / 2], s.rotation || 0, [s.x, s.y]);

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
  //
  // Tap selects (bed or structure) and shows the selection toolbar. Dragging a selected, unlocked
  // item moves it right away; dragging anything else pans. Double-tap a bed to open it.
  // Right-click also selects. Two fingers pinch-zoom.

  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  let resizing = false;             // toolbar "Resize" toggle (rectangular structures only)
  const snap = v => Math.round(v * 2) / 2;
  const slop = e => (e.pointerType === 'touch' ? 10 : 5);
  const canResize = it => selected?.type === 'struct' && it && !it.locked && !it.points?.length;
  const isSelected = hit => hit && selected && hit.type === selected.type && hit.id === selected.id;

  canvas.addEventListener('pointerdown', e => {
    if (e.button === 2) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), zi };
      return;
    }
    const w = eventWorld(e);
    const sel = itemOf(selected);

    if (resizing && canResize(sel)) {
      const [hx, hy] = handlePos(sel);
      if (Math.hypot(w[0] - hx, w[1] - hy) * ppf() * ART <= (e.pointerType === 'touch' ? 28 : 14)) {
        const fixed = rotate([sel.x - sel.w / 2, sel.y - sel.h / 2], sel.rotation || 0, [sel.x, sel.y]);
        gesture = { kind: 'resize', id: sel.id, fixed, orig: { ...sel }, moved: false };
        return;
      }
    }

    const hit = hitItem(w);
    const it = itemOf(hit);
    const movable = isSelected(hit) && it && !it.locked;
    gesture = {
      kind: movable ? 'maybe-drag' : 'maybe-pan', hit, sx: e.clientX, sy: e.clientY, cam: { ...cam }, w0: w,
      offset: it ? [posOf(hit.type, it)[0] - w[0], posOf(hit.type, it)[1] - w[1]] : null,
    };
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
      return;
    }

    if (gesture.kind.startsWith('maybe-')) {
      if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) < slop(e)) return;
      if (gesture.kind === 'maybe-pan' && gesture.hit && isSelected(gesture.hit) && itemOf(gesture.hit)?.locked && !gesture.warned) {
        gesture.warned = true;
        toast('Locked. Tap the lock in the toolbar to move it.');
      }
      gesture.kind = gesture.kind === 'maybe-drag' ? 'drag' : 'pan';
      if (gesture.kind === 'pan') canvas.classList.add('dragging');
    }

    if (gesture.kind === 'pan') {
      const dx = (e.clientX - gesture.sx) / ART / ppf(), dy = (e.clientY - gesture.sy) / ART / ppf();
      cam = { x: gesture.cam.x - dx, y: gesture.cam.y - dy };
      invalidate();
    } else if (gesture.kind === 'drag') {
      const [x, y] = eventWorld(e);
      const it = itemOf(gesture.hit);
      const nx = snap(x + gesture.offset[0]), ny = snap(y + gesture.offset[1]);
      // Live preview: mutate the in-memory row; it's committed once on release.
      if (gesture.hit.type === 'bed') Object.assign(it, { x_ft: nx, y_ft: ny });
      else Object.assign(it, { x: nx, y: ny });
      gesture.moved = true;
      invalidate();
    } else if (gesture.kind === 'resize') {
      const s = structures().find(x => x.id === gesture.id);
      const [px, py] = eventWorld(e);
      const [fx, fy] = gesture.fixed;
      const [lx, ly] = rotate([px - fx, py - fy], -(s.rotation || 0));
      const w = Math.max(1, snap(lx)), hgt = Math.max(1, snap(ly));
      const [cx, cy] = rotate([fx + w / 2, fy + hgt / 2], s.rotation || 0, [fx, fy]);
      Object.assign(s, scaleStructure(gesture.orig, w, hgt), { x: cx, y: cy });
      gesture.moved = true;
      invalidate();
    }
  });

  const end = e => {
    const wasPointer = pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (!gesture || !wasPointer) return;
    const g = gesture;
    if (g.kind.startsWith('maybe-')) {
      // A tap.
      const now = Date.now();
      const doubleTap = g.hit && lastTap?.hit && lastTap.hit.id === g.hit.id && now - lastTap.t < 350;
      lastTap = { hit: g.hit, t: now };
      if (doubleTap && g.hit.type === 'bed') location.hash = `#/bed/${g.hit.id}`;
      else if (doubleTap && g.hit.type === 'struct') editStructure(itemOf(g.hit));
      else select(g.hit);
    } else if (g.kind === 'drag' && g.moved) {
      const it = itemOf(g.hit);
      if (g.hit.type === 'bed') store.updateBed(it.id, { x_ft: it.x_ft, y_ft: it.y_ft });
      else saveStructures([...structures()]);
    } else if (g.kind === 'resize' && g.moved) {
      saveStructures([...structures()]);
    } else if (g.kind === 'pan') {
      savePrefs();
    }
    if (pointers.size === 0) gesture = null;
    invalidate();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    // Touch long-press also fires contextmenu; never let it interrupt a gesture.
    if (gesture) return;
    select(hitItem(eventWorld(e)));
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1 : -1, eventWorld(e));
  }, { passive: false });

  // ---------------------------------------------------------- selection toolbar

  async function editStructure(s) {
    const res = await structureSheet(s);
    if (res === 'delete') {
      saveStructures(structures().filter(x => x.id !== s.id));
      select(null);
    } else if (res) {
      saveStructures(structures().map(x => (x.id === s.id ? { ...x, ...res, ...scaleStructure(x, res.w, res.h) } : x)));
    }
  }

  async function addStructure() {
    const res = await structureSheet(null);
    if (!res || res === 'delete') return;
    const s = { id: crypto.randomUUID(), x: snap(cam.x), y: snap(cam.y), locked: false, ...res };
    saveStructures([...structures(), s]);
    select({ type: 'struct', id: s.id });
  }

  function renderBar() {
    const it = itemOf(selected);
    bar.hidden = !it;
    if (!it) return;
    const isBed = selected.type === 'bed';
    const tool = (label, ic, fn, { pressed, text } = {}) => h('button.btn.sm', {
      title: label, 'aria-label': label, ...(pressed !== undefined ? { 'aria-pressed': String(pressed) } : {}), onclick: fn,
    }, ic ? icon(ic, 16) : null, text ?? null);
    const locked = !!it.locked;
    const here = isBed ? state().plantings.filter(p => p.bed_id === it.id && !['done', 'failed'].includes(p.status)).length : 0;
    fill(bar,
      h('div.sel-title',
        h('b', it.name || STRUCTURE_KINDS[it.kind]),
        h('span.small.muted', isBed
          ? `${fmtFt(it.length_ft)} × ${fmtFt(it.width_ft)} · ${here} planting${here === 1 ? '' : 's'}`
          : `${STRUCTURE_KINDS[it.kind] || it.kind}${it.points?.length ? ' · outline' : ` · ${fmtFt(it.w)} × ${fmtFt(it.h)}`}`),
        h('span.small.sel-hint', locked ? 'Locked' : 'Drag to move')),
      h('div.sel-tools',
        isBed ? h('a.btn.sm.primary', { href: `#/bed/${it.id}`, title: 'Open bed' }, icon('bed', 16), 'Open') : null,
        tool(locked ? 'Unlock' : 'Lock in place', 'lock', () => {
          resizing = false;
          updateItem(selected, { locked: !locked });
        }, { pressed: locked, text: locked ? 'Locked' : 'Lock' }),
        locked ? null : tool('Rotate left 15°', null, () => rotateItem(selected, -15), { text: '⟲' }),
        locked ? null : tool('Rotate right 15°', null, () => rotateItem(selected, 15), { text: '⟳' }),
        canResize(it) ? tool('Resize', null, () => { resizing = !resizing; renderBar(); invalidate(); }, { pressed: resizing, text: '⤡' }) : null,
        tool('Edit', 'edit', () => (isBed ? editBedSheet(it) : editStructure(it))),
        tool('Deselect', 'close', () => select(null))));
    placeBar();
  }

  /** Keep the toolbar next to the selection: above it, or below when there's no room. */
  function placeBar() {
    const it = itemOf(selected);
    if (!it || bar.hidden) return;
    const b = bbox(cornersOf(selected.type, it));
    const [x0, y0] = toScreen(b.minX, b.minY);
    const [x1, y1] = toScreen(b.maxX, b.maxY);
    const vw = view.clientWidth, vh = view.clientHeight;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const cx = ((x0 + x1) / 2) * ART;
    let top = y0 * ART - bh - 12;
    if (top < 56) top = y1 * ART + 12;
    bar.style.left = `${Math.max(8, Math.min(vw - bw - 8, cx - bw / 2))}px`;
    bar.style.top = `${Math.max(56, Math.min(vh - bh - 8, top))}px`;
  }

  // ---------------------------------------------------------- HUD

  function renderHud() {
    const g = state().garden;
    fill(hud,
      g?.origin_lat != null
        ? h('button.btn.sm', { 'aria-pressed': String(prefs.photo), onclick: () => { prefs.photo = !prefs.photo; savePrefs(); renderHud(); invalidate(); } },
          icon('map', 16), 'Photo')
        : null,
      prefs.photo ? h('label.opacity.px.flat.small', 'Fade',
        h('input', { type: 'range', min: 0.2, max: 1, step: 0.05, value: prefs.opacity,
          oninput: e => { prefs.opacity = Number(e.target.value); savePrefs(); invalidate(); } })) : null,
      h('button.btn.sm', { onclick: async () => {
        const bed = await newBedSheet({ x_ft: snap(cam.x), y_ft: snap(cam.y) });
        if (bed) select({ type: 'bed', id: bed.id });
      } }, icon('plus', 16), 'Bed'),
      h('button.btn.sm', { onclick: addStructure }, icon('plus', 16), 'House / path'),
      h('button.btn.sm', { onclick: fit }, 'Fit'),
      prefs.hinted2 ? null : h('span.hint.px.flat', 'Tap a bed to select it, then drag to move',
        h('button.btn.ghost.sm', { 'aria-label': 'Dismiss tip', onclick: () => { prefs.hinted2 = true; savePrefs(); renderHud(); } }, icon('close', 16))),
    );
  }

  function select(sel) {
    if (!sel || !isSelected(sel)) resizing = false;
    selected = sel;
    renderBar();
    invalidate();
  }

  // ---------------------------------------------------------- lifecycle

  // Older gardens may carry structures without ids (v1 import); give them one so they're editable.
  if (structures().some(s => !s.id)) saveStructures(structures().map(s => ({ id: crypto.randomUUID(), locked: false, ...s })));

  const ro = new ResizeObserver(() => resize());
  ro.observe(view);
  resize();
  if (prefs.cx == null) fit();
  renderHud();
  document.fonts?.load('8px Silkscreen').then(invalidate, () => {});

  const unsub = store.watch(s => [s.garden, s.beds, s.plantings, s.custom], () => {
    if (gesture && ['drag', 'resize'].includes(gesture.kind)) return;
    renderHud();
    renderBar();
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
