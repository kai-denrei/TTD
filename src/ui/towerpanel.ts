// towerpanel.ts — what this tower is, what the next tier would make it, and
// what selling it pays back.
//
// The shop answers "which tower do I buy?". Nothing until now answered "was
// that tower worth the credit, and what does another 28 credits do to it?" —
// which is the harder question, because a tier is bought against a tower that
// already exists and is already killing (or failing to kill) things.
//
// THE NEXT TIER IS SHOWN AS A DELTA, NEVER AS AN ABSOLUTE. "dmg 3.9" is a
// number you have to hold the old one beside to read; "dmg 2.5 → 3.9" is the
// decision itself. That matters more here than anywhere else in the UI because
// effectiveStats' tier-2 signature bonus is deliberately ASYMMETRIC (mortar
// gets splash, spread gets pellets, single gets rate): a panel that printed one
// fixed row of numbers would flatten exactly the difference the roster exists
// to express. So the rows are computed by diffing two effectiveStats calls and
// only the ones that MOVED are printed — the panel never has to know which
// tower gets which bonus, and it cannot fall out of step with towerspec.ts.
//
// IT NEVER MUTATES THE WORLD. Upgrade and Sell call injected callbacks with the
// cell; the shell owns the mutation. That keeps this file testable-adjacent and
// stops a UI surface from becoming a second, divergent copy of the economy's
// rules — the panel PROPOSES (planUpgrade), the world DISPOSES.
//
// AFFORDABILITY IS COMPUTED THE WAY THE ECONOMY COMPUTES IT — ceiling the cost
// before comparing, matching economy.canAfford and shop.ts. A panel that used a
// bare `>=` would eventually enable an upgrade the world then refuses, and the
// player reads that as a broken button rather than as a rule.
//
// THE PURE HALF IS EXPORTED SEPARATELY. planUpgrade/statDeltas/refundPreview
// take plain values and return plain values, so towerpanel.test.ts exercises
// them under `node --test` with no DOM anywhere. Only makeTowerPanel touches
// `document`.
//
// Writes are diffed, like hud.ts and shop.ts. The credit readout moves several
// times a second while the tower's identity moves on a click, so the two are
// keyed separately: the stat block is rebuilt only when the TOWER changes, and
// the buttons only when credit or the refund lever changes.

import { MAX_TIER, upgradeCost, effectiveStats, sellRefund, TOWER_BY_KEY } from '../core/sim/towerspec.ts';
import type { TowerSpec, EffectiveStats } from '../core/sim/towerspec.ts';
import type { Tower } from '../core/sim/towers.ts';
import type { World } from '../core/sim/world.ts';

// ---- Pure helpers (no DOM) --------------------------------------------------

export type UpgradePlan = {
  ok: boolean;
  reason?: string;
  /** Ceilinged price of the next tier; 0 when there is no next tier. */
  cost: number;
  fromTier: number;
  toTier: number;
};

/** Whether `credit` buys the next tier for a tower of `spec` at `tier`.
 *
 *  Refusals carry DIFFERENT reasons on purpose: "maxed" and "short" are two
 *  unrelated facts about the board, and a button that greys out for both with
 *  one message teaches the player nothing about which one they are looking at.
 *
 *  Exactly-equal credit IS a purchase — the boundary is the whole decision, and
 *  the ceiling matches Economy.canAfford so the panel can never offer an
 *  upgrade the world will then refuse. */
export function planUpgrade(spec: TowerSpec, tier: number, credit: number): UpgradePlan {
  const raw = tier >= MAX_TIER ? null : upgradeCost(spec, tier);
  if (raw === null) {
    return { ok: false, reason: 'maxed', cost: 0, fromTier: tier, toTier: tier };
  }
  const cost = Math.ceil(raw);
  if (credit < cost) {
    return {
      ok: false,
      reason: `${cost - credit} cr short`,
      cost,
      fromTier: tier,
      toTier: tier + 1,
    };
  }
  return { ok: true, cost, fromTier: tier, toTier: tier + 1 };
}

/** Refund for selling `tower` at refund `fraction`.
 *
 *  Clamped into [0, spent] rather than trusting the lever. eco.sellRefund is
 *  authored 0..1 today, but a preset string sets levers by text and a refund
 *  that exceeded what was sunk in would turn sell-and-rebuy into an income
 *  source — a money printer is a worse bug than a wrong number, because it
 *  invalidates every economy reading taken after it. */
export function refundPreview(tower: Pick<Tower, 'spent'>, fraction: number): number {
  const spent = Math.max(0, tower.spent);
  return Math.max(0, Math.min(spent, sellRefund(spent, fraction)));
}

// The stat table, in the order a player reads it. `show` answers "does this
// number mean anything for THIS tower?" — every tower carries all eight fields
// because EffectiveStats is flat, but a single-shot tower with "pellets 1" and
// "splash 0" is four rows of nothing between the three that matter.
type StatRow = {
  label: string;
  pick(s: EffectiveStats): number;
  fmt(v: number): string;
  show(v: number): boolean;
};

const one = (v: number): string => v.toFixed(1);
const int = (v: number): string => String(Math.round(v));
// slowFactor MULTIPLIES speed (critters.ts), so 0.45 is a 55% slow. Naming it
// the other way round would advertise the opposite of what it does.
const pct = (v: number): string => `${Math.round((1 - v) * 100)}%`;
const always = (): boolean => true;

const STAT_ROWS: readonly StatRow[] = [
  { label: 'dmg', pick: (s) => s.damage, fmt: one, show: always },
  { label: 'range', pick: (s) => s.rangeCells, fmt: one, show: always },
  { label: 'rate', pick: (s) => s.rate, fmt: one, show: always },
  { label: 'speed', pick: (s) => s.projSpeed, fmt: one, show: (v) => v > 0 },
  { label: 'pellets', pick: (s) => s.pellets, fmt: int, show: (v) => v > 1 },
  { label: 'splash', pick: (s) => s.splashCells, fmt: one, show: (v) => v > 0 },
  { label: 'slow', pick: (s) => s.slowFactor, fmt: pct, show: (v) => v < 1 },
  { label: 'slow for', pick: (s) => s.slowDur, fmt: one, show: (v) => v > 0 },
];

export type StatDelta = { label: string; from: string; to: string };

/** The before/after rows for a tier change: ONLY the stats that actually moved.
 *
 *  Both halves of that are load-bearing. A mortar's splash is untouched from
 *  tier 0 to 1 and multiplied at tier 2, so listing splash on the first upgrade
 *  would advertise a bonus the player has not bought yet. And the comparison is
 *  on the FORMATTED strings, not the raw floats: a change too small to survive
 *  one decimal place prints as "3.5 → 3.5", which reads as the panel being
 *  broken rather than as a rounding artefact. */
export function statDeltas(spec: TowerSpec, fromTier: number, toTier: number): StatDelta[] {
  const a = effectiveStats(spec, fromTier);
  const b = effectiveStats(spec, toTier);
  const out: StatDelta[] = [];
  for (const row of STAT_ROWS) {
    const from = row.fmt(row.pick(a));
    const to = row.fmt(row.pick(b));
    if (from === to) continue;
    out.push({ label: row.label, from, to });
  }
  return out;
}

/** The tower as it stands: the same table, filtered to the rows that mean
 *  something for this attack kind. Not exported — statDeltas is the half worth
 *  asserting on, and this is a rendering of one effectiveStats call. */
function currentRows(spec: TowerSpec, tier: number): StatDelta[] {
  const s = effectiveStats(spec, tier);
  const out: StatDelta[] = [];
  for (const row of STAT_ROWS) {
    const v = row.pick(s);
    if (!row.show(v)) continue;
    out.push({ label: row.label, from: row.fmt(v), to: '' });
  }
  return out;
}

// ---- The panel itself -------------------------------------------------------

export type TowerPanelOptions = {
  /** Apply the upgrade the panel just proposed. The shell owns the mutation:
   *  the panel has already checked planUpgrade().ok, but the world is expected
   *  to re-check — a UI guard is a courtesy, not a rule. */
  onUpgrade(cell: number): void;
  /** Sell the tower on `cell`. Typically world.sellTower. */
  onSell(cell: number): void;
};

export type TowerPanel = {
  el: HTMLElement;
  /** Inspect the tower on `cell`, or null to dismiss. Repaints immediately so a
   *  tap does not wait for the next frame. */
  select(cell: number | null): void;
  readonly selectedCell: number | null;
  sync(): void;
};

export function makeTowerPanel(world: World, root: HTMLElement, opts: TowerPanelOptions): TowerPanel {
  const el = document.createElement('div');
  el.className = 'towerpanel';
  el.hidden = true;
  el.innerHTML =
    '<div class="tp-head">' +
      '<span class="tp-name" data-f="name"></span>' +
      '<span class="tp-tier" data-f="tier"></span>' +
    '</div>' +
    '<div class="tp-now" data-f="now"></div>' +
    '<div class="tp-next" data-f="next"></div>' +
    '<div class="tp-actions">' +
      '<button type="button" class="tp-upgrade" data-f="upgrade"></button>' +
      '<button type="button" class="tp-sell" data-f="sell"></button>' +
    '</div>';
  root.appendChild(el);

  const fields = new Map<string, HTMLElement>();
  for (const node of Array.from(el.querySelectorAll<HTMLElement>('[data-f]'))) {
    const name = node.dataset['f'];
    if (name !== undefined) fields.set(name, node);
  }
  const upgradeBtn = fields.get('upgrade');
  const sellBtn = fields.get('sell');

  let selectedCell: number | null = null;
  // Two keys, not one. The tower block is expensive (two effectiveStats calls
  // and a row of innerHTML) and changes on a click; the buttons are cheap and
  // change with the credit readout. Keying them together would rebuild the
  // stat table sixty times a second for a number that did not move.
  let lastTowerKey = '';
  let lastButtonKey = '';

  function towerAt(cell: number | null): Tower | undefined {
    if (cell === null) return undefined;
    return world.towers.find((t) => t.cell === cell);
  }

  function set(name: string, value: string): void {
    const node = fields.get(name);
    if (node !== undefined && node.textContent !== value) node.textContent = value;
  }

  function rowsHtml(rows: readonly StatDelta[], arrow: boolean): string {
    return rows
      .map((r) => {
        const value = arrow
          ? `<span class="tp-from">${r.from}</span><span class="tp-arrow">→</span><span class="tp-to">${r.to}</span>`
          : `<span class="tp-to">${r.from}</span>`;
        return `<span class="tp-row"><span class="tp-label">${r.label}</span>${value}</span>`;
      })
      .join('');
  }

  function hide(): void {
    if (!el.hidden) el.hidden = true;
    lastTowerKey = '';
    lastButtonKey = '';
  }

  function sync(): void {
    const tower = towerAt(selectedCell);
    if (tower === undefined) {
      // The tower was sold, or the selection never had one. Clearing the cell
      // as well as hiding matters: a stale cell would silently re-adopt the
      // NEXT tower built on that spot, and the panel would appear to open by
      // itself.
      selectedCell = null;
      hide();
      return;
    }
    const spec = TOWER_BY_KEY.get(tower.key);
    if (spec === undefined) {
      // A tower carrying a key the roster does not have is a bug elsewhere, not
      // a crash here.
      hide();
      return;
    }
    if (el.hidden) el.hidden = false;

    const plan = planUpgrade(spec, tower.tier, world.economy.credit);

    const towerKey = `${tower.id}|${tower.key}|${tower.tier}`;
    if (towerKey !== lastTowerKey) {
      lastTowerKey = towerKey;
      set('name', spec.label);
      set('tier', `tier ${tower.tier}/${MAX_TIER}`);
      const now = fields.get('now');
      if (now !== undefined) now.innerHTML = rowsHtml(currentRows(spec, tower.tier), false);
      const next = fields.get('next');
      if (next !== undefined) {
        next.innerHTML = plan.toTier > plan.fromTier
          ? rowsHtml(statDeltas(spec, plan.fromTier, plan.toTier), true)
          : '';
      }
    }

    const refund = refundPreview(tower, world.tuning.get('eco.sellRefund'));
    const buttonKey = `${plan.ok ? 'y' : 'n'}|${plan.reason ?? ''}|${plan.cost}|${refund}`;
    if (buttonKey !== lastButtonKey) {
      lastButtonKey = buttonKey;
      // The label SAYS WHICH refusal it is. A disabled button with no reason
      // makes the player go looking for a bug; "maxed" and "12 cr short" are
      // two different next actions.
      set('upgrade',
        plan.reason === 'maxed' ? 'max tier'
          : plan.ok ? `upgrade · ${plan.cost} cr`
            : `upgrade · ${plan.cost} cr (${plan.reason})`);
      set('sell', `sell · +${refund} cr`);
      if (upgradeBtn instanceof HTMLButtonElement) upgradeBtn.disabled = !plan.ok;
      if (upgradeBtn !== undefined) upgradeBtn.classList.toggle('is-poor', !plan.ok && plan.reason !== 'maxed');
    }
  }

  upgradeBtn?.addEventListener('click', () => {
    const cell = selectedCell;
    const tower = towerAt(cell);
    if (cell === null || tower === undefined) return;
    const spec = TOWER_BY_KEY.get(tower.key);
    // Re-checked at the moment of the click, not trusted from the last paint:
    // credit moves between frames, and a click on a button painted one frame
    // ago must not spend money the player no longer has.
    if (spec === undefined || !planUpgrade(spec, tower.tier, world.economy.credit).ok) return;
    opts.onUpgrade(cell);
    sync();
  });

  sellBtn?.addEventListener('click', () => {
    const cell = selectedCell;
    if (cell === null || towerAt(cell) === undefined) return;
    opts.onSell(cell);
    // Repaint now rather than next frame: the tower is gone, and a panel still
    // offering to sell it is a button that does nothing.
    sync();
  });

  function select(cell: number | null): void {
    selectedCell = cell;
    lastTowerKey = '';
    lastButtonKey = '';
    sync();
  }

  sync();

  return {
    el,
    select,
    get selectedCell() { return selectedCell; },
    sync,
  };
}
