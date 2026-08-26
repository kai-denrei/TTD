// hud.ts — the player-facing HUD. The ONLY UI a non-admin session shows.
//
// Four things: heart HP, wave, enemies alive, and a run-over card. Anything
// more is Admin Mode leaking into the game — the tuning rig is internal
// tooling and none of it belongs in front of a player.
//
// Writes are diffed against the last value. Setting textContent every frame
// forces layout 60x/s for numbers that change about once a second, and on a
// phone that competes directly with the bloom chain for the frame budget.

import { HEART_MAX_HP } from '../core/sim/world.ts';
import type { World } from '../core/sim/world.ts';

export type Hud = {
  sync(world: World): void;
  showRunOver(summary: Record<string, number>): void;
};

export function makeHud(root: HTMLElement): Hud {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML =
    `<span>heart <b data-f="heart">${HEART_MAX_HP}</b>/${HEART_MAX_HP}</span>` +
    `<span>wave <b data-f="wave">0</b></span>` +
    `<span><b data-f="alive">0</b> alive</span>`;
  root.appendChild(el);

  const over = document.createElement('div');
  over.className = 'runover';
  over.hidden = true;
  root.appendChild(over);

  const fields = new Map<string, HTMLElement>();
  for (const node of Array.from(el.querySelectorAll<HTMLElement>('[data-f]'))) {
    const name = node.dataset['f'];
    if (name !== undefined) fields.set(name, node);
  }
  const last = new Map<string, string>();

  function set(name: string, value: string): void {
    if (last.get(name) === value) return;
    last.set(name, value);
    const node = fields.get(name);
    if (node !== undefined) node.textContent = value;
  }

  return {
    sync(world) {
      set('heart', String(Math.max(0, world.heartHp)));
      set('wave', String(world.waves.wave));
      set('alive', String(world.critters.filter((c) => c.alive).length));
    },
    showRunOver(summary) {
      if (!over.hidden) return;
      over.hidden = false;
      const survived = (summary['survivedFor'] ?? 0).toFixed(1);
      const kills = summary['kills'] ?? 0;
      over.innerHTML =
        `<h2>run over</h2><p>survived ${survived}s · ${kills} kills</p>` +
        `<p class="sub">reload to run again</p>`;
    },
  };
}
