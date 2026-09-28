// Bed advisor: what a bed carries into next season, what won't survive the winter, what to do to
// the soil before replanting, and what to rotate in. Pure (runs under node --test).

import { getPlant, allPlants } from './plants.js';
import { expectedHarvest, frostDates, addDays, prettyDate, sowingWindows, displayName } from './season.js';

const HEAVY = new Set(['solanaceae', 'brassica', 'cucurbit']);

// Classic rotation: after X, these families do well (and rebuild what X took).
const FOLLOW_WITH = {
  solanaceae: ['legume', 'allium', 'amaranth'],
  cucurbit: ['legume', 'allium', 'brassica'],
  brassica: ['umbellifer', 'allium', 'amaranth', 'legume'],
  legume: ['brassica', 'aster', 'amaranth', 'cucurbit'],
  allium: ['solanaceae', 'cucurbit', 'brassica'],
  umbellifer: ['legume', 'solanaceae', 'cucurbit'],
  amaranth: ['legume', 'solanaceae', 'cucurbit'],
  aster: ['brassica', 'solanaceae', 'cucurbit'],
};

// Plain-English names for plant families, used in everything the advisor says.
const GROUP = {
  solanaceae: 'tomatoes & peppers', cucurbit: 'squash, melons & cucumbers', brassica: 'kale, broccoli & cabbage',
  legume: 'beans & peas', allium: 'onions & garlic', umbellifer: 'carrots, dill & cilantro',
  amaranth: 'beets, chard & spinach', aster: 'lettuce', lamiaceae: 'herbs like basil & thyme',
  rosaceae: 'strawberries & raspberries', ericaceae: 'blueberries', moraceae: 'figs',
};
export const familyName = f => GROUP[f] || 'other plants';
// Groups already contain commas, so: two joined by a word, three or more separated by dots.
const list = (xs, word) => (xs.length < 2 ? xs.join('') : xs.length === 2 ? `${xs[0]} ${word} ${xs[1]}` : xs.join(' · '));
// Plain words: "a, b and c".
export const joinWords = (xs, word = 'and') => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${word} ${xs.at(-1)}`);

// What to call a crop in a sentence: its generic crop, plural ("Cal Wonder Bell Pepper" -> "peppers").
// History must only ever name crops that were actually recorded, never the rest of their family.
const UNCOUNTED = /(squash|zucchini|broccoli|raab|cauliflower|cabbage|radicchio|kohlrabi|kale|choy|chard|spinach|arugula|mâche|garlic|edamame|cannabis|mix)$/;
export function cropWord(plant, custom) {
  const base = plant.base ? getPlant(plant.base, custom) : plant;
  const w = base.name.replace(/\s*\(.*\)$/, '').split(' ').map(x => (/^(Asian|Brussels|Swiss)$/.test(x) ? x : x.toLowerCase())).join(' ');
  if (['herbs', 'greens', 'lettuce'].includes(base.category) || UNCOUNTED.test(w) || /s$/.test(w)) return w;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(tomato|potato|sh|ch)$/.test(w)) return `${w}es`;
  return `${w}s`;
}

// Same-family crops that share pests and diseases, for "keep these out too" advice.
// Quick, light-feeding cabbage-family crops: rotation guides group them with roots and salads.
const LIGHT_BRASSICAS = /^(radish|daikon|arugula|turnip)/;
const RELATIVES = {
  solanaceae: ['tomatoes', 'peppers', 'eggplants', 'potatoes', 'tomatillos'],
  cucurbit: ['squash', 'zucchini', 'pumpkins', 'cucumbers', 'melons', 'watermelons'],
  brassica: ['kale', 'broccoli', 'cabbage', 'cauliflower', 'Brussels sprouts', 'collard greens'],
};

/**
 * @param {object} ctx { bed, plantings (all garden plantings), climate: {lastFrost, firstFrost},
 *                       custom?, planYear, today }
 * @returns {{ staying, ending, prep, rotation, ideas, conflicts }}
 *   staying/ending: [{ planting, plant, name, note, until? }]
 *   prep: [{ title, detail }]
 *   rotation: { grown: [family], avoid: [family], follow: [family], note }
 *   ideas: [{ plant, reason }]
 */
export function bedAdvice({ bed, plantings, climate, custom, planYear, today }) {
  const lookup = k => getPlant(k, custom);
  const year = Number(today.slice(0, 4));
  const { firstFrost } = frostDates(climate, year);
  const nextLastFrost = `${planYear}-${climate.lastFrost}`;
  const inBed = plantings.filter(p => p.bed_id === bed.id);
  const live = inBed.filter(p => !['done', 'failed'].includes(p.status) && p.season < planYear);
  const planned = inBed.filter(p => p.season === planYear && p.status === 'planned');

  // ---------------------------------------------------------- staying vs ending
  const staying = [], ending = [];
  for (const p of live) {
    const plant = lookup(p.plant_key);
    const name = displayName(p, plant);
    const eh = expectedHarvest(p, plant);
    const harvestEnd = eh ? addDays(eh, plant.harvestDays || 14) : null;
    if (plant.perennial) {
      staying.push({ planting: p, plant, name, until: null, note: 'Comes back every year.' });
    } else if (plant.hardiness === 'tender') {
      ending.push({ planting: p, plant, name, note: `Can't take frost. The first frost (~${prettyDate(firstFrost)}) will kill it, so pick what you can and pull it before then.` });
    } else if (harvestEnd && harvestEnd >= `${planYear}-01-01`) {
      staying.push({ planting: p, plant, name, until: harvestEnd,
        note: `Stays through winter${plant.hardiness === 'half-hardy' ? ' (cover it on nights below ~25°F)' : ''}. Ready to pick ~${prettyDate(eh)}, in the bed until ~${prettyDate(harvestEnd)}.` });
    } else if (plant.hardiness === 'hardy' && (plant.days || 0) < 40) {
      // Quick crops (radishes, arugula) are done long before spring; just harvest and resow.
      ending.push({ planting: p, plant, name,
        note: `Grows fast: pick it by ~${prettyDate(harvestEnd || addDays(today, 30))} and the space is free.` });
    } else if (plant.hardiness === 'hardy') {
      // Hardy greens and roots stand through a zone-8b winter and bolt once days lengthen.
      const bolt = `${planYear}-05-01`;
      staying.push({ planting: p, plant, name, until: bolt,
        note: `Tough enough for winter, so keep picking. Around ~${prettyDate(bolt)} it'll start flowering and get tough or bitter.` });
    } else {
      ending.push({ planting: p, plant, name,
        note: `Might make it through a mild winter under a cover, but plan on it being done by ~${prettyDate(harvestEnd || firstFrost)}.` });
    }
  }

  // ---------------------------------------------------------- rotation
  const lastYears = inBed.filter(p => p.season >= planYear - 2 && p.season < planYear && p.status !== 'planned');
  const rotYears = lastYears.filter(p => { const pl = lookup(p.plant_key); return !LIGHT_BRASSICAS.test(pl.base || pl.key); });
  const grown = [...new Set(rotYears.map(p => lookup(p.plant_key).family))].filter(f => FOLLOW_WITH[f]);
  const avoid = grown.filter(f => HEAVY.has(f));
  const followScore = {};
  for (const f of grown) for (const [i, g] of (FOLLOW_WITH[f] || []).entries()) {
    if (grown.includes(g)) continue; // never suggest a family that was just here

    followScore[g] = (followScore[g] || 0) + (3 - Math.min(i, 2));
  }
  const follow = Object.entries(followScore).sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 3);
  const heavyGrown = grown.filter(f => HEAVY.has(f));
  // The crops actually recorded here, by generic name: "peppers", "leeks".
  const kinds = fams => [...new Set((fams ? rotYears : lastYears).filter(p => !fams || fams.includes(lookup(p.plant_key).family))
    .map(p => cropWord(lookup(p.plant_key), custom)))];
  const had = kinds();
  const hadText = had.length > 6 ? `${had.slice(0, 5).join(', ')} and ${had.length - 5} more` : joinWords(had);
  const avoidKinds = kinds(avoid);
  const relatives = avoid.flatMap(f => (RELATIVES[f] || []).filter(r => !avoidKinds.includes(r)).slice(0, 3));
  const rotation = {
    grown, avoid, follow, had,
    note: bed.kind === 'tray' ? 'Seed trays don\'t need rotating: just use fresh seed-starting mix each time.'
      : live.length && live.every(p => lookup(p.plant_key).perennial) ? 'These come back every year, so no need to switch things up.'
      : !had.length ? 'Nothing recorded here before, so plant whatever you like.'
      : `This ${bed.kind === 'container' ? 'pot' : bed.kind === 'ground' ? 'spot' : 'bed'} had ${hadText}. ${avoid.length
        ? `Next year, keep ${joinWords(avoidKinds)} out of it${relatives.length ? `, and their relatives too (${joinWords(relatives)})` : ''}: crops from the same family build up the same bugs and diseases and wear out the soil. `
        : ''}${follow.length ? `Good things to plant next: ${list(follow.map(familyName), 'or')}.` : ''}`,
  };

  // ---------------------------------------------------------- soil prep
  const plannedFamilies = new Set(planned.map(p => lookup(p.plant_key).family));
  const plannedKeys = new Set(planned.map(p => p.plant_key));
  const prep = [];
  if (bed.kind === 'container') {
    prep.push({ title: 'Refresh the potting mix', detail: 'Old mix gets tired. Swap out the top third for fresh mix and compost, or dump it all and start fresh if the plant got sick.' });
  } else if (heavyGrown.length) {
    prep.push({ title: 'Add compost', detail: `Hungry crops (${joinWords(kinds(heavyGrown))}) used up a lot of the soil's food. Spread 1–2″ of compost and some all-purpose organic fertilizer. The bed sinks about that much each year anyway.` });
  }
  if (grown.includes('solanaceae')) {
    prep.push({ title: `Clear out the old ${joinWords(kinds(['solanaceae']))}`, detail: 'Their diseases hide in dead leaves over winter. Pull every bit out, and throw away (don\'t compost) anything with spotty leaves.' });
  }
  if (grown.includes('brassica')) {
    prep.push({ title: `Check the ${joinWords(kinds(['brassica']))} roots`, detail: 'When you pull them, look at the roots. Thin and stringy is normal. Swollen, lumpy roots mean a soil disease (clubroot): if you see that, keep that whole family (kale, broccoli, cabbage, cauliflower) out of this bed for 5+ years.' });
  }
  if (grown.includes('cucurbit')) {
    prep.push({ title: 'Clear the old vines', detail: 'White mildew and squash bugs spend the winter on dead vines. Pull them and put them in the trash, not the compost.' });
  }
  if (plannedFamilies.has('brassica') || follow[0] === 'brassica') {
    prep.push({ title: 'Planting kale or broccoli? Add lime', detail: 'Portland soil is a bit too sour for that family. A cheap soil test tells you for sure; if it reads under 6.5, mix in garden lime this fall so it\'s working by spring.' });
  }
  if (plannedFamilies.has('umbellifer') || [...plannedKeys].some(k => /beet|turnip|rutabaga|radish|parsnip|carrot/.test(k))) {
    prep.push({ title: 'Loosen the soil for root crops', detail: 'Dig it up about a foot deep and pull out rocks and clumps. Use compost, not fresh manure: manure makes carrots split into weird forks.' });
  }
  if ([...plannedKeys].some(k => /potato/.test(k) && !/sweet/.test(k))) {
    prep.push({ title: 'Potatoes: skip lime and manure', detail: 'Both give potatoes rough, scabby skins. Also keep them out of spots where tomatoes grew the last couple of years.' });
  }
  if (plannedFamilies.has('allium')) {
    prep.push({ title: 'Weed well for onions & garlic', detail: 'They can\'t fight weeds. Clear the bed completely and mulch after planting.' });
  }
  if (live.some(p => lookup(p.plant_key).family === 'ericaceae')) {
    prep.push({ title: 'Keep blueberry soil sour', detail: 'Blueberries like very acidic soil. Feed them azalea/rhododendron fertilizer in spring, mulch with bark or pine needles, and add sulfur if a soil test says it\'s drifting.' });
  }
  if (live.some(p => p.plant_key === 'strawberry')) {
    prep.push({ title: 'Tidy the strawberries after picking', detail: 'Keep the strongest plants, cut off old leaves and extra runners, and add some compost. Swap in new plants every 3–4 years when berries slow down.' });
  }
  if (bed.kind === 'tray') prep.length = 0; // soil and rotation advice is for beds and pots
  const bare = staying.length === 0;
  if (bare && !['container', 'tray'].includes(bed.kind)) {
    prep.push(today <= `${year}-11-01`
      ? { title: 'Plant a cover crop for winter', detail: 'Nothing is staying here. Scatter crimson clover, fava beans or winter rye by early November. In spring, chop it down and dig it in about a month before planting; it feeds the soil and keeps rain from packing it down.' }
      : { title: 'Cover the empty bed', detail: 'Spread 2–3″ of shredded leaves so winter rain doesn\'t pack the soil down and wash it out. Rake them off a couple of weeks before planting.' });
  } else if (bed.kind !== 'tray' && staying.some(s => !s.plant.perennial)) {
    prep.push({ title: 'Protect what\'s staying over winter', detail: 'Mulch around the plants and throw frost cloth over them on nights below ~25°F. Slugs are the big winter pest here, so put out slug bait (Sluggo).' });
  }

  // ---------------------------------------------------------- conflicts
  const conflicts = [];
  for (const s of staying.filter(x => x.until && x.until >= `${planYear}-01-01`)) {
    const blocked = planned.filter(p => {
      const w = sowingWindows(lookup(p.plant_key), climate, planYear).find(x => x.type !== 'indoors');
      return w && w.start < s.until;
    });
    if (blocked.length) {
      conflicts.push(`${s.name} is still here until ~${prettyDate(s.until)}, but ${[...new Set(blocked.map(p => displayName(p, lookup(p.plant_key))))].join(', ')} needs to go in before that. Put them in the open part of the bed, or plant them after it comes out.`);
    }
  }

  // ---------------------------------------------------------- ideas
  const grownKeys = new Set(plantings.map(p => p.plant_key));
  const plannedElsewhere = plantings.filter(p => p.season === planYear && p.status === 'planned' && !p.bed_id).map(p => p.plant_key);
  const ideas = [];
  const seen = new Set([...plannedKeys]);
  const add = (plant, reason) => {
    if (seen.has(plant.key) || plant.key === 'unknown') return;
    seen.add(plant.key);
    ideas.push({ plant, reason });
  };
  for (const k of plannedElsewhere) {
    const plant = lookup(k);
    if (follow.includes(plant.family) && !avoid.includes(plant.family)) add(plant, `On your ${planYear} list and a good fit here`);
  }
  // Then by rotation rank: a few per recommended family, crops you already grow first.
  for (const fam of follow) {
    const fits = allPlants(custom).filter(p => p.family === fam && !p.perennial && !p.base);
    const ranked = [...fits.filter(p => grownKeys.has(p.key)), ...fits.filter(p => !grownKeys.has(p.key))];
    let n = 0;
    for (const plant of ranked) {
      if (n >= 3) break;
      const before = ideas.length;
      add(plant, grownKeys.has(plant.key) ? 'You grow it · good fit here' : 'Good fit here');
      if (ideas.length > before) n++;
    }
  }

  return { staying, ending, prep, rotation, ideas: ideas.slice(0, 8), conflicts, nextLastFrost };
}
