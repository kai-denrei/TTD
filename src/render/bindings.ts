// bindings.ts — how render-only levers reach the renderer, and how we prove it.
//
// THE PROBLEM. liveness.test.ts diffs telemetry at a lever's min and max to
// prove the lever is live. bloom.* and shake.amount can never move sim
// telemetry — they are render-only by design — so that gate cannot judge them,
// and they sat in a RENDER_ONLY exclusion set with the note "will be confirmed
// live in M0b". CLAUDE.md forbids unjustified exclusions; this is where the
// note comes due.
//
// THE FIX. Render levers are consumed through a declared table operating on a
// plain-data RenderTarget. Because the table is data and the target is a plain
// object, this module imports nothing from three.js and its tests run under
// node --test: no browser, no pixel diff, and it gates every commit alongside
// the rest of the suite. RENDER_ONLY stops being an exclusion and becomes a
// differently-tested set.
//
// WHAT THIS DOES NOT PROVE. That three.js honours the property once written.
// Nothing here can. That step is verified once by eye and recorded in the M0b
// notes — stated rather than papered over.
//
// LIVENESS RULE. readRenderState() is called every frame and reads through
// tuning.get() every time. Never hoist a get() out of it: a render lever
// captured at construction is exactly the bug the whole rig exists to prevent.

/** Plain-data mirror of the render state a frame needs. The three.js layer
 *  copies these onto the real UnrealBloomPass and camera rig. Plain data is
 *  what makes this Node-testable. */
export type RenderTarget = {
  bloom: { strength: number; radius: number; threshold: number };
  camera: { shakeGain: number };
};

export type RenderBinding = {
  key: string;
  apply(target: RenderTarget, value: number): void;
};

/** Must match liveness.test.ts's RENDER_ONLY set exactly; the coverage test
 *  fails if the two drift apart. */
export const RENDER_ONLY_KEYS: readonly string[] = [
  'bloom.strength',
  'bloom.radius',
  'bloom.threshold',
  'shake.amount',
];

export const RENDER_BINDINGS: readonly RenderBinding[] = [
  { key: 'bloom.strength', apply: (t, v) => { t.bloom.strength = v; } },
  { key: 'bloom.radius', apply: (t, v) => { t.bloom.radius = v; } },
  { key: 'bloom.threshold', apply: (t, v) => { t.bloom.threshold = v; } },
  { key: 'shake.amount', apply: (t, v) => { t.camera.shakeGain = v; } },
];

export function makeRenderTarget(): RenderTarget {
  return {
    bloom: { strength: 0, radius: 0, threshold: 0 },
    camera: { shakeGain: 0 },
  };
}

/** Refresh `target` from the live tuning store. Call once per frame. */
export function readRenderState(tuning: { get(key: string): number }, target: RenderTarget): void {
  for (const b of RENDER_BINDINGS) b.apply(target, tuning.get(b.key));
}
