// dashboard.ts — the tuning panel, rendered entirely from LEVERS.
//
// SPEC §4 IS THE RULE HERE: one declarative schema is the single source of
// truth, and a new lever is ONE entry, not four edits. If adding a lever ever
// requires touching this file, the schema has stopped being authoritative.
// Nothing below names a specific lever.
//
// This is a TOOL, not a game surface. Density over discoverability: no
// onboarding, no animation, no aesthetic budget. It is a fullscreen modal so
// all 28 levers fit on a phone instead of scrolling in a sliver.
//
// LIVENESS: every write goes through tuning.set(), and systems already read
// tuning.get() inside their tick — so liveness is inherited, not
// re-implemented. There is no apply button, by design.

import { LEVERS } from '../../core/tuning/store.ts';
import type { TuningStore, Lever, LeverGroup } from '../../core/tuning/store.ts';
import type { World } from '../../core/sim/world.ts';
import { makePresets } from './presets.ts';
import { makeTelemetryView } from './telemetry.ts';
import { makeCompare } from './compare.ts';

const GROUP_ORDER: LeverGroup[] = ['intensity', 'critters', 'player', 'feel', 'camera', 'god'];
const OPEN_KEY = 'ttd.admin.open';

export type Dashboard = { toggle(): void; sync(world: World): void; el: HTMLElement };

export function makeDashboard(tuning: TuningStore, root: HTMLElement): Dashboard {
  const el = document.createElement('div');
  el.className = 'admin';

  const head = document.createElement('div');
  head.className = 'admin-head';
  const title = document.createElement('b');
  title.textContent = 'ADMIN · tuning';
  head.append(
    title,
    button('reset all', () => tuning.reset()),
    button('close', () => toggle()),
  );
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'admin-body';
  el.appendChild(body);

  const tel = makeTelemetryView();
  body.appendChild(tel.el);
  body.appendChild(makePresets(tuning).el);
  body.appendChild(makeCompare(tuning).el);

  // Each lever keeps its own updater: rebuilding the DOM on every change would
  // drop focus mid-drag, which makes a slider unusable.
  const refreshers: Array<() => void> = [];

  for (const group of GROUP_ORDER) {
    const levers = LEVERS.filter((l) => l.group === group);
    if (levers.length === 0) continue;

    const section = document.createElement('details');
    section.className = 'admin-group';
    section.open = group === 'intensity';

    const summary = document.createElement('summary');
    summary.textContent = `${group} (${levers.length})`;
    const reset = button('reset', (e) => { e.stopPropagation(); tuning.reset(group); });
    reset.className = 'admin-mini';
    summary.appendChild(reset);
    section.appendChild(summary);

    for (const lever of levers) section.appendChild(row(lever));
    body.appendChild(section);
  }

  function row(lever: Lever): HTMLElement {
    const isBool = lever.min === 0 && lever.max === 1 && lever.step === 1;
    const wrap = document.createElement('label');
    wrap.className = 'admin-row';
    wrap.title = lever.help;

    const name = document.createElement('span');
    name.className = 'admin-name';
    name.textContent = lever.label;

    const value = document.createElement('span');
    value.className = 'admin-value';

    const control = document.createElement('input');
    control.dataset['lever'] = lever.key;
    if (isBool) {
      control.type = 'checkbox';
      control.checked = tuning.flag(lever.key);
      control.addEventListener('change', () => tuning.set(lever.key, control.checked ? 1 : 0));
    } else {
      control.type = 'range';
      control.min = String(lever.min);
      control.max = String(lever.max);
      control.step = String(lever.step);
      control.value = String(tuning.get(lever.key));
      control.addEventListener('input', () => tuning.set(lever.key, Number(control.value)));
    }

    function refresh(): void {
      const v = tuning.get(lever.key);
      if (isBool) control.checked = v !== 0;
      else if (document.activeElement !== control) control.value = String(v);
      value.textContent = isBool ? (v !== 0 ? 'on' : 'off') : formatValue(v, lever.step);
    }
    refresh();
    refreshers.push(refresh);

    wrap.append(name, control, value);
    return wrap;
  }

  // The store is the single source of truth, so a change from ANY source
  // (preset load, ?preset=, reset all) repaints the panel.
  tuning.onChange(() => { for (const fn of refreshers) fn(); });

  root.appendChild(el);

  function toggle(): void {
    el.hidden = !el.hidden;
    try { localStorage.setItem(OPEN_KEY, el.hidden ? '0' : '1'); } catch { /* ignore */ }
  }

  // Default to OPEN. This code only runs once the gate has been deliberately
  // opened (?admin=1, backtick, or a five-tap corner), so hiding the panel the
  // operator just asked for is a surprise. Only an explicit previous "close"
  // keeps it shut — and spec §6 wants that choice to persist, since the panel
  // gets opened hundreds of times.
  try {
    el.hidden = localStorage.getItem(OPEN_KEY) === '0';
  } catch {
    el.hidden = false;
  }

  return {
    toggle,
    el,
    // Skip the work entirely while the panel is closed.
    sync(world) { if (!el.hidden) tel.sync(world); },
  };
}

function formatValue(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : (String(step).split('.')[1]?.length ?? 2);
  return v.toFixed(decimals);
}

function button(label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
