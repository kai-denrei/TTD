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
import type { World } from './world.ts';

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

/** A scripted session: drive back and forth, TURN TOWARD THE NEAREST THREAT,
 *  and hold fire.
 *
 *  Fire is HELD rather than pulsed since M0c-2. The tank gained heat and
 *  lockout, which make sustained fire self-limiting — so holding the trigger is
 *  both the realistic stress and the only way the heat levers are exercised.
 *
 *  IT AIMS, and that is a deliberate trade. M0c-2 gave the tank a fire arc, and
 *  a script that merely swept its heading never pointed at anything: it killed
 *  nothing, so playerKillShare read 0.00 in every sweep. Spec §5 calls
 *  player-kills vs tower-kills the sharpest single number in M0, and a metric
 *  pinned at zero is worse than one that flatters. This aimer is perfect and
 *  never panics, so treat playerKillShare from a sweep as an UPPER BOUND on
 *  what a person would achieve — it is a comparative number, not an absolute.
 *
 *  Falls back to the old heading sweep when nothing is alive, so the tank still
 *  moves (and still exercises the movement levers) on an empty board. */
export function patrolInput(k: number, world: World): TankInput {
  const forward = k % 120 < 60 ? 1 : -1;

  let nearest: { d: number; pos: readonly [number, number, number] } | null = null;
  for (const c of world.critters) {
    if (!c.alive) continue;
    const dx = c.pos[0] - world.tank.pos[0];
    const dy = c.pos[1] - world.tank.pos[1];
    const dz = c.pos[2] - world.tank.pos[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (nearest === null || d < nearest.d) nearest = { d, pos: c.pos };
  }
  if (nearest === null) return { forward, turn: Math.sin(k / 30), fire: true };

  // Which way to turn: the sign of (heading x toward) . normal tells us whether
  // the target sits to the left or right on the tangent plane.
  const t = world.tank;
  const n = t.pos; // unit sphere: position IS the surface normal
  const toward: [number, number, number] = [
    nearest.pos[0] - t.pos[0], nearest.pos[1] - t.pos[1], nearest.pos[2] - t.pos[2],
  ];
  const cx = t.heading[1] * toward[2] - t.heading[2] * toward[1];
  const cy = t.heading[2] * toward[0] - t.heading[0] * toward[2];
  const cz = t.heading[0] * toward[1] - t.heading[1] * toward[0];
  const side = cx * n[0] + cy * n[1] + cz * n[2];
  // stepTank negates turn (a positive turn is a right turn), so steer by -sign.
  const turn = side > 0 ? -1 : side < 0 ? 1 : 0;
  return { forward, turn, fire: true };
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
    world.tick(dt, inputMode === 'patrol' ? patrolInput(k, world) : IDLE);
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
