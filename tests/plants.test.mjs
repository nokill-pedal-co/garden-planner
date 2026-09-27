// node --test tests/plants.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CLIMATE, CATEGORIES, PLANT_FAMILIES, SPRITE_KEYS_USED, UNKNOWN_PLANT, PLANTS,
  getPlant, allPlants, findPlantByName, normalizeName, fixMojibake,
} from '../js/plants.js';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const DB_PATH = here('../../garden-db.json');
const V1_PATH = here('../../index.html');

const HEX = /^#[0-9a-f]{6}$/i;
const WINDOW_TYPES = ['indoors', 'transplant', 'direct', 'fall'];
const HARDINESS = ['tender', 'half-hardy', 'hardy'];
const catKeys = new Set(CATEGORIES.map(c => c.key));
const keySet = new Set(PLANTS.map(p => p.key));

function refOk(ref) {
  if (typeof ref !== 'string') return false;
  if (ref.startsWith('family:')) return ref.slice(7) in PLANT_FAMILIES;
  return keySet.has(ref);
}

function dbPlantNames() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const out = [];
  for (const group of ['beds', 'containers']) {
    for (const [id, bed] of Object.entries(db[group] || {})) {
      for (const p of bed.plants || []) out.push({ where: `${group}.${id}`, name: p.name });
    }
  }
  return out;
}

function v1Palette() {
  const html = fs.readFileSync(V1_PATH, 'utf8');
  const start = html.indexOf('const PLANT_CATEGORIES');
  const end = html.indexOf('const ALL_PLANTS', start);
  assert.ok(start > 0 && end > start, 'found PLANT_CATEGORIES block in v1 index.html');
  const block = html.slice(start, end);
  return [...block.matchAll(/type:\s*'([a-z0-9_]+)'[^}]*?name:\s*(['"])(.*?)\2/g)]
    .map(m => ({ type: m[1], name: m[3] }));
}

test('climate + exports', () => {
  assert.deepEqual({ ...DEFAULT_CLIMATE }, {
    place: 'Portland, OR 97229', zone: '8b', lastFrost: '04-15', firstFrost: '10-25',
  });
  assert.ok(PLANTS.length >= 100, `library has ${PLANTS.length} entries`);
  assert.ok(Array.isArray(SPRITE_KEYS_USED) && SPRITE_KEYS_USED.includes('unknown'));
  assert.equal(new Set(SPRITE_KEYS_USED).size, SPRITE_KEYS_USED.length);
  assert.equal(new Set(CATEGORIES.map(c => c.key)).size, CATEGORIES.length);
  assert.equal(UNKNOWN_PLANT.key, 'unknown');
  assert.equal(UNKNOWN_PLANT.sprite, 'unknown');
});

test('every entry has valid fields', () => {
  const problems = [];
  for (const p of [...PLANTS, UNKNOWN_PLANT]) {
    const bad = msg => problems.push(`${p.key}: ${msg}`);
    if (typeof p.key !== 'string' || !/^[a-z0-9_]+$/.test(p.key)) bad('key');
    if (typeof p.name !== 'string' || !p.name) bad('name');
    if (!catKeys.has(p.category)) bad(`category ${p.category}`);
    if (!(p.family in PLANT_FAMILIES)) bad(`family ${p.family}`);
    if (!SPRITE_KEYS_USED.includes(p.sprite)) bad(`sprite ${p.sprite}`);
    if (p.tint !== null) {
      if (typeof p.tint !== 'object') bad('tint type');
      else for (const [k, v] of Object.entries(p.tint)) if (!['A', 'B'].includes(k) || !HEX.test(v)) bad(`tint ${k}=${v}`);
    }
    if (p.days !== null && !(Number.isInteger(p.days) && p.days > 0)) bad(`days ${p.days}`);
    if (!['sow', 'transplant'].includes(p.daysFrom)) bad(`daysFrom ${p.daysFrom}`);
    if (p.harvestDays !== null && !(p.harvestDays > 0)) bad(`harvestDays ${p.harvestDays}`);
    if (!(typeof p.spacingIn === 'number' && p.spacingIn > 0)) bad(`spacingIn ${p.spacingIn}`);
    if (!HARDINESS.includes(p.hardiness)) bad(`hardiness ${p.hardiness}`);
    if (typeof p.perennial !== 'boolean') bad('perennial');
    if (!p.windows || typeof p.windows !== 'object') bad('windows');
    else {
      for (const [type, w] of Object.entries(p.windows)) {
        if (!WINDOW_TYPES.includes(type)) bad(`window type ${type}`);
        if (!Array.isArray(w) || w.length !== 2 || !w.every(Number.isFinite) || w[0] > w[1]) bad(`window ${type} ${w}`);
        else if (w[0] < -26 || w[1] > 30) bad(`window ${type} out of range ${w}`);
      }
      if (p !== UNKNOWN_PLANT && !Object.keys(p.windows).length) bad('no planting windows');
    }
    if (p.succession !== null && !(p.succession > 0)) bad(`succession ${p.succession}`);
    for (const list of ['companions', 'avoid']) {
      if (!Array.isArray(p[list])) { bad(`${list} not array`); continue; }
      for (const r of p[list]) if (!refOk(r)) bad(`${list} ref ${r}`);
      if (p[list].includes(p.key)) bad(`${list} references itself`);
    }
    for (const r of p.companions) if (p.avoid.includes(r)) bad(`${r} both companion and avoid`);
    if (!Array.isArray(p.aliases) || !p.aliases.every(a => typeof a === 'string' && a)) bad('aliases');
    if (typeof p.notes !== 'string') bad('notes');
    if (p.base !== null && (!keySet.has(p.base) || getPlant(p.base).base !== null)) bad(`base ${p.base}`);
  }
  assert.deepEqual(problems, []);
});

test('keys unique and no name/alias collides across plants', () => {
  assert.equal(keySet.size, PLANTS.length, 'keys unique');
  const owner = new Map();
  const clashes = [];
  for (const p of PLANTS) {
    for (const raw of [p.key.replace(/_/g, ' '), p.name, ...p.aliases]) {
      const n = normalizeName(raw);
      if (!n) continue;
      if (owner.has(n) && owner.get(n) !== p.key) clashes.push(`"${n}": ${owner.get(n)} vs ${p.key}`);
      else owner.set(n, p.key);
    }
  }
  assert.deepEqual(clashes, []);
});

test('generic refs are expanded to cover varieties', () => {
  const basil = getPlant('basil');
  assert.ok(basil.companions.includes('tomato'));
  assert.ok(basil.companions.includes('black_krim'), 'basil companion reaches tomato varieties');
  assert.ok(getPlant('bush_bean').avoid.includes('family:allium'));
  assert.ok(getPlant('jalapeno').avoid.includes('fennel'), 'varieties inherit avoid list');
});

test('EVERY plant name in garden-db.json resolves', () => {
  const failures = [];
  const names = dbPlantNames();
  assert.ok(names.length > 50, `read ${names.length} names from garden-db.json`);
  for (const { where, name } of names) {
    const r = findPlantByName(name);
    if (!r || !r.plant || r.plant.key === 'unknown') failures.push(`${where}: "${name}"`);
  }
  if (failures.length) console.log('Unresolved garden-db names:\n  ' + failures.join('\n  '));
  assert.deepEqual(failures, []);
});

test('every v1 palette key exists and its v1 name resolves back to it', () => {
  const palette = v1Palette();
  assert.ok(palette.length >= 80, `parsed ${palette.length} v1 palette entries`);
  const missing = palette.filter(({ type }) => !keySet.has(type)).map(({ type }) => type);
  assert.deepEqual(missing, [], 'v1 keys missing from library');
  const wrong = [];
  for (const { type, name } of palette) {
    const r = findPlantByName(name);
    if (r?.plant.key !== type) wrong.push(`${name} -> ${r?.plant.key} (want ${type})`);
    if (findPlantByName(type)?.plant.key !== type) wrong.push(`key ${type} does not resolve to itself`);
  }
  assert.deepEqual(wrong, []);
});

test('spot checks', () => {
  const chk = (name, key, variety) => {
    const r = findPlantByName(name);
    assert.ok(r, `${name} resolves`);
    assert.equal(r.plant.key, key, `${name} -> ${key}`);
    if (variety !== undefined) assert.equal(r.variety, variety, `${name} variety`);
  };
  chk("Broccoli 'Belstar'", 'broccoli', 'Belstar');
  chk('Meeker Raspberries', 'raspberry', 'Meeker');
  chk('Jalapeno', 'jalapeno', null);
  chk('Jalapeño', 'jalapeno', null);
  chk('Red Russian Kale', 'kale', 'Red Russian');
  chk('Dino Kale', 'dino_kale', null);
  chk("Cauliflower 'Di Sicilia Violetto' (purple)", 'cauliflower', 'Di Sicilia Violetto');
  chk('Broccoli Raab / Rapini', 'broccoli_raab', null);
  chk('Mystery Plant (likely pepper)', 'pepper');
  chk('Edamame (Soybean)', 'edamame', null);
  chk('Yellow Pear', 'yellow_pear', null);           // not the asian pear
  chk('Salt and Pepper Cucumber', 'cucumber', 'Salt and Pepper');
  chk('Orange Sweet Potatoes', 'sweet_potato', 'Orange');
  chk('Sandy Lettuce', 'sandy', null);               // variety beats its generic
  chk("Tomato 'Black Krim'", 'black_krim', null);
  chk('Hot & Spicy Oregano', 'hot_spicy_oregano');
  chk("Mrs. Robb's Bonnet", 'euphorbia_mrs_robbs_bonnet');
  chk('Radish (mixed)', 'radish_mixed');
  chk('Basil starts (indoor)', 'basil', null);
  chk('Brocolli', 'broccoli', null);                 // typo, head-noun fallback
  chk('dino_kale', 'dino_kale', null);
  assert.equal(findPlantByName('xyzzy'), null);
  assert.equal(findPlantByName(''), null);
  assert.equal(findPlantByName(null), null);
});

test('mojibake is tolerated', () => {
  assert.equal(fixMojibake('JalapeÃ±o'), 'Jalapeño');
  assert.equal(fixMojibake('Broccoli â€˜Belstarâ€™'), 'Broccoli ‘Belstar’');
  assert.equal(fixMojibake('a â€” b'), 'a — b');
  const r = findPlantByName('Broccoli â€˜Belstarâ€™');
  assert.equal(r.plant.key, 'broccoli');
  assert.equal(r.variety, 'Belstar');
  assert.equal(findPlantByName('JalapeÃ±o').plant.key, 'jalapeno');
  assert.equal(findPlantByName("Miner's Merlot").plant.key, 'euphorbia_miners_merlot');
  assert.equal(findPlantByName('Minerâ€™s Merlot').plant.key, 'euphorbia_miners_merlot');
});

test('getPlant / allPlants with custom plants', () => {
  assert.equal(getPlant('tomato').name, 'Tomato');
  assert.equal(getPlant('nope'), UNKNOWN_PLANT);
  assert.equal(getPlant(undefined), UNKNOWN_PLANT);
  assert.equal(allPlants(), PLANTS);
  const custom = [
    { key: 'tomato', days: 60, windows: { transplant: [1, 4] } },
    { key: 'kiwi_hardy', name: 'Hardy Kiwi', category: 'fruit', family: 'other', sprite: 'shrub', aliases: ['arguta'] },
  ];
  const merged = allPlants(custom);
  assert.equal(merged.length, PLANTS.length + 1);
  const t = getPlant('tomato', custom);
  assert.equal(t.days, 60);
  assert.deepEqual([...t.windows.transplant], [1, 4]);
  assert.deepEqual([...t.windows.indoors], [...getPlant('tomato').windows.indoors], 'windows merged');
  assert.equal(getPlant('kiwi_hardy', custom).name, 'Hardy Kiwi');
  assert.equal(getPlant('kiwi_hardy').key, 'unknown', 'custom does not leak into the base library');
  assert.equal(findPlantByName('Arguta Kiwi', custom)?.plant.key, 'kiwi_hardy');
  assert.equal(findPlantByName('Hardy Kiwi', custom)?.plant.key, 'kiwi_hardy');
});

test('owner season rules are encoded', () => {
  const w = k => getPlant(k).windows;
  assert.ok(w('pepper').indoors[0] <= -12, 'peppers start indoors in January');
  assert.ok(w('tomato').indoors[0] <= -9 && w('tomato').indoors[1] >= -7, 'tomatoes start indoors in February');
  assert.ok(w('radish_mixed').direct[1] <= -2, 'no radishes after April 1');
  assert.ok(w('radish_mixed').fall, 'fall radishes');
  assert.ok(!w('napa_cabbage').direct && !w('napa_cabbage').transplant, 'napa is fall-only');
  assert.equal(getPlant('bush_bean').succession, 14);
  assert.ok(w('bush_bean').fall[1] <= -10, 'last bush beans by mid-August');
  assert.ok(getPlant('arugula').succession >= 14 && getPlant('arugula').succession <= 21);
  assert.ok(getPlant('cilantro').succession >= 14 && getPlant('cilantro').succession <= 21);
  assert.equal(getPlant('dino_kale').succession, null);
  assert.equal(getPlant('chard').succession, null);
  assert.equal(getPlant('garlic').windows.fall.length, 2);
});
