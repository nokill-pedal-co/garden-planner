import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importV1, fixMojibake, makeBackup, restoreBackup } from '../js/importer.js';
import { toLatLng, fromLatLng, bedCorners, bedToGarden, pointInPolygon } from '../js/geo.js';

const db = JSON.parse(readFileSync(new URL('../../garden-db.json', import.meta.url), 'utf8'));

test('fixMojibake repairs cp1252-misdecoded UTF-8 and leaves clean text alone', () => {
  assert.equal(fixMojibake('bean->brassica â€” rotation'), 'bean->brassica — rotation');
  assert.equal(fixMojibake('soil â‰¥65Â°F'), 'soil ≥65°F');
  assert.equal(fixMojibake('plain — already fine'), 'plain — already fine');
  assert.equal(fixMojibake(null), null);
});

test('imports the real v1 database', () => {
  const { garden, beds, plantings, report } = importV1(db);
  assert.equal(garden.zone, '8b');
  assert.ok(garden.lot.length === 4);
  const raised = beds.filter(b => b.kind === 'raised');
  assert.equal(raised.length, Object.keys(db.beds).length);
  assert.deepEqual([raised[0].length_ft, raised[0].width_ft], [6, 3]);
  const all = Object.values(db.beds).concat(Object.values(db.containers)).flatMap(b => b.plants);
  const plants = all.reduce((n, dp) => n + (dp.quantity || 1), 0);
  assert.ok(plantings.length >= all.length, 'at least one planting per v1 plant entry');
  assert.equal(plantings.reduce((n, p) => n + p.qty, 0), plants, 'every individual plant is kept');
  const pots = beds.filter(b => b.kind === 'container');
  assert.ok(pots.every(b => b.shape === 'round' && b.volume_gal > 0), 'pots are round with a gallon size');
  assert.ok(!beds.some(b => /fabric pots|grow bags/i.test(b.name)), 'grouped pot entries are split into single pots');
  assert.ok(pots.every(b => plantings.filter(p => p.bed_id === b.id).length >= 1));
  const bushes = beds.filter(b => b.kind === 'ground');
  assert.ok(bushes.length >= 4 && bushes.every(b => b.shape === 'round' && plantings.filter(p => p.bed_id === b.id).length === 1),
    'in-ground blueberries are one round patch each');
  assert.deepEqual(report.unmatched, [], `unmatched: ${report.unmatched.join(', ')}`);
  for (const p of plantings) {
    assert.equal(p.garden_id, garden.id);
    if (p.bed_id) {
      const bed = beds.find(b => b.id === p.bed_id);
      assert.ok(bed, 'bed exists');
      assert.ok(p.x_ft >= 0 && p.x_ft <= bed.length_ft && p.y_ft >= 0 && p.y_ft <= bed.width_ft, `${p.plant_key} inside ${bed.name}`);
    }
    for (const f of ['notes', 'source', 'variety']) assert.ok(!/â€|Ã/.test(p[f] || ''), `mojibake left in ${f}: ${p[f]}`);
  }
  assert.ok(plantings.some(p => p.status === 'planned' && p.season === 2027), '2027 plan list imported as planned');
  assert.ok(plantings.some(p => p.status === 'started'), 'indoor starts imported as started');
  assert.ok(!beds.some(b => b.kind === 'plan'), 'planning lists are not beds');
});

test('v1 export positions are used when present', () => {
  const exported = { bed1: { plants: [{ type: 'dino_kale', name: 'Dino Kale', x: 50, y: 50, locked: true }] } };
  const { beds, plantings } = importV1(db, exported);
  const bed1 = beds.find(b => b.name === 'Bed 1');
  const inBed = plantings.filter(p => p.bed_id === bed1.id);
  assert.equal(inBed.length, 1);
  assert.deepEqual([inBed[0].x_ft, inBed[0].y_ft, inBed[0].locked], [3, 1.5, true]);
});

test('backup round-trip remaps every id and keeps references', () => {
  const data = importV1(db);
  const events = [{ id: 'e1', garden_id: data.garden.id, type: 'harvest', date: '2026-07-01', planting_id: data.plantings[0].id, bed_id: data.plantings[0].bed_id }];
  const restored = restoreBackup(JSON.parse(JSON.stringify(makeBackup({ ...data, events, custom: [] }))));
  assert.notEqual(restored.garden.id, data.garden.id);
  const oldIds = new Set([data.garden.id, ...data.beds.map(b => b.id), ...data.plantings.map(p => p.id)]);
  for (const r of [...restored.beds, ...restored.plantings]) assert.ok(!oldIds.has(r.id));
  const bedIds = new Set(restored.beds.map(b => b.id));
  for (const p of restored.plantings) if (p.bed_id) assert.ok(bedIds.has(p.bed_id));
  assert.ok(restored.plantings.some(p => p.id === restored.events[0].planting_id));
});

test('geo round-trips and bed geometry', () => {
  const o = { lat: 45.55306, lng: -122.89049 };
  const ll = toLatLng(o, 30, -12);
  const back = fromLatLng(o, ll.lat, ll.lng);
  assert.ok(Math.abs(back.x - 30) < 1e-6 && Math.abs(back.y + 12) < 1e-6);
  const bed = { x_ft: 10, y_ft: 5, length_ft: 6, width_ft: 2, rotation_deg: 90 };
  const c = bedCorners(bed);
  assert.ok(Math.abs(c[0][0] - 11) < 1e-9 && Math.abs(c[0][1] - 2) < 1e-9, `rotated corner ${c[0]}`);
  assert.ok(pointInPolygon([10, 5], c));
  const [gx, gy] = bedToGarden({ ...bed, rotation_deg: 0 }, 0, 0);
  assert.deepEqual([gx, gy], [7, 4]);
});

test('pot sizes, round outlines and per-plant row layout', async () => {
  const { potDims, unitPositions, bedOutline, pointInPolygon } = await import('../js/geo.js');
  assert.equal(potDims(5).diameter_ft, 1);            // 12" fabric pot
  assert.ok(potDims(15).diameter_ft > potDims(5).diameter_ft);
  assert.ok(potDims(12).diameter_ft > potDims(10).diameter_ft && potDims(12).diameter_ft < potDims(15).diameter_ft);
  // 4 plants at 18" fill a 6 ft row exactly.
  assert.deepEqual(unitPositions({ qty: 4, x_ft: 0.75, y_ft: 0.75 }, { length_ft: 6, width_ft: 3 }, 1.5),
    [[0.75, 0.75], [2.25, 0.75], [3.75, 0.75], [5.25, 0.75]]);
  // Saved positions win; missing ones are filled after them.
  assert.deepEqual(unitPositions({ qty: 2, x_ft: 1, y_ft: 1, positions: [[4, 2]] }, { length_ft: 6, width_ft: 3 }, 1).length, 2);
  const round = { shape: 'round', x_ft: 0, y_ft: 0, length_ft: 2, width_ft: 2 };
  assert.ok(pointInPolygon([0.9, 0], bedOutline(round)));
  assert.ok(!pointInPolygon([0.95, 0.95], bedOutline(round)), 'corner of the bounding square is outside a round pot');
});

test('Bed 8 imports as two rows of four at 18"', () => {
  const { beds, plantings } = importV1(db);
  const bed8 = beds.find(b => b.name === 'Bed 8');
  if (!bed8) return;
  for (const p of plantings.filter(p => p.bed_id === bed8.id)) {
    assert.equal(p.positions.length, 4);
    const xs = p.positions.map(u => u[0]);
    assert.ok(xs[0] >= 0 && xs.at(-1) <= bed8.length_ft, `${p.variety} row fits: ${xs}`);
  }
});

test('plants stay centred in pots and scale with resized beds', async () => {
  const { plantSpots, rescaleSpots } = await import('../js/geo.js');
  const pot = { kind: 'container', shape: 'round', length_ft: 3, width_ft: 3 };
  assert.deepEqual(plantSpots({ qty: 1, x_ft: 0.5, y_ft: 0.5, positions: [[0.5, 0.5]] }, pot, 1), [[1.5, 1.5]]);
  const r = rescaleSpots({ qty: 1, x_ft: 0.5, y_ft: 0.5 }, { ...pot, length_ft: 1, width_ft: 1 }, pot, 1);
  assert.deepEqual(r.positions, [[1.5, 1.5]]);
  const bed = { kind: 'raised', shape: 'rect', length_ft: 6, width_ft: 3 };
  const s = rescaleSpots({ qty: 2, x_ft: 1, y_ft: 1, positions: [[1, 1], [5, 2]] }, bed, { ...bed, length_ft: 12, width_ft: 6 }, 1);
  assert.deepEqual(s.positions, [[2, 2], [10, 4]]);
});
