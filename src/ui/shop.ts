// shop.ts — pick the tower before you tap the board.
//
// Until now placement had one tower and one verb: tap. The roster in
// towerspec.ts is eight structurally different towers, and none of them is
// reachable without a way to say which one you mean. That is all this is — a
// selector plus the two numbers you need to choose between them.
//
// IT SITS OVER A GAME, so it is compact and mobile-legible rather than dense
// like Admin Mode. The dashboard is a tool and can trade discoverability for
// information; this is a game surface and cannot.
//
// UNAFFORDABLE ROWS ARE DIMMED, NEVER HIDDEN OR DISABLED. A tower you cannot
// buy yet is the most useful thing the shop can show you: it is what the next
// forty credits are for. Removing it turns saving up into a surprise.
//
// AFFORDABILITY IS COMPUTED THE WAY THE ECONOMY COMPUTES IT. economy.canAfford
// rounds the cost UP before comparing, because credit is integral by design
// (economy.ts: "a player who cannot afford a 50-credit tower while holding
// 49.999999 has hit a rounding artefact"). A shop that used a bare `>=` would
// eventually offer a purchase the world then refuses, and the player would
// read that as the button being broken.
//
// THE PURE HALF IS EXPORTED SEPARATELY. affordability/statLine/nextUpgrade/
// cellSize/rangeWorld take plain values and return plain values, so they are
// tested by shop.test.ts under `node --test` with no DOM anywhere. Only
// makeShop touches `document`.
//
// Writes are diffed, like hud.ts: the credit readout changes a few times a
// second and the class list changes on a click, so re-writing either every
// frame buys nothing and costs a layout pass against the bloom chain.

import {
  TOWER_ORDER, TOWER_BY_KEY, MAX_TIER, upgradeCost, effectiveStats, unlockedKeys,
} from '../core/sim/towerspec.ts';
import type { TowerSpec } from '../core/sim/towerspec.ts';
import type { World } from '../core/sim/world.ts';

// ---- Pure helpers (no DOM) --------------------------------------------------

export type Affordability = 'affordable' | 'tooExpensive';

/** Whether `credit` buys something priced at `cost`.
 *  Exactly-equal credit IS affordable, and the ceiling matches
 *  Economy.canAfford so the shop can never offer a purchase world.placeTower
 *  will then refuse. */
export function affordability(credit: number, cost: number): Affordability {
  return credit >= Math.ceil(cost) ? 'affordable' : 'tooExpensive';
}

/** The one line under a tower's name: "2.52 dmg" is noise on a phone, so every
 *  number is fixed to one decimal — in a monospace column that also lines the
 *  rows up, which is most of what makes eight rows scannable.
 *
 *  The trailing tag is the tower's STRUCTURAL difference, not another number.
 *  A roster that advertised only damage/range/rate would read as one tower
 *  with a slider, which is exactly what the roster was built not to be. */
export function statLine(spec: TowerSpec): string {
  const parts = [
    `${spec.damage.toFixed(1)} dmg`,
    `${spec.rangeCells.toFixed(1)} cells`,
    `${spec.rate.toFixed(1)}/s`,
  ];
  const tag = signature(spec);
  if (tag !== null) parts.push(tag);
  return parts.join(' · ');
}

function signature(spec: TowerSpec): string | null {
  switch (spec.attack) {
    case 'spread': return `x${spec.pellets ?? 1}`;
    case 'mortar': return `splash ${(spec.splashCells ?? 0).toFixed(1)}`;
    // slowFactor MULTIPLIES speed (critters.ts), so 0.45 is a 55% slow. Naming
    // it the other way round would advertise the opposite of what it does.
    case 'slowfield': return `slow ${Math.round((1 - (spec.slowFactor ?? 1)) * 100)}%`;
    case 'homing': return 'seeks';
    case 'beam': return 'hitscan';
    case 'single': return null;
  }
}

/** What it costs to take a tower from `tier` to the next one, or null when
 *  there is no next one. Wraps upgradeCost so callers never have to know that
 *  the tier ceiling and the price table live in two separate places. */
export function nextUpgrade(spec: TowerSpec, tier: number): { cost: number; tier: number } | null {
  if (tier < 0 || tier >= MAX_TIER) return null;
  const cost = upgradeCost(spec, tier);
  if (cost === null) return null;
  return { cost, tier: tier + 1 };
}

/** World units per cell.
 *
 *  Tower ranges are authored in CELLS and converted with the mesh's mean chord
 *  (towers.ts), but World does not expose meanChord — it exposes
 *  tankContactRadius, which world.ts defines as 0.4 x meanChord. Dividing that
 *  factor back out is a seam, so it lives here, named, in ONE place, rather
 *  than as a bare 0.4 sprinkled through main.ts. If world.ts ever publishes
 *  meanChord directly, this function is the only thing to delete. */
export const TANK_CONTACT_FRACTION = 0.4;

export function cellSize(world: { tankContactRadius: number }): number {
  return world.tankContactRadius / TANK_CONTACT_FRACTION;
}

/** The radius, in world units, that a tower of this spec and tier actually
 *  shoots to. Mirrors towers.ts exactly — including the tower.range lever,
 *  because a ring drawn from the unscaled spec would be a picture of a tower
 *  that does not exist at the current tuning. */
export function rangeWorld(
  spec: TowerSpec,
  tier: number,
  cell: number,
  rangeScale: number,
): number {
  return effectiveStats(spec, tier).rangeCells * cell * rangeScale;
}

// ---- The shop itself --------------------------------------------------------

export type Shop = {
  el: HTMLElement;
  /** The tower key the next placement should use. */
  readonly selectedKey: string;
  sync(): void;
};

export function makeShop(world: World, root: HTMLElement): Shop {
  const el = document.createElement('div');
  el.className = 'shop';

  const credit = document.createElement('div');
  credit.className = 'shop-credit';
  credit.innerHTML = '<b data-f="credit">0</b> cr';
  el.appendChild(credit);

  const list = document.createElement('div');
  list.className = 'shop-list';
  el.appendChild(list);

  type Row = { node: HTMLElement; spec: TowerSpec };
  const rows: Row[] = [];

  for (const key of TOWER_ORDER) {
    const spec = TOWER_BY_KEY.get(key);
    if (spec === undefined) continue; // a ladder entry with no tower is a bug elsewhere, not a crash here
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'shop-row';
    node.dataset['key'] = spec.key;
    const up = nextUpgrade(spec, 0);
    node.title = up === null ? spec.help : `${spec.help}\n\nupgrade to tier 1: ${up.cost} cr`;
    node.innerHTML =
      `<span class="shop-name">${spec.label}</span>` +
      `<span class="shop-cost">${spec.cost}</span>` +
      `<span class="shop-stat">${statLine(spec)}</span>`;
    list.appendChild(node);
    rows.push({ node, spec });
  }

  const first = rows[0];
  let selectedKey = first === undefined ? 'single' : first.spec.key;

  // One delegated listener rather than eight: the rows never change, but a
  // listener per row is eight closures to keep in step with nothing.
  list.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest<HTMLElement>('.shop-row');
    const key = row?.dataset['key'];
    if (key === undefined || key === selectedKey) return;
    // A locked row is readable and inert: tapping it must not arm a purchase
    // that placeTower would then refuse, which would read as the shop lying.
    if (row?.classList.contains('is-locked') === true) return;
    selectedKey = key;
    paintSelection();
  });

  const creditNode = credit.querySelector<HTMLElement>('[data-f="credit"]');
  let lastCredit = '';
  // Keyed on a composite of lock+affordability, not affordability alone: a row
  // that becomes locked while staying unaffordable still needs a repaint.
  const lastRowState = new Map<string, string>();
  let lastSelected = '';

  function paintSelection(): void {
    if (lastSelected === selectedKey) return;
    lastSelected = selectedKey;
    for (const row of rows) {
      row.node.classList.toggle('is-selected', row.spec.key === selectedKey);
    }
  }

  function sync(): void {
    const c = world.economy.credit;
    const text = String(c);
    if (text !== lastCredit) {
      lastCredit = text;
      if (creditNode !== null) creditNode.textContent = text;
    }
    // Locked towers are shown but not selectable. Both references introduce one
    // new tower per wave rather than opening the shop at once — a player handed
    // eight towers on wave 1 has to evaluate a matrix; a player handed a second
    // tower on wave 2 has to answer a question. Showing the locked rows is the
    // point: you can see what is coming and plan the credit for it.
    const unlocked = new Set(unlockedKeys(world.waves.wave));
    for (const row of rows) {
      const locked = !unlocked.has(row.spec.key);
      const aff = affordability(c, row.spec.cost);
      const state = `${locked ? 'L' : 'u'}${aff}`;
      if (lastRowState.get(row.spec.key) === state) continue;
      lastRowState.set(row.spec.key, state);
      row.node.classList.toggle('is-locked', locked);
      row.node.classList.toggle('is-poor', !locked && aff === 'tooExpensive');
    }
    // If the wave rolled back past the selection (or the run restarted), fall
    // back to a tower that is actually available rather than silently selling
    // the player something placeTower will refuse.
    if (!unlocked.has(selectedKey)) selectedKey = TOWER_ORDER[0]!;
    paintSelection();
  }

  paintSelection();
  sync();
  root.appendChild(el);

  return {
    el,
    get selectedKey() { return selectedKey; },
    sync,
  };
}
