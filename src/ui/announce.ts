// announce.ts — the board's narrator: build phase, new threats, run over.
//
// A wave that arrives silently is a wave the player fights twice — once
// without knowing what it is, and again after guessing wrong. The reference
// opens every wave with a card, and the beat that actually teaches is the
// NEW THREAT one: the roster is twelve structural questions (enemyspec.ts),
// and a type whose difference is never stated reads as "the same enemy, but
// my tactic stopped working". Naming it at the moment it arrives is the
// difference between early waves that teach and early waves that overwhelm.
//
// Four cards, and no fifth:
//   BUILD      persistent, counts down — the only moment the board is quiet
//              enough to read, so it says what to do with it.
//   NEW THREAT the type's label + why it is different. One per introduction.
//   WAVE N     the fallback beat, brief, for waves that introduce nothing.
//   RUN OVER   persistent, won or lost.
//
// THE PURE HALF IS EXPORTED SEPARATELY, as in shop.ts: newTypesInWave,
// announcementFor and formatCountdown take plain values and return plain
// values, so announce.test.ts runs them under `node --test` with no DOM.
// Only makeAnnounce touches `document`.
//
// Writes are diffed like hud.ts. The only text that changes per-frame is the
// build countdown, and it changes about once a second — re-writing it 60x/s
// would cost a layout pass against the bloom chain for nothing.
//
// NOTE: hud.ts also owns a run-over card (`showRunOver`), which reports the
// telemetry summary. This one reports the OUTCOME, in the banner stack, in
// the same voice as the wave cards. If they are ever unified, this is the
// half to delete — the summary is the one carrying information.

import { INTROS, ENEMY_BY_TYPE } from '../core/sim/enemyspec.ts';
import type { World } from '../core/sim/world.ts';

// ---- Pure helpers (no DOM) --------------------------------------------------

export type AnnounceKind = 'build' | 'threat' | 'wave' | 'won' | 'lost';

export type Announcement = {
  kind: string;
  title: string;
  body: string;
};

/** Seconds a transient card lives before it is pulled. Long enough to read a
 *  help line at a glance, short enough that it is gone before the wave it
 *  announces reaches the tank. */
export const CARD_LIFETIME = 4.2;

/** Seconds of that lifetime spent fading. The card is still in the DOM during
 *  this window, carrying `is-fading`, so the transition is the stylesheet's
 *  business and not a timer here. */
export const CARD_FADE = 0.9;

/** Types introduced at EXACTLY this wave, in ladder order.
 *
 *  Not `typesByWave`, which is cumulative: the card is about what is NEW, and
 *  a cumulative list would re-announce the phage every wave forever. Waves past
 *  the end of the ladder introduce nothing and return empty — endless mode
 *  keeps drawing from the full roster, but it has no more surprises to name. */
export function newTypesInWave(wave: number): readonly string[] {
  const n = Math.floor(wave);
  if (!Number.isFinite(n) || n < 1) return [];
  return INTROS.filter((iv) => iv.wave === n).map((iv) => iv.type);
}

/** The card the board should be showing, or null when it should show nothing.
 *
 *  PRIORITY IS THE WHOLE FUNCTION. A run that has just ended must not be
 *  narrating wave 9; a build phase must not be interrupted by a wave card it
 *  precedes. Highest first:
 *    1. lost / won   — the run is over, nothing else is news
 *    2. build        — the pre-wave phase, which is a state, not an event
 *    3. new threat   — a type arriving for the first time
 *    4. wave start   — the fallback beat
 *  `lost` is tested before `won` because a heart death is unambiguous:
 *  world.won can only be set with the heart alive (world.ts), so both true at
 *  once is a bug elsewhere and this is the reading that is safe to show.
 *
 *  `state` is a plain string rather than WaveState so callers and tests can
 *  pass one without importing the wave engine's type. */
export function announcementFor(
  wave: number,
  state: string,
  won: boolean,
  lost: boolean,
): Announcement | null {
  if (lost) {
    return {
      kind: 'lost',
      title: 'THE HEART IS LOST',
      body: 'The core went dark. Reload to run again.',
    };
  }
  if (won) {
    const n = Math.max(0, Math.floor(wave));
    return {
      kind: 'won',
      title: `SURVIVED — ${n} waves`,
      body: 'The board is clear and the heart still beats.',
    };
  }
  if (state === 'building') {
    return {
      kind: 'build',
      title: 'BUILD',
      body: 'Place towers on the lit high ground before the first wave lands.',
    };
  }
  const n = Math.floor(wave);
  if (!Number.isFinite(n) || n < 1) return null;

  const fresh = newTypesInWave(n);
  if (fresh.length > 0) {
    return {
      kind: 'threat',
      title: `NEW THREAT — ${fresh.map(labelOf).join(' + ')}`,
      body: fresh.map(briefOf).join(' · '),
    };
  }
  return { kind: 'wave', title: `WAVE ${n}`, body: '' };
}

/** The spec's label, never a string repeated here. A type with no spec is a
 *  ladder entry pointing at nothing — a bug in enemyspec.ts, not a reason for
 *  the narrator to throw mid-run, so it degrades to the raw id. */
function labelOf(type: string): string {
  return ENEMY_BY_TYPE.get(type)?.label ?? type.toUpperCase();
}

/** Why this one is different: the intro's one-line role, then the spec's own
 *  help text. The role says what it IS; the help says what it costs you. */
function briefOf(type: string): string {
  const role = INTROS.find((iv) => iv.type === type)?.role ?? '';
  const help = ENEMY_BY_TYPE.get(type)?.help ?? '';
  if (role === '') return help;
  if (help === '') return role;
  return `${role} — ${help}`;
}

/** Seconds remaining, as the player should read them.
 *
 *  CEIL, NOT ROUND: a countdown that shows "0" while a second of build time
 *  is still on the clock is lying at the exact moment the lie costs a tower.
 *  Negative and non-finite inputs clamp to zero — the phase is over, and a
 *  banner reading "-2s" is a bug report the player cannot file. */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  return `${Math.ceil(seconds)}s`;
}

/** Cards that stay until their condition ends, rather than ageing out. */
function isPersistent(kind: string): boolean {
  return kind === 'build' || kind === 'won' || kind === 'lost';
}

/** One card per phase, one card per wave. Keying the transient cards by wave
 *  (not by kind alone) is what stops a wave being re-announced every frame it
 *  spends in 'spawning', while still letting wave 9 speak after wave 8 did. */
function keyFor(kind: string, wave: number): string {
  return isPersistent(kind) ? kind : `${kind}:${Math.floor(wave)}`;
}

// ---- The narrator itself ----------------------------------------------------

export type Announce = {
  el: HTMLElement;
  /** Called once per frame with the same dt the world was ticked with. */
  sync(dt: number): void;
};

type Card = {
  key: string;
  kind: string;
  node: HTMLElement;
  /** Seconds of life left. Ignored for persistent cards. */
  left: number;
  /** The countdown slot, on the build card only. */
  count: HTMLElement | null;
};

export function makeAnnounce(world: World, root: HTMLElement): Announce {
  const el = document.createElement('div');
  el.className = 'announce';
  root.appendChild(el);

  const cards: Card[] = [];
  // Everything ever shown. A card that reappears is worse than one that never
  // showed: the player reads it as a second phage wave, not as a repeat.
  const seen = new Set<string>();

  // Mirrors the engine's own build countdown (waves.ts), which is not exposed —
  // timeToNext() returns 0 while building. Read LIVE and clamped exactly as the
  // engine does, so dragging wave.buildTime during the phase moves both.
  let buildLeft = world.tuning.get('wave.buildTime');
  let lastCount = '';

  function push(a: Announcement, key: string): Card {
    const node = document.createElement('div');
    node.className = `announce-card is-${a.kind}`;
    const title = document.createElement('div');
    title.className = 'announce-title';
    title.textContent = a.title;
    node.appendChild(title);
    if (a.body !== '') {
      const body = document.createElement('div');
      body.className = 'announce-body';
      body.textContent = a.body;
      node.appendChild(body);
    }
    let count: HTMLElement | null = null;
    if (a.kind === 'build') {
      count = document.createElement('div');
      count.className = 'announce-count';
      node.appendChild(count);
    }
    el.appendChild(node);
    const card: Card = { key, kind: a.kind, node, left: CARD_LIFETIME, count };
    cards.push(card);
    return card;
  }

  function drop(i: number): void {
    const card = cards[i];
    if (card === undefined) return;
    card.node.remove();
    cards.splice(i, 1);
  }

  function sync(dt: number): void {
    const waves = world.waves;
    const building = waves.state === 'building';
    if (building) {
      buildLeft = Math.min(buildLeft, world.tuning.get('wave.buildTime')) - dt;
    }

    const next = announcementFor(waves.wave, waves.state, world.won, world.heartDied);
    if (next !== null) {
      const key = keyFor(next.kind, waves.wave);
      if (!seen.has(key)) {
        seen.add(key);
        push(next, key);
      }
    }

    // Age transient cards; retire the build card the instant the phase ends
    // rather than letting it linger over a wave that has already spawned.
    for (let i = cards.length - 1; i >= 0; i--) {
      const card = cards[i];
      if (card === undefined) continue;
      if (card.kind === 'build') {
        if (!building) drop(i);
        continue;
      }
      if (isPersistent(card.kind)) continue;
      card.left -= dt;
      if (card.left <= 0) {
        drop(i);
        continue;
      }
      // Diffed: toggle() on an unchanged class still costs a class-list write.
      const fading = card.left <= CARD_FADE;
      if (fading && !card.node.classList.contains('is-fading')) {
        card.node.classList.add('is-fading');
      }
    }

    if (building) {
      const text = formatCountdown(buildLeft);
      if (text !== lastCount) {
        lastCount = text;
        for (const card of cards) {
          if (card.count !== null) card.count.textContent = text;
        }
      }
    }
  }

  return { el, sync };
}
