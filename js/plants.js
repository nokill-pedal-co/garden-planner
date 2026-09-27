// plants.js — plant library + name matching. PURE (no DOM), runs under `node --test`.
//
// Tuned for Portland, OR 97229 (USDA 8b, maritime PNW: cool wet springs, dry summers,
// wet mild winters). Owner's frost dates: last frost 04-15, first frost 10-25.
//
// Windows are in WEEKS: indoors/transplant/direct are relative to LAST frost (negative = before),
// `fall` is relative to FIRST frost (negative = before). `days` = days to first harvest counted
// from `daysFrom` ('sow' | 'transplant'); null for ornamentals/trees where it doesn't apply.
//
// Keys reuse the v1 palette `type` strings (index.html PLANT_CATEGORIES) so v1 data maps 1:1.
// Named varieties are their own entries with `base` = the generic crop key (extra field beyond
// the ARCHITECTURE contract; null on generic entries). Companion/avoid refs that name a generic
// crop are expanded at build time to also cover its varieties (season.js matches refs by exact
// key or 'family:x').

export const DEFAULT_CLIMATE = Object.freeze({
  place: 'Portland, OR 97229',
  zone: '8b',
  lastFrost: '04-15',
  firstFrost: '10-25',
});

export const CATEGORIES = Object.freeze([
  { key: 'lettuce', name: 'Lettuces' },
  { key: 'greens', name: 'Greens' },
  { key: 'brassicas', name: 'Brassicas' },
  { key: 'legumes', name: 'Beans & Peas' },
  { key: 'roots', name: 'Root Vegetables' },
  { key: 'alliums', name: 'Onions & Garlic' },
  { key: 'tomatoes', name: 'Tomatoes' },
  { key: 'peppers', name: 'Peppers & Eggplant' },
  { key: 'squash', name: 'Squash & Cucumbers' },
  { key: 'melons', name: 'Melons' },
  { key: 'other_veg', name: 'Other Vegetables' },
  { key: 'herbs', name: 'Herbs' },
  { key: 'fruit', name: 'Fruit & Berries' },
  { key: 'trees', name: 'Trees' },
  { key: 'flowers', name: 'Flowers & Ornamentals' },
  { key: 'dahlias', name: 'Dahlias' },
  { key: 'euphorbias', name: 'Euphorbias' },
  { key: 'bulbs', name: 'Bulbs' },
  { key: 'other', name: 'Other' },
].map(Object.freeze));

export const PLANT_FAMILIES = Object.freeze({
  brassica: 'Brassicas (cabbage family)',
  solanaceae: 'Nightshades (tomato family)',
  cucurbit: 'Cucurbits (squash family)',
  legume: 'Legumes (bean family)',
  allium: 'Alliums (onion family)',
  umbellifer: 'Umbellifers (carrot family)',
  amaranth: 'Amaranths (beet & chard family)',
  aster: 'Asters (daisy & lettuce family)',
  lamiaceae: 'Mint family (Lamiaceae)',
  rosaceae: 'Rose family (Rosaceae)',
  ericaceae: 'Heath family (blueberries)',
  moraceae: 'Mulberry family (figs)',
  other: 'Other',
});

/** Every sprite key this library references (sprites.js must define all of them). */
export const SPRITE_KEYS_USED = Object.freeze([
  'seedling', 'lettuce', 'leafy', 'kale', 'chard', 'cabbage', 'broccoli', 'bokchoy', 'bean', 'pea',
  'carrot', 'beet', 'radish', 'turnip', 'onion', 'leek', 'garlic', 'potato', 'tomato', 'pepper',
  'eggplant', 'melon', 'watermelon', 'squash', 'zucchini', 'cucumber', 'pumpkin', 'corn',
  'strawberry', 'blueberry', 'raspberry', 'herb', 'basil', 'parsley', 'dill', 'rosemary', 'flower',
  'dahlia', 'marigold', 'nasturtium', 'sunflower', 'lupine', 'bulb', 'euphorbia', 'tree', 'fig',
  'groundcherry', 'tomatillo', 'shrub', 'unknown',
]);

// Palette shorthands (sprites.js PALETTE).
const INK = '#1a1c2c', PLUM = '#5d275d', RED = '#b13e53', ORANGE = '#ef7d57', YELLOW = '#ffcd75',
  LIME = '#a7f070', GREEN = '#38b764', DKGREEN = '#1e6b45', TEAL = '#257179', NAVY = '#29366f',
  BLUE = '#3b5dc9', PURPLE = '#8b5cb8', PINK = '#f5a3c7', WHITE = '#f4f4f4',
  SILVER = '#94b0c2', BROWN = '#734c3b', CREAM = '#f2e6c9';

const DEFAULTS = {
  base: null,
  tint: null,
  days: null,
  daysFrom: 'sow',
  harvestDays: null,
  spacingIn: 12,
  hardiness: 'half-hardy',
  perennial: false,
  windows: {},
  succession: null,
  companions: [],
  avoid: [],
  aliases: [],
  notes: '',
};

export const UNKNOWN_PLANT = deepFreeze({
  ...DEFAULTS,
  key: 'unknown',
  name: 'Unknown plant',
  category: 'other',
  family: 'other',
  sprite: 'unknown',
  daysFrom: 'transplant',
  notes: 'Not in the plant library yet — add it as a custom plant to get windows and tasks.',
});

// ------------------------------------------------------------------------------------ data

const LIST = [];
const BY_KEY = new Map();

function crop(key, name, category, family, sprite, o = {}) {
  const p = { ...DEFAULTS, key, name, category, family, sprite, ...o };
  LIST.push(p);
  BY_KEY.set(key, p);
  return p;
}

/** A named variety: inherits horticulture from its generic `baseKey`, overrides what differs. */
function variety(baseKey, key, name, o = {}) {
  const b = BY_KEY.get(baseKey);
  if (!b) throw new Error(`plants.js: unknown base ${baseKey}`);
  const { notes, ...rest } = o;
  const p = {
    ...b,
    windows: { ...b.windows },
    companions: [...b.companions],
    avoid: [...b.avoid],
    aliases: [],
    key, name, base: baseKey,
    ...rest,
    notes: [notes, b.notes].filter(Boolean).join(' '),
  };
  LIST.push(p);
  BY_KEY.set(key, p);
  return p;
}

// ---- Lettuces ---------------------------------------------------------------------------
crop('lettuce', 'Lettuce', 'lettuce', 'aster', 'lettuce', {
  tint: { A: GREEN, B: LIME }, days: 45, daysFrom: 'sow', harvestDays: 21, spacingIn: 8,
  hardiness: 'half-hardy',
  windows: { indoors: [-10, -6], transplant: [-5, 2], direct: [-6, 8], fall: [-12, -6] },
  succession: 18,
  companions: ['carrot', 'radish_mixed', 'chives', 'strawberry', 'beet'],
  aliases: ['lettuces', 'leaf lettuce', 'loose leaf lettuce', 'looseleaf lettuce', 'head lettuce',
    'mesclun', 'mixed lettuce', 'salad mix'],
  notes: 'Owner rule: 2–3 heads of each variety every 2–3 weeks, March–October — never all at once ' +
    '(2026: everything planted 4/20 matured together and bolted). Starts in the ground by mid-March; ' +
    'direct sow from early March. Handles light frost. Part of the Portland "bolting trio" with radish ' +
    'and cilantro — done by June unless heat-tolerant (Jericho, Green Tower, BSS) under shade cloth.',
});
variety('lettuce', 'romaine', 'Romaine', {
  tint: { A: GREEN, B: DKGREEN }, days: 45,
  aliases: ['romaine lettuce', 'cos', 'cos lettuce'],
  notes: 'Upright heads; Jericho is the most heat-tolerant for summer.',
});
variety('lettuce', 'black_seeded_simpson', 'Black Seeded Simpson', {
  tint: { A: LIME, B: GREEN }, days: 40, spacingIn: 6,
  aliases: ['bss', 'simpson', 'black seeded simpson lettuce'],
  notes: 'Fast frilly loose-leaf; cut-and-come-again.',
});
variety('lettuce', 'winter_density', 'Winter Density', {
  tint: { A: DKGREEN, B: GREEN }, days: 55,
  aliases: ['winter density lettuce'],
  notes: 'Bibb/romaine cross, very cold tolerant — best for early spring and the fall window.',
});
variety('lettuce', 'dark_lolla_rossa', 'Dark Lolla Rossa', {
  tint: { A: RED, B: PLUM }, days: 50, spacingIn: 6,
  aliases: ['lolla rossa', 'lollo rossa', 'dark lollo rossa', 'red lolla rossa'],
  notes: 'Deep red frilly loose-leaf.',
});
variety('lettuce', 'pirat_butterhead', 'Pirat Butterhead', {
  tint: { A: GREEN, B: RED }, days: 55,
  aliases: ['pirat', 'butterhead', 'butter lettuce', 'bibb', 'bibb lettuce'],
  notes: 'Green butterhead with red-speckled edges.',
});
variety('lettuce', 'sandy', 'Sandy', {
  tint: { A: GREEN, B: LIME }, days: 45,
  aliases: ['sandy lettuce', 'sandy oakleaf', 'oakleaf', 'oak leaf lettuce'],
  notes: 'Oakleaf type; slow to bolt.',
});
variety('lettuce', 'savoy_lettuce', 'Savoy Lettuce', {
  tint: { A: DKGREEN, B: LIME }, days: 45,
  aliases: ['savoy'],
  notes: 'Crinkled-leaf lettuce (v1 "Savoy" in the Lettuces palette).',
});

// ---- Greens -----------------------------------------------------------------------------
crop('arugula', 'Arugula', 'greens', 'brassica', 'leafy', {
  tint: { A: DKGREEN, B: GREEN }, days: 30, daysFrom: 'sow', harvestDays: 21, spacingIn: 3,
  hardiness: 'hardy',
  windows: { direct: [-6, 12], fall: [-12, -4] },
  succession: 18,
  companions: ['lettuce', 'bush_bean', 'carrot'],
  aliases: ['rocket', 'roquette', 'rucola', 'arugola', 'salad rocket'],
  notes: 'Owner rule: succession sow every 2–3 weeks from March through fall — constant flow. ' +
    'Bolts fast in heat but germinates fast; ~30 days seed to harvest. 2026 start (5/20) was way too ' +
    'late. Fall sowings (Aug–Sep) are the sweet spot. Flea beetles — row cover.',
});
crop('spinach', 'Spinach', 'greens', 'amaranth', 'leafy', {
  tint: { A: DKGREEN, B: GREEN }, days: 45, daysFrom: 'sow', harvestDays: 21, spacingIn: 4,
  hardiness: 'hardy',
  windows: { transplant: [-5, -1], direct: [-7, -2], fall: [-10, -7] },
  succession: 14,
  companions: ['strawberry', 'pea', 'radish_mixed', 'lettuce'],
  aliases: ['spinaches', 'true spinach', 'savoy spinach'],
  notes: 'Bolts on long days — spring crop must be in by early April. Fall sowing Aug–early Sept ' +
    'overwinters well in PDX (Bloomsdale). Dislikes transplanting; direct sow.',
});
crop('perpetual_spinach', 'Perpetual Spinach', 'greens', 'amaranth', 'chard', {
  tint: { A: GREEN, B: DKGREEN }, days: 50, daysFrom: 'sow', harvestDays: 180, spacingIn: 6,
  hardiness: 'hardy',
  windows: { transplant: [-3, 3], direct: [-4, 10], fall: [-14, -10] },
  companions: ['onion', 'lettuce', 'bush_bean'],
  aliases: ['leaf beet', 'spinach beet', 'perpetual lettuce'],
  notes: 'A chard (leaf beet) that eats like spinach and does NOT bolt in summer heat. ' +
    'Cut-and-come-again, like the owner\'s chard.',
});
crop('chard', 'Swiss Chard', 'greens', 'amaranth', 'chard', {
  tint: { A: GREEN, B: RED }, days: 55, daysFrom: 'sow', harvestDays: 180, spacingIn: 6,
  hardiness: 'hardy',
  windows: { indoors: [-8, -5], transplant: [-3, 3], direct: [-3, 12], fall: [-14, -10] },
  companions: ['onion', 'bush_bean', 'lettuce', 'family:brassica'],
  aliases: ['swiss chard', 'rainbow chard', 'bright lights', 'silverbeet', 'chards'],
  notes: 'Owner: huge 2026 winner — plant once, harvest all season. Cut-and-come-again from the ' +
    'outside leaves; no succession needed. 4/20 starts worked; a 7/22 sowing carries into winter.',
});
crop('kale', 'Kale', 'greens', 'brassica', 'kale', {
  tint: { A: GREEN, B: DKGREEN }, days: 55, daysFrom: 'sow', harvestDays: 180, spacingIn: 12,
  hardiness: 'hardy',
  windows: { indoors: [-9, -5], transplant: [-4, 2], direct: [-4, 4], fall: [-15, -10] },
  companions: ['onion', 'beet', 'celery', 'dill', 'chamomile', 'nasturtium', 'marigold', 'rosemary'],
  avoid: ['strawberry'],
  aliases: ['kales', 'curly kale', 'scotch kale'],
  notes: 'Cut-and-come-again all season: harvest lower leaves, keep the crown growing. ' +
    'Sweetens after frost; stands all winter in PDX. Watch for cabbage loopers/aphids (Bt, hose off).',
});
variety('kale', 'dino_kale', 'Dino Kale', {
  tint: { A: DKGREEN, B: TEAL }, days: 60,
  aliases: ['lacinato', 'lacinato kale', 'tuscan kale', 'cavolo nero', 'black kale', 'dinosaur kale',
    'nero di toscana'],
  notes: 'Owner: absolute keeper. Grows all season with no succession — harvest from the bottom and ' +
    'it goes spring through fall. March/April starts. No pest issues. Grow more.',
});
variety('kale', 'red_leaf_kale', 'Red Leaf Kale', {
  tint: { A: PLUM, B: GREEN }, days: 60,
  aliases: ['red kale', 'redbor', 'redbor kale'],
  notes: 'Purple-red ribs and leaves; same care as dino kale.',
});
crop('collards', 'Collard Greens', 'greens', 'brassica', 'kale', {
  tint: { A: DKGREEN, B: SILVER }, days: 60, daysFrom: 'sow', harvestDays: 150, spacingIn: 12,
  hardiness: 'hardy',
  windows: { indoors: [-9, -5], transplant: [-4, 2], direct: [-4, 4], fall: [-15, -10] },
  companions: ['onion', 'dill', 'chamomile', 'nasturtium', 'marigold'],
  avoid: ['strawberry'],
  aliases: ['collard', 'collard greens', 'collard green'],
  notes: 'Grow-bag friendly. 2026: cabbage worm / flea beetle chewing — check leaf undersides, Bt for ' +
    'caterpillars. Very cold hardy; harvest lower leaves.',
});
crop('mustard_greens', 'Mustard Greens', 'greens', 'brassica', 'leafy', {
  tint: { A: PLUM, B: GREEN }, days: 40, daysFrom: 'sow', harvestDays: 30, spacingIn: 6,
  hardiness: 'hardy',
  windows: { direct: [-5, 0], fall: [-10, -5] },
  succession: 21,
  aliases: ['mustard', 'mustards', 'mizuna', 'red giant mustard', 'asian greens'],
  notes: 'Fast; bolts in summer heat — spring and fall only. Spicier after frost.',
});
crop('mache', 'Mâche', 'greens', 'other', 'lettuce', {
  tint: { A: DKGREEN, B: GREEN }, days: 50, daysFrom: 'sow', harvestDays: 60, spacingIn: 3,
  hardiness: 'hardy',
  windows: { direct: [-8, -4], fall: [-9, -4] },
  aliases: ['corn salad', 'lambs lettuce', 'lamb lettuce', 'field salad', 'valerianella'],
  notes: 'Winter salad green: sow Sep–Oct, harvest rosettes all winter in PDX. Germinates only in cool soil.',
});
crop('bok_choy', 'Bok Choy', 'greens', 'brassica', 'bokchoy', {
  tint: { A: GREEN, B: WHITE }, days: 45, daysFrom: 'sow', harvestDays: 21, spacingIn: 6,
  hardiness: 'half-hardy',
  windows: { indoors: [-8, -5], transplant: [-4, 0], direct: [-5, -1], fall: [-10, -6] },
  succession: 21,
  companions: ['onion', 'dill', 'chamomile', 'nasturtium'],
  avoid: ['strawberry'],
  aliases: ['pak choi', 'pak choy', 'bok choi', 'baby bok choy', 'joi choi', 'shanghai bok choy'],
  notes: 'Bolts with heat and long days — spring and fall. Owner fall-sowed pak choi 8/21 (~45 days). ' +
    'Flea beetles: row cover.',
});

// ---- Brassicas --------------------------------------------------------------------------
const BRASSICA_COMPANIONS = ['onion', 'dill', 'chamomile', 'nasturtium', 'marigold', 'rosemary', 'sage', 'celery', 'beet'];
crop('cabbage', 'Cabbage', 'brassicas', 'brassica', 'cabbage', {
  tint: { A: GREEN, B: LIME }, days: 70, daysFrom: 'transplant', harvestDays: 21, spacingIn: 18,
  hardiness: 'hardy',
  windows: { indoors: [-9, -6], transplant: [-4, 1], fall: [-15, -11] },
  companions: BRASSICA_COMPANIONS,
  avoid: ['strawberry'],
  aliases: ['cabbages', 'head cabbage'],
  notes: 'Heavy feeder. Cabbage loopers/imported cabbageworm — hand-pick or Bt. Fall heads are the ' +
    'easiest in PDX (sow indoors June, set out July).',
});
variety('cabbage', 'savoy_cabbage', 'Savoy Cabbage', {
  tint: { A: DKGREEN, B: LIME },
  windows: { indoors: [-9, 4], transplant: [-4, 9], fall: [-15, -11] },
  aliases: ['savoy cabbages'],
  notes: 'Owner note: more heat-tolerant than other cabbages — starts can go in late May/June for a ' +
    'late-summer harvest. Plan: starts in spring 2027.',
});
crop('napa_cabbage', 'Napa Cabbage', 'brassicas', 'brassica', 'cabbage', {
  tint: { A: LIME, B: CREAM }, days: 70, daysFrom: 'sow', harvestDays: 21, spacingIn: 12,
  hardiness: 'half-hardy',
  windows: { fall: [-14, -11] },
  companions: BRASSICA_COMPANIONS,
  avoid: ['strawberry'],
  aliases: ['napa', 'chinese cabbage', 'wong bok', 'celery cabbage'],
  notes: 'Owner rule: do NOT plant in spring/summer — it bolts like radishes. Direct sow late July/' +
    'early August for an October harvest.',
});
crop('broccoli', 'Broccoli', 'brassicas', 'brassica', 'broccoli', {
  tint: { A: DKGREEN, B: GREEN }, days: 65, daysFrom: 'transplant', harvestDays: 30, spacingIn: 12,
  hardiness: 'hardy',
  windows: { indoors: [-9, -6], transplant: [-4, 0], fall: [-15, -11] },
  companions: BRASSICA_COMPANIONS,
  avoid: ['strawberry'],
  aliases: ['calabrese', 'sprouting broccoli', 'broccolis'],
  notes: 'Cut the main head before the beads loosen; side shoots follow for weeks. Spring broccoli ' +
    'buttons/bolts if set out late. Fall: Belstar is the safe head — transplant into a finishing-bean ' +
    'spot (bean → brassica rotation). Romanesco needs ~90 days, may head the next spring.',
});
crop('broccoli_raab', 'Broccoli Raab', 'brassicas', 'brassica', 'broccoli', {
  tint: { A: GREEN, B: YELLOW }, days: 45, daysFrom: 'sow', harvestDays: 14, spacingIn: 4,
  hardiness: 'hardy',
  windows: { direct: [-5, -1], fall: [-12, -8] },
  companions: BRASSICA_COMPANIONS,
  avoid: ['strawberry'],
  aliases: ['rapini', 'broccoli rabe', 'raab', 'rabe', 'cima di rapa'],
  notes: 'Fast leafy brassica; harvest stems + buds before flowers open. Direct sow in rows in August.',
});
crop('cauliflower', 'Cauliflower', 'brassicas', 'brassica', 'broccoli', {
  tint: { A: CREAM, B: GREEN }, days: 65, daysFrom: 'transplant', harvestDays: 10, spacingIn: 18,
  hardiness: 'half-hardy',
  windows: { indoors: [-9, -6], transplant: [-3, 1], fall: [-16, -12] },
  companions: BRASSICA_COMPANIONS,
  avoid: ['strawberry'],
  aliases: ['cauli', 'cauliflowers'],
  notes: 'Fussy: any check (cold snap, drought, rootbound start) makes tiny "buttons". Overwinter ' +
    'plan: transplant Jul–Aug, heads in spring 2027. Snowball is a fast summer/fall type, NOT cold ' +
    'hardy; Green Macerata and Di Sicilia Violetto (purple) are the better overwinter candidates.',
});
crop('brussels_sprouts', 'Brussels Sprouts', 'brassicas', 'brassica', 'cabbage', {
  tint: { A: DKGREEN, B: GREEN }, days: 100, daysFrom: 'transplant', harvestDays: 60, spacingIn: 18,
  hardiness: 'hardy',
  windows: { indoors: [2, 6], transplant: [7, 11] },
  companions: BRASSICA_COMPANIONS,
  avoid: ['strawberry'],
  aliases: ['brussels sprout', 'brussel sprouts', 'brussels'],
  notes: 'A fall/winter crop in PDX: start May, set out June, pick Oct–Jan. Frost sweetens them. ' +
    'Top the plant in September to size up sprouts.',
});
crop('kohlrabi', 'Kohlrabi', 'brassicas', 'brassica', 'turnip', {
  tint: { A: PURPLE, B: LIME }, days: 50, daysFrom: 'sow', harvestDays: 14, spacingIn: 6,
  hardiness: 'hardy',
  windows: { transplant: [-4, 0], direct: [-5, -1], fall: [-11, -7] },
  companions: ['onion', 'beet', 'dill', 'chamomile'],
  avoid: ['strawberry'],
  aliases: ['kohl rabi'],
  notes: 'Pick at 2–3" across before it turns woody. Spring and fall.',
});
crop('radicchio', 'Radicchio', 'brassicas', 'aster', 'cabbage', {
  tint: { A: RED, B: WHITE }, days: 85, daysFrom: 'sow', harvestDays: 30, spacingIn: 10,
  hardiness: 'hardy',
  windows: { direct: [8, 13] },
  aliases: ['chicory', 'red chicory', 'italian chicory', 'treviso', 'chioggia radicchio'],
  notes: 'Chicory (aster family, not a brassica). Sow late June–mid July for fall heads; spring ' +
    'sowings bolt. Heads color up and sweeten with cold. Owner sowed Baldo + T&T 4050 on 7/8.',
});

// ---- Beans & peas -----------------------------------------------------------------------
crop('bush_bean', 'Bush Bean', 'legumes', 'legume', 'bean', {
  tint: { A: GREEN, B: DKGREEN }, days: 55, daysFrom: 'sow', harvestDays: 21, spacingIn: 4,
  hardiness: 'tender',
  windows: { direct: [5, 13], fall: [-13, -10] },
  succession: 14,
  companions: ['carrot', 'corn', 'cucumber', 'potato', 'marigold', 'nasturtium', 'strawberry', 'chard'],
  avoid: ['family:allium', 'fennel'],
  aliases: ['bush beans', 'bean', 'green bean', 'snap bean', 'string bean', 'french bean',
    'haricot vert', 'bush green bean'],
  notes: 'Owner rule: sow every 2 weeks, late May through mid-July. Last sowing needs ~55 days ' +
    'before first frost (10/25) — stop by mid-August. Wait for soil ≥60°F; seed rots in cold PDX ' +
    'soil. Follow with fall brassicas (bean → brassica rotation).',
});
variety('bush_bean', 'blue_lake_bush_bean', 'Blue Lake Bush Bean', {
  aliases: ['blue lake', 'blue lake 274', 'blue lake bush'],
  notes: 'Classic Oregon-bred green bean.',
});
variety('bush_bean', 'royal_burgundy_bush_bean', 'Royal Burgundy Bush Bean', {
  tint: { A: PLUM, B: DKGREEN },
  aliases: ['royal burgundy', 'burgundy bush bean', 'burgundy bean', 'purple bush bean'],
  notes: 'Purple pods (turn green when cooked); tolerates cooler soil than most — good first sowing.',
});
variety('bush_bean', 'wax_bush_bean', 'Yellow Wax Bush Bean', {
  tint: { A: YELLOW, B: GREEN }, days: 52,
  aliases: ['wax bush bean', 'yellow wax bean', 'wax bean', 'yellow bush bean', 'golden wax bean'],
  notes: 'Butter-yellow pods; easy to spot when picking.',
});
crop('pole_bean', 'Pole Bean', 'legumes', 'legume', 'bean', {
  tint: { A: GREEN, B: RED }, days: 65, daysFrom: 'sow', harvestDays: 45, spacingIn: 6,
  hardiness: 'tender',
  windows: { direct: [5, 10] },
  companions: ['corn', 'carrot', 'cucumber', 'marigold', 'nasturtium'],
  avoid: ['family:allium', 'fennel', 'beet'],
  aliases: ['pole beans', 'runner bean', 'scarlet runner bean', 'climbing bean'],
  notes: 'Needs a 6–7 ft trellis; one sowing crops until frost if picked often.',
});
crop('fava_bean', 'Fava Bean', 'legumes', 'legume', 'bean', {
  tint: { A: DKGREEN, B: WHITE }, days: 85, daysFrom: 'sow', harvestDays: 21, spacingIn: 8,
  hardiness: 'hardy',
  windows: { direct: [-10, -4], fall: [-3, 2] },
  avoid: ['family:allium', 'fennel'],
  aliases: ['fava', 'favas', 'broad bean', 'faba bean', 'windsor bean'],
  notes: 'PNW classic: sow Oct–Nov to overwinter (harvest May–June) or Feb–Mar. Doubles as a ' +
    'nitrogen-fixing cover crop — chop and drop.',
});
crop('edamame', 'Edamame', 'legumes', 'legume', 'bean', {
  tint: { A: GREEN, B: LIME }, days: 80, daysFrom: 'sow', harvestDays: 14, spacingIn: 6,
  hardiness: 'tender',
  windows: { direct: [5, 8] },
  companions: ['corn', 'marigold'],
  avoid: ['family:allium', 'fennel'],
  aliases: ['soybean', 'soy bean', 'soya bean', 'vegetable soybean'],
  notes: 'Warm-season and fussier about cold soil than common beans — wait for late May. The whole ' +
    'plant ripens together, so the harvest window is short. Pick early varieties for PDX. Planned 2027.',
});
crop('pea', 'Pea', 'legumes', 'legume', 'pea', {
  tint: { A: GREEN, B: WHITE }, days: 60, daysFrom: 'sow', harvestDays: 28, spacingIn: 4,
  hardiness: 'hardy',
  windows: { indoors: [-10, -6], transplant: [-6, -2], direct: [-8, -2], fall: [-12, -10] },
  companions: ['carrot', 'radish_mixed', 'lettuce', 'spinach', 'cucumber', 'corn'],
  avoid: ['family:allium', 'fennel'],
  aliases: ['peas', 'garden pea', 'shelling pea', 'shell pea', 'english pea'],
  notes: 'Owner: plant earlier (March starts, or direct sow Feb–Mar) for a longer harvest — 4/20 ' +
    'starts produced by mid-June. An August sowing for fall is a gamble (powdery mildew, cold). ' +
    'Trellis; pick often.',
});
variety('pea', 'snap_peas', 'Snap Peas', {
  aliases: ['snap pea', 'sugar snap', 'sugar snap pea', 'regular snap peas'],
  notes: 'Owner: loved these — eat right off the vine.',
});
variety('pea', 'oregon_sugar_snap_peas', 'Oregon Sugar Snap Peas', {
  tint: { A: LIME, B: WHITE },
  aliases: ['oregon sugar', 'oregon sugar pod', 'oregon sugar pod ii', 'oregon sugar snap'],
  notes: 'OSU-bred, disease resistant (strictly a flat-podded snow type).',
});
variety('pea', 'snow_pea', 'Snow Pea', {
  tint: { A: LIME, B: WHITE },
  aliases: ['snow peas', 'chinese pea pod', 'mangetout'],
  notes: 'Flat edible pods; pick before the peas swell.',
});

// ---- Roots ------------------------------------------------------------------------------
crop('radish_mixed', 'Radish (mixed)', 'roots', 'brassica', 'radish', {
  tint: { A: RED, B: WHITE }, days: 28, daysFrom: 'sow', harvestDays: 10, spacingIn: 3,
  hardiness: 'hardy',
  windows: { direct: [-7, -2], fall: [-9, -5] },
  succession: 10,
  companions: ['lettuce', 'pea', 'carrot', 'spinach', 'cucumber'],
  aliases: ['radish', 'radishes', 'mixed radish', 'french breakfast', 'cherry belle',
    'easter egg radish', 'spring radish'],
  notes: 'Owner rule: spring (March) and fall (September) ONLY — never summer. 2026: sown 4/20, all ' +
    '25–30 bolted in May heat. Direct sow early–mid March (late Feb under a cold frame); DO NOT sow ' +
    'after April 1. Fall: around Labor Day (8/20 sowing worked). Shade cloth extends spring.',
});
crop('daikon', 'Daikon Radish', 'roots', 'brassica', 'radish', {
  tint: { A: WHITE, B: GREEN }, days: 60, daysFrom: 'sow', harvestDays: 30, spacingIn: 6,
  hardiness: 'hardy',
  windows: { fall: [-11, -7] },
  companions: ['lettuce', 'carrot'],
  aliases: ['daikon', 'winter radish', 'watermelon radish', 'korean radish', 'mooli'],
  notes: 'Fall-only (spring sowings bolt). On the 2027 try list: daikon and watermelon radish sown ' +
    'mid-August.',
});
crop('carrot', 'Carrot', 'roots', 'umbellifer', 'carrot', {
  tint: { A: ORANGE, B: GREEN }, days: 70, daysFrom: 'sow', harvestDays: 45, spacingIn: 3,
  hardiness: 'hardy',
  windows: { direct: [-4, 12], fall: [-14, -9] },
  succession: 21,
  companions: ['onion', 'leeks', 'chives', 'radish_mixed', 'lettuce', 'pea', 'rosemary', 'sage'],
  avoid: ['dill', 'fennel'],
  aliases: ['carrots', 'nantes', 'danvers', 'scarlet nantes'],
  notes: 'Taproot — direct sow only. Keep the seedbed moist for 2 weeks (board or burlap). ' +
    'Carrot rust fly: row cover. Fall carrots sweeten after frost and hold in the ground.',
});
variety('carrot', 'cosmic_purple_carrot', 'Cosmic Purple Carrot', {
  tint: { A: PURPLE, B: ORANGE }, days: 70,
  aliases: ['cosmic purple', 'purple carrot'],
  notes: 'Purple skin, orange core. Owner fall-sowed 8/21 → harvest late Oct/Nov.',
});
crop('beet', 'Beet', 'roots', 'amaranth', 'beet', {
  tint: { A: RED, B: GREEN }, days: 60, daysFrom: 'sow', harvestDays: 30, spacingIn: 4,
  hardiness: 'hardy',
  windows: { direct: [-4, 12], fall: [-14, -9] },
  succession: 21,
  companions: ['onion', 'lettuce', 'kohlrabi', 'family:brassica'],
  avoid: ['pole_bean'],
  aliases: ['beets', 'beetroot', 'detroit dark red'],
  notes: 'Each "seed" is a cluster — thin to one. Greens are edible. Sow spring through mid-summer; ' +
    'a late-July sowing gives fall roots.',
});
variety('beet', 'red_beets', 'Red Beets', {
  tint: { A: RED, B: GREEN },
  aliases: ['red beet'],
});
variety('beet', 'golden_beets', 'Golden Beets', {
  tint: { A: YELLOW, B: GREEN }, days: 70,
  aliases: ['golden beet', 'gold beet', 'yellow beet', 'touchstone gold', 'burpee golden'],
  notes: 'Lower germination than red beets — sow thicker. Doesn\'t bleed.',
});
variety('beet', 'chioggia_beet', 'Chioggia Beet', {
  tint: { A: PINK, B: WHITE }, days: 55,
  aliases: ['chioggia', 'candy stripe beet', 'candy cane beet', 'bassano'],
  notes: 'Candy-striped Italian heirloom.',
});
crop('turnip', 'Turnip', 'roots', 'brassica', 'turnip', {
  tint: { A: WHITE, B: PURPLE }, days: 50, daysFrom: 'sow', harvestDays: 21, spacingIn: 4,
  hardiness: 'hardy',
  windows: { direct: [-4, 2], fall: [-14, -8] },
  succession: 21,
  companions: ['pea', 'onion'],
  aliases: ['turnips', 'turnip greens', 'hakurei'],
  notes: 'Spring and fall. Pull at 2–3" for tender roots. 7/22 sowing into the old broccoli spot.',
});
crop('rutabaga', 'Rutabaga', 'roots', 'brassica', 'turnip', {
  tint: { A: YELLOW, B: PURPLE }, days: 90, daysFrom: 'sow', harvestDays: 60, spacingIn: 6,
  hardiness: 'hardy',
  windows: { direct: [6, 11] },
  companions: ['pea', 'onion'],
  aliases: ['rutabagas', 'swede', 'swedes', 'neep'],
  notes: 'Wants cool weather to finish and sweetens after a light frost — sow June–early July for an ' +
    'October harvest (the 5/15 sowing was early). Can hold in the ground into winter.',
});
crop('parsnip', 'Parsnip', 'roots', 'umbellifer', 'carrot', {
  tint: { A: CREAM, B: GREEN }, days: 120, daysFrom: 'sow', harvestDays: 90, spacingIn: 4,
  hardiness: 'hardy',
  windows: { direct: [-3, 6] },
  companions: ['onion', 'radish_mixed'],
  avoid: ['fennel'],
  aliases: ['parsnips'],
  notes: 'Slow (up to 3 weeks) to germinate — always fresh seed. Leave in the ground; frost turns ' +
    'starch to sugar. Dig through winter.',
});
crop('potato', 'Potato', 'roots', 'solanaceae', 'potato', {
  tint: { A: BROWN, B: GREEN }, days: 90, daysFrom: 'sow', harvestDays: 30, spacingIn: 12,
  hardiness: 'half-hardy',
  windows: { direct: [-4, 4] },
  companions: ['bush_bean', 'marigold', 'corn', 'cabbage'],
  avoid: ['tomato', 'family:cucurbit', 'raspberry', 'sunflower'],
  aliases: ['potatoes', 'spud', 'spuds', 'seed potato', 'new potato'],
  notes: 'Grow bags work well: back-fill/hill 3× as it grows. New potatoes at flowering; main crop ' +
    'when tops die back (then cure 2 weeks). Don\'t follow tomatoes/peppers (blight, same family).',
});
crop('sweet_potato', 'Sweet Potato', 'roots', 'other', 'potato', {
  tint: { A: ORANGE, B: PURPLE }, days: 100, daysFrom: 'transplant', harvestDays: 21, spacingIn: 12,
  hardiness: 'tender',
  windows: { transplant: [6, 9] },
  aliases: ['sweet potatoes', 'yam', 'yams', 'ipomoea batatas'],
  notes: 'Marginal in Portland — needs ~100 warm days and soil above 65°F. Plant slips late May–June ' +
    'in the hottest spot, black fabric pots or black plastic; short-season varieties (Georgia Jet, ' +
    'Covington, Beauregard). Dig before soil drops under ~55°F (late Sep–early Oct) or when tops die ' +
    'back; cure warm 7–10 days. Owner is growing orange, purple and Japanese types.',
});

// ---- Alliums ----------------------------------------------------------------------------
const ALLIUM_COMPANIONS = ['carrot', 'beet', 'lettuce', 'tomato', 'pepper', 'chamomile', 'family:brassica'];
crop('onion', 'Onion', 'alliums', 'allium', 'onion', {
  tint: { A: YELLOW, B: GREEN }, days: 100, daysFrom: 'transplant', harvestDays: 30, spacingIn: 4,
  hardiness: 'hardy',
  windows: { indoors: [-13, -9], transplant: [-4, 0], direct: [-5, -1], fall: [-9, -7] },
  companions: ALLIUM_COMPANIONS,
  avoid: ['family:legume'],
  aliases: ['onions', 'bulb onion', 'storage onion', 'onion sets', 'walla walla', 'red onion',
    'yellow onion'],
  notes: 'PDX needs long-day varieties. Start from seed Jan–Feb or plant sets in March. Walla Walla ' +
    'can be sown late August to overwinter. Harvest when tops flop; cure 2–3 weeks.',
});
crop('green_onion', 'Green Onion', 'alliums', 'allium', 'onion', {
  tint: { A: LIME, B: WHITE }, days: 60, daysFrom: 'sow', harvestDays: 30, spacingIn: 2,
  hardiness: 'hardy',
  windows: { direct: [-6, 14], fall: [-10, -6] },
  succession: 21,
  companions: ALLIUM_COMPANIONS,
  avoid: ['family:legume'],
  aliases: ['green onions', 'scallion', 'scallions', 'spring onion', 'bunching onion', 'welsh onion'],
  notes: 'Owner 2027 idea: green onion sets — quick and easy, fill gaps between crops.',
});
crop('leeks', 'Leeks', 'alliums', 'allium', 'leek', {
  tint: { A: GREEN, B: WHITE }, days: 100, daysFrom: 'transplant', harvestDays: 120, spacingIn: 4,
  hardiness: 'hardy',
  windows: { indoors: [-12, -8], transplant: [-2, 6], direct: [-3, 4] },
  companions: ALLIUM_COMPANIONS,
  avoid: ['family:legume'],
  aliases: ['leek'],
  notes: 'Hill or trench for long white shanks. Stands in the bed all winter in PDX — harvest as ' +
    'needed Sept–March. Direct-sown 5/10 in 2026 (~120 days).',
});
crop('garlic', 'Garlic', 'alliums', 'allium', 'garlic', {
  tint: { A: WHITE, B: PURPLE }, days: 240, daysFrom: 'sow', harvestDays: 14, spacingIn: 5,
  hardiness: 'hardy',
  windows: { fall: [-3, 3] },
  companions: ['tomato', 'carrot', 'beet', 'strawberry', 'family:brassica'],
  avoid: ['family:legume'],
  aliases: ['garlics', 'hardneck garlic', 'softneck garlic', 'garlic bulbs'],
  notes: 'Owner 2027 plan: plant cloves October/November, harvest next July when ~half the leaves ' +
    'are brown. Cut hardneck scapes in June. Cure 3–4 weeks. Stop watering in late June.',
});
crop('chives', 'Chives', 'herbs', 'allium', 'onion', {
  tint: { A: GREEN, B: PURPLE }, days: 60, daysFrom: 'sow', harvestDays: 180, spacingIn: 6,
  hardiness: 'hardy', perennial: true,
  windows: { indoors: [-10, -6], transplant: [-3, 4], direct: [-4, 2] },
  companions: ['carrot', 'tomato', 'strawberry', 'family:brassica'],
  avoid: ['family:legume'],
  aliases: ['chive', 'common chives', 'onion chives'],
  notes: 'Perennial clump; cut to 2" and it regrows. Divide every 3 years. Purple flowers are edible ' +
    'and pull in bees.',
});
crop('garlic_chives', 'Garlic Chives', 'herbs', 'allium', 'onion', {
  tint: { A: DKGREEN, B: WHITE }, days: 70, daysFrom: 'sow', harvestDays: 180, spacingIn: 6,
  hardiness: 'hardy', perennial: true,
  windows: { indoors: [-10, -6], transplant: [-3, 4], direct: [-4, 2] },
  companions: ['carrot', 'tomato', 'family:brassica'],
  avoid: ['family:legume'],
  aliases: ['chinese chives', 'chinese leek', 'nira', 'garlic chive'],
  notes: 'Flat-leaf perennial with white late-summer flowers. Deadhead — it self-seeds aggressively.',
});

// ---- Tomatoes ---------------------------------------------------------------------------
crop('tomato', 'Tomato', 'tomatoes', 'solanaceae', 'tomato', {
  tint: { A: RED, B: GREEN }, days: 75, daysFrom: 'transplant', harvestDays: 70, spacingIn: 18,
  hardiness: 'tender',
  windows: { indoors: [-10, -6], transplant: [3, 6] },
  companions: ['basil', 'marigold', 'nasturtium', 'borage', 'carrot', 'chives', 'garlic', 'onion'],
  avoid: ['fennel', 'potato', 'corn', 'dill'],
  aliases: ['tomatoes', 'slicing tomato', 'slicer', 'rosso'],
  notes: 'Owner rule: start indoors in February on the heating pad (75–85°F soil), 8–10 weeks before ' +
    'transplant — 2026\'s 5/22 sowing was way late. Hottest south-facing spot; PDX "warm" is still ' +
    'borderline. Grow Big (6-4-4) until flowers, then Tiger Bloom (2-8-4). Prune/remove new flowers ' +
    'after mid-August so fruit ripens before the late-blight rains. Don\'t follow potatoes.',
});
variety('tomato', 'cherry_tomato', 'Cherry Tomato', {
  days: 65, spacingIn: 18,
  aliases: ['cherry tomatoes', 'sungold', 'sun gold', 'sweet 100', 'grape tomato'],
  notes: 'The most reliable tomatoes in cool PDX summers.',
});
variety('tomato', 'black_krim', 'Black Krim', {
  tint: { A: PLUM, B: RED }, days: 80,
  aliases: ['black krim tomato', 'krim'],
  notes: 'Dark Crimean beefsteak; cracks with uneven watering.',
});
variety('tomato', 'san_marzano', 'San Marzano', {
  tint: { A: RED, B: DKGREEN }, days: 80,
  aliases: ['san marzano tomato'],
  notes: 'Paste tomato; prone to blossom-end rot — keep watering even.',
});
variety('tomato', 'cherokee_purple', 'Cherokee Purple', {
  tint: { A: RED, B: PLUM }, days: 80,
  aliases: ['purple cherokee', 'cherokee purple tomato'],
  notes: 'Dusky-rose heirloom beefsteak.',
});
variety('tomato', 'chocolate_cherry', 'Chocolate Cherry', {
  tint: { A: BROWN, B: RED }, days: 70,
  aliases: ['choco cherry', 'chocolate cherry tomato'],
});
variety('tomato', 'green_zebra', 'Green Zebra', {
  tint: { A: LIME, B: DKGREEN }, days: 78,
  aliases: ['green zebra tomato'],
  notes: 'Ripe when it turns yellow-green and slightly soft.',
});
variety('tomato', 'valencia', 'Valencia', {
  tint: { A: ORANGE, B: YELLOW }, days: 76,
  aliases: ['valencia tomato'],
  notes: 'Orange heirloom from Maine — handles cool summers.',
});
variety('tomato', 'yellow_pear', 'Yellow Pear', {
  tint: { A: YELLOW, B: GREEN }, days: 70,
  aliases: ['yellow pear tomato', 'pear tomato'],
});
variety('tomato', 'midnight_snack', 'Midnight Snack', {
  tint: { A: NAVY, B: RED }, days: 70,
  aliases: ['midnight snack tomato', 'indigo cherry'],
  notes: 'Indigo cherry: ripe when the green parts turn red under the purple.',
});

// ---- Peppers & eggplant -----------------------------------------------------------------
crop('pepper', 'Pepper', 'peppers', 'solanaceae', 'pepper', {
  tint: { A: RED, B: GREEN }, days: 80, daysFrom: 'transplant', harvestDays: 60, spacingIn: 12,
  hardiness: 'tender',
  windows: { indoors: [-13, -8], transplant: [4, 7] },
  companions: ['basil', 'onion', 'marigold', 'carrot', 'chives'],
  avoid: ['fennel'],
  aliases: ['peppers', 'chili', 'chile', 'chili pepper', 'chile pepper', 'capsicum', 'bell pepper'],
  notes: 'Owner rule: start indoors January/February on the heating pad (75–85°F), 8–10 weeks ' +
    'before transplant (2026 5/10 seedlings were late). Transplant once nights stay above 50°F ' +
    '(mid–late May). Sun is everything — hottest spot. Grow Big → Tiger Bloom at first flowers; ' +
    'half-strength feed in containers every 7–10 days.',
});
variety('pepper', 'habanero', 'Habanero', {
  tint: { A: ORANGE, B: GREEN }, days: 100,
  aliases: ['habaneros', 'habanero pepper'],
  notes: 'Slowest pepper — needs maximum heat; struggled in a fabric pot in 2026. Start in January.',
});
variety('pepper', 'cayenne', 'Cayenne', {
  tint: { A: RED, B: DKGREEN }, days: 90,
  aliases: ['cayenne pepper'],
});
variety('pepper', 'poblano', 'Poblano', {
  tint: { A: DKGREEN, B: RED }, days: 85,
  aliases: ['poblano pepper', 'ancho'],
});
variety('pepper', 'shishito', 'Shishito', {
  tint: { A: LIME, B: GREEN }, days: 70,
  aliases: ['shishitos', 'shishito pepper'],
  notes: 'Fastest pepper here; pick green and often.',
});
variety('pepper', 'cal_wonder', 'Cal Wonder Bell Pepper', {
  tint: { A: GREEN, B: RED }, days: 85,
  aliases: ['cal wonder', 'california wonder', 'cal wonder bell'],
  notes: 'Bells need the longest warm run to turn red in PDX; pick green if September turns wet.',
});
variety('pepper', 'serrano', 'Serrano', {
  tint: { A: GREEN, B: RED }, days: 90,
  aliases: ['serrano pepper', 'serranos'],
});
variety('pepper', 'hungarian_wax', 'Hungarian Hot Wax', {
  tint: { A: YELLOW, B: RED }, days: 80,
  aliases: ['hungarian wax', 'hot wax', 'hungarian wax pepper', 'hungarian hot wax pepper'],
  notes: 'One of the more cool-tolerant hot peppers.',
});
variety('pepper', 'banana_pepper', 'Banana Pepper', {
  tint: { A: YELLOW, B: GREEN }, days: 75,
  aliases: ['banana', 'sweet banana', 'sweet banana pepper'],
});
variety('pepper', 'anaheim', 'Anaheim', {
  tint: { A: GREEN, B: RED }, days: 85,
  aliases: ['anaheim pepper', 'new mexico chile'],
});
variety('pepper', 'jalapeno', 'Jalapeño', {
  tint: { A: DKGREEN, B: RED }, days: 85,
  aliases: ['jalapeno', 'jalapenos', 'jalapeno pepper'],
});
crop('eggplant', 'Eggplant', 'peppers', 'solanaceae', 'eggplant', {
  tint: { A: PLUM, B: GREEN }, days: 75, daysFrom: 'transplant', harvestDays: 60, spacingIn: 18,
  hardiness: 'tender',
  windows: { indoors: [-12, -8], transplant: [4, 7] },
  companions: ['basil', 'marigold', 'bush_bean'],
  avoid: ['fennel'],
  aliases: ['eggplants', 'aubergine', 'brinjal'],
  notes: 'Needs more heat than peppers — marginal in PDX. Black pot or wall-of-water, hottest ' +
    'spot. Flea beetles on young plants: row cover.',
});
variety('eggplant', 'snowy_eggplant', 'Snowy Eggplant', {
  tint: { A: WHITE, B: GREEN }, days: 65,
  aliases: ['snowy', 'snow eggplant', 'white eggplant'],
  notes: 'White, compact, early.',
});
crop('tomatillo', 'Tomatillo', 'other_veg', 'solanaceae', 'tomatillo', {
  tint: { A: LIME, B: GREEN }, days: 75, daysFrom: 'transplant', harvestDays: 60, spacingIn: 24,
  hardiness: 'tender',
  windows: { indoors: [-8, -5], transplant: [3, 6] },
  companions: ['basil', 'marigold', 'onion'],
  avoid: ['fennel'],
  aliases: ['tomatillos', 'husk tomato', 'mexican husk tomato'],
  notes: 'Owner: not self-pollinating — always plant at least 2, within a few feet. Harvest when ' +
    'the fruit fills and splits the husk. Sprawls — cage it.',
});

// ---- Squash, cucumbers, melons ----------------------------------------------------------
const CUCURBIT_COMPANIONS = ['nasturtium', 'marigold', 'borage', 'corn', 'bush_bean', 'radish_mixed'];
crop('cucumber', 'Cucumber', 'squash', 'cucurbit', 'cucumber', {
  tint: { A: GREEN, B: YELLOW }, days: 55, daysFrom: 'transplant', harvestDays: 45, spacingIn: 12,
  hardiness: 'tender',
  windows: { indoors: [-2, 3], transplant: [4, 8], direct: [5, 11] },
  companions: [...CUCURBIT_COMPANIONS, 'dill', 'lettuce', 'sunflower', 'pea'],
  avoid: ['potato', 'fennel', 'sage'],
  aliases: ['cucumbers', 'cuke', 'cukes', 'slicing cucumber'],
  notes: 'Owner: start indoors in April (peat pots, heating pad); 5/28 starts were fine. Trellis it. ' +
    'Fabric pots dry out FAST — daily water in July–Aug, mulch the top. Pick often or it stops. ' +
    'A 7/8 sowing is a late gamble.',
});
crop('cucamelon', 'Cucamelon', 'squash', 'cucurbit', 'cucumber', {
  tint: { A: LIME, B: DKGREEN }, days: 70, daysFrom: 'transplant', harvestDays: 60, spacingIn: 12,
  hardiness: 'tender',
  windows: { indoors: [-2, 2], transplant: [4, 7] },
  companions: CUCURBIT_COMPANIONS,
  avoid: ['potato', 'fennel'],
  aliases: ['mexican sour gherkin', 'mouse melon', 'mexican gherkin', 'sandita'],
  notes: 'Owner 2027 try list: grape-sized cucumber-melon on a ferny vine. Needs a trellis and a long ' +
    'warm season — start indoors ~April.',
});
crop('zucchini', 'Zucchini', 'squash', 'cucurbit', 'zucchini', {
  tint: { A: DKGREEN, B: YELLOW }, days: 50, daysFrom: 'transplant', harvestDays: 70, spacingIn: 24,
  hardiness: 'tender',
  windows: { indoors: [-3, 2], transplant: [3, 7], direct: [4, 9] },
  companions: CUCURBIT_COMPANIONS,
  avoid: ['potato', 'fennel'],
  aliases: ['zucchinis', 'summer squash', 'courgette', 'squash', 'zuke'],
  notes: 'Pick at 6–8". Powdery mildew is certain by late August in PDX — remove worst leaves, ' +
    'good airflow. One or two plants is plenty.',
});
variety('zucchini', 'patio_yellow', 'Patio Yellow', {
  tint: { A: YELLOW, B: GREEN }, spacingIn: 18,
  aliases: ['patio yellow zucchini', 'patio star yellow'],
  notes: 'Compact bush yellow zucchini — fits containers.',
});
variety('zucchini', 'magda', 'Magda', {
  tint: { A: LIME, B: GREEN },
  aliases: ['magda zucchini', 'magda squash', 'cousa', 'kousa', 'middle eastern squash'],
  notes: 'Pale-green Middle-Eastern cousa type; nutty, great stuffed.',
});
variety('zucchini', 'tromboncino', 'Tromboncino', {
  tint: { A: LIME, B: ORANGE }, days: 60, spacingIn: 18,
  aliases: ['zucchetta', 'zucchetta rampicante', 'trombetta', 'tromboncino squash', 'climbing squash'],
  notes: 'Owner: 2026 keeper, grow again. C. moschata — climbs, so trellis it (keeps fruit straight ' +
    'and clean) and it shrugs off mildew better than zucchini. Eat young as summer squash, or let one ' +
    'mature into a butternut-like winter squash — the long neck is solid seedless flesh.',
});
crop('winter_squash', 'Winter Squash', 'squash', 'cucurbit', 'squash', {
  tint: { A: ORANGE, B: DKGREEN }, days: 90, daysFrom: 'transplant', harvestDays: 30, spacingIn: 36,
  hardiness: 'tender',
  windows: { indoors: [-2, 2], transplant: [4, 7], direct: [5, 8] },
  companions: CUCURBIT_COMPANIONS,
  avoid: ['potato', 'fennel'],
  aliases: ['hard squash', 'acorn squash', 'acorn', 'kabocha', 'hubbard'],
  notes: 'Needs 3×3 ft per vine (or a sturdy trellis + slings). Harvest before the heavy October rains ' +
    'when the rind resists a fingernail and the stem is corky; cure 1–2 weeks somewhere warm.',
});
variety('winter_squash', 'spaghetti_squash', 'Spaghetti Squash', {
  tint: { A: YELLOW, B: CREAM }, days: 90,
  aliases: ['spaghetti', 'vegetable spaghetti'],
});
variety('winter_squash', 'butternut', 'Butternut', {
  tint: { A: CREAM, B: ORANGE }, days: 100,
  aliases: ['butternut squash', 'waltham butternut'],
  notes: 'Longest season of the owner\'s four — give it the hottest spot.',
});
variety('winter_squash', 'delicata', 'Delicata', {
  tint: { A: CREAM, B: DKGREEN }, days: 85,
  aliases: ['delicata squash'],
  notes: 'Edible skin; stores ~3 months.',
});
variety('winter_squash', 'buttercup', 'Buttercup', {
  tint: { A: DKGREEN, B: ORANGE }, days: 95,
  aliases: ['buttercup squash', 'burgess buttercup'],
});
crop('pumpkin', 'Pumpkin', 'squash', 'cucurbit', 'pumpkin', {
  tint: { A: ORANGE, B: DKGREEN }, days: 100, daysFrom: 'transplant', harvestDays: 30, spacingIn: 36,
  hardiness: 'tender',
  windows: { indoors: [-2, 1], transplant: [4, 7], direct: [4, 7] },
  companions: CUCURBIT_COMPANIONS,
  avoid: ['potato', 'fennel'],
  aliases: ['pumpkins', 'pie pumpkin', 'jack o lantern'],
  notes: 'Start by late April for October fruit. Volunteers from compost are cross-pollinated — ' +
    'fruit is a surprise.',
});
crop('melon', 'Melon', 'melons', 'cucurbit', 'melon', {
  tint: { A: YELLOW, B: ORANGE }, days: 85, daysFrom: 'transplant', harvestDays: 21, spacingIn: 24,
  hardiness: 'tender',
  windows: { indoors: [-2, 2], transplant: [5, 8] },
  companions: CUCURBIT_COMPANIONS,
  avoid: ['potato', 'fennel'],
  aliases: ['melons', 'cantaloupe', 'muskmelon', 'honeydew'],
  notes: 'Owner: start indoors in April on the heating pad; transplant late May/early June once soil ' +
    'is warm (5/31 in 2026). Short-season varieties only in PDX. Black plastic/fabric pots add heat. ' +
    'Ease off water as fruit ripens for sweetness.',
});
crop('watermelon', 'Watermelon', 'melons', 'cucurbit', 'watermelon', {
  tint: { A: DKGREEN, B: RED }, days: 85, daysFrom: 'transplant', harvestDays: 21, spacingIn: 24,
  hardiness: 'tender',
  windows: { indoors: [-2, 2], transplant: [5, 8] },
  companions: CUCURBIT_COMPANIONS,
  avoid: ['potato', 'fennel'],
  aliases: ['watermelons', 'water melon'],
  notes: 'Ripe when the tendril nearest the fruit browns and the ground spot turns creamy yellow. ' +
    'Stick to small, early types in PDX.',
});
variety('watermelon', 'blacktail_watermelon', 'Blacktail Mountain Watermelon', {
  tint: { A: INK, B: RED }, days: 75,
  aliases: ['blacktail mountain', 'blacktail', 'blacktail mountain melon'],
  notes: 'Bred in north Idaho for short cool seasons — the best watermelon bet for PDX.',
});
variety('watermelon', 'sugar_melon', 'Sugar Baby Watermelon', {
  tint: { A: DKGREEN, B: RED }, days: 80,
  aliases: ['sugar melon', 'sugar baby', 'sugar baby melon'],
  notes: 'v1 palette called this "Sugar Melon"; the garden DB confirms Sugar Baby (small icebox watermelon).',
});
variety('melon', 'sugar_cube_melon', 'Sugar Cube Melon', {
  tint: { A: CREAM, B: ORANGE }, days: 80,
  aliases: ['sugar cube', 'sugar cube cantaloupe'],
  notes: 'Compact, disease-resistant personal cantaloupe; slips off the vine when ripe.',
});
variety('melon', 'tigger_melon', 'Tigger Melon', {
  tint: { A: YELLOW, B: RED }, days: 85,
  aliases: ['tigger'],
  notes: 'Armenian heirloom with yellow/red zig-zag stripes; ripe when fragrant.',
});

// ---- Other vegetables -------------------------------------------------------------------
crop('corn', 'Sweet Corn', 'other_veg', 'other', 'corn', {
  tint: { A: YELLOW, B: GREEN }, days: 80, daysFrom: 'sow', harvestDays: 14, spacingIn: 12,
  hardiness: 'tender',
  windows: { direct: [4, 8] },
  companions: ['bush_bean', 'pole_bean', 'winter_squash', 'zucchini', 'pumpkin', 'cucumber', 'melon', 'pea'],
  avoid: ['tomato'],
  aliases: ['sweet corn', 'maize', 'corn on the cob'],
  notes: 'Owner 2027 idea: plant in a BLOCK (min 3×3, never a single row) for wind pollination. Heavy ' +
    'feeder, full sun, lots of space and water. Early varieties for PDX; soil ≥60°F.',
});
crop('celery', 'Celery', 'other_veg', 'umbellifer', 'leafy', {
  tint: { A: LIME, B: GREEN }, days: 100, daysFrom: 'transplant', harvestDays: 60, spacingIn: 8,
  hardiness: 'half-hardy',
  windows: { indoors: [-12, -9], transplant: [1, 4] },
  companions: ['family:brassica', 'bush_bean', 'leeks', 'tomato'],
  avoid: ['fennel'],
  aliases: ['celeries', 'celery stalk'],
  notes: 'Very thirsty — PDX\'s dry summers mean drip + mulch or it goes stringy and bitter. Cold ' +
    'snaps on young transplants cause bolting; wait until after last frost.',
});
crop('rhubarb', 'Rhubarb', 'other_veg', 'other', 'chard', {
  tint: { A: RED, B: GREEN }, harvestDays: 60, spacingIn: 36, daysFrom: 'transplant',
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-8, -2] },
  aliases: ['pie plant', 'rhubarb crown'],
  notes: 'Perennial: plant crowns late winter. No harvest year 1, light year 2. Pull stalks April–June; ' +
    'leaves are toxic. Remove flower stalks.',
});
crop('asparagus', 'Asparagus', 'other_veg', 'other', 'leek', {
  tint: { A: GREEN, B: PURPLE }, harvestDays: 45, spacingIn: 18, daysFrom: 'transplant',
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-6, -1] },
  companions: ['tomato', 'parsley'],
  avoid: ['family:allium'],
  aliases: ['asparagus crowns', 'sparrowgrass'],
  notes: 'Perennial bed for 20 years: plant crowns in a trench in March. Harvest from year 3, ' +
    'spears for ~6 weeks, then let the ferns grow.',
});

// ---- Herbs ------------------------------------------------------------------------------
crop('basil', 'Basil', 'herbs', 'lamiaceae', 'basil', {
  tint: { A: GREEN, B: LIME }, days: 40, daysFrom: 'sow', harvestDays: 60, spacingIn: 8,
  hardiness: 'tender',
  windows: { indoors: [-4, -1], transplant: [3, 8], direct: [4, 16] },
  succession: 25,
  companions: ['tomato', 'pepper', 'eggplant', 'tomatillo', 'lettuce'],
  aliases: ['sweet basil', 'genovese', 'genovese basil', 'basils'],
  notes: 'Owner rule: succession every 3–4 weeks, May through August. Start indoors in April, direct ' +
    'sow once soil is warm. Thin to 6–8" (eat the thinnings). Pinch flower buds immediately and ' +
    'constantly — it keeps producing; flowering turns leaves bitter. First to die in a cold snap.',
});
crop('cilantro', 'Cilantro', 'herbs', 'umbellifer', 'parsley', {
  tint: { A: LIME, B: WHITE }, days: 30, daysFrom: 'sow', harvestDays: 21, spacingIn: 4,
  hardiness: 'half-hardy',
  windows: { direct: [-5, 16], fall: [-10, -5] },
  succession: 18,
  companions: ['spinach', 'tomato', 'pepper'],
  avoid: ['fennel'],
  aliases: ['coriander', 'chinese parsley', 'cilantros'],
  notes: 'Owner rule: bolts FAST in heat — succession sow every 2–3 weeks, March/April through fall; ' +
    'each summer batch lasts only 3–4 weeks. Use slow-bolt varieties (Calypso, Santo). 2026 mid-May ' +
    'sowing bolted by June. Taproot — direct sow. Fall sowing 8/21 in Bed 2.',
});
crop('dill', 'Dill', 'herbs', 'umbellifer', 'dill', {
  tint: { A: GREEN, B: YELLOW }, days: 40, daysFrom: 'sow', harvestDays: 30, spacingIn: 9,
  hardiness: 'half-hardy',
  windows: { direct: [-2, 14] },
  succession: 21,
  companions: ['family:brassica', 'cucumber', 'lettuce', 'onion'],
  avoid: ['carrot', 'tomato', 'fennel'],
  aliases: ['dill weed', 'dillweed', 'fernleaf dill'],
  notes: 'Taproot — direct sow only, spring through August. Flowers feed beneficial wasps. ' +
    'Self-seeds.',
});
crop('fennel', 'Fennel', 'herbs', 'umbellifer', 'dill', {
  tint: { A: LIME, B: CREAM }, days: 80, daysFrom: 'sow', harvestDays: 30, spacingIn: 10,
  hardiness: 'half-hardy',
  windows: { direct: [-2, 2], fall: [-11, -8] },
  avoid: ['family:solanaceae', 'family:legume', 'family:brassica', 'family:cucurbit', 'dill',
    'cilantro', 'carrot', 'parsnip', 'celery'],
  aliases: ['florence fennel', 'bulb fennel', 'finocchio', 'fennel bulb', 'bronze fennel'],
  notes: 'Allelopathic — inhibits most neighbours; give it its own corner or pot. Cross-pollinates ' +
    'with dill. Spring sowings bolt; the late-August sowing (owner, 8/21) bulbs up in fall.',
});
crop('parsley', 'Parsley', 'herbs', 'umbellifer', 'parsley', {
  tint: { A: GREEN, B: DKGREEN }, days: 75, daysFrom: 'sow', harvestDays: 180, spacingIn: 8,
  hardiness: 'hardy',
  windows: { indoors: [-10, -6], transplant: [-2, 4], direct: [-4, 2] },
  companions: ['tomato', 'asparagus', 'carrot'],
  aliases: ['parsleys'],
  notes: 'Soak seed overnight; germination takes up to 3 weeks. Biennial: overwinters in PDX, then ' +
    'bolts its second spring. Host plant for swallowtail caterpillars.',
});
variety('parsley', 'flat_parsley', 'Flat Parsley', {
  tint: { A: GREEN, B: DKGREEN },
  aliases: ['flat leaf parsley', 'flat-leaf parsley', 'italian parsley', 'italian flat leaf parsley'],
});
variety('parsley', 'curly_parsley', 'Curly Parsley', {
  tint: { A: LIME, B: GREEN },
  aliases: ['curled parsley', 'moss curled parsley'],
});
crop('thyme', 'Thyme', 'herbs', 'lamiaceae', 'herb', {
  tint: { A: GREEN, B: SILVER }, days: 45, daysFrom: 'transplant', harvestDays: 200, spacingIn: 12,
  hardiness: 'hardy', perennial: true,
  windows: { indoors: [-10, -6], transplant: [-2, 8], fall: [-8, -4] },
  companions: ['family:brassica', 'strawberry', 'tomato'],
  aliases: ['thymes'],
  notes: 'Perennial. Lean, sharp-draining soil — soggy PDX winters kill more thyme than cold does. ' +
    'Drought tolerant once established. Shear lightly after flowering; replace woody plants every ' +
    '3–4 years.',
});
variety('thyme', 'english_thyme', 'English Thyme', {
  aliases: ['common thyme', 'thymus vulgaris', 'french thyme'],
});
variety('thyme', 'lemon_thyme', 'Lemon Thyme', {
  tint: { A: LIME, B: YELLOW },
  aliases: ['thymus citriodorus'],
});
variety('thyme', 'lime_thyme', 'Lime Thyme', {
  tint: { A: LIME, B: GREEN },
  aliases: [],
  notes: 'Low, spreading, citrus-scented; good edging.',
});
crop('oregano', 'Oregano', 'herbs', 'lamiaceae', 'herb', {
  tint: { A: DKGREEN, B: PINK }, days: 45, daysFrom: 'transplant', harvestDays: 200, spacingIn: 12,
  hardiness: 'hardy', perennial: true,
  windows: { indoors: [-10, -6], transplant: [-2, 8], fall: [-8, -4] },
  companions: ['family:brassica', 'family:cucurbit', 'tomato', 'pepper'],
  aliases: ['greek oregano', 'italian oregano', 'origanum'],
  notes: 'Perennial, spreads. Best flavor just before flowering; cut back hard mid-summer for fresh ' +
    'growth. Drought tolerant.',
});
variety('oregano', 'hot_spicy_oregano', 'Hot & Spicy Oregano', {
  tint: { A: DKGREEN, B: PURPLE },
  aliases: ['hot and spicy oregano', 'hot n spicy oregano', 'spicy oregano'],
  notes: 'Extra-pungent Mexican-style oregano; slightly less cold hardy — sharp drainage.',
});
crop('rosemary', 'Rosemary', 'herbs', 'lamiaceae', 'rosemary', {
  tint: { A: DKGREEN, B: BLUE }, days: 60, daysFrom: 'transplant', harvestDays: 300, spacingIn: 24,
  hardiness: 'half-hardy', perennial: true,
  windows: { transplant: [1, 8], fall: [-8, -4] },
  companions: ['carrot', 'sage', 'bush_bean', 'family:brassica'],
  aliases: ['rosmarinus', 'salvia rosmarinus'],
  notes: 'Perennial shrub in 8b if it drains: pick hardy cultivars (Arp, Madeline Hill) and avoid ' +
    'winter-wet clay. Don\'t overwater pots. Never cut into bare old wood.',
});
crop('sage', 'Sage', 'herbs', 'lamiaceae', 'herb', {
  tint: { A: SILVER, B: GREEN }, days: 60, daysFrom: 'transplant', harvestDays: 250, spacingIn: 18,
  hardiness: 'hardy', perennial: true,
  windows: { indoors: [-10, -6], transplant: [-2, 8], fall: [-8, -4] },
  companions: ['rosemary', 'carrot', 'family:brassica'],
  avoid: ['cucumber'],
  aliases: ['garden sage', 'common sage', 'culinary sage', 'salvia officinalis'],
  notes: 'Perennial; prune by a third in spring. Gets woody after ~4 years — replace. Drainage matters.',
});
crop('mint', 'Mint', 'herbs', 'lamiaceae', 'herb', {
  tint: { A: GREEN, B: LIME }, days: 30, daysFrom: 'transplant', harvestDays: 200, spacingIn: 18,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-2, 8] },
  companions: ['family:brassica', 'tomato'],
  aliases: ['mints', 'spearmint', 'peppermint', 'mojito mint', 'chocolate mint', 'mentha'],
  notes: 'Invasive — containers only, never loose in a raised bed. Loves PDX moisture; tolerates shade.',
});
crop('chamomile', 'Chamomile', 'herbs', 'aster', 'flower', {
  tint: { A: WHITE, B: YELLOW }, days: 60, daysFrom: 'sow', harvestDays: 60, spacingIn: 8,
  hardiness: 'hardy',
  windows: { direct: [-4, 13] },
  companions: ['family:brassica', 'onion', 'cucumber'],
  aliases: ['german chamomile', 'roman chamomile', 'camomile', 'matricaria'],
  notes: 'Surface-sow (needs light). Harvest flowers fully open for tea. Self-seeds. Owner sowed 7/8.',
});
crop('borage', 'Borage', 'herbs', 'other', 'flower', {
  tint: { A: BLUE, B: WHITE }, days: 50, daysFrom: 'sow', harvestDays: 90, spacingIn: 18,
  hardiness: 'half-hardy',
  windows: { direct: [-2, 8] },
  companions: ['tomato', 'strawberry', 'family:cucurbit'],
  aliases: ['starflower', 'borago'],
  notes: 'Pollinator magnet — bees love it. Edible blue flowers. Self-seeds hard; pull extras.',
});
crop('lavender', 'Lavender', 'herbs', 'lamiaceae', 'herb', {
  tint: { A: PURPLE, B: SILVER }, daysFrom: 'transplant', harvestDays: 45, spacingIn: 24,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [0, 8], fall: [-8, -4] },
  companions: ['rosemary', 'family:brassica'],
  aliases: ['english lavender', 'lavandula', 'hidcote', 'munstead'],
  notes: 'English types handle wet PDX winters best. Sharp drainage, no fertilizer. Prune after bloom, ' +
    'never into old wood.',
});

// ---- Fruit & berries --------------------------------------------------------------------
crop('strawberry', 'Strawberry', 'fruit', 'rosaceae', 'strawberry', {
  tint: { A: RED, B: GREEN }, days: 90, daysFrom: 'transplant', harvestDays: 30, spacingIn: 12,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-6, 2], fall: [-8, -4] },
  companions: ['borage', 'spinach', 'lettuce', 'bush_bean', 'onion', 'thyme'],
  avoid: ['family:brassica'],
  aliases: ['strawberries', 'june bearing strawberry', 'everbearing strawberry',
    'day neutral strawberry', 'alpine strawberry'],
  notes: 'PNW classics: Hood and Shuksan (June-bearing), Seascape/Albion (day-neutral). Pinch first-' +
    'year flowers on June-bearers. Slugs + wet fruit rot: straw mulch. Renew beds every 3–4 years.',
});
crop('blueberry', 'Blueberry', 'fruit', 'ericaceae', 'blueberry', {
  tint: { A: BLUE, B: DKGREEN }, daysFrom: 'transplant', harvestDays: 45, spacingIn: 48,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-10, 2], fall: [-6, 2] },
  aliases: ['blueberries', 'blueberry bush', 'highbush blueberry'],
  notes: 'Acid soil pH 4.5–5.5 (sulfur, conifer-bark mulch, acid fertilizer). Plant 2+ varieties for ' +
    'better set. Net against birds. Keep evenly moist — containers dry out fast. Owner\'s: Bountiful ' +
    'Blue (compact, pot), Perpetua (reblooming), Earliblue, Cabernet Splash.',
});
crop('raspberry', 'Raspberry', 'fruit', 'rosaceae', 'raspberry', {
  tint: { A: RED, B: GREEN }, daysFrom: 'transplant', harvestDays: 30, spacingIn: 24,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-10, -2] },
  avoid: ['family:solanaceae'],
  aliases: ['raspberries', 'raspberry cane', 'summer raspberry'],
  notes: 'Summer-bearers (e.g. Meeker, the classic WA/OR berry) fruit on 2nd-year canes — cut spent ' +
    'canes to the ground after harvest. Needs drainage (root rot in wet clay). Keep away from ' +
    'nightshades (verticillium).',
});
variety('raspberry', 'fallgold_raspberry', 'Fallgold Raspberry', {
  tint: { A: YELLOW, B: GREEN },
  aliases: ['fallgold', 'fall gold raspberry', 'golden raspberry', 'yellow raspberry'],
  notes: 'Everbearing (primocane) golden raspberry: mow all canes in late winter for one big fall ' +
    'crop, or tip-prune for summer + fall crops.',
});
crop('blackberry', 'Blackberry', 'fruit', 'rosaceae', 'raspberry', {
  tint: { A: INK, B: PLUM }, daysFrom: 'transplant', harvestDays: 30, spacingIn: 48,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-10, -2] },
  avoid: ['family:solanaceae'],
  aliases: ['blackberries', 'marionberry', 'marionberries', 'thornless blackberry', 'boysenberry'],
  notes: 'Marionberry is Oregon\'s own. Trailing types need a trellis; cut floricanes after harvest. ' +
    'Never plant Himalayan blackberry (invasive).',
});
crop('ground_cherry', 'Ground Cherry', 'fruit', 'solanaceae', 'groundcherry', {
  tint: { A: YELLOW, B: CREAM }, days: 70, daysFrom: 'transplant', harvestDays: 60, spacingIn: 18,
  hardiness: 'tender',
  windows: { indoors: [-8, -5], transplant: [3, 7] },
  companions: ['basil', 'marigold'],
  avoid: ['fennel'],
  aliases: ['ground cherries', 'groundcherry', 'husk cherry', 'cape gooseberry', 'physalis',
    'aunt mollys'],
  notes: 'Fruit drops when ripe — collect from the ground and let husks dry. Owner grows them in ' +
    '5-gal fabric pots: daily water in summer, mulch the top. 2026: sown 5/10, out 6/14.',
});

// ---- Trees ------------------------------------------------------------------------------
crop('fig', 'Fig Tree', 'trees', 'moraceae', 'fig', {
  tint: { A: PLUM, B: GREEN }, daysFrom: 'transplant', harvestDays: 45, spacingIn: 96,
  hardiness: 'half-hardy', perennial: true,
  windows: { transplant: [-6, 4], fall: [-4, 2] },
  aliases: ['fig', 'figs', 'ficus carica'],
  notes: 'PNW figs: Desert King gives a reliable breba crop (July–Aug) — the main-season crop often ' +
    'doesn\'t ripen here, so don\'t prune off last year\'s wood. Violette de Bordeaux is compact and ' +
    'great in pots. Protect potted roots in hard freezes (move against the house / wrap).',
});
crop('asian_pear', 'Asian Pear', 'trees', 'rosaceae', 'tree', {
  tint: { A: YELLOW, B: GREEN }, daysFrom: 'transplant', harvestDays: 45, spacingIn: 144,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-10, -2], fall: [-4, 3] },
  aliases: ['asian pears', 'nashi', 'nashi pear', 'apple pear', 'pear', 'pear tree'],
  notes: 'Owner has a 5-graft tree (Shinseiki, Korean Giant, 20th Century, Hosui, Chojuro) — the ' +
    'grafts cross-pollinate. Thin to one fruit per cluster. Pear rust (orange leaf spots) comes from ' +
    'nearby junipers; fungicide in spring.',
});
crop('apple', 'Apple Tree', 'trees', 'rosaceae', 'tree', {
  tint: { A: RED, B: GREEN }, daysFrom: 'transplant', harvestDays: 45, spacingIn: 144,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-10, -2], fall: [-4, 3] },
  aliases: ['apple', 'apples', 'apple tree', 'columnar apple'],
  notes: 'Choose scab-resistant varieties for wet PDX springs (Liberty, Enterprise, Akane). ' +
    'Needs a pollinizer. Codling moth: bag fruit or traps.',
});

// ---- Flowers & ornamentals --------------------------------------------------------------
const PEST_CONFUSER = ['family:brassica', 'family:cucurbit', 'family:solanaceae', 'bush_bean'];
crop('nasturtium', 'Nasturtium', 'flowers', 'other', 'nasturtium', {
  tint: { A: ORANGE, B: GREEN }, days: 50, daysFrom: 'sow', harvestDays: 100, spacingIn: 12,
  hardiness: 'tender',
  windows: { direct: [1, 8] },
  companions: PEST_CONFUSER,
  aliases: ['nasturtiums', 'tropaeolum', 'indian cress'],
  notes: 'Owner: trap crop in almost every bed — pulls aphids off the veggies, edible flowers, zero ' +
    'maintenance. Scatter seed everywhere. Lean soil = more flowers.',
});
crop('marigold', 'Marigold', 'flowers', 'aster', 'marigold', {
  tint: { A: ORANGE, B: YELLOW }, days: 50, daysFrom: 'sow', harvestDays: 120, spacingIn: 8,
  hardiness: 'tender',
  windows: { indoors: [-6, -3], transplant: [2, 6], direct: [3, 7] },
  companions: PEST_CONFUSER,
  aliases: ['marigolds', 'french marigold', 'african marigold', 'tagetes'],
  notes: 'Owner: companion throughout veggie beds — deters pests. Went leafy in rich bed soil and was ' +
    'slow to flower — no extra nitrogen. Deadhead.',
});
crop('calendula', 'Calendula', 'flowers', 'aster', 'flower', {
  tint: { A: ORANGE, B: YELLOW }, days: 50, daysFrom: 'sow', harvestDays: 150, spacingIn: 9,
  hardiness: 'hardy',
  windows: { direct: [-4, 4], fall: [-8, -5] },
  companions: PEST_CONFUSER,
  aliases: ['pot marigold', 'calendulas'],
  notes: 'Cool-season annual; often blooms into winter in PDX. Edible petals. Self-seeds.',
});
crop('zinnia', 'Zinnia', 'flowers', 'aster', 'flower', {
  tint: { A: YELLOW, B: ORANGE }, days: 60, daysFrom: 'sow', harvestDays: 100, spacingIn: 9,
  hardiness: 'tender',
  windows: { indoors: [-4, -1], transplant: [3, 7], direct: [4, 8] },
  companions: ['family:solanaceae', 'family:cucurbit'],
  aliases: ['zinnias', 'pompom zinnia'],
  notes: 'Pollinator magnet (owner has a golden double pompom). Needs heat — don\'t rush it out. ' +
    'Cut-and-come-again; powdery mildew late summer.',
});
crop('sunflower', 'Sunflower', 'flowers', 'aster', 'sunflower', {
  tint: { A: YELLOW, B: BROWN }, days: 80, daysFrom: 'sow', harvestDays: 30, spacingIn: 12,
  hardiness: 'tender',
  windows: { direct: [1, 9] },
  companions: ['cucumber', 'corn'],
  avoid: ['potato'],
  aliases: ['sunflowers', 'helianthus', 'mammoth sunflower'],
  notes: 'Direct sow after last frost; slugs and birds take seedlings — cover. Stake giants. Hulls ' +
    'are mildly allelopathic.',
});
crop('cosmos', 'Cosmos', 'flowers', 'aster', 'flower', {
  tint: { A: PINK, B: YELLOW }, days: 60, daysFrom: 'sow', harvestDays: 100, spacingIn: 12,
  hardiness: 'tender',
  windows: { indoors: [-4, -1], direct: [2, 8] },
  aliases: ['cosmos bipinnatus', 'sensation cosmos'],
  notes: 'Easy, drought tolerant, pollinator favorite. Lean soil.',
});
crop('wildflower_mix', 'Wildflower Mix', 'flowers', 'other', 'flower', {
  tint: { A: BLUE, B: YELLOW }, days: 60, daysFrom: 'sow', harvestDays: 90, spacingIn: 6,
  hardiness: 'half-hardy',
  windows: { direct: [-6, 2], fall: [-6, 0] },
  aliases: ['wildflowers', 'wildflower', 'wildflower seed', 'pollinator mix', 'meadow mix'],
  notes: 'Scattered through the front-yard landscape. PNW native mixes do best sown in fall or very ' +
    'early spring; rake in lightly.',
});
crop('lupine', 'Lupine', 'flowers', 'legume', 'lupine', {
  tint: { A: PURPLE, B: BLUE }, daysFrom: 'transplant', harvestDays: 45, spacingIn: 18,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-4, 2], direct: [-6, -2], fall: [-6, 0] },
  aliases: ['lupines', 'lupin', 'lupinus'],
  notes: 'PNW native. Minimal supplemental water once established — overwatering causes root rot. ' +
    'Fixes its own nitrogen; hates rich soil and transplanting when large. Aphids on flower spikes.',
});
crop('delphinium_red_lark', "Delphinium 'Red Lark'", 'flowers', 'other', 'lupine', {
  tint: { A: RED, B: DKGREEN }, daysFrom: 'transplant', harvestDays: 45, spacingIn: 18,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-2, 4] },
  aliases: ['red lark', 'red lark delphinium', 'delphinium'],
  notes: 'Tall red spikes — stake. Wants pH 6.5–7.5 (lime Portland soil). Slugs love it: bait/DE ' +
    'early. Cut back after first flush for a second bloom.',
});
crop('calceolaria_kentish_hero', "Calceolaria 'Kentish Hero'", 'flowers', 'other', 'flower', {
  tint: { A: ORANGE, B: YELLOW }, daysFrom: 'transplant', harvestDays: 90, spacingIn: 12,
  hardiness: 'half-hardy', perennial: true,
  windows: { transplant: [0, 6] },
  aliases: ['kentish hero', 'kentish hero pocketbook flower', 'pocketbook flower', 'slipper flower',
    'calceolaria'],
  notes: 'Red-orange pouch flowers, bee and butterfly friendly. Part shade, moderate water; borderline ' +
    'hardy in 8b — mulch the crown in winter.',
});
crop('rose', 'Rose', 'flowers', 'rosaceae', 'shrub', {
  tint: { A: RED, B: DKGREEN }, daysFrom: 'transplant', harvestDays: 150, spacingIn: 36,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-10, -2], fall: [-6, 0] },
  companions: ['garlic', 'chives', 'marigold'],
  aliases: ['roses', 'rosa', 'rose bush', 'rosebush'],
  notes: 'Owner\'s roses have black spot: neem oil + remove affected leaves, water at the base in the ' +
    'morning, clean up fallen leaves. Choose disease-resistant varieties. Prune late Feb (Presidents\' Day).',
});

// ---- Dahlias ----------------------------------------------------------------------------
crop('dahlia', 'Dahlia', 'dahlias', 'aster', 'dahlia', {
  tint: { A: PINK, B: YELLOW }, days: 90, daysFrom: 'transplant', harvestDays: 100, spacingIn: 18,
  hardiness: 'tender', perennial: true,
  windows: { indoors: [-4, -1], transplant: [1, 5] },
  aliases: ['dahlias', 'dahlia tuber'],
  notes: 'Tender perennial tubers. Plant when soil is ~60°F (late April–May); don\'t water until ' +
    'shoots show (tubers rot). Then water 2–3×/week, deadhead, stake tall ones. Slugs on new shoots. ' +
    'After the first frost blackens foliage: dig and store tubers, or mulch heavily in Portland.',
});
const DAHLIAS = [
  ['dahlia_black_forest_ruby', 'Black Forest Ruby', RED, PLUM, 'Dark foliage, bright red blooms, 2–3 ft.'],
  ['dahlia_mystic_sparkler', 'Mystic Sparkler', RED, YELLOW, 'Dark foliage, showy red-and-yellow bicolor.'],
  ['dahlia_city_lights_purple', 'City Lights Purple', PURPLE, PLUM, 'Purple/magenta ball blooms, compact.'],
  ['dahlia_city_lights_lavender_pink', 'City Lights Lavender Pink', PINK, PURPLE, 'Lavender-pink ball blooms, compact.'],
  ['dahlia_mystic_dreamer', 'Mystic Dreamer', PINK, YELLOW, 'Soft pink single blooms, dark foliage.'],
  ['dahlia_mystic_wizard', 'Mystic Wizard', PLUM, YELLOW, 'Deep magenta/fuchsia single blooms, dark foliage.'],
  ['dahlia_mystic_fantasy', 'Mystic Fantasy', ORANGE, YELLOW, 'Peach/salmon single blooms, dark foliage.'],
  ['dahlia_mystic_spirit', 'Mystic Spirit', YELLOW, ORANGE, 'Apricot single blooms, dark foliage.'],
];
for (const [key, nm, A, B, notes] of DAHLIAS) {
  variety('dahlia', key, `Dahlia '${nm}'`, {
    tint: { A, B },
    aliases: [nm.toLowerCase(), `${nm.toLowerCase()} dahlia`],
    notes,
  });
}

// ---- Euphorbias -------------------------------------------------------------------------
crop('euphorbia', 'Euphorbia', 'euphorbias', 'other', 'euphorbia', {
  tint: { A: LIME, B: DKGREEN }, daysFrom: 'transplant', harvestDays: null, spacingIn: 24,
  hardiness: 'hardy', perennial: true,
  windows: { transplant: [-4, 6], fall: [-8, -3] },
  aliases: ['euphorbias', 'spurge'],
  notes: 'All drought-tolerant once established — minimal summer water, sharp drainage. Wear gloves ' +
    'and eye protection when pruning: the milky sap is a skin irritant. Cut spent flower stems to the ' +
    'base after bloom.',
});
const EUPHORBIAS = [
  ['euphorbia_tasmanian_tiger', "Euphorbia 'Tasmanian Tiger'", WHITE, GREEN, 24,
    ['tasmanian tiger'], 'Variegated white/green foliage, compact mound. Sun–part shade.'],
  ['euphorbia_purpurea', "Euphorbia 'Purpurea'", PLUM, LIME, 18,
    ['purpurea', 'euphorbia amygdaloides purpurea', 'purple wood spurge'],
    'Purple-tinted foliage, yellow-green bracts.'],
  ['euphorbia_bonfire', "Cushion Spurge 'Bonfire'", RED, YELLOW, 18,
    ['bonfire', 'euphorbia bonfire', 'cushion spurge', 'euphorbia polychroma bonfire'],
    'E. polychroma: deep burgundy-red foliage, yellow spring flowers.'],
  ['euphorbia_mrs_robbs_bonnet', "Mrs. Robb's Bonnet", DKGREEN, LIME, 18,
    ['euphorbia robbiae', 'robbiae', 'mrs robbs bonnet euphorbia'],
    'E. amygdaloides var. robbiae: evergreen groundcover for dry shade; spreads by runners.'],
  ['euphorbia_wulfenii', 'Euphorbia characias wulfenii', SILVER, LIME, 36,
    ['wulfenii', 'wulfenii euphorbia', 'characias wulfenii', 'mediterranean spurge'],
    'Large architectural blue-green plant with chartreuse heads. Great Plant Picks winner.'],
  ['euphorbia_ascot_rainbow', "Euphorbia 'Ascot Rainbow'", LIME, PINK, 24,
    ['ascot rainbow'], 'Multicolor foliage — green, cream, pink, red; year-round color.'],
  ['euphorbia_miners_merlot', "Euphorbia 'Miner's Merlot'", PLUM, YELLOW, 24,
    ["miner's merlot", 'miners merlot'], 'Deep merlot foliage, yellow spring flowers. Sun–part shade.'],
  ['euphorbia_martins', "Martin's Euphorbia", DKGREEN, RED, 24,
    ["martin's", 'euphorbia martinii', 'martinii', "martin's spurge"],
    'E. × martinii: compact, red-eyed yellow-green flower clusters; good structure plant.'],
];
for (const [key, nm, A, B, spacingIn, aliases, notes] of EUPHORBIAS) {
  variety('euphorbia', key, nm, { tint: { A, B }, spacingIn, aliases, notes });
}

// ---- Bulbs ------------------------------------------------------------------------------
crop('daffodil_narcissus', 'Daffodil/Narcissus', 'bulbs', 'other', 'bulb', {
  tint: { A: YELLOW, B: ORANGE }, daysFrom: 'transplant', harvestDays: 30, spacingIn: 6,
  hardiness: 'hardy', perennial: true,
  windows: { fall: [-6, 3] },
  aliases: ['daffodil', 'daffodils', 'narcissus', 'narcissi', 'jonquil'],
  notes: 'Plant bulbs Sep–Nov, pointy end up, 3× their height deep. Don\'t cut green leaves after ' +
    'bloom — wait until fully brown to dig or move. Deer/rodent-proof.',
});
crop('tulip', 'Tulip', 'bulbs', 'other', 'bulb', {
  tint: { A: RED, B: DKGREEN }, daysFrom: 'transplant', harvestDays: 21, spacingIn: 4,
  hardiness: 'hardy', perennial: true,
  windows: { fall: [-6, 3] },
  aliases: ['tulips', 'tulipa'],
  notes: 'Plant Oct–Nov. Hybrids fade after a year or two in wet PDX soil; species tulips perennialize.',
});

// ---- Other ------------------------------------------------------------------------------
crop('cannabis', 'Cannabis', 'other', 'other', 'leafy', {
  tint: { A: DKGREEN, B: PURPLE }, days: 120, daysFrom: 'transplant', harvestDays: 21, spacingIn: 36,
  hardiness: 'tender',
  windows: { transplant: [4, 8] },
  aliases: ['marijuana', 'hemp', 'grape spritzer', 'purple spritzer', 'cryowolf'],
  notes: 'Oregon allows 4 plants per household. Owner: clones (Cryowolf, Grape/Purple Spritzer) in ' +
    '5-gal buckets — water deeply 2×/week, consider 10–15 gal fabric pots if rootbound. Long June–July ' +
    'days drive strong veg growth. Harvest before October rains bring bud rot (botrytis).',
});

// ------------------------------------------------------------------------ post-processing

// Expand generic refs to cover their varieties (season.js matches refs by exact key).
const VARIETIES_OF = new Map();
for (const p of LIST) if (p.base) (VARIETIES_OF.get(p.base) || VARIETIES_OF.set(p.base, []).get(p.base)).push(p.key);
const expandRefs = (refs, self) => {
  const out = [];
  for (const r of refs) for (const k of [r, ...(VARIETIES_OF.get(r) || [])]) if (k !== self && !out.includes(k)) out.push(k);
  return out;
};
for (const p of LIST) {
  p.companions = expandRefs(p.companions, p.key);
  p.avoid = expandRefs(p.avoid, p.key);
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const PLANTS = deepFreeze(LIST);

// ----------------------------------------------------------------------------- lookups

const EMPTY = [];
const mergedCache = new WeakMap();

/** Normalise the `custom` argument (array of plant objects, rows {key, data}, or a key->plant map). */
function customList(custom) {
  if (!custom) return EMPTY;
  const arr = Array.isArray(custom) ? custom : Object.entries(custom).map(([key, v]) => ({ key, ...v }));
  return arr.filter(Boolean).map(c => (c.data && typeof c.data === 'object' ? { key: c.key, ...c.data } : c))
    .filter(c => typeof c.key === 'string' && c.key);
}

/**
 * The library merged with per-garden custom plants. A custom entry with an existing key overrides
 * that entry's fields (windows merged); new keys are appended with UNKNOWN_PLANT defaults.
 */
export function allPlants(custom) {
  if (!custom) return PLANTS;
  if (typeof custom === 'object' && mergedCache.has(custom)) return mergedCache.get(custom);
  const list = customList(custom);
  if (!list.length) return PLANTS;
  const out = PLANTS.slice();
  const idx = new Map(out.map((p, i) => [p.key, i]));
  for (const c of list) {
    if (idx.has(c.key)) {
      const base = out[idx.get(c.key)];
      out[idx.get(c.key)] = { ...base, ...c, windows: { ...base.windows, ...(c.windows || {}) }, custom: true };
    } else {
      idx.set(c.key, out.length);
      out.push({ ...UNKNOWN_PLANT, name: c.key, notes: '', ...c, custom: true });
    }
  }
  if (typeof custom === 'object') mergedCache.set(custom, out);
  return out;
}

const PLANT_MAP = new Map(PLANTS.map(p => [p.key, p]));

const mapCache = new WeakMap();

/** Plant by key (custom overrides first); falls back to UNKNOWN_PLANT. */
export function getPlant(key, custom) {
  if (key == null) return UNKNOWN_PLANT;
  if (custom) {
    const list = allPlants(custom);
    if (list !== PLANTS) {
      let map = mapCache.get(list);
      if (!map) mapCache.set(list, (map = new Map(list.map(p => [p.key, p]))));
      return map.get(key) || UNKNOWN_PLANT;
    }
  }
  return PLANT_MAP.get(key) || UNKNOWN_PLANT;
}

// ------------------------------------------------------------------------- name matching

// UTF-8 bytes 0x80–0x9F that Windows-1252 shows as these characters (for mojibake repair).
const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);
const CONT = '[\\u0080-\\u00bf\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e\\u0192\\u02c6\\u02dc\\u2013\\u2014\\u2018-\\u201e\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203a\\u20ac\\u2122]';
const MOJIBAKE_RE = new RegExp(`[\\u00c2-\\u00df]${CONT}|[\\u00e0-\\u00ef]${CONT}{2}|[\\u00f0-\\u00f4]${CONT}{3}`, 'g');
let decoder = null;

/** Repair UTF-8 text that was decoded as Windows-1252 (e.g. `â€™` -> `’`, `Ã±` -> `ñ`). */
export function fixMojibake(s) {
  s = String(s ?? '');
  return s.replace(MOJIBAKE_RE, seq => {
    const bytes = [];
    for (const ch of seq) {
      const c = ch.codePointAt(0);
      bytes.push(c < 0x100 ? c : CP1252.get(c));
    }
    try {
      decoder ||= new TextDecoder('utf-8', { fatal: true });
      return decoder.decode(Uint8Array.from(bytes));
    } catch {
      return seq;
    }
  });
}

const FILLER = new Set(['start', 'seedling', 'seed', 'transplant', 'plant', 'indoor', 'outdoor',
  'organic', 'the', 'a', 'an', 'f1', 'hybrid', 'cv', 'var', 'variety', 'clone', 'slip', 'crown', 'tuber']);
const CONNECTORS = new Set(['and', 'or', 'of', 'with', 'de', 'the', 'a', 'an', '-', '&', '+']);

function singular(t) {
  if (t.length <= 3 || /\d/.test(t)) return t;
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('oes')) return t.slice(0, -2);
  if (/(ch|sh|x|ss)es$/.test(t)) return t.slice(0, -2);
  if (/(ss|us|is)$/.test(t)) return t;
  if (t.endsWith('s')) return t.slice(0, -1);
  return t;
}

function cleanText(s) {
  return fixMojibake(s)
    .replace(/â€|Â/g, ' ')                           // leftover unrepairable mojibake
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/'/g, '')                               // miner's -> miners
    .replace(/[&+]/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s) {
  const c = cleanText(s);
  if (!c) return [];
  return c.split(' ').map(singular).filter(t => !FILLER.has(t));
}

/** Normalised matching form of a plant name: lowercase, ASCII, no punctuation, singular words. */
export function normalizeName(s) {
  return tokens(s).join(' ');
}

const indexCache = new WeakMap();

function buildIndex(plants) {
  const exact = new Map();   // normalised term -> plant
  const terms = [];          // { toks, str, plant }
  const vocab = new Map();   // plant key -> Set of tokens used in its key/name/aliases
  const byKey = new Map();
  for (const p of plants) {
    byKey.set(p.key, p);
    const set = new Set();
    for (const raw of [p.key.replace(/_/g, ' '), p.name, ...(p.aliases || [])]) {
      const toks = tokens(raw);
      if (!toks.length) continue;
      for (const t of toks) set.add(t);
      const str = toks.join(' ');
      if (!exact.has(str)) {
        exact.set(str, p);
        terms.push({ toks, str, plant: p });
      }
    }
    vocab.set(p.key, set);
  }
  return { exact, terms, vocab, byKey };
}

function getIndex(custom) {
  const plants = allPlants(custom);
  let idx = indexCache.get(plants);
  if (!idx) {
    // Custom plants first so their names/aliases win over library terms.
    const custom1 = plants.filter(p => p.custom);
    idx = buildIndex(custom1.length ? [...custom1, ...plants.filter(p => !p.custom)] : plants);
    indexCache.set(plants, idx);
  }
  return idx;
}

/** Split a raw name into its parts: text outside parentheses, quoted variety names, parentheticals. */
function parse(raw) {
  const s = fixMojibake(String(raw ?? '')).replace(/â€|Â/g, ' ').replace(/\s+/g, ' ').trim();
  const parens = [];
  const noParen = s.replace(/[([{]([^)\]}]*)[)\]}]?/g, (_, inner) => { parens.push(inner); return ' '; });
  const quoted = [];
  const QUOTE = /(^|[\s/,:-])['‘"“]([^'‘’"“”]+)['’"”](?=$|[\s),.;:!?/-])/g;
  const withQ = noParen.replace(QUOTE, (_, pre, q) => { quoted.push(q.trim()); return `${pre} ${q} `; });
  const noQ = noParen.replace(QUOTE, (_, pre) => `${pre} `);
  return { withQ, noQ, quoted, parens };
}

function containedMatch(toks, idx) {
  if (!toks.length) return null;
  let found = [];
  for (const term of idx.terms) {
    const n = term.toks.length;
    for (let i = 0; i + n <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < n; j++) if (toks[i + j] !== term.toks[j]) { ok = false; break; }
      if (ok) found.push({ plant: term.plant, start: i, end: i + n, len: term.str.length });
    }
  }
  if (!found.length) return null;
  // Drop matches strictly inside a longer span of another plant ("yellow pear" beats "pear").
  found = found.filter(a => !found.some(b => b.plant !== a.plant && b.start <= a.start && b.end >= a.end &&
    b.end - b.start > a.end - a.start));
  // Prefer a variety over its own generic ("Sandy Lettuce" -> sandy, not lettuce).
  found = found.filter(m => !found.some(o => o.plant.base === m.plant.key));
  found.sort((a, b) => (b.len - a.len) || (b.end - a.end));
  return found[0]?.plant || null;
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Fuzzy head-noun fallback: rightmost word that is a near-miss spelling of a one-word term. */
function headNounMatch(toks, idx) {
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i];
    if (t.length < 5) continue;
    const maxD = t.length >= 8 ? 2 : 1;
    let best = null, bestD = Infinity;
    for (const term of idx.terms) {
      if (term.toks.length !== 1 || Math.abs(term.str.length - t.length) > maxD) continue;
      const d = editDistance(t, term.str);
      if (d <= maxD && d < bestD) { best = term.plant; bestD = d; }
    }
    if (best) return { plant: best, token: t };
  }
  return null;
}

function tidyVariety(words) {
  const w = words.map(x => x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  while (w.length && CONNECTORS.has(w[0].toLowerCase())) w.shift();
  while (w.length && CONNECTORS.has(w[w.length - 1].toLowerCase())) w.pop();
  return w.length ? w.join(' ') : null;
}

function varietyFor(plant, idx, parts, extra = []) {
  const vocab = new Set([...(idx.vocab.get(plant.key) || []), ...(plant.base ? idx.vocab.get(plant.base) || [] : []),
    ...extra]);
  const described = str => { const t = tokens(str); return t.length > 0 && !t.every(x => vocab.has(x)); };
  for (const q of parts.quoted) if (described(q)) return tidyVariety(q.split(/\s+/));
  const words = parts.noQ.split(/[\s/,]+/).filter(Boolean);
  return tidyVariety(words.filter(described));
}

/**
 * Fuzzy-match a free-text plant name (garden DB names, v1 exports, user input) to the library.
 *
 * Handles case, quotes ("Broccoli 'Belstar'"), apostrophes, accents ("Jalapeño"), mojibake
 * ("â€™", "Ã±"), plurals ("Meeker Raspberries"), parentheticals ("Basil (indoor)", "Mystery Plant
 * (likely pepper)"), filler words ("starts", "seedlings"), slash alternatives ("Broccoli Raab /
 * Rapini") and small typos. Order: exact key/name/alias match, then a quoted variety that is itself
 * a library entry, then the longest alias contained in the name (a variety beats its own generic),
 * then a fuzzy head-noun match.
 *
 * @param {string} name   Free-text plant name.
 * @param {Array|Object} [custom]  Per-garden custom plants (same shape as PLANTS).
 * @returns {{ plant: object, variety: string|null } | null}
 *   `plant`   – the library (or custom) entry; never UNKNOWN_PLANT.
 *   `variety` – the leftover descriptive part of the name, original casing, e.g. 'Belstar' for
 *               "Broccoli 'Belstar'", 'Meeker' for "Meeker Raspberries", 'Red Russian' for
 *               "Red Russian Kale"; null when the name is fully described by the entry
 *               (e.g. "Dino Kale" -> dino_kale, variety null).
 *   Returns null when nothing plausible matches.
 */
export function findPlantByName(name, custom) {
  if (name == null) return null;
  const idx = getIndex(custom);
  const parts = parse(name);
  const tMain = tokens(parts.withQ);
  const tNoQ = tokens(parts.noQ);
  const tFull = tokens(`${parts.withQ} ${parts.parens.join(' ')}`);
  if (!tFull.length) return null;
  const done = (plant, extra) => ({ plant, variety: varietyFor(plant, idx, parts, extra) });
  const exact = toks => (toks.length ? idx.exact.get(toks.join(' ')) : undefined);

  // 1. Exact key / name / alias (whole name, then each "/"-separated alternative).
  let p = exact(tMain);
  if (p) return done(p);
  const segs = parts.withQ.split(/\s*\/\s*|,/);
  if (segs.length > 1) for (const seg of segs) if ((p = exact(tokens(seg)))) return done(p);

  // 2. Quoted part is itself an entry ("Tomato 'Black Krim'") and agrees with the unquoted part.
  for (const q of parts.quoted) {
    const qp = exact(tokens(q));
    if (!qp) continue;
    const rest = tNoQ.length ? exact(tNoQ) || containedMatch(tNoQ, idx) : null;
    if (!rest || rest === qp || rest.key === qp.base || (rest.base && rest.base === qp.base) ||
        rest.category === qp.category) return done(qp);
  }

  // 3. Unquoted part exact ("Broccoli 'Belstar'" -> broccoli + variety Belstar).
  if (parts.quoted.length && (p = exact(tNoQ))) return done(p);

  // 4. Longest alias contained in the name, then including parentheticals.
  if ((p = containedMatch(tMain, idx))) return done(p);
  if (tFull.length > tMain.length && (p = containedMatch(tFull, idx))) return done(p);

  // 5. Fuzzy head noun (typos, odd plurals).
  const fuzzy = headNounMatch(tFull, idx);
  return fuzzy ? done(fuzzy.plant, [fuzzy.token]) : null;
}
