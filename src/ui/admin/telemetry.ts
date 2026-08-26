// telemetry.ts — the live readout, in the two panes spec §5 defines.
//
// DIFFICULTY answers "is it hard enough". LAYER BALANCE answers "is each layer
// doing its job" — and that second pane is the one vision §0 says the rig
// exists for. macroShare and modeSwitches read 0 in every M0a sweep because
// nothing ever called setMacro; the camera family switch now feeds them.

import type { World } from '../../core/sim/world.ts';

const DIFFICULTY = [
  'survivedFor', 'heartHits', 'tankHits', 'leaks',
  'kills', 'ttkMean', 'waveClearMean', 'peakConcurrent',
];
const BALANCE = [
  'macroShare', 'modeSwitches', 'tankIdleUnderThreat',
  'decisionsTotal', 'playerKillShare', 'towerKillShare',
];

export type TelemetryView = { el: HTMLElement; sync(world: World): void };

export function makeTelemetryView(): TelemetryView {
  const el = document.createElement('div');
  el.className = 'admin-tel';
  const panes: Array<{ keys: string[]; body: HTMLElement }> = [];

  for (const [title, keys] of [['difficulty', DIFFICULTY], ['layer balance', BALANCE]] as const) {
    const pane = document.createElement('div');
    pane.className = 'admin-tel-pane';
    const h = document.createElement('div');
    h.className = 'admin-tel-h';
    h.textContent = title;
    const body = document.createElement('div');
    body.className = 'admin-tel-body';
    pane.append(h, body);
    el.appendChild(pane);
    panes.push({ keys: [...keys], body });
  }

  let frame = 0;
  return {
    el,
    sync(world) {
      // 6 Hz: these are numbers a human reads, and a 60 Hz DOM rewrite of ~14
      // fields competes with the bloom chain for the frame budget on a phone.
      frame += 1;
      if (frame % 10 !== 0) return;
      const s = world.telemetry.summary();
      for (const pane of panes) {
        pane.body.innerHTML = pane.keys
          .map((k) => `<div>${k}</div><div class="v">${format(s[k])}</div>`)
          .join('');
      }
    },
  };
}

function format(v: number | undefined): string {
  if (v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
