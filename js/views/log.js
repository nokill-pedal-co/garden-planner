// Log: harvest totals per crop for the season, plus a dated list of harvests and notes.

import * as store from '../store.js';
import { h, icon, plantSprite, sprite, clear, fill, sheet, field, formData, confirmSheet } from '../ui.js';
import { getPlant } from '../plants.js';
import { prettyDate, todayStr } from '../season.js';
import { harvestSheet, pickPlantSheet } from './common.js';

export function mount(main) {
  const view = h('div.view');
  main.append(view);
  const ui = { year: Number(todayStr().slice(0, 4)) };

  function render() {
    const { events } = store.getState();
    const custom = store.customPlants();
    const years = [...new Set([ui.year, ...events.map(e => Number(e.date.slice(0, 4)))])].sort((a, b) => b - a);
    const list = events.filter(e => e.date.startsWith(String(ui.year))).sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
    const harvests = list.filter(e => e.type === 'harvest' && e.plant_key);

    // Totals per crop + unit.
    const totals = {};
    for (const e of harvests) {
      const k = `${e.plant_key}|${e.unit || 'count'}`;
      totals[k] = (totals[k] || 0) + (e.amount || 0);
    }
    const rows = Object.entries(totals).map(([k, v]) => ({ key: k.split('|')[0], unit: k.split('|')[1], amount: v })).sort((a, b) => b.amount - a.amount);
    const maxBy = {};
    for (const r of rows) maxBy[r.unit] = Math.max(maxBy[r.unit] || 0, r.amount);

    fill(view, 
      h('div.row.wrap',
        h('h1.grow', 'Log'),
        h('button.btn.warn', { onclick: async () => {
          const key = await pickPlantSheet({ title: 'What did you harvest?' });
          if (key) harvestSheet(null, { plantKey: key });
        } }, icon('basket', 24), 'Harvest'),
        h('button.btn', { onclick: noteSheet }, icon('edit', 24), 'Note')),
      h('div.row.wrap', years.map(y => h(`button.btn.sm${y === ui.year ? '.primary' : ''}`, { onclick: () => { ui.year = y; render(); } }, String(y)))),
      rows.length ? h('section.card.px',
        h('h3', `${ui.year} harvest`),
        h('div.bars', rows.map(r => {
          const plant = getPlant(r.key, custom);
          return h('div.bar', plantSprite(r.key, custom, { size: 24 }), h('span', plant.name),
            h('div', h('div.fill', { style: { width: `${Math.max(3, (r.amount / maxBy[r.unit]) * 100)}%` } })),
            h('span.small', `${round(r.amount)} ${r.unit}`));
        }))) : null,
      list.length
        ? h('ul.log-list', list.map(e => h('li.px',
          e.plant_key ? plantSprite(e.plant_key, custom, { size: 32 }) : sprite(e.type === 'harvest' ? 'icon_basket' : 'icon_edit', { size: 32 }),
          h('div',
            h('div', e.type === 'harvest'
              ? `${e.amount != null ? `${round(e.amount)} ${e.unit || ''} ` : ''}${e.plant_key ? getPlant(e.plant_key, custom).name : 'Harvest'}`
              : e.text || 'Note'),
            h('div.small.muted', [prettyDate(e.date, { weekday: true }), e.type === 'harvest' ? e.text : null].filter(Boolean).join(' · '))),
          h('button.btn.sm.ghost', { 'aria-label': 'Delete entry', onclick: async () => {
            if (await confirmSheet('Delete this entry?', { ok: 'Delete', danger: true })) store.deleteEvent(e.id);
          } }, icon('trash', 16)))))
        : h('div.empty', sprite('icon_basket', { size: 64 }), h('p', `Nothing logged in ${ui.year} yet.`)),
    );
  }

  async function noteSheet() {
    const res = await sheet(close => {
      const form = h('form.stack', { onsubmit: e => { e.preventDefault(); close(formData(form)); } },
        h('header', sprite('icon_edit', { size: 48 }), h('h2', 'Garden note')),
        field('Date', h('input', { type: 'date', name: 'date', value: todayStr() })),
        field('Note', h('textarea', { name: 'text', required: true, autofocus: true, placeholder: 'Aphids on the kale, first ripe tomato…' })),
        h('div.actions', h('button.btn.primary', { type: 'submit' }, 'Save'), h('button.btn', { type: 'button', onclick: () => close(null) }, 'Cancel')));
      return form;
    }, { label: 'Garden note' });
    if (res?.text) store.logEvent({ type: 'note', date: res.date || todayStr(), text: res.text });
  }

  render();
  return store.watch(s => [s.events, s.custom], render);
}

function round(n) {
  return Math.round(n * 100) / 100;
}
