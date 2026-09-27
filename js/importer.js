// v1 -> v2 migration. Pure: takes the v1 garden-db.json (and optionally a v1 "Export" JSON with
// hand-placed positions) and returns v2 rows { garden, beds, plantings } ready to upsert.

import { findPlantByName, getPlant } from './plants.js';
import { fromLatLng } from './geo.js';

// v1 map constants (index.html "MAP VIEW").
const V1_LOT_CENTER = { lat: 45.55306, lng: -122.89049 };
const V1_LOT = [
  [45.55326268612815, -122.89038831322173],
  [45.55307862164735, -122.89022872178535],
  [45.55286920061208, -122.89063239424209],
  [45.553147176345846, -122.89072224824409],
];
const V1_MAP_POS = {
  bed1: { lat: 45.55294, lng: -122.89055 },
  bed2: { lat: 45.55294, lng: -122.89046 },
  bed3: { lat: 45.55294, lng: -122.89037 },
  bed4: { lat: 45.55316, lng: -122.89048 },
  bed5: { lat: 45.55316, lng: -122.8904 },
  bed6: { lat: 45.55316, lng: -122.89032 },
  bed7: { lat: 45.5531, lng: -122.8906 },
  blueberries: { lat: 45.55318, lng: -122.89044 },
  asianPear: { lat: 45.55314, lng: -122.89055 },
  fig1: { lat: 45.55312, lng: -122.89052 },
  fig2: { lat: 45.55312, lng: -122.89058 },
};

// ---------------------------------------------------------------- text repair

// Windows-1252 code points for bytes 0x80–0x9F (the rest map 1:1 to Latin-1).
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Undo UTF-8 text that was mis-decoded as Windows-1252 ("â€”" -> "—"). Leaves clean text alone. */
export function fixMojibake(s) {
  if (typeof s !== 'string' || !/[ÂÃâ][\u0080-˿ -ℯ]/.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp < 0x100) bytes.push(cp);
    else if (CP1252[cp] !== undefined) bytes.push(CP1252[cp]);
    else return s; // not a clean round-trip; don't guess
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------- mapping helpers

const AREA_NAMES = { backyard: 'Backyard', 'front yard': 'Front yard', indoors: 'Indoors' };

function areaName(loc) {
  if (!loc || loc === 'TBD') return null;
  return AREA_NAMES[loc.toLowerCase()] || loc.replace(/^\w/, c => c.toUpperCase());
}

/** "Radish 'French Breakfast'" -> "French Breakfast", unless the plant's own name already says it. */
function quotedVariety(name, plant) {
  const v = /['‘’]([^'‘’]+)['‘’]/.exec(name)?.[1];
  return v && !plant.name.toLowerCase().includes(v.toLowerCase()) ? v : null;
}

function containerKind(c) {
  const t = (c.containerType || '').toLowerCase();
  if (t.includes('planning')) return 'plan';
  if (t.includes('seed tray') || t.includes('indoors')) return 'tray';
  if (t.includes('in ground')) return 'ground';
  return 'container';
}

function methodOf(raw, plant) {
  const m = (raw || '').toLowerCase();
  if (m.startsWith('indoor start')) return 'start';
  if (m.startsWith('direct sow')) return 'direct';
  if (m.startsWith('transplant')) return 'transplant';
  if (plant.perennial) return 'perennial';
  return null;
}

function planSeason(container, fallback) {
  const m = /(20\d\d)/.exec(container.name || '');
  return m ? Number(m[1]) : fallback;
}

// ---------------------------------------------------------------- layout

/** Spread plantings over a bed on a 1 ft (or 0.5 ft when crowded) lattice. */
function autoLayout(bed, plantings) {
  // A few multi-plant rows (e.g. 4 broccoli + 4 cauliflower): one centred row each.
  if (plantings.length && plantings.length <= 3) {
    plantings.forEach((p, i) => {
      p.x_ft = round2(bed.length_ft / 2);
      p.y_ft = round2(((i + 0.5) * bed.width_ft) / plantings.length);
    });
    return;
  }
  let cell = 1;
  const fits = c => Math.floor(bed.length_ft / c) * Math.floor(bed.width_ft / c) >= plantings.length;
  if (!fits(cell)) cell = 0.5;
  const cols = Math.max(1, Math.floor(bed.length_ft / cell));
  const rows = Math.max(1, Math.floor(bed.width_ft / cell));
  plantings.forEach((p, i) => {
    const c = i % cols, r = Math.floor(i / cols) % rows;
    p.x_ft = round2((c + 0.5) * (bed.length_ft / cols));
    p.y_ft = round2((r + 0.5) * (bed.width_ft / rows));
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------- main

/**
 * @param {object} db        v1 garden-db.json
 * @param {object} [exported] v1 "Export" JSON: { bed1: { plants: [{ type, name, x, y (percent), sowDate… }] }, __customBeds, __customPlants }
 * @param {object} [opts]    { uuid, gardenName, year }
 * @returns {{ garden, beds, plantings, report }}
 */
export function importV1(db, exported = null, opts = {}) {
  const uuid = opts.uuid || (() => crypto.randomUUID());
  const year = opts.year || Number((db.lastUpdated || '2026').slice(0, 4));
  const report = { unmatched: [], beds: 0, plantings: 0 };

  const garden = {
    id: uuid(),
    name: opts.gardenName || 'Home Garden',
    place: 'Portland, OR 97229',
    zone: '8b',
    last_frost: '04-15',
    first_frost: '10-25',
    origin_lat: V1_LOT_CENTER.lat,
    origin_lng: V1_LOT_CENTER.lng,
    lot: V1_LOT.map(([lat, lng]) => ft(fromLatLng(V1_LOT_CENTER, lat, lng))),
    // v1's house footprint was a rough guess that overlaps the front beds; the photo layer shows the real one.
    structures: [],
    is_public: false,
  };

  const beds = [];
  const plantings = [];
  const bedIdMap = {};
  let sort = 0;

  const addBed = (v1id, src, kind) => {
    const dims = src.dimensions || {};
    const isPot = kind === 'container';
    const pos = V1_MAP_POS[v1id] ? ft(fromLatLng(V1_LOT_CENTER, V1_MAP_POS[v1id].lat, V1_MAP_POS[v1id].lng)) : null;
    const bed = {
      id: uuid(),
      garden_id: garden.id,
      name: fixMojibake(src.name),
      kind,
      area: areaName(fixMojibake(src.location)),
      length_ft: dims.length || (isPot ? 2 : 4),
      width_ft: dims.width || (isPot ? 2 : 4),
      height_ft: dims.height ?? null,
      x_ft: pos ? pos[0] : 0,
      y_ft: pos ? pos[1] : 0,
      rotation_deg: 0,
      color: null,
      notes: [src.position && src.position !== 'TBD' ? fixMojibake(src.position) : null,
        src.structures ? fixMojibake(src.structures) : null].filter(Boolean).join('\n') || null,
      sort: sort++,
      archived: false,
      _placed: !!pos,
    };
    beds.push(bed);
    bedIdMap[v1id] = bed.id;
    return bed;
  };

  const addPlanting = (dp, bed, { planned = false, season = year } = {}) => {
    const name = fixMojibake(dp.name);
    const hit = findPlantByName(name) || (dp.type ? { plant: getPlant(dp.type), variety: null } : null);
    const plant = hit?.plant || getPlant('unknown');
    if (!hit || plant.key === 'unknown') report.unmatched.push(name);
    const rawMethod = fixMojibake(dp.method || '');
    const method = methodOf(rawMethod, plant);
    const sow = dp.sowDate || null;
    const tx = dp.plantedDate || dp.transplantDate || null;
    let status = 'planted';
    if (planned) status = 'planned';
    else if ((dp.currentLocation || '').toLowerCase() === 'indoors' || (method === 'start' && !dp.plantedDate)) status = 'started';
    const notes = [fixMojibake(dp.notes),
      rawMethod && !/^(direct sow|transplant|potted|in ground|grow bag|unknown)$/i.test(rawMethod) ? `v1 method: ${rawMethod}` : null,
    ].filter(Boolean).join('\n') || null;
    const p = {
      id: uuid(),
      garden_id: garden.id,
      bed_id: planned ? null : bed?.id ?? null,
      plant_key: plant.key,
      // A quoted cultivar ("Radish 'French Breakfast'") is kept even when it's also a library alias.
      variety: hit?.variety || quotedVariety(name, plant) || (plant.key === 'unknown' ? name : null),
      qty: dp.quantity || 1,
      x_ft: null,
      y_ft: null,
      status,
      season: sow ? Number(sow.slice(0, 4)) : tx ? Number(tx.slice(0, 4)) : season,
      method,
      sow_date: sow,
      transplant_date: tx,
      expected_harvest: dp.estimatedHarvest || null,
      done_date: null,
      source: fixMojibake(dp.source) || null,
      notes,
      locked: false,
    };
    plantings.push(p);
    return p;
  };

  for (const [v1id, b] of Object.entries(db.beds || {})) {
    const bed = addBed(v1id, b, 'raised');
    const placed = exported?.[v1id]?.plants;
    if (placed?.length) {
      for (const u of placed) {
        const p = addPlanting({ ...u, quantity: 1, name: u.name || u.type, sowDate: u.sowDate || null,
          plantedDate: u.plantedDate || u.transplantDate || null, estimatedHarvest: u.harvestDate || null }, bed);
        p.x_ft = round2((u.x / 100) * bed.length_ft);
        p.y_ft = round2((u.y / 100) * bed.width_ft);
        p.locked = !!u.locked;
      }
    } else {
      autoLayout(bed, b.plants.map(dp => addPlanting(dp, bed)));
    }
  }

  for (const [v1id, c] of Object.entries(db.containers || {})) {
    const kind = containerKind(c);
    if (kind === 'plan') {
      const season = planSeason(c, year);
      c.plants.forEach(dp => addPlanting(dp, null, { planned: true, season }));
      continue;
    }
    const bed = addBed(v1id, c, kind);
    autoLayout(bed, c.plants.map(dp => addPlanting(dp, bed)));
  }

  for (const cb of exported?.__customBeds || []) {
    if (bedIdMap[cb.id]) continue;
    addBed(cb.id, { name: cb.label || cb.id, location: cb.location, dimensions: { length: cb.lengthFt, width: cb.widthFt } }, 'raised');
  }

  placeLooseBeds(beds);
  for (const b of beds) delete b._placed;
  report.beds = beds.length;
  report.plantings = plantings.length;
  return { garden, beds, plantings, report };
}

// ---------------------------------------------------------------- v2 backups

/** Build a portable backup of one garden. */
export function makeBackup({ garden, beds, plantings, events, custom }) {
  return { app: 'garden-planner', version: 2, exportedAt: new Date().toISOString(), garden, beds, plantings, events, custom };
}

/**
 * Restore a v2 backup as a NEW garden: every id is replaced and references rewired, so restoring
 * never collides with the original (which may still exist in the cloud).
 */
export function restoreBackup(backup, { uuid = () => crypto.randomUUID() } = {}) {
  if (backup?.app !== 'garden-planner' || backup.version !== 2) throw new Error('Not a Garden Planner v2 backup');
  const ids = new Map();
  const map = id => (id == null ? null : ids.get(id) ?? id);
  const fresh = id => { const n = uuid(); ids.set(id, n); return n; };
  const strip = ({ created_at, updated_at, owner_id, ...r }) => r;
  const garden = { ...strip(backup.garden), id: fresh(backup.garden.id) };
  const beds = (backup.beds || []).map(b => ({ ...strip(b), id: fresh(b.id), garden_id: garden.id }));
  const plantings = (backup.plantings || []).map(p => ({ ...strip(p), id: fresh(p.id), garden_id: garden.id }));
  for (const p of plantings) p.bed_id = map(p.bed_id);
  const events = (backup.events || []).map(e => ({ ...strip(e), id: fresh(e.id), garden_id: garden.id }));
  for (const e of events) { e.bed_id = map(e.bed_id); e.planting_id = map(e.planting_id); }
  const custom = (backup.custom || []).map(c => ({ ...strip(c), id: fresh(c.id), garden_id: garden.id }));
  return { garden, beds, plantings, events, custom };
}

function ft({ x, y }) {
  return [round2(x), round2(y)];
}


/** Beds with no v1 map position: line them up along the south edge of their area, off to one side. */
function placeLooseBeds(beds) {
  const loose = beds.filter(b => !b._placed && b.kind !== 'tray');
  let x = -30;
  for (const b of loose) {
    b.x_ft = round2(x + b.length_ft / 2);
    b.y_ft = b.area === 'Front yard' ? -8 : 22;
    x += b.length_ft + 1.5;
  }
}
