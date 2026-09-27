// node --test tests/sprites.test.mjs   (Node 24, no deps, no DOM)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PALETTE, SPRITES, SPRITE_KEYS, DEFAULT_TINTS, TINT_SLOTS,
  hasSprite, renderToRGBA, spriteURL, spriteCanvas,
} from '../js/sprites.js';

const REQUIRED = {
  plants: `seedling lettuce leafy kale chard cabbage broccoli bokchoy bean pea carrot beet radish
    turnip onion leek garlic potato tomato pepper eggplant melon watermelon squash zucchini
    cucumber pumpkin corn strawberry blueberry raspberry herb basil parsley dill rosemary flower
    dahlia marigold nasturtium sunflower lupine bulb euphorbia tree fig groundcherry tomatillo
    shrub unknown`,
  icons: `icon_yard icon_bed icon_calendar icon_book icon_basket icon_seed icon_can icon_frost
    icon_sun icon_shovel icon_gear icon_plus icon_trash icon_lock icon_unlock icon_user
    icon_cloud icon_cloud_off icon_sprout icon_map icon_check icon_close icon_edit icon_warn
    icon_heart icon_clash`,
  tiles: `tile_grass tile_grass2 tile_soil tile_soil2 tile_path tile_wood tile_water`,
};
const ALL_REQUIRED = Object.values(REQUIRED).flatMap((s) => s.trim().split(/\s+/));

const px = (img, x, y) => Array.from(img.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
const usesTint = (key) => SPRITES[key].rows.some((r) => /[AQBV]/.test(r));

test('module imports without a DOM', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  assert.ok(SPRITE_KEYS.length > 0);
  assert.equal(typeof spriteURL, 'function');
  assert.equal(typeof spriteCanvas, 'function');
});

test('palette: transparent dot + valid hex colours', () => {
  assert.equal(PALETTE['.'], 'transparent');
  for (const [ch, hex] of Object.entries(PALETTE)) {
    assert.equal(ch.length, 1, `palette key ${ch}`);
    if (ch !== '.') assert.match(hex, /^#[0-9a-f]{6}$/i, `palette ${ch}`);
    assert.ok(!TINT_SLOTS.includes(ch), `palette must not shadow tint slot ${ch}`);
  }
  // spec: base 22 entries (incl '.') + at most 4 extras
  assert.ok(Object.keys(PALETTE).length <= 26);
});

test('all required keys present', () => {
  const missing = ALL_REQUIRED.filter((k) => !hasSprite(k));
  assert.deepEqual(missing, []);
  assert.deepEqual([...SPRITE_KEYS], Object.keys(SPRITES));
});

test('every sprite is 16 rows x 16 chars', () => {
  for (const key of SPRITE_KEYS) {
    const { rows } = SPRITES[key];
    assert.equal(rows.length, 16, `${key} row count`);
    rows.forEach((r, i) => assert.equal(r.length, 16, `${key} row ${i}: "${r}"`));
  }
});

test('every char is a palette colour or tint slot', () => {
  const ok = new Set([...Object.keys(PALETTE), ...TINT_SLOTS]);
  for (const key of SPRITE_KEYS) {
    SPRITES[key].rows.forEach((r, i) => {
      for (const ch of r) assert.ok(ok.has(ch), `${key} row ${i} has bad char "${ch}"`);
    });
  }
});

test('sprites using tint slots have DEFAULT_TINTS for the slots they use', () => {
  for (const key of SPRITE_KEYS) {
    const txt = SPRITES[key].rows.join('');
    if (/[AQ]/.test(txt)) assert.match(DEFAULT_TINTS[key]?.A ?? '', /^#[0-9a-f]{6}$/i, `${key} needs DEFAULT_TINTS.A`);
    if (/[BV]/.test(txt)) assert.match(DEFAULT_TINTS[key]?.B ?? '', /^#[0-9a-f]{6}$/i, `${key} needs DEFAULT_TINTS.B`);
  }
  for (const key of Object.keys(DEFAULT_TINTS)) assert.ok(hasSprite(key), `DEFAULT_TINTS.${key} has no sprite`);
});

test('spec-mandated tint slots are used', () => {
  for (const key of ['lettuce', 'chard', 'carrot', 'beet', 'radish', 'tomato', 'pepper', 'eggplant',
    'melon', 'squash', 'flower', 'dahlia', 'lupine', 'bulb', 'euphorbia', 'tree']) {
    assert.ok(SPRITES[key].rows.some((r) => r.includes('A')), `${key} should use tint A`);
  }
  assert.ok(SPRITES.flower.rows.some((r) => r.includes('B')), 'flower should use tint B');
});

test('sprites are not blank and plants/icons have transparent background', () => {
  for (const key of SPRITE_KEYS) {
    const txt = SPRITES[key].rows.join('');
    const filled = txt.replace(/\./g, '').length;
    assert.ok(filled >= 20, `${key} looks empty`);
    if (key.startsWith('tile_')) assert.equal(filled, 256, `${key} tile must be fully opaque`);
    else assert.ok(filled < 256, `${key} should have some transparency`);
  }
});

test('renderToRGBA: 16x16, 1024 bytes, alpha matches art', () => {
  for (const key of SPRITE_KEYS) {
    const img = renderToRGBA(key);
    assert.equal(img.w, 16);
    assert.equal(img.h, 16);
    assert.ok(img.data instanceof Uint8ClampedArray);
    assert.equal(img.data.length, 1024);
    const rows = SPRITES[key].rows;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const a = px(img, x, y)[3];
      assert.equal(a, rows[y][x] === '.' ? 0 : 255, `${key} alpha at ${x},${y}`);
    }
  }
});

test('renderToRGBA: palette colours come through exactly', () => {
  const img = renderToRGBA('tile_grass');
  const ch = SPRITES.tile_grass.rows[0][0];
  const hex = PALETTE[ch];
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.deepEqual(px(img, 0, 0).slice(0, 3), rgb);
});

test('renderToRGBA: tint override changes pixels, shadow auto-derives darker', () => {
  const find = (key, ch) => {
    const rows = SPRITES[key].rows;
    for (let y = 0; y < 16; y++) { const x = rows[y].indexOf(ch); if (x >= 0) return [x, y]; }
    return null;
  };
  const [ax, ay] = find('tomato', 'A');
  const [qx, qy] = find('tomato', 'Q');
  const def = renderToRGBA('tomato');
  const blue = renderToRGBA('tomato', { A: '#0000ff' });
  assert.notDeepEqual(Array.from(def.data), Array.from(blue.data));
  assert.deepEqual(px(blue, ax, ay), [0, 0, 255, 255]);
  const q = px(blue, qx, qy);
  assert.ok(q[2] < 255 && q[2] > 100, 'Q is a darker blue');
  // explicit Q override wins
  const q2 = renderToRGBA('tomato', { A: '#0000ff', Q: '#00ff00' });
  assert.deepEqual(px(q2, qx, qy), [0, 255, 0, 255]);
  // B slot on flower
  const [bx, by] = find('flower', 'B');
  assert.deepEqual(px(renderToRGBA('flower', { B: '#ff00ff' }), bx, by), [255, 0, 255, 255]);
  // 3-digit hex + invalid values fall back to defaults
  assert.deepEqual(px(renderToRGBA('tomato', { A: '#f00' }), ax, ay), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(renderToRGBA('tomato', { A: 'nope' }).data), Array.from(def.data));
  // tint on a sprite with no tint slots changes nothing
  assert.deepEqual(Array.from(renderToRGBA('icon_gear', { A: '#0000ff' }).data), Array.from(renderToRGBA('icon_gear').data));
});

test('default tints resolve (no sprite renders tint slots as transparent)', () => {
  for (const key of SPRITE_KEYS.filter(usesTint)) {
    const img = renderToRGBA(key);
    SPRITES[key].rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if ('AQBV'.includes(ch)) assert.equal(px(img, x, y)[3], 255, `${key} ${x},${y}`);
    }));
  }
});

test('unknown keys fall back to the unknown sprite', () => {
  assert.equal(hasSprite('definitely_not_a_plant'), false);
  assert.equal(hasSprite(undefined), false);
  assert.equal(hasSprite('toString'), false);
  const u = Array.from(renderToRGBA('unknown').data);
  assert.deepEqual(Array.from(renderToRGBA('definitely_not_a_plant').data), u);
  assert.deepEqual(Array.from(renderToRGBA(undefined).data), u);
  assert.deepEqual(Array.from(renderToRGBA('__proto__').data), u);
});

test('renderToRGBA is pure (fresh buffer each call)', () => {
  const a = renderToRGBA('carrot');
  a.data.fill(0);
  assert.notDeepEqual(Array.from(renderToRGBA('carrot').data), Array.from(a.data));
});

test('sprites are frozen', () => {
  assert.ok(Object.isFrozen(SPRITES));
  assert.ok(Object.isFrozen(SPRITES.tomato.rows));
  assert.ok(Object.isFrozen(PALETTE));
});
