// Tiny DOM helpers shared by the views: element builder, sheet (modal), toast, sprite <img>.

import { spriteURL } from './sprites.js';
import { getPlant } from './plants.js';

/** h('div.card.px', { onclick }, child, 'text', [more]) */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function sprite(key, { tint, size = 32, alt = '', cls } = {}) {
  return h('img', { src: spriteURL(key, tint), width: size, height: size, alt, class: cls, draggable: false });
}

export function plantSprite(plantKey, custom, opts = {}) {
  const plant = getPlant(plantKey, custom);
  return sprite(plant.sprite, { tint: plant.tint, alt: opts.alt ?? plant.name, ...opts });
}

export function icon(name, size = 24, alt = '') {
  return sprite(`icon_${name}`, { size, alt });
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/** Replace el's children; like append() but skips null/false and flattens arrays. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ------------------------------------------------------------ sheet (modal)

let openSheet = null;

/** Opens a bottom sheet / dialog. `build(close)` returns the sheet's content. Resolves on close. */
export function sheet(build, { label = 'Dialog' } = {}) {
  closeSheet();
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const close = value => {
      scrim.remove();
      document.removeEventListener('keydown', onKey);
      openSheet = null;
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const box = h('div.sheet.px', { role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    const scrim = h('div.scrim', { onclick: e => { if (e.target === scrim) close(); } }, box);
    append(box, [build(close)]);
    document.body.append(scrim);
    document.addEventListener('keydown', onKey);
    openSheet = close;
    (box.querySelector('[autofocus]') || box.querySelector('input, select, textarea, button'))?.focus();
  });
}

export function closeSheet() {
  openSheet?.();
}

export function confirmSheet(message, { ok = 'OK', danger = false } = {}) {
  return sheet(close => h('div.stack',
    h('p', message),
    h('div.actions',
      h(`button.btn${danger ? '.danger' : '.primary'}`, { onclick: () => close(true) }, ok),
      h('button.btn', { onclick: () => close(false) }, 'Cancel'))));
}

// ------------------------------------------------------------ toast

export function toast(message, { error = false, ms = 2600 } = {}) {
  let host = document.querySelector('.toast-host');
  if (!host) document.body.append(host = h('div.toast-host', { role: 'status', 'aria-live': 'polite' }));
  const t = h(`div.toast${error ? '.error' : ''}`, message);
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

// ------------------------------------------------------------ forms

export function field(label, input) {
  return h('label.field', h('span', label), input);
}

export function select(options, value, props = {}) {
  return h('select', props, options.map(o => {
    const [v, text] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: v === value }, text);
  }));
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value === '' ? null : el.value;
  }
  return out;
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
