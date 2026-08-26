// runner.ts — the single definition of "a comparable run".
//
// WHY THIS EXISTS. M0a's brain notes, finding #5: the sim has no terminal
// condition. At default tuning the heart dies between t~37s and t~98s
// depending on settings, but sweeps ran a flat 100s — so 2-63% of every row
// was post-mortem accrual, telemetry piling up on a dead game. A row that died
// at t=37 and a row that died at t=62 are not comparable without normalising.
//
// Rather than fix that at each call site (the sweep script, the Admin Mode
// compare worker, any future auto-tuner), truncation-at-death is a property of
// a run, enforced here once and consumed everywhere.
//
// SERIALISABILITY IS A REQUIREMENT, NOT A STYLE CHOICE. RunSpec is posted to a
// Web Worker via structuredClone, so every field must be plain data. That is
// why `input` and `towers` are string unions rather than the callbacks they
// would naturally be.

import { makeWorld } from './world.ts';
import { makeTuning } from '../tuning/store.ts';
import { nearestFrontierWall } from '../sphere/dungeon.ts';
import type { TankInput } from './tank.ts';

export type RunInput = 'idle' | 'patrol';
export type RunTowers = 'heart' | 'none' | readonly number[];

export type RunSpec = {
  seed: number;
  /** tuning.export() format: 'key=value;key=value'. Omitted = schema defaults. */
  preset?: string;
  /** Tick budget. Default 6000 = 100 s at 1/60. */
  maxTicks?: number;
  dt?: number;
  /** Stop the moment the heart dies. Default true — see the note above. */
  stopAtDeath?: boolean;
  input?: RunInput;
  /** 'heart' = the frontier wall nearest the heart (towers need high ground). */
  towers?: RunTowers;
};

export type RunResult = {
  summary: Record<string, number>;
  ticksRun: number;
  /** True when the run ended on heart death rather than exhausting maxTicks. */
  stoppedEarly: boolean;
};

const IDLE: TankInput = { forward: 0, turn: 0, fire: false };

/** A scripted session: drive back and forth, sweep the heading, hold fire.
 *
 *  Fire is HELD rather than pulsed since M0c-2. The tank gained heat and
 *  lockout, which make sustained fire self-limiting — so holding the trigger is
 *  both the realistic stress and the only way the heat levers are exercised at
 *  all. Before that change this pulsed 1 tick in 5, which added heat far slower
 *  than it cooled. */
function patrolInput(k: number): TankInput {
  return { forward: k % 120 < 60 ? 1 : -1, turn: Math.sin(k / 30), fire: true };
}

export function runHeadless(spec: RunSpec): RunResult {
  const dt = spec.dt ?? 1 / 60;
  const maxTicks = spec.maxTicks ?? 6000;
  const stopAtDeath = spec.stopAtDeath ?? true;
  const inputMode: RunInput = spec.input ?? 'idle';

  const tuning = makeTuning();
  if (spec.preset !== undefined && spec.preset !== '') tuning.import(spec.preset);

  const world = makeWorld({ seed: spec.seed, tuning });

  const towers = spec.towers ?? 'heart';
  if (towers === 'heart') {
    // 'heart' now means "the high ground nearest the heart" — towers cannot
    // stand on open floor (see world.placeTower). The name still describes the
    // intent, defend the heart; renaming it would churn the sweep script, the
    // compare worker and their tests for nothing.
    const cell = nearestFrontierWall(world.mesh, world.dungeon, world.dungeon.heart);
    if (cell !== -1) world.placeTower(cell);
  } else if (towers !== 'none') {
    for (const cell of towers) world.placeTower(cell);
  }

  let ticksRun = 0;
  let stoppedEarly = false;
  for (let k = 0; k < maxTicks; k++) {
    world.tick(dt, inputMode === 'patrol' ? patrolInput(k) : IDLE);
    ticksRun = k + 1;
    if (stopAtDeath && world.heartDied) {
      stoppedEarly = true;
      break;
    }
  }

  return { summary: world.telemetry.summary(), ticksRun, stoppedEarly };
}

/** Element-wise mean over runs. Used to average a seed set, because a single
 *  seed is not evidence: M0a's brain notes flag that all critters share one RNG
 *  stream, so changing a combat lever shifts every later critter's envelope
 *  draws. Multi-seed averaging is a mitigation, not a fix. */
export function meanSummaries(rs: readonly RunResult[]): Record<string, number> {
  if (rs.length === 0) return {};
  const out: Record<string, number> = {};
  const first = rs[0]!.summary;
  for (const key of Object.keys(first)) {
    let sum = 0;
    for (const r of rs) sum += r.summary[key] ?? 0;
    out[key] = sum / rs.length;
  }
  return out;
}
