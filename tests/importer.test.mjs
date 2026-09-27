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
  const total = Object.values(db.beds).concat(Object.values(db.containers)).reduce((n, b) => n + b.plants.length, 0);
  assert.equal(plantings.length, total, 'one planting per v1 plant entry');
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
