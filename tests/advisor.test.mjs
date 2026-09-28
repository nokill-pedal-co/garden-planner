import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedAdvice } from '../js/advisor.js';

const climate = { lastFrost: '04-15', firstFrost: '10-25' };
const bed = { id: 'b', name: 'Bed', kind: 'raised', shape: 'rect', length_ft: 6, width_ft: 3 };
let n = 0;
const P = o => ({ id: `p${n++}`, bed_id: 'b', qty: 1, status: 'planted', season: 2026, method: 'direct',
  sow_date: null, transplant_date: null, expected_harvest: null, done_date: null, variety: null, ...o });
const advise = (plantings, extra = {}) => bedAdvice({ bed, plantings, climate, planYear: 2027, today: '2026-09-28', ...extra });

test('tender crops end, hardy/overwintering/perennial crops stay', () => {
  const a = advise([
    P({ plant_key: 'tomato', transplant_date: '2026-05-20' }),
    P({ plant_key: 'kale', sow_date: '2026-08-15' }),
    P({ plant_key: 'garlic', sow_date: '2026-10-20', season: 2026 }),
    P({ plant_key: 'strawberry' }),
  ]);
  const staying = a.staying.map(s => s.plant.key);
  assert.deepEqual(a.ending.map(s => s.plant.key), ['tomato']);
  assert.ok(staying.includes('kale') && staying.includes('garlic') && staying.includes('strawberry'));
  const garlic = a.staying.find(s => s.plant.key === 'garlic');
  assert.ok(garlic.until > '2027-05-01', `garlic holds the bed into summer: ${garlic.until}`);
});

test('rotation after nightshades: avoid them, follow with legumes', () => {
  const a = advise([P({ plant_key: 'tomato' }), P({ plant_key: 'pepper' })]);
  assert.deepEqual(a.rotation.avoid, ['solanaceae']);
  assert.equal(a.rotation.follow[0], 'legume');
  assert.ok(a.ideas.length && a.ideas.every(i => i.plant.family !== 'solanaceae'));
  assert.ok(a.prep.some(p => /nightshade/i.test(p.title)));
  assert.ok(a.prep.some(p => /compost/i.test(p.title)));
  assert.ok(a.prep.some(p => /cover crop/i.test(p.title)), 'nothing staying -> cover crop');
});

test('planned brassicas get a lime note; overwintering crop blocks early plans', () => {
  const a = advise([
    P({ plant_key: 'garlic', sow_date: '2026-10-20' }),
    P({ plant_key: 'lettuce', status: 'planned', season: 2027 }),
    P({ plant_key: 'kale', status: 'planned', season: 2027 }),
  ]);
  assert.ok(a.prep.some(p => /lime/i.test(p.title)));
  assert.ok(a.conflicts.length >= 1, 'garlic until summer vs spring lettuce/kale');
});

test('pots get potting-mix advice, not compost top-up', () => {
  const a = bedAdvice({ bed: { ...bed, kind: 'container', shape: 'round' }, plantings: [P({ plant_key: 'tomato' })], climate, planYear: 2027, today: '2026-09-28' });
  assert.ok(a.prep.some(p => /potting mix/i.test(p.title)));
  assert.ok(!a.prep.some(p => /cover crop/i.test(p.title)));
});
