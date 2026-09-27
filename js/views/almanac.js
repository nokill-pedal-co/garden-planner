// Almanac: frost countdown, this week's tasks, season timeline, and a sowing calendar.

import * as store from '../store.js';
import { h, icon, plantSprite, sprite, clear, fill, toast } from '../ui.js';
import { getPlant } from '../plants.js';
import {
  weeklyTasks, timeline, sowingWindows, frostDates, todayStr, daysBetween, prettyDate, addDays, parseDate, displayName,
} from '../season.js';
import { harvestSheet, plantingSheet, pickPlantSheet } from './common.js';

const DISMISSED = 'gp2.dismissed';
const KIND_ICONS = { frost: 'frost', harvest: 'basket', transplant: 'shovel', sow: 'seed', succession: 'seed', suggest: 'calendar', info: 'sun' };

export function mount(main) {
  const view = h('div.view');
  main.append(view);
  const ui = { tab: store.storage.get('gp2.almanacTab', 'week'), year: Number(todayStr().slice(0, 4)) };

  function render() {
    const { garden, plantings, beds } = store.getState();
    if (!garden) return;
    const custom = store.customPlants();
    const climate = { lastFrost: garden.last_frost, firstFrost: garden.first_frost };
    const today = todayStr();

    fill(view, 
      h('h1', 'Almanac'),
      frostStrip(climate, today),
      h('div.tabs', { role: 'tablist' },
        [['week', 'This week'], ['season', 'Season'], ['sowing', 'Sowing calendar']].map(([k, label]) =>
          h(`button.btn.sm${ui.tab === k ? '.primary' : ''}`, { role: 'tab', 'aria-selected': String(ui.tab === k),
            onclick: () => { ui.tab = k; store.storage.set('gp2.almanacTab', k); render(); } }, label))),
      ui.tab === 'week' ? weekPanel({ plantings, beds, climate, custom }, today)
        : ui.tab === 'season' ? seasonPanel(plantings, custom, today)
          : sowingPanel(plantings, custom, climate, today),
    );
  }

  // ---------------------------------------------------------- frost strip

  function frostStrip(climate, today) {
    const year = Number(today.slice(0, 4));
    let { lastFrost, firstFrost } = frostDates(climate, year);
    if (today > lastFrost) lastFrost = frostDates(climate, year + 1).lastFrost; // next spring's
    const toLast = daysBetween(today, lastFrost);
    const toFirst = daysBetween(today, firstFrost);
    const growing = today >= lastFrost && today <= firstFrost;
    const seasonLen = daysBetween(frostDates(climate, year).lastFrost, firstFrost);
    const into = daysBetween(frostDates(climate, year).lastFrost, today);
    return h('section.card.px',
      h('div.frost-strip',
        h('div.stat', icon('frost', 40),
          h('div', h('b.big', toLast >= 0 ? `${toLast}d` : '—'), h('span.small.muted', toLast >= 0 ? `to last frost · ${prettyDate(lastFrost)}` : 'last frost passed'))),
        h('div.stat', icon('sun', 40),
          h('div', h('b.big', growing ? `${toFirst}d` : '—'), h('span.small.muted', growing ? `to first frost · ${prettyDate(firstFrost)}` : 'outside frost-free season'))),
        h('div.stat', { style: { flexDirection: 'column', alignItems: 'stretch', gap: '4px' } },
          h('span.small.muted', 'Frost-free season'),
          h('div.meter', h('i', { style: { width: `${Math.max(0, Math.min(100, Math.round((into / seasonLen) * 100)))}%` } }),
            h('b', growing ? `day ${into} of ${seasonLen}` : 'dormant')))));
  }

  // ---------------------------------------------------------- week

  function weekPanel(ctx, today) {
    const dismissed = store.storage.get(DISMISSED, {});
    const tasks = weeklyTasks(ctx, today).filter(t => !dismissed[taskId(t)] || dismissed[taskId(t)] < today);
    if (!tasks.length) {
      return h('div.empty', sprite('icon_sun', { size: 64 }), h('p', 'Nothing urgent this week. Go enjoy the garden.'));
    }
    return h('ul.tasks', tasks.map(t => h('li.task.px', { dataset: { kind: t.kind } },
      t.plantKey ? plantSprite(t.plantKey, ctx.custom, { size: 40, cls: 'kind' }) : icon(KIND_ICONS[t.kind] || 'sun', 40),
      h('div',
        h('div.when', `${iconLabel(t.kind)} · ${t.date <= today ? 'now' : prettyDate(t.date, { weekday: true })}`),
        h('div.t', t.title),
        t.detail ? h('div.d', t.detail) : null),
      h('div.acts',
        action(t, today),
        h('a.btn.sm', { href: calendarLink(t), target: '_blank', rel: 'noopener', title: 'Add to Google Calendar' }, icon('calendar', 16)),
        h('button.btn.sm.ghost', { title: 'Hide for a week', onclick: () => {
          store.storage.set(DISMISSED, { ...store.storage.get(DISMISSED, {}), [taskId(t)]: addDays(today, 7) });
          render();
        } }, icon('close', 16))))));
  }

  function action(t, today) {
    const { plantings } = store.getState();
    const p = t.plantingId && plantings.find(x => x.id === t.plantingId);
    const done = (label, fn) => h('button.btn.sm.primary', { onclick: fn }, icon('check', 16), label);
    switch (t.kind) {
      case 'sow':
        return done('Sown', () => {
          const indoors = t.title.startsWith('Start indoors');
          store.updatePlanting(p.id, { status: indoors ? 'started' : 'planted', sow_date: today, method: indoors ? 'start' : 'direct' });
          toast(indoors ? 'Marked as started indoors' : 'Marked as sown');
        });
      case 'transplant':
        return done('Planted', () => {
          store.updatePlanting(p.id, { status: 'planted', transplant_date: today });
          toast('Transplanted');
          if (!p.bed_id) plantingSheet({ ...p, status: 'planted', transplant_date: today });
        });
      case 'harvest':
        return p ? h('button.btn.sm.warn', { onclick: () => harvestSheet(p) }, icon('basket', 16), 'Log') : null;
      case 'succession':
      case 'suggest':
        return done('Sow', () => {
          const prev = [...plantings].filter(x => x.plant_key === t.plantKey).sort((a, b) => (b.sow_date || '').localeCompare(a.sow_date || ''))[0];
          store.addPlanting({ plant_key: t.plantKey, bed_id: prev?.bed_id ?? null, status: 'planted', method: 'direct', sow_date: today, qty: prev?.qty || 1,
            x_ft: prev?.x_ft ?? null, y_ft: prev?.y_ft ?? null, variety: prev?.variety ?? null });
          toast('New sowing added');
        });
      default:
        return null;
    }
  }

  // ---------------------------------------------------------- season (Gantt)

  function seasonPanel(plantings, custom, today) {
    const rows = timeline(plantings, ui.year, custom);
    const years = [...new Set([Number(today.slice(0, 4)), ...plantings.map(p => p.season)])].sort();
    const start = `${ui.year}-01-01`;
    const span = daysBetween(start, `${ui.year + 1}-01-01`);
    const pct = d => `${Math.max(0, Math.min(100, (daysBetween(start, d) / span) * 100))}%`;
    const width = (a, b) => `${Math.max(0.6, (Math.min(span, daysBetween(start, b)) - Math.max(0, daysBetween(start, a))) / span * 100)}%`;
    const todayLine = today.startsWith(String(ui.year)) ? h('i.today', { style: { left: pct(today) } }) : null;

    return h('section.stack',
      h('div.row.wrap',
        years.map(y => h(`button.btn.sm${y === ui.year ? '.primary' : ''}`, { onclick: () => { ui.year = y; render(); } }, String(y))),
        h('span.spacer'),
        h('div.legend', h('span', h('i', { style: { background: 'var(--purple)' } }), 'Indoors'),
          h('span', h('i', { style: { background: 'var(--green)' } }), 'Growing'),
          h('span', h('i', { style: { background: 'var(--yellow)' } }), 'Harvest'))),
      rows.length ? h('div.gantt.card.px', h('table',
        h('thead', h('tr', h('th', ''), h('th', h('div.months', MONTHS.map(m => h('span', m)))))),
        h('tbody', rows.map(r => h('tr',
          h('td.name', h('button.btn.ghost', { style: { padding: 0, minHeight: 0, fontWeight: 400 }, onclick: () => plantingSheet(r.planting) },
            plantSprite(r.plant.key, custom, { size: 24 }), displayName(r.planting, r.plant))),
          h('td', h('div.lane', todayLine?.cloneNode(),
            r.segments.map(s => h(`i.seg.${s.kind}`, { title: `${s.kind}: ${prettyDate(s.start)} – ${prettyDate(s.end)}`,
              style: { left: pct(s.start < start ? start : s.start), width: width(s.start, s.end) } })))))))))
        : h('div.empty', sprite('icon_calendar', { size: 64 }), h('p', `No plantings in ${ui.year}.`)));
  }

  // ---------------------------------------------------------- sowing calendar

  function sowingPanel(plantings, custom, climate, today) {
    const year = Number(today.slice(0, 4));
    const planYear = today > `${year}-${climate.firstFrost}` ? year + 1 : year;
    const pinned = store.storage.get('gp2.sowPins', []);
    const keys = [...new Set([...plantings.map(p => p.plant_key), ...pinned])]
      .map(k => getPlant(k, custom)).filter(p => p.key !== 'unknown' && Object.keys(p.windows || {}).length)
      .sort((a, b) => a.name.localeCompare(b.name));
    const start = `${planYear}-01-01`;
    const span = daysBetween(start, `${planYear + 1}-01-01`);
    const pct = d => `${Math.max(0, Math.min(100, (daysBetween(start, d) / span) * 100))}%`;
    const width = (a, b) => `${Math.max(0.6, (Math.min(span, daysBetween(start, b)) - Math.max(0, daysBetween(start, a))) / span * 100)}%`;
    const todayLine = today.startsWith(String(planYear)) ? h('i.today', { style: { left: pct(today) } }) : null;

    return h('section.stack',
      h('div.row.wrap',
        h('p.grow.small.muted', `${planYear} windows for crops you grow, from your frost dates (${prettyDate(`${planYear}-${climate.lastFrost}`)} / ${prettyDate(`${planYear}-${climate.firstFrost}`)}).`),
        h('button.btn.sm', { onclick: async () => {
          const key = await pickPlantSheet({ title: 'Add to sowing calendar' });
          if (key) { store.storage.set('gp2.sowPins', [...new Set([...pinned, key])]); render(); }
        } }, icon('plus', 16), 'Add crop')),
      h('div.legend',
        [['window-indoors', 'var(--purple)', 'Start indoors'], ['window-transplant', 'var(--orange)', 'Transplant'],
          ['window-direct', 'var(--green)', 'Direct sow'], ['window-fall', 'var(--teal)', 'Fall crop']]
          .map(([, c, l]) => h('span', h('i', { style: { background: c } }), l))),
      keys.length ? h('div.gantt.card.px', h('table',
        h('thead', h('tr', h('th', ''), h('th', h('div.months', MONTHS.map(m => h('span', m)))))),
        h('tbody', keys.map(plant => h('tr',
          h('td.name', plantSprite(plant.key, custom, { size: 24 }), plant.name),
          h('td', h('div.lane', { style: { height: '20px' } }, todayLine?.cloneNode(),
            sowingWindows(plant, climate, planYear).map((w, i, all) => h(`i.seg.window-${w.type}`, {
              title: `${w.label}: ${prettyDate(w.start)} – ${prettyDate(w.end)}`,
              style: { left: pct(w.start), width: width(w.start, w.end), top: `${2 + (overlapIndex(all, i) * 6)}px`, bottom: 'auto', height: '8px' },
            })))))))))
        : h('div.empty', sprite('icon_seed', { size: 64 }), h('p', 'Add crops to see their sowing windows.')));
  }

  render();
  return store.watch(s => [s.garden, s.plantings, s.beds, s.custom], render);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function overlapIndex(all, i) {
  let n = 0;
  for (let j = 0; j < i; j++) if (all[j].end >= all[i].start) n++;
  return Math.min(n, 2);
}

function taskId(t) {
  return `${t.kind}:${t.plantingId || t.plantKey || t.title}`;
}

function iconLabel(kind) {
  return { frost: 'Frost', harvest: 'Harvest', transplant: 'Transplant', sow: 'Sow', succession: 'Succession', suggest: 'Idea' }[kind] || kind;
}

/** Google Calendar "add event" link for a task (all-day, on the task's date). */
function calendarLink(t) {
  const d = t.date.replaceAll('-', '');
  const next = addDays(t.date, 1).replaceAll('-', '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `🌱 ${t.title}`, dates: `${d}/${next}`, details: t.detail || '' });
  return `https://calendar.google.com/calendar/render?${params}`;
}
