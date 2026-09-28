// Season engine: frost dates, sowing windows, harvest estimates, weekly tasks, bed checks.
// Pure. Dates are 'YYYY-MM-DD' strings treated as calendar days (UTC math, no timezones).

import { getPlant } from './plants.js';
import { distance, isSolo } from './geo.js';

const DAY = 86_400_000;
// A transplant-counted crop sown indoors spends about this long as a start before going out.
const START_WEEKS = 6;

// ---------------------------------------------------------------- dates

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fmt(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return fmt(parseDate(s) + n * DAY);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY);
}

export function todayStr(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function yearOf(s) {
  return Number(s.slice(0, 4));
}

export function prettyDate(s, { weekday = false } = {}) {
  const d = new Date(parseDate(s));
  return d.toLocaleDateString(undefined, {
    timeZone: 'UTC', month: 'short', day: 'numeric', ...(weekday ? { weekday: 'short' } : {}),
  });
}

// ---------------------------------------------------------------- climate

export function frostDates(climate, year) {
  return { lastFrost: `${year}-${climate.lastFrost}`, firstFrost: `${year}-${climate.firstFrost}` };
}

const WINDOW_LABELS = {
  indoors: 'Start indoors',
  transplant: 'Transplant out',
  direct: 'Direct sow',
  fall: 'Fall planting',
};

export function sowingWindows(plant, climate, year) {
  const { lastFrost, firstFrost } = frostDates(climate, year);
  const out = [];
  for (const [type, range] of Object.entries(plant.windows || {})) {
    if (!range) continue;
    const anchor = type === 'fall' ? firstFrost : lastFrost;
    out.push({
      type,
      label: WINDOW_LABELS[type] || type,
      start: addDays(anchor, Math.round(range[0] * 7)),
      end: addDays(anchor, Math.round(range[1] * 7)),
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function windowOpen(win, today, leadDays = 0) {
  return today >= addDays(win.start, -leadDays) && today <= win.end;
}

// ---------------------------------------------------------------- one planting

/** The day this planting's harvest clock starts, per the plant's `daysFrom`. */
export function clockStart(planting, plant) {
  const { sow_date: sow, transplant_date: tx } = planting;
  if (plant.daysFrom === 'transplant') {
    if (tx) return tx;
    if (sow) return planting.method === 'direct' ? sow : addDays(sow, START_WEEKS * 7);
    return null;
  }
  if (sow) return sow;
  if (tx) return addDays(tx, -START_WEEKS * 7);
  return null;
}

export function expectedHarvest(planting, plant) {
  if (planting.expected_harvest) return planting.expected_harvest;
  if (!plant.days) return null;
  const start = clockStart(planting, plant);
  return start ? addDays(start, plant.days) : null;
}

/**
 * Where a planting is in its life.
 * stage: planned | started | growing | ready | late | done | failed | perennial
 */
export function progress(planting, plant, today) {
  if (planting.status === 'done' || planting.status === 'failed') {
    return { stage: planting.status, pct: 1, daysLeft: null };
  }
  if (planting.status === 'planned') return { stage: 'planned', pct: 0, daysLeft: null };
  const harvest = expectedHarvest(planting, plant);
  const start = clockStart(planting, plant);
  if (!harvest || !start) {
    const stage = planting.status === 'started' ? 'started' : plant.perennial ? 'perennial' : 'growing';
    return { stage, pct: 0, daysLeft: null };
  }
  const total = Math.max(1, daysBetween(start, harvest));
  const done = daysBetween(start, today);
  const daysLeft = daysBetween(today, harvest);
  const windowDays = plant.harvestDays || 14;
  let stage;
  if (planting.status === 'started' && today < (planting.transplant_date || start)) stage = 'started';
  else if (daysLeft > 0) stage = 'growing';
  else if (-daysLeft <= windowDays || planting.status === 'harvesting') stage = 'ready';
  else stage = 'late';
  return { stage, pct: Math.min(1, Math.max(0, done / total)), daysLeft };
}

export function displayName(planting, plant) {
  return planting.variety ? `${plant.name} '${planting.variety}'` : plant.name;
}

// ---------------------------------------------------------------- weekly tasks

const PRIORITY = { frost: 0, harvest: 1, transplant: 2, sow: 3, succession: 4, suggest: 5, info: 6 };

/**
 * Tasks for the week starting `today`.
 * ctx: { plantings, beds, climate, custom, events? }
 */
export function weeklyTasks(ctx, today) {
  const { plantings = [], beds = [], climate, custom } = ctx;
  const lookup = key => getPlant(key, custom);
  const bedName = id => beds.find(b => b.id === id)?.name;
  const year = yearOf(today);
  const weekEnd = addDays(today, 7);
  const { lastFrost, firstFrost } = frostDates(climate, year);
  const tasks = [];
  const push = t => tasks.push({ priority: PRIORITY[t.kind] ?? 9, ...t });

  const live = plantings.filter(p => !['done', 'failed'].includes(p.status));

  // Frost warnings.
  const toLast = daysBetween(today, lastFrost);
  if (toLast >= 0 && toLast <= 14) {
    push({ kind: 'frost', date: lastFrost, title: `Last frost around ${prettyDate(lastFrost)}`,
      detail: 'Hold tender transplants until nights stay above 50°F; harden starts off outside.' });
  }
  const toFirst = daysBetween(today, firstFrost);
  if (toFirst >= 0 && toFirst <= 21) {
    const tender = live.filter(p => ['planted', 'harvesting'].includes(p.status)
      && lookup(p.plant_key).hardiness === 'tender');
    if (tender.length) {
      push({ kind: 'frost', date: firstFrost,
        title: `First frost in ~${toFirst} days`,
        detail: `Pick or protect: ${unique(tender.map(p => lookup(p.plant_key).name)).join(', ')}.` });
    }
  }

  for (const p of live) {
    const plant = lookup(p.plant_key);
    const name = displayName(p, plant);
    const where = bedName(p.bed_id);

    if (p.status === 'planned') {
      if (p.season !== year) continue;
      const wins = sowingWindows(plant, climate, year).filter(w => w.type !== 'transplant');
      const want = p.method === 'start' ? ['indoors'] : p.method === 'direct' ? ['direct', 'fall'] : null;
      const win = wins.find(w => (!want || want.includes(w.type)) && windowOpen(w, today, 7));
      if (win) {
        push({ kind: 'sow', date: win.start < today ? today : win.start, plantingId: p.id, plantKey: plant.key,
          title: `${win.label}: ${name}`,
          detail: `${where ? `For ${where}. ` : ''}Window ${prettyDate(win.start)} – ${prettyDate(win.end)}.` });
      }
      continue;
    }

    if (p.status === 'started') {
      const tx = sowingWindows(plant, climate, year).find(w => w.type === 'transplant');
      const age = p.sow_date ? daysBetween(p.sow_date, today) : null;
      const ready = age === null || age >= 21;
      if (tx && ready && windowOpen(tx, today, 3)) {
        push({ kind: 'transplant', date: today, plantingId: p.id, plantKey: plant.key,
          title: `Transplant ${name}${where ? ` → ${where}` : ''}`,
          detail: age !== null ? `Started ${age} days ago. Harden off for a week first.` : 'Harden off for a week first.' });
      }
    }

    if (['planted', 'harvesting', 'started'].includes(p.status)) {
      const pr = progress(p, plant, today);
      const harvest = expectedHarvest(p, plant);
      if (pr.stage === 'ready') {
        push({ kind: 'harvest', date: today, plantingId: p.id, plantKey: plant.key,
          title: `Harvest ${name}`, detail: where ? `In ${where}.` : '' });
      } else if (harvest && harvest > today && harvest <= weekEnd) {
        push({ kind: 'harvest', date: harvest, plantingId: p.id, plantKey: plant.key,
          title: `${name} ready ~${prettyDate(harvest)}`, detail: where ? `In ${where}.` : '' });
      }
    }
  }

  // Succession sowing: crops with an interval, sown this season, window still open.
  const byKey = groupBy(plantings.filter(p => p.season === year && p.sow_date), p => p.plant_key);
  for (const [key, group] of Object.entries(byKey)) {
    const plant = lookup(key);
    if (!plant.succession) continue;
    const last = group.map(p => p.sow_date).sort().at(-1);
    const due = addDays(last, plant.succession);
    if (due > weekEnd) continue;
    const win = sowingWindows(plant, climate, year)
      .filter(w => w.type === 'direct' || w.type === 'fall')
      .find(w => windowOpen(w, today));
    if (!win) continue;
    const ago = daysBetween(last, today);
    push({ kind: 'succession', date: due < today ? today : due, plantKey: key,
      title: `Succession sow ${plant.name}`,
      detail: `Last sown ${ago} days ago; every ${plant.succession} days keeps it coming. Window ends ${prettyDate(win.end)}.` });
  }

  // Suggestions: crops this garden has grown before whose window opens this week.
  const grown = new Set(plantings.map(p => p.plant_key));
  const already = new Set(live.filter(p => p.season === year).map(p => p.plant_key));
  for (const key of grown) {
    if (already.has(key)) continue;
    const plant = lookup(key);
    if (plant.perennial || plant.key === 'unknown') continue;
    for (const w of sowingWindows(plant, climate, year)) {
      if (w.type === 'transplant') continue;
      if (w.start >= today && w.start <= weekEnd) {
        push({ kind: 'suggest', date: w.start, plantKey: key,
          title: `${w.label} window opens: ${plant.name}`,
          detail: `You've grown it before. Open ${prettyDate(w.start)} – ${prettyDate(w.end)}.` });
      }
    }
  }

  return tasks.sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- season timeline

/**
 * Bars for a season Gantt: one row per planting in `year`.
 * segments: { kind: 'indoors'|'growing'|'harvest', start, end }
 */
export function timeline(plantings, year, custom) {
  const rows = [];
  for (const p of plantings) {
    if (p.season !== year) continue;
    const plant = getPlant(p.plant_key, custom);
    const segs = [];
    const start = clockStart(p, plant);
    const harvest = expectedHarvest(p, plant);
    if (p.sow_date && (p.method === 'start' || p.transplant_date) && plant.daysFrom === 'transplant') {
      const tx = p.transplant_date || addDays(p.sow_date, START_WEEKS * 7);
      segs.push({ kind: 'indoors', start: p.sow_date, end: tx });
    }
    if (start && harvest) segs.push({ kind: 'growing', start, end: harvest });
    if (harvest) {
      const end = p.done_date && p.done_date > harvest ? p.done_date : addDays(harvest, plant.harvestDays || 14);
      segs.push({ kind: 'harvest', start: harvest, end });
    }
    rows.push({ planting: p, plant, segments: segs });
  }
  return rows.sort((a, b) => (a.segments[0]?.start || '9999').localeCompare(b.segments[0]?.start || '9999'));
}

// ---------------------------------------------------------------- bed checks

function refMatches(ref, plant) {
  if (ref.startsWith('family:')) return plant.family === ref.slice(7);
  return ref === plant.key;
}

export function relates(a, b, list) {
  return (a[list] || []).some(r => refMatches(r, b)) || (b[list] || []).some(r => refMatches(r, a));
}

/** Pairs of plantings in one bed that dislike (or help) each other. Neighbours = within 2 ft. */
export function companionIssues(bedPlantings, custom, { radiusFt = 2 } = {}) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < bedPlantings.length; i++) {
    for (let j = i + 1; j < bedPlantings.length; j++) {
      const p = bedPlantings[i], q = bedPlantings[j];
      if (p.plant_key === q.plant_key) continue;
      const hasPos = p.x_ft != null && q.x_ft != null;
      if (hasPos && distance([p.x_ft, p.y_ft], [q.x_ft, q.y_ft]) > radiusFt) continue;
      const a = getPlant(p.plant_key, custom), b = getPlant(q.plant_key, custom);
      const pair = [a.key, b.key].sort().join('|');
      const kind = relates(a, b, 'avoid') ? 'avoid' : relates(a, b, 'companions') ? 'companion' : null;
      if (!kind || seen.has(pair + kind)) continue;
      seen.add(pair + kind);
      out.push({ a: p, b: q, kind, names: [a.name, b.name] });
    }
  }
  return out;
}

const HEAVY_FAMILIES = new Set(['solanaceae', 'brassica', 'cucurbit', 'allium']);

/** Families grown in this bed last season that are back again this season. */
export function rotationIssues(bed, plantings, season, custom) {
  const fam = yr => new Set(plantings
    .filter(p => p.bed_id === bed.id && p.season === yr)
    .map(p => getPlant(p.plant_key, custom).family));
  const prev = fam(season - 1), now = fam(season);
  return [...now].filter(f => HEAVY_FAMILIES.has(f) && prev.has(f));
}

/** Square-foot footprint of what's in a bed vs its area. */
export function bedCapacity(bed, plantings, custom) {
  const areaSqFt = bed.shape === 'round' ? (Math.PI / 4) * bed.length_ft * bed.width_ft : bed.length_ft * bed.width_ft;
  const pot = isSolo(bed);
  let usedSqFt = 0;
  for (const p of plantings) {
    if (p.bed_id !== bed.id || ['done', 'failed'].includes(p.status)) continue;
    // A pot is sized for its plant (a pumpkin in a pot vines out over the edge), so one plant
    // fills at most the whole pot: 1 pumpkin = 100%, 2 plants in a pot = 200%.
    const fp = footprintSqFt(getPlant(p.plant_key, custom));
    usedSqFt += (pot ? Math.min(fp, areaSqFt) : fp) * (p.qty || 1);
  }
  return { usedSqFt, areaSqFt, pct: areaSqFt ? usedSqFt / areaSqFt : 0 };
}

// Bush summer squash really do take their full spread; every other cucurbit vines out of the bed
// (or up a trellis), as do sweet potatoes.
const BUSH_SQUASH = new Set(['zucchini', 'patio_yellow', 'magda']);

export function isVining(plant) {
  // By exact key: tromboncino is filed under zucchini but is a climbing vine.
  return (plant.family === 'cucurbit' && !BUSH_SQUASH.has(plant.key))
    || plant.key === 'sweet_potato' || plant.base === 'sweet_potato';
}

/** Bed area one plant needs (sq ft): spacing squared, but a vining crop only counts its ~1 sq ft crown. */
export function footprintSqFt(plant) {
  if (isVining(plant)) return 1;
  const ft = Math.max(3, plant.spacingIn || 12) / 12;
  return ft * ft;
}

// ---------------------------------------------------------------- utils

function unique(xs) {
  return [...new Set(xs)];
}

function groupBy(xs, f) {
  const out = {};
  for (const x of xs) (out[f(x)] ||= []).push(x);
  return out;
}
