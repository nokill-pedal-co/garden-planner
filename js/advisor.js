// Bed advisor: what a bed carries into next season, what won't survive the winter, what to do to
// the soil before replanting, and what to rotate in. Pure (runs under node --test).

import { getPlant, allPlants, PLANT_FAMILIES } from './plants.js';
import { expectedHarvest, frostDates, addDays, prettyDate, sowingWindows, displayName } from './season.js';

const HEAVY = new Set(['solanaceae', 'brassica', 'cucurbit']);
const LIGHT = new Set(['umbellifer', 'allium', 'amaranth', 'aster']);

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

const familyName = f => (PLANT_FAMILIES[f] || f).replace(/ \(.*\)$/, '');

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
      staying.push({ planting: p, plant, name, until: null, note: 'Perennial: comes back next year.' });
    } else if (plant.hardiness === 'tender') {
      ending.push({ planting: p, plant, name, note: `Tender: the first frost (~${prettyDate(firstFrost)}) will kill it. Harvest and pull it before then.` });
    } else if (harvestEnd && harvestEnd >= `${planYear}-01-01`) {
      staying.push({ planting: p, plant, name, until: harvestEnd,
        note: `Overwinters${plant.hardiness === 'half-hardy' ? ' (cover it below ~25°F)' : ''}; harvest ~${prettyDate(eh)}. In the bed until ~${prettyDate(harvestEnd)}.` });
    } else if (plant.hardiness === 'hardy' && (plant.days || 0) < 40) {
      // Quick crops (radishes, arugula) are done long before spring; just harvest and resow.
      ending.push({ planting: p, plant, name,
        note: `Quick crop: harvest by ~${prettyDate(harvestEnd || addDays(today, 30))}; the space is free after that.` });
    } else if (plant.hardiness === 'hardy') {
      // Hardy greens and roots stand through a zone-8b winter and bolt once days lengthen.
      const bolt = `${planYear}-05-01`;
      staying.push({ planting: p, plant, name, until: bolt,
        note: `Hardy: can stand through winter for more picking; expect it to bolt by ~${prettyDate(bolt)}.` });
    } else {
      ending.push({ planting: p, plant, name,
        note: `Half-hardy: may limp through a mild winter under cover, but plan on it finishing by ~${prettyDate(harvestEnd || firstFrost)}.` });
    }
  }

  // ---------------------------------------------------------- rotation
  const lastYears = inBed.filter(p => p.season >= planYear - 2 && p.season < planYear && p.status !== 'planned');
  const grown = [...new Set(lastYears.map(p => lookup(p.plant_key).family))].filter(f => FOLLOW_WITH[f]);
  const avoid = grown.filter(f => HEAVY.has(f));
  const followScore = {};
  for (const f of grown) for (const [i, g] of (FOLLOW_WITH[f] || []).entries()) {
    if (avoid.includes(g)) continue;
    followScore[g] = (followScore[g] || 0) + (3 - Math.min(i, 2));
  }
  const follow = Object.entries(followScore).sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 3);
  const heavyGrown = grown.filter(f => HEAVY.has(f));
  const rotation = {
    grown, avoid, follow,
    note: live.length && live.every(p => lookup(p.plant_key).perennial) ? 'Perennial planting: no rotation needed.'
      : !grown.length ? 'No history for this bed yet, so rotation is wide open.'
      : `Grew ${grown.map(familyName).join(', ')} here. ${avoid.length
        ? `Give ${avoid.map(familyName).join(' and ')} a year or two elsewhere (disease and nutrient build-up). `
        : ''}${follow.length ? `Good next: ${follow.map(familyName).join(', ')}.` : ''}`,
  };

  // ---------------------------------------------------------- soil prep
  const plannedFamilies = new Set(planned.map(p => lookup(p.plant_key).family));
  const plannedKeys = new Set(planned.map(p => p.plant_key));
  const prep = [];
  const names = fam => [...new Set(lastYears.filter(p => lookup(p.plant_key).family === fam).map(p => lookup(p.plant_key).name))].slice(0, 4).join(', ');
  if (bed.kind === 'container') {
    prep.push({ title: 'Refresh the potting mix', detail: 'Pots lose structure and nutrients each season: replace the top third with fresh mix and compost, or tip it out and start fresh if anything got sick.' });
  } else if (heavyGrown.length) {
    prep.push({ title: 'Top up compost', detail: `Heavy feeders (${heavyGrown.map(f => names(f)).join('; ')}) drew the bed down. Add 1–2″ of compost and a balanced organic fertilizer; raised beds also settle about that much each year.` });
  }
  if (grown.includes('solanaceae')) {
    prep.push({ title: 'Clear nightshade debris', detail: 'Early blight and other tomato/pepper diseases overwinter on old leaves and stems. Remove all of it and don\'t compost anything that had spotted leaves.' });
  }
  if (grown.includes('brassica')) {
    prep.push({ title: 'Check brassica roots', detail: 'When you pull brassicas, look at the roots: swollen, knobby "clubs" mean clubroot, and brassicas should stay out of this bed for 5+ years. Normal fibrous roots = fine.' });
  }
  if (grown.includes('cucurbit')) {
    prep.push({ title: 'Clear the vines', detail: 'Powdery mildew and squash bugs overwinter on old vines and leaves. Pull and bin them rather than composting.' });
  }
  if (plannedFamilies.has('brassica') || follow[0] === 'brassica') {
    prep.push({ title: 'Lime before brassicas', detail: 'Brassicas want pH 6.5–7 and Portland soil runs acidic. Test this fall; if it\'s under 6.5 work in garden lime now so it has time to act (it also discourages clubroot).' });
  }
  if (plannedFamilies.has('umbellifer') || [...plannedKeys].some(k => /beet|turnip|rutabaga|radish|parsnip|carrot/.test(k))) {
    prep.push({ title: 'Loosen for root crops', detail: 'Fork 10–12″ deep and rake out stones and clods. Skip fresh manure (it forks carrots and parsnips); use finished compost.' });
  }
  if ([...plannedKeys].some(k => /potato/.test(k) && !/sweet/.test(k))) {
    prep.push({ title: 'Potatoes: no lime, no fresh manure', detail: 'Both encourage scab. And don\'t plant them where tomatoes grew in the last couple of years.' });
  }
  if (plannedFamilies.has('allium')) {
    prep.push({ title: 'Weed-free for alliums', detail: 'Onions, garlic and leeks can\'t compete with weeds. Clear the bed thoroughly and mulch after planting.' });
  }
  if (live.some(p => lookup(p.plant_key).family === 'ericaceae')) {
    prep.push({ title: 'Keep it acidic', detail: 'Blueberries want pH 4.5–5.5. Feed with an acid (azalea/rhododendron) fertilizer in spring, mulch with bark or pine needles, and add sulfur if the pH creeps up.' });
  }
  if (live.some(p => p.plant_key === 'strawberry')) {
    prep.push({ title: 'Renovate the strawberries after harvest', detail: 'Thin to the strongest plants, cut old leaves and extra runners, and top-dress with compost. Replace plants every 3–4 years as yields drop.' });
  }
  const bare = staying.length === 0;
  if (bare && bed.kind !== 'container') {
    prep.push(today <= `${year}-11-01`
      ? { title: 'Cover crop over winter', detail: 'Nothing is staying in this bed. Sow crimson clover, fava beans or cereal rye by early November; chop it down and turn it in 3–4 weeks before spring planting. It feeds the soil and stops rain compaction.' }
      : { title: 'Mulch the bare bed', detail: '2–3″ of shredded leaves keeps winter rain from compacting and leaching the soil. Pull it back a couple of weeks before planting.' });
  } else if (staying.some(s => !s.plant.perennial)) {
    prep.push({ title: 'Protect what\'s overwintering', detail: 'Mulch around the plants and keep frost cloth handy for nights forecast below ~25°F. Slugs are the main winter pest here, so set out iron-phosphate bait.' });
  }

  // ---------------------------------------------------------- conflicts
  const conflicts = [];
  for (const s of staying.filter(x => x.until && x.until >= `${planYear}-01-01`)) {
    const blocked = planned.filter(p => {
      const w = sowingWindows(lookup(p.plant_key), climate, planYear).find(x => x.type !== 'indoors');
      return w && w.start < s.until;
    });
    if (blocked.length) {
      conflicts.push(`${s.name} is here until ~${prettyDate(s.until)}, but ${[...new Set(blocked.map(p => displayName(p, lookup(p.plant_key))))].join(', ')} would go in earlier. Give them the rest of the bed, or plan them after it.`);
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
    if (follow.includes(plant.family) && !avoid.includes(plant.family)) add(plant, 'On your 2027 list and fits the rotation');
  }
  // Then by rotation rank: a few per recommended family, crops you already grow first.
  for (const fam of follow) {
    const fits = allPlants(custom).filter(p => p.family === fam && !p.perennial && !p.base);
    const ranked = [...fits.filter(p => grownKeys.has(p.key)), ...fits.filter(p => !grownKeys.has(p.key))];
    let n = 0;
    for (const plant of ranked) {
      if (n >= 3) break;
      const before = ideas.length;
      add(plant, grownKeys.has(plant.key) ? `You grow it · ${familyName(fam)} fit the rotation` : `${familyName(fam)} fit the rotation`);
      if (ideas.length > before) n++;
    }
  }

  return { staying, ending, prep, rotation, ideas: ideas.slice(0, 8), conflicts, nextLastFrost };
}
