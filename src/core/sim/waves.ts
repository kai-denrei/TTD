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
//  Overlap threshold:
//    threshold = overlap * count
//    overlap=0 → threshold=0 → wait until enemiesAlive <= 0 (full clear required)
//    overlap=1 → threshold=count → enemiesAlive <= count always true once spawning
//      starts → next wave triggers immediately (never waits)
//    intermediate → triggers once enemiesAlive <= overlap*count
//    e.g. overlap=0.75, count=10 → threshold=7.5 → next wave when 25% have died
//
//  Live reads: dripRate, dripJitter, overlap, gap, size, sizeGrowth, hpGrowth,
//    and enemy.hp are all read from the store at plan/tick time — never captured.

import type { TuningStore } from '../tuning/store.ts';
import type { Rng } from './rng.ts';

export type SpawnEvent = { at: number; gate: number };
export type WavePlan = { wave: number; count: number; hp: number; events: SpawnEvent[] };
export type WaveState = 'idle' | 'spawning' | 'engaged' | 'breathing';

export type WaveEngine = {
  state: WaveState;
  wave: number;
  tick(dt: number, ctx: { enemiesAlive: number; onSpawn: (gate: number, hp: number) => void }): void;
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

  // Assign gates round-robin
  const gateCount = gates.length;
  const events: SpawnEvent[] = rawTimes.map((at, i) => ({
    at,
    gate: gates[i % gateCount]!,
  }));

  return { wave, count, hp, events };
}

export function makeWaveEngine(tuning: TuningStore, rng: Rng, gates: number[]): WaveEngine {
  let state: WaveState = 'idle';
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

  // Kick off wave 1 immediately
  startNextWave();

  function tick(dt: number, ctx: { enemiesAlive: number; onSpawn: (gate: number, hp: number) => void }): void {
    if (state === 'idle') return;

    if (state === 'spawning') {
      waveTime += dt;
      const plan = currentPlan!;
      // Fire all events whose time has arrived
      while (spawnCursor < plan.events.length) {
        const evt = plan.events[spawnCursor]!;
        if (waveTime >= evt.at) {
          ctx.onSpawn(evt.gate, plan.hp);
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
      // Check overlap condition.
      // threshold = overlap * count
      // overlap=0 → 0 (full clear); overlap=1 → count (always triggers, handled
      // via spawning→breathing shortcut above); intermediate → fraction of wave.
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
