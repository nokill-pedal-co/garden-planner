// Plant library: browse, see sowing windows for your frost dates, companions, and plan a crop.

import * as store from '../store.js';
import { h, icon, plantSprite, clear, fill, sheet, toast } from '../ui.js';
import { allPlants, getPlant, CATEGORIES, PLANT_FAMILIES } from '../plants.js';
import { sowingWindows, prettyDate, daysBetween, todayStr } from '../season.js';

export function mount(main, key) {
  const view = h('div.view');
  main.append(view);
  const ui = { q: '', cat: 'all' };

  const results = h('div');

  /** Just the plant grid, so typing in the search box never rebuilds (and un-focuses) the input. */
  function renderResults() {
    const custom = store.customPlants();
    const q = ui.q.toLowerCase();
    const shown = allPlants(custom).filter(p => (ui.cat === 'all' || p.category === ui.cat)
      && (!q || p.name.toLowerCase().includes(q) || (p.aliases || []).some(a => a.toLowerCase().includes(q))));
    fill(results, shown.length
      ? h('div.lib-grid', shown.map(p => h('button.lib-item.px', { type: 'button', onclick: () => detail(p.key) },
        plantSprite(p.key, custom, { size: 48, alt: '' }), h('span', p.name),
        h('span.small', [p.days ? `${p.days}d` : null, p.perennial ? 'perennial' : null, p.spacingIn ? `${p.spacingIn}"` : null].filter(Boolean).join(' · ')))))
      : h('p.empty', 'No matches.'));
  }

  function render() {
    const count = allPlants(store.customPlants()).length;
    const search = h('input', { type: 'search', placeholder: `Search ${count} plants…`, value: ui.q, 'aria-label': 'Search plants',
      oninput: e => { ui.q = e.target.value; renderResults(); } });
    fill(view,
      h('h1', 'Library'),
      h('div.stack', search,
        h('div.cats.row.wrap', [['all', 'All'], ...CATEGORIES.map(c => [c.key, c.name])].map(([k, n]) =>
          h(`button.btn.sm${ui.cat === k ? '.primary' : ''}`, { onclick: () => { ui.cat = k; render(); } }, n)))),
      h('div', { style: { height: '14px' } }),
      results);
    renderResults();
  }

  render();
  if (key) detail(key);
  return () => {};
}

export async function detail(key) {
  const custom = store.customPlants();
  const plant = getPlant(key, custom);
  const { garden, plantings } = store.getState();
  const climate = { lastFrost: garden.last_frost, firstFrost: garden.first_frost };
  const today = todayStr();
  const year = Number(today.slice(0, 4));
  const planYear = today > `${year}-${climate.firstFrost}` ? year + 1 : year;
  const wins = sowingWindows(plant, climate, planYear);
  const history = plantings.filter(p => p.plant_key === plant.key);
  const ref = r => r.startsWith('family:') ? { label: `${PLANT_FAMILIES[r.slice(7)] || r.slice(7)} family`, key: null } : { label: getPlant(r, custom).name, key: r };

  const res = await sheet(close => h('div.stack',
    h('header', plantSprite(plant.key, custom, { size: 64 }),
      h('div', h('h2', plant.name), h('div.small.muted', `${catName(plant.category)} · ${PLANT_FAMILIES[plant.family] || plant.family}${plant.perennial ? ' · perennial' : ''}`))),
    h('div.grid2',
      stat('Days to harvest', plant.days ? `${plant.days} from ${plant.daysFrom === 'transplant' ? 'transplant' : 'sowing'}` : '—'),
      stat('Spacing', plant.spacingIn ? `${plant.spacingIn}" (${Math.max(1, Math.floor(144 / (plant.spacingIn ** 2)))}/sq ft)` : '—'),
      stat('Hardiness', plant.hardiness || '—'),
      stat('Succession', plant.succession ? `every ${plant.succession} days` : '—')),
    wins.length ? h('div',
      h('div.small.muted', `${planYear} windows`),
      h('div.months', ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map(m => h('span', m))),
      windowsBar(wins, planYear),
      h('div.small.muted', wins.map(w => `${w.label} ${prettyDate(w.start)}–${prettyDate(w.end)}`).join(' · '))) : null,
    plant.companions?.length ? h('div', h('div.small.muted', 'Good neighbours'),
      h('div.pill-list', plant.companions.map(ref).map(r => h('span.pill.good', r.key ? plantSprite(r.key, custom, { size: 24 }) : icon('heart', 24), r.label)))) : null,
    plant.avoid?.length ? h('div', h('div.small.muted', 'Keep apart from'),
      h('div.pill-list', plant.avoid.map(ref).map(r => h('span.pill.bad', r.key ? plantSprite(r.key, custom, { size: 24 }) : icon('clash', 24), r.label)))) : null,
    plant.notes ? h('p', plant.notes) : null,
    history.length ? h('div.small.muted', `You've grown this ${history.length} time${history.length === 1 ? '' : 's'} (${[...new Set(history.map(p => p.season))].join(', ')}).`) : null,
    h('div.actions',
      h('button.btn.primary', { onclick: () => close('plan') }, icon('seed', 16), `Plan for ${planYear}`),
      h('button.btn', { onclick: () => close(null) }, 'Close'))), { label: plant.name });

  if (res === 'plan') {
    store.addPlanting({ plant_key: plant.key, status: 'planned', season: planYear });
    toast(`${plant.name} added to ${planYear} plan — place it from a bed's Unplaced tray`);
  }
}

function windowsBar(wins, year) {
  const start = `${year}-01-01`;
  const span = daysBetween(start, `${year + 1}-01-01`);
  const pct = d => Math.max(0, Math.min(100, (daysBetween(start, d) / span) * 100));
  const colors = { indoors: 'var(--purple)', transplant: 'var(--orange)', direct: 'var(--green)', fall: 'var(--teal)' };
  const lanes = { indoors: 0, transplant: 1, direct: 2, fall: 3 };
  return h('div.windows', wins.map(w => h('i.seg', {
    title: `${w.label}: ${prettyDate(w.start)} – ${prettyDate(w.end)}`,
    style: { left: `${pct(w.start)}%`, width: `${Math.max(1, pct(w.end) - pct(w.start))}%`, top: `${4 + lanes[w.type] * 17}px`, background: colors[w.type] },
  })));
}

function stat(label, value) {
  return h('div', h('div.small.muted', label), h('div', value));
}

function catName(key) {
  return CATEGORIES.find(c => c.key === key)?.name || key || '';
}
