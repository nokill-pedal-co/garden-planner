// Title screen: magic-link sign in, or play locally.

import { h, sprite, field, toast } from '../ui.js';
import { spriteURL } from '../sprites.js';
import * as sync from '../sync.js';

export function renderTitle({ enterLocal }) {
  const status = h('p.small.muted', { role: 'status', 'aria-live': 'polite' });
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com', autofocus: true });
  const go = h('button.btn.primary', { type: 'submit' }, sprite('icon_seed', { size: 24 }), 'Send magic link');

  const form = h('form.stack', {
    onsubmit: async e => {
      e.preventDefault();
      go.disabled = true;
      status.textContent = 'Sending…';
      try {
        await sync.sendMagicLink(email.value.trim());
        status.textContent = `Check ${email.value.trim()} — tap the link and you're in.`;
      } catch (err) {
        status.textContent = '';
        toast(err.message, { error: true });
      } finally {
        go.disabled = false;
      }
    },
  }, field('Email', email), go, status);

  const screen = h('div.title-screen',
    h('div.title-card.px',
      sprite('icon_sprout', { size: 96, cls: 'logo-big', alt: '' }),
      h('h1', 'Garden Planner'),
      h('p.tag', 'Beds, seeds, frost dates, harvests.'),
      sync.configured() ? form : h('p.small.muted', 'Cloud sync is not configured yet.'),
      h('hr.pix-hr'),
      h('button.btn', { onclick: () => enterLocal() }, 'Play offline (this device only)'),
    ));
  screen.style.backgroundImage = `url(${spriteURL('tile_grass')})`;
  return screen;
}
