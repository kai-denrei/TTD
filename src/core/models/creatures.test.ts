import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATURE_MODELS,
  amoebaPts,
  batPts,
  coronaPts,
  jellyfishPts,
  neuronPts,
  phagePts,
  slimePts,
  spiderPts,
  ufoPts,
} from './creatures.ts';
import { ENEMY_BY_TYPE } from '../sim/enemyspec.ts';

// Exact counts are derived from generator structure, not observed from a run.
// If one of these fails, the PORT is wrong, not the test.
//
// ufo       = 75 dome (of 150 fib dirs, those with y >= 0) + 460 disc
//             + 90 rim + 8 under-lights.
// bat       = 90 body + 14 ears (2 sides x 7) + 110 wings
//             (2 x [17 leading + 31 trailing + 7 strut]) + 2 eyes.
// corona    = 320 shell + 44 spikes x (3 stalk + 6 knob); every knob dot is lit,
//             so highlights = 44 x 6 = 264.
// phage     = 200 head + 150 sheath (15 rings x 10) + 60 baseplate (30 x 2 radii)
//             + 84 legs (6 x 2 segments x 7); one lit foot tip per leg.
// amoeba    = 620 membrane + 44 nucleus (all lit) + 28 vacuoles (2 x 14).
// jellyfish = 150 bell (of 300, y >= 0) + 40 rim + 336 tentacles (16 x 21)
//             + 52 oral arms (4 x 13).
// slime     = 286 dome (of 520, y >= -0.1) + 64 drip base.
// spider    = 150 abdomen + 70 head + 112 legs (2 x 4 x 2 x 7) + 2 eyes.
// neuron    = 74 soma + 138 dendrites (6 x [9 trunk + 2 forks x 7]) + 17 axon
//             + 5 terminals.
const MODELS = [
  { name: 'ufo', fn: ufoPts, points: 633, highlights: 8 },
  { name: 'bat', fn: batPts, points: 216, highlights: 2 },
  { name: 'corona', fn: coronaPts, points: 716, highlights: 264 },
  { name: 'phage', fn: phagePts, points: 494, highlights: 6 },
  { name: 'amoeba', fn: amoebaPts, points: 692, highlights: 44 },
  { name: 'jellyfish', fn: jellyfishPts, points: 578, highlights: 0 },
  { name: 'slime', fn: slimePts, points: 350, highlights: 0 },
  { name: 'spider', fn: spiderPts, points: 334, highlights: 2 },
  { name: 'neuron', fn: neuronPts, points: 234, highlights: 5 },
] as const;

describe('creature models', () => {
  for (const m of MODELS) {
    test(`${m.name} has exactly ${m.points} points`, () => {
      assert.equal(m.fn().length, m.points);
    });

    test(`${m.name} has exactly ${m.highlights} highlight dots`, () => {
      assert.equal(m.fn().filter((p) => p[3] === 1).length, m.highlights);
    });

    test(`${m.name} fits inside the unit sphere and touches it`, () => {
      let max = 0;
      for (const p of m.fn()) {
        const r = Math.hypot(p[0], p[1], p[2]);
        assert.ok(r <= 1 + 1e-9, `${m.name} point escapes the unit sphere at r=${r}`);
        if (r > max) max = r;
      }
      assert.ok(Math.abs(max - 1) < 1e-9, `${m.name} never reaches r=1; fitUnit did not normalise`);
    });

    test(`${m.name} every point has 4 finite components`, () => {
      for (const p of m.fn()) {
        assert.equal(p.length, 4);
        for (const c of p) assert.ok(Number.isFinite(c));
      }
    });

    test(`${m.name} highlight flag is only ever 0 or 1`, () => {
      for (const p of m.fn()) assert.ok(p[3] === 0 || p[3] === 1, `bad highlight flag ${p[3]}`);
    });

    test(`${m.name} is deterministic across calls`, () => {
      assert.deepEqual(m.fn(), m.fn());
    });
  }
});

describe('CREATURE_MODELS lookup', () => {
  test('every key is a real enemy type', () => {
    for (const key of CREATURE_MODELS.keys()) {
      assert.ok(ENEMY_BY_TYPE.has(key), `${key} is not an enemy type in enemyspec.ts`);
    }
  });

  // Guards the promise the map's comment makes: exactly these four fall back to
  // the mine model. If a model is added, this list must be edited deliberately.
  test('exactly the documented types fall back to the mine model', () => {
    const missing = [...ENEMY_BY_TYPE.keys()].filter((t) => !CREATURE_MODELS.has(t));
    assert.deepEqual(missing.sort(), ['drifter', 'knot', 'prime', 'rolling']);
  });

  test('every mapped generator returns a non-trivial cloud', () => {
    for (const [key, fn] of CREATURE_MODELS) {
      const pts = fn();
      assert.ok(pts.length > 100, `${key} produced only ${pts.length} points`);
    }
  });

  test('no two enemy types share a generator — the roster must not re-fuse', () => {
    const fns = [...CREATURE_MODELS.values()];
    assert.equal(new Set(fns).size, fns.length);
  });
});
