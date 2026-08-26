// feel.ts — impact feel: hitstop, damage-scaled trauma, and heart danger states.
//
// WHY THIS EXISTS. M0c gave the sim an event stream (events.ts) and the camera
// a deterministic shake (cameras/registry.ts addTrauma), but nothing in between
// decided WHAT a given event is worth. main.ts called addTrauma(0.12) at one
// call site — a refused purchase — and every actual violent thing in the game
// (a shell landing, a critter dying, the heart taking a hit) went unfelt. This
// module is that missing table, plus the one effect that does more for impact
// than any amount of shake: stopping the frame.
//
// PURE, LIKE THE RIG. No three.js, no DOM, no Math.random, no wall clock. Time
// enters as dt. That is what keeps it under `node --test` alongside loop.ts and
// registry.ts, and it is why the constants live in an exported table rather
// than scattered through the frame callback.
//
// THE DETERMINISM LINE — READ THIS BEFORE WIRING. Hitstop scales RENDER time
// ONLY: the camera rig's dt, effect lifetimes, ring TTLs. It must NEVER touch
// the value handed to loop.advance(), because loop.ts steps world.tick at a
// FIXED dt precisely so that replay determinism holds (loop.ts header). A
// hitstop that shortened or lengthened simulated time would make the same seed
// and the same inputs produce different telemetry depending on how many things
// exploded — the exact failure the fixed timestep exists to prevent. The sim
// does not know hitstop exists; the player's eyes do.

import type { WorldEvent } from '../core/sim/events.ts';

/** Every tuned constant in one place, so a feel pass is one edit and one diff
 *  rather than a hunt through the frame callback. Trauma values are in the
 *  rig's units: addTrauma saturates at 1 and the rig squares it, so 0.1 is a
 *  barely-there tick and 0.5 is unmistakable. */
export const FEEL_DEFAULTS = {
  // --- hitstop -------------------------------------------------------------
  /** Ceiling on accumulated freeze. Past ~1/8s the pause stops reading as
   *  impact and starts reading as a dropped frame or a hung tab. */
  hitstopMax: 0.13,
  /** A hit that finished something — i.e. a kill. Roughly two frames at 60Hz:
   *  long enough to register as a stop, short enough that a busy fight does
   *  not become a slideshow. Deliberately NOT spent on every `impact` event —
   *  tower shells land continuously, and freezing on each one would make the
   *  view permanently choppy and cost kills their punctuation. The cap handles
   *  a whole swarm dying in one tick. */
  hitstopImpact: 0.035,
  /** The tank being hit. The player's own body: worth more than a hit they
   *  landed on someone else. */
  hitstopTank: 0.06,
  /** The heart being hit. The loudest thing that can happen on the board, and
   *  the only event the whole run is scored against. */
  hitstopHeart: 0.11,

  // --- trauma --------------------------------------------------------------
  /** Tank muzzle recoil. Tower fire deliberately gets none — see traumaFor. */
  traumaTankShot: 0.05,
  /** Hitscan laser. Barely a tick: it fires often and cannot miss. */
  traumaBeam: 0.02,
  /** Trauma for an impact dealing exactly impactRefDamage. */
  traumaImpactRef: 0.05,
  /** The damage a typical tower shot deals (towerspec HK(14) ≈ 2.52 against a
   *  5 HP default critter — the authored two-shot kill). Impacts scale
   *  linearly against this, so "reference hit" means what it says. */
  impactRefDamage: 2.5,
  /** Cap on impact trauma. A sniper (HK(62) ≈ 11.2) would otherwise be worth
   *  0.22 and a damage lever cranked to max far more; one shot should not
   *  white out the screen. */
  traumaImpactMax: 0.18,
  /** A critter dying. A nudge — kills are the common case, and if the common
   *  case shakes hard the camera never sits still and nothing feels special. */
  traumaCritterDied: 0.07,
  /** The tank taking a hit. */
  traumaTankHit: 0.26,
  /** The heart taking a hit, at full health. */
  traumaHeartHit: 0.42,
  /** How much a heart hit grows as the heart empties. At heartFrac 0 the hit
   *  is worth traumaHeartHit * (1 + this) = 0.84 — nearly the rig's ceiling.
   *  This IS the danger state: the same event hits harder the closer the run
   *  is to over, so losing feels like losing rather than like arithmetic. */
  heartDangerGain: 1.0,

  // --- danger states -------------------------------------------------------
  /** heartFrac at or below which the run reads as threatened. */
  dangerThreatened: 0.6,
  /** heartFrac at or below which the run reads as critical. */
  dangerCritical: 0.3,
  /** How far heartFrac must climb back ABOVE a threshold before the level
   *  relaxes. 0.06 exceeds one heart HP step (1/HEART_MAX_HP = 0.05), which is
   *  deliberate — see dangerLevel. */
  dangerHysteresis: 0.06,
} as const;

// ---------------------------------------------------------------------------
// Hitstop
// ---------------------------------------------------------------------------

export type Hitstop = {
  /** Request a freeze. Accumulates onto whatever is already running, capped at
   *  hitstopMax. */
  punch(seconds: number): void;
  /** Advance and return this frame's RENDER time scale in [0,1]. Multiply the
   *  camera/effect dt by it. NEVER the simulation's. */
  update(dt: number): number;
};

export function makeHitstop(maxSeconds: number = FEEL_DEFAULTS.hitstopMax): Hitstop {
  let remaining = 0;
  /** The length of the freeze currently running, so the ease-out knows what
   *  fraction is left rather than assuming a fixed duration. Reset to 0 the
   *  moment the freeze ends, so the next punch starts from a clean 1→0. */
  let span = 0;

  return {
    punch(seconds: number): void {
      // EXTEND, DO NOT RESTART. Assigning `remaining = seconds` would let a
      // small second hit CUT SHORT a big first one — the loudest moment of a
      // fight (many things landing at once) would then freeze less than a
      // single shot does, which is backwards.
      if (!(seconds > 0)) return;
      remaining = Math.min(maxSeconds, remaining + seconds);
      span = remaining;
    },

    update(dt: number): number {
      if (remaining <= 0) {
        span = 0;
        return 1;
      }
      // Scale is read BEFORE the decrement so the frame that follows a punch
      // is the frozen one. Reading after would spend the first frame already
      // partway out and the hit would feel mushy.
      const left = span > 0 ? clamp01(remaining / span) : 0;
      remaining = Math.max(0, remaining - Math.max(0, dt));
      if (remaining <= 0) span = 0;

      // Smoothstep out: sit near zero for the first part of the freeze, then
      // ease back to full speed. A linear ramp reads as slow-motion; snapping
      // straight back to 1 reads as a stutter. The pause should end the way a
      // held breath does.
      const k = 1 - left;
      return clamp01(k * k * (3 - 2 * k));
    },
  };
}

// ---------------------------------------------------------------------------
// Trauma mapping
// ---------------------------------------------------------------------------

/** What a single world event is worth in camera trauma, given how close the
 *  heart is to death (heartFrac = world.heartHp / HEART_MAX_HP).
 *
 *  THE RULE THIS TABLE ENCODES: the common case is quiet. Towers fire
 *  constantly and critters die constantly; if either shakes hard the camera
 *  hums permanently and the rare, expensive events lose their punctuation.
 *  Shake is a punctuation mark, and a page of exclamation marks says nothing. */
export function traumaFor(event: WorldEvent, heartFrac: number): number {
  const F = FEEL_DEFAULTS;
  switch (event.kind) {
    case 'shotFired':
      // Recoil belongs to the gun the player is holding. A tower firing is
      // someone else's business happening across the board.
      return event.source === 'tank' ? F.traumaTankShot : 0;

    case 'beam':
      return F.traumaBeam;

    case 'impact':
      // The only event carrying damage, so the only one that can be scaled by
      // it honestly. Linear against a reference hit, then capped — the cap is
      // what stops a sniper or a cranked tower.damage lever from turning one
      // shot into the whole frame.
      return clamp(
        F.traumaImpactRef * (event.damage / F.impactRefDamage),
        0,
        F.traumaImpactMax,
      );

    case 'critterDied':
      return F.traumaCritterDied;

    case 'tankHit':
      return F.traumaTankHit;

    case 'heartHit':
      // Damage-scaled by proxy: heartHit carries no damage field because every
      // hit costs exactly 1 HP (world.ts), so the thing that varies is not the
      // hit's size but its COST — the last point of heart is worth far more
      // than the first. That is what heartFrac buys here.
      return clamp01(F.traumaHeartHit * (1 + F.heartDangerGain * (1 - clamp01(heartFrac))));
  }
}

// ---------------------------------------------------------------------------
// Danger states
// ---------------------------------------------------------------------------

/** 0 calm · 1 threatened · 2 critical. */
export type DangerLevel = 0 | 1 | 2;

/** Which danger state a heart fraction reads as, given the state it was in.
 *
 *  WHY HYSTERESIS. A danger level is not a number on a readout, it is a set of
 *  expensive, visible commitments — palette shift, bloom push, a heartbeat
 *  under the mix. Toggling any of those at 30Hz because a value is sitting on
 *  a threshold looks like a rendering fault, not tension. And heartFrac WILL
 *  sit on a threshold: HEART_MAX_HP is 20, so every reachable value is a
 *  multiple of 0.05 and lands exactly on the round thresholds a designer picks
 *  — 12/20 is 0.6 to the pixel, and float division does not promise which side
 *  of `<=` it falls on. Worse, once a smoothed or animated heartFrac feeds in
 *  (a pulse, a lerp toward the new value), it crosses the line repeatedly on
 *  the way past.
 *
 *  So: escalating uses the bare threshold — danger should arrive the instant
 *  it is earned — while relaxing requires climbing dangerHysteresis ABOVE it.
 *  That band (0.06) is wider than one heart HP step (0.05) on purpose: a
 *  single point of heart clawed back should not switch the music off. Dread
 *  earns out slowly.
 *
 *  PURE BY DESIGN. Hysteresis needs memory, and the obvious home for it is a
 *  module-level `let` — which would make this function's result depend on
 *  hidden global state, order-dependent under `node --test`, and impossible to
 *  reason about in a replay. The previous level is a parameter instead; the
 *  caller owns the one variable. Call it as dangerLevel(frac) for a cold read.
 */
export function dangerLevel(heartFrac: number, prev: DangerLevel = 0): DangerLevel {
  const F = FEEL_DEFAULTS;
  const f = clamp01(heartFrac);
  const threatExit = F.dangerThreatened + F.dangerHysteresis;
  const critExit = F.dangerCritical + F.dangerHysteresis;

  if (prev === 2) {
    if (f <= critExit) return 2;
    return f > threatExit ? 0 : 1;
  }
  if (prev === 1) {
    if (f <= F.dangerCritical) return 2;
    return f > threatExit ? 0 : 1;
  }
  if (f <= F.dangerCritical) return 2;
  return f <= F.dangerThreatened ? 1 : 0;
}

// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
