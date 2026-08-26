// rng.ts — the only source of randomness in TTD's simulation.
//
// Determinism is a design pillar: a run must be reproducible or tuning means
// nothing. `Math.random` is banned in core/ — every stochastic decision draws
// from a named, seeded stream so two runs with the same seed play identically.
//
// Separate streams (one per concern: waves, minds, terrain) keep systems from
// perturbing each other — adding a coin-flip to the wave planner must not
// change how critters path.

/** A deterministic 0..1 generator. */
export type Rng = () => number;

/** mulberry32 — small, fast, good enough for gameplay; not cryptographic. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit int, so streams can be named rather than numbered. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A named sub-stream of a run's seed. `stream(7, 'waves')` and
 * `stream(7, 'minds')` are independent but both reproducible from seed 7.
 */
export function stream(seed: number, name: string): Rng {
  return mulberry32((seed ^ hashSeed(name)) | 0);
}

/** Uniform float in [lo, hi). */
export function range(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** Uniform integer in [lo, hi] inclusive. */
export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Pick one element; throws on an empty list rather than returning undefined. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() from an empty list');
  const item = items[Math.floor(rng() * items.length)];
  // noUncheckedIndexedAccess: the bounds are guaranteed above, but prove it.
  if (item === undefined) throw new Error('pick() index out of range');
  return item;
}

/** Fisher-Yates into a new array; the input is untouched. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
