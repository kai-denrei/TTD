// waves.ts — drip-based wave engine.
//
// Key design notes:
//
//  planWave():
//    Builds a WavePlan — a deterministic list of timed spawn events. Spawn
//    times are computed as:
//      rawAt[i] = i * dripRate * (1 + jitter * (rng()*2 - 1))
//    then sorted so jitter never reorders events. After sorting, events that
//    go negative (possible when jitter > 0 on index 0) are clamped to 0, and
//    then re-sorted so that no event is earlier than the previous one
//    (monotone enforcement).
//
//  WaveEngine state machine:
//    idle      → spawning  : immediately at construction (wave 1 starts right away)
//    spawning  → engaged   : all spawns fired; now watching enemiesAlive
//    engaged   → breathing : overlap threshold met; starts counting wave.gap
//    breathing → spawning  : gap timer expired; advance wave number, new plan
//
//  Overlap threshold (governs 0 <= overlap < 1 only):
//    threshold = overlap * count
//    overlap=0   → threshold=0  → wait until enemiesAlive <= 0 (full clear required)
//    intermediate → triggers once the global enemiesAlive count drops to ≤ overlap*count
//    e.g. overlap=0.75, count=10 → threshold=7.5 → next wave when 25% have died
//    Note: 'count' is the current wave's size, not total alive; for small waves the
//      bottom of the range is a dead zone (overlap=0.05, count=10 → threshold 0.5,
//      which behaves identically to overlap=0 because enemiesAlive is always an integer).
//    overlap >= 1: handled entirely by the spawning→breathing shortcut in makeWaveEngine;
//      the engaged branch is unreachable at overlap=1 — the engine never enters 'engaged'.
//
//  Live reads: dripRate, dripJitter, overlap, gap, size, sizeGrowth, hpGrowth,
//    and enemy.hp are all read from the store at plan/tick time — never captured.

import type { TuningStore } from '../tuning/store.ts';
import type { Rng } from './rng.ts';
import { typesByWave, ENEMY_BY_TYPE } from './enemyspec.ts';

export type SpawnEvent = { at: number; gate: number; type: string };
export type WavePlan = { wave: number; count: number; hp: number; events: SpawnEvent[] };

/** HP for one spawn: the wave curve times the type's own multiplier. Keeping
 *  the two separate means enemy.hp and wave.hpGrowth still tune the whole board
 *  while the roster keeps its internal spread — a prime is always tankier than
 *  a phage, at every difficulty. */
export function hpFor(type: string, waveHp: number): number {
  return waveHp * (ENEMY_BY_TYPE.get(type)?.hp ?? 1);
}
export type WaveState = 'building' | 'idle' | 'spawning' | 'engaged' | 'breathing';

export type WaveEngine = {
  state: WaveState;
  wave: number;
  tick(dt: number, ctx: { enemiesAlive: number; onSpawn: (gate: number, hp: number, type: string) => void }): void;
  plan(): WavePlan | null;
  timeToNext(): number;
};

export function planWave(wave: number, tuning: TuningStore, rng: Rng, gates: number[]): WavePlan {
  const size = tuning.get('wave.size');
  const sizeGrowth = tuning.get('wave.sizeGrowth');
  const dripRate = tuning.get('wave.dripRate');
  const dripJitter = tuning.get('wave.dripJitter');
  const baseHp = tuning.get('enemy.hp');
  const hpGrowth = tuning.get('wave.hpGrowth');

  // count: wave 1 = size; wave N = size + sizeGrowth * (N-1)
  const count = Math.round(size + sizeGrowth * (wave - 1));

  // hp: base * growth^(wave-1)
  const hp = baseHp * Math.pow(hpGrowth, wave - 1);

  // Build raw spawn times with jitter
  const rawTimes: number[] = [];
  for (let i = 0; i < count; i++) {
    // jitter factor in [-jitter, +jitter]; rng() * 2 - 1 gives [-1, 1]
    const jf = dripJitter > 0 ? dripJitter * (rng() * 2 - 1) : 0;
    rawTimes.push(i * dripRate * (1 + jf));
  }

  // Sort times to preserve ordering (jitter may have disturbed it)
  rawTimes.sort((a, b) => a - b);

  // Ensure non-negative and monotone: clamp to max(0, prev)
  let prev = 0;
  for (let i = 0; i < rawTimes.length; i++) {
    const t = rawTimes[i]!;
    const clamped = Math.max(i === 0 ? 0 : prev, t < 0 ? 0 : t);
    rawTimes[i] = clamped;
    prev = clamped;
  }

  // ── surges ────────────────────────────────────────────────────────────────
  // A wave that arrives on a perfect metronome has no shape. Surges pull a
  // fraction of the spawns forward onto a few shared instants, so the wave has
  // a middle — the "here it comes" beat — rather than only a start and an end.
  // The PoC audit named burst-only spawning as its core pacing failure; this is
  // deliberately the opposite of that, a drip WITH punctuation.
  const surgeCount = Math.round(tuning.get('wave.surgeCount'));
  if (surgeCount > 0 && rawTimes.length > 2) {
    const span = rawTimes[rawTimes.length - 1]! || 1;
    const share = tuning.get('wave.surgeSize');
    const perSurge = Math.max(1, Math.floor((rawTimes.length * share) / surgeCount));
    for (let sIdx = 0; sIdx < surgeCount; sIdx++) {
      // Surges sit inside the wave, never at its very start or end: a surge on
      // the first spawn is just a lump, and one on the last is just the tail.
      const at = span * ((sIdx + 1) / (surgeCount + 1));
      const start = Math.min(
        rawTimes.length - perSurge,
        Math.max(0, Math.round(rawTimes.length * ((sIdx + 1) / (surgeCount + 1)))),
      );
      for (let k = 0; k < perSurge; k++) rawTimes[start + k] = at;
    }
    rawTimes.sort((a, b) => a - b);
  }

  // Assign gates round-robin, and pick a TYPE per spawn.
  //
  // Composition follows the reference ladder: wave N draws from the first N
  // introduced types, with the NEWEST type as the headline and older ones
  // sprinkled behind it. That is what makes a wave read as "here is a new idea,
  // plus what you already know how to fight" rather than as a uniform blob.
  // Difficulty ramps by which behaviours are present, not by count alone.
  const pool = typesByWave(wave);
  const headline = pool[pool.length - 1]!;

  // NO MULTI-FRONT YET, AND IT IS NOT A TUNING PROBLEM. Both references open a
  // second route mid-run — HokorobiTawaa after wave 6 — as a deliberate
  // rug-pull that turns a perfect kill-box into half a defence. A lever for it
  // was written and then removed, because TTD cannot express it: gates are the
  // open neighbours of ONE spawn cell, which yields 1-2 of them (seed 42, the
  // liveness seed, has exactly ONE). Gating "which gates are live" on a board
  // with one gate does nothing at all.
  //
  // This needs real PORTALS — several spawn points placed around the board,
  // as the PoC has — not a scheduling lever. Until then a wave has one front.
  //
  // ATTEMPTED AND REVERTED TWICE. Recorded in full because the second attempt
  // looked like it addressed the first attempt's flaw and did not.
  //
  // (2) Real PORTALS — three spawn points at 62% of the board's reach, spread
  // greedily apart, with the tank starting AT THE HEART instead of at the spawn
  // so it defends rather than camps the source. That is the correct design on
  // paper and it lost 5/5 seeds where the shipped build wins 5/5.
  //
  // Every hypothesis was tested and none held. Staging the second front later
  // did not help (gateOpenAt 20, so it never opens inside 12 waves: still 0/5).
  // Money was not the constraint either — 4x bounty with easier HP growth still
  // lost every seed. Tower siting was not it: the calibration heuristic was
  // re-pointed at the portals and the numbers did not move.
  //
  // The real coupling is that the tank at the SPAWN was farming kills at a
  // chokepoint, and that farm was quietly funding the whole economy. Moving it
  // to the heart is better design and removes the funding, and no income lever
  // tested closes the gap. Multi-front is therefore not a portals problem: it
  // needs the economy re-derived for a tank that defends instead of farms.
  //
  // (1) Gates spread greedily to the far side of the board.
  // It made the mechanic expressible and made the GAME worse — critters walked
  // very long paths, so fewer fights happened anywhere near the tank or the
  // heart, and FIVE levers went dead in liveness (tank.fireRate among them,
  // because the tank simply stopped meeting anything). Multi-front is not a
  // gate-placement problem; it needs portals that are near enough to threaten,
  // plus a tank that starts near what it is defending rather than at the spawn.
  const gateCount = gates.length;
  const events: SpawnEvent[] = rawTimes.map((at, i) => {
    // Every third spawn is the headline; the rest are drawn from the back
    // catalogue so early types keep appearing instead of being retired.
    const type = i % 3 === 0
      ? headline
      : pool[Math.floor(rng() * pool.length)] ?? headline;
    return { at, gate: gates[i % gateCount]!, type };
  });

  return { wave, count, hp, events };
}

export function makeWaveEngine(tuning: TuningStore, rng: Rng, gates: number[]): WaveEngine {
  // Starts in 'building', not mid-fight. You begin a run holding credit with
  // nowhere to have spent it; a wave that lands immediately reads as the game
  // starting without you. Both references open with a build phase.
  let state: WaveState = 'building';
  let buildLeft = tuning.get('wave.buildTime');
  let waveNum = 0;
  let currentPlan: WavePlan | null = null;
  let spawnCursor = 0;   // index into currentPlan.events, next event to fire
  let waveTime = 0;      // seconds elapsed since current wave started
  let breathTimer = 0;   // countdown during breathing state

  function startNextWave(): void {
    waveNum += 1;
    currentPlan = planWave(waveNum, tuning, rng, gates);
    spawnCursor = 0;
    waveTime = 0;
    state = 'spawning';
  }

  // Wave 1 waits for the build phase. If buildTime is 0 the very first tick
  // starts it, so the lever's floor still behaves like the old immediate start.
  function tick(dt: number, ctx: { enemiesAlive: number; onSpawn: (gate: number, hp: number, type: string) => void }): void {
    if (state === 'building') {
      // Read LIVE so dragging the lever during a build phase takes effect —
      // capturing it at construction is exactly the bug the rig exists to catch.
      buildLeft = Math.min(buildLeft, tuning.get('wave.buildTime'));
      buildLeft -= dt;
      if (buildLeft <= 0) startNextWave();
      return;
    }
    if (state === 'idle') return;

    if (state === 'spawning') {
      waveTime += dt;
      const plan = currentPlan!;
      // Fire all events whose time has arrived
      while (spawnCursor < plan.events.length) {
        const evt = plan.events[spawnCursor]!;
        if (waveTime >= evt.at) {
          ctx.onSpawn(evt.gate, hpFor(evt.type, plan.hp), evt.type);
          spawnCursor++;
        } else {
          break;
        }
      }
      // All spawns fired — transition to engaged (or breathing if overlap=1)
      if (spawnCursor >= plan.events.length) {
        const overlap = tuning.get('wave.overlap');
        if (overlap >= 1) {
          // overlap=1: start next wave as soon as spawning finishes, no field check
          breathTimer = tuning.get('wave.gap');
          state = 'breathing';
        } else {
          state = 'engaged';
        }
      }
      return;
    }

    if (state === 'engaged') {
      // Check overlap condition (only reached when overlap < 1).
      // threshold = overlap * count  (0 <= overlap < 1)
      // overlap=0   → threshold=0  → full clear required before advancing.
      // overlap >= 1 → handled by the spawning→breathing shortcut; never reaches here.
      // 'count' is the current wave's size; 'enemiesAlive' is the global live count.
      // They are not comparable at face value — the threshold is a sizing signal
      // derived from wave count, not a cap on total alive enemies.
      const plan = currentPlan!;
      const overlap = tuning.get('wave.overlap');
      const threshold = overlap * plan.count;
      if (ctx.enemiesAlive <= threshold) {
        // Transition to breathing
        breathTimer = tuning.get('wave.gap');
        state = 'breathing';
      }
      return;
    }

    if (state === 'breathing') {
      breathTimer -= dt;
      if (breathTimer <= 0) {
        startNextWave();
      }
      return;
    }
  }

  return {
    get state() { return state; },
    get wave() { return waveNum; },
    tick,
    plan() { return currentPlan; },
    timeToNext() {
      if (state === 'breathing') return Math.max(0, breathTimer);
      if (state === 'spawning' && currentPlan) {
        const last = currentPlan.events[currentPlan.events.length - 1];
        return last ? Math.max(0, last.at - waveTime) : 0;
      }
      return 0;
    },
  };
}
