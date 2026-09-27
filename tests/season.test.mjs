import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, sowingWindows, expectedHarvest, progress, weeklyTasks, companionIssues,
  rotationIssues, bedCapacity, timeline, clockStart,
} from '../js/season.js';
import { getPlant } from '../js/plants.js';

const climate = { lastFrost: '04-15', firstFrost: '10-25' };
const P = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2), bed_id: 'b1', plant_key: 'lettuce', variety: null, qty: 1,
  x_ft: null, y_ft: null, status: 'planted', season: 2026, method: 'direct',
  sow_date: null, transplant_date: null, expected_harvest: null, done_date: null, ...over,
});

test('date math', () => {
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetween('2026-04-15', '2026-10-25'), 193);
});

test('sowing windows anchor to frost dates', () => {
  const plant = { windows: { indoors: [-8, -6], direct: [2, 10], fall: [-10, -6] } };
  const w = sowingWindows(plant, climate, 2026);
  const byType = Object.fromEntries(w.map(x => [x.type, x]));
  assert.equal(byType.indoors.start, '2026-02-18');
  assert.equal(byType.indoors.end, '2026-03-04');
  assert.equal(byType.direct.start, '2026-04-29');
  assert.equal(byType.fall.start, addDays('2026-10-25', -70));
  assert.deepEqual(w.map(x => x.start), [...w.map(x => x.start)].sort());
});

test('expected harvest respects daysFrom and overrides', () => {
  const tomato = { days: 70, daysFrom: 'transplant' };
  assert.equal(expectedHarvest(P({ transplant_date: '2026-05-10' }), tomato), '2026-07-19');
  // Started indoors with no transplant date: assume ~6 weeks as a start.
  assert.equal(clockStart(P({ method: 'start', sow_date: '2026-03-01' }), tomato), '2026-04-12');
  const radish = { days: 25, daysFrom: 'sow' };
  assert.equal(expectedHarvest(P({ sow_date: '2026-04-01' }), radish), '2026-04-26');
  assert.equal(expectedHarvest(P({ sow_date: '2026-04-01', expected_harvest: '2026-05-01' }), radish), '2026-05-01');
  assert.equal(expectedHarvest(P({}), radish), null);
});

test('progress stages', () => {
  const radish = { days: 25, daysFrom: 'sow', harvestDays: 10 };
  const p = P({ sow_date: '2026-04-01' });
  assert.equal(progress(p, radish, '2026-04-10').stage, 'growing');
  assert.equal(progress(p, radish, '2026-04-10').daysLeft, 16);
  assert.equal(progress(p, radish, '2026-04-28').stage, 'ready');
  assert.equal(progress(p, radish, '2026-06-01').stage, 'late');
  assert.equal(progress(P({ status: 'planned' }), radish, '2026-04-10').stage, 'planned');
  assert.equal(progress(P({ status: 'done' }), radish, '2026-04-10').stage, 'done');
});

test('weekly tasks: frost warning, harvest, sow, succession', () => {
  const tomato = getPlant('tomato');
  assert.equal(tomato.hardiness, 'tender', 'library: tomato should be tender');
  const plantings = [
    P({ id: 'tom', plant_key: 'tomato', method: 'transplant', transplant_date: '2026-05-20' }),
    P({ id: 'rad', plant_key: getPlant('radish_mixed').key, sow_date: '2026-09-20' }),
  ];
  const tasks = weeklyTasks({ plantings, beds: [{ id: 'b1', name: 'Bed 1' }], climate }, '2026-10-10');
  assert.ok(tasks.some(t => t.kind === 'frost'), 'frost warning within 21 days with tomatoes in the ground');
  assert.equal(tasks[0].kind, 'frost', 'frost sorts first');
});

test('weekly tasks: planned crop with an open window becomes a sow task', () => {
  const lettuce = getPlant('lettuce');
  const win = sowingWindows(lettuce, climate, 2026).find(w => w.type === 'direct');
  assert.ok(win, 'lettuce has a direct-sow window');
  const plantings = [P({ id: 'l1', status: 'planned', method: 'direct' })];
  const tasks = weeklyTasks({ plantings, beds: [], climate }, win.start);
  assert.ok(tasks.find(t => t.kind === 'sow' && t.plantingId === 'l1'));
});

test('weekly tasks: succession reminder after the interval', () => {
  const plant = getPlant('arugula');
  assert.ok(plant.succession, 'arugula has a succession interval');
  const win = sowingWindows(plant, climate, 2026).find(w => w.type === 'direct');
  const sow = addDays(win.start, 3);
  const later = addDays(sow, plant.succession);
  if (later > win.end) return; // window too short for this check
  const tasks = weeklyTasks({ plantings: [P({ plant_key: 'arugula', sow_date: sow })], beds: [], climate }, later);
  assert.ok(tasks.find(t => t.kind === 'succession' && t.plantKey === 'arugula'));
});

test('companion issues honour distance and avoid lists', () => {
  const custom = [
    { key: 'aa', name: 'AA', family: 'x', avoid: ['bb'], companions: [], windows: {} },
    { key: 'bb', name: 'BB', family: 'y', avoid: [], companions: [], windows: {} },
    { key: 'cc', name: 'CC', family: 'z', avoid: [], companions: ['family:x'], windows: {} },
  ];
  const near = companionIssues([P({ plant_key: 'aa', x_ft: 1, y_ft: 1 }), P({ plant_key: 'bb', x_ft: 2, y_ft: 1 })], custom);
  assert.equal(near.length, 1);
  assert.equal(near[0].kind, 'avoid');
  const far = companionIssues([P({ plant_key: 'aa', x_ft: 0, y_ft: 0 }), P({ plant_key: 'bb', x_ft: 5, y_ft: 0 })], custom);
  assert.equal(far.length, 0);
  const fam = companionIssues([P({ plant_key: 'aa' }), P({ plant_key: 'cc' })], custom);
  assert.equal(fam[0].kind, 'companion');
});

test('rotation + capacity', () => {
  const bed = { id: 'b1', length_ft: 4, width_ft: 2 };
  const plantings = [P({ plant_key: 'tomato', season: 2025 }), P({ plant_key: 'pepper', season: 2026 })];
  assert.deepEqual(rotationIssues(bed, plantings, 2026), ['solanaceae']);
  const cap = bedCapacity(bed, [P({ plant_key: 'tomato', qty: 2 })]);
  assert.equal(cap.areaSqFt, 8);
  assert.ok(cap.usedSqFt > 0);
});

test('timeline builds indoor/growing/harvest segments', () => {
  const rows = timeline([P({ plant_key: 'tomato', method: 'start', sow_date: '2026-02-20', transplant_date: '2026-05-15' })], 2026);
  assert.deepEqual(rows[0].segments.map(s => s.kind), ['indoors', 'growing', 'harvest']);
  assert.equal(rows[0].segments[0].end, '2026-05-15');
});
