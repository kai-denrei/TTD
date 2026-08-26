// sound.ts — synthesised Web Audio voices for the world event feed.
//
// WHY A LEAF. Audio is downstream of everything and upstream of nothing:
// nothing in core/ or render/ may import this file. It reads the same
// `WorldEvent[]` the renderer drains and turns it into sound. The only import
// is a *type*, so there is no runtime edge into core at all.
//
// SYNTHESIS ONLY, NO SAMPLES. Ported (re-typed, re-shaped, trimmed) from the
// DeepWatch stack at ~/Documents/Dev/centroid-defense/audio.js. Every voice is
// oscillators + a shared noise buffer + gain envelopes + filters. No asset
// loading, no decode latency, no bytes in the bundle.
//
// RATE LIMITING IS THE POINT. A mortar splash resolves eight `impact` events in
// one tick, and the event buffer allows up to 512 per tick. One voice per event
// is a wall of noise AND a frame-budget hazard (every voice is 3-5 nodes plus a
// scheduled teardown). So: events are accumulated into a short window, collapsed
// per kind to a hard cap, priority-ordered, and clipped to a global ceiling.
// Collapsed duplicates come back as a small gain boost — eight simultaneous
// impacts should sound *bigger*, not eight times.
//
// MATH.RANDOM IS DELIBERATE HERE. The noise buffer and the per-voice pitch
// jitter both draw from Math.random. That is legal *only* because nothing in
// this file feeds back into the simulation — audio is write-only with respect
// to world state. The determinism pillar (core/architecture.test.ts) covers
// core/; this module must never be imported from there.

import type { WorldEvent } from '../core/sim/events.ts';

type EventKind = WorldEvent['kind'];

// ---------------------------------------------------------------------------
// Rate limiting — pure, testable, no AudioContext anywhere near it.
// ---------------------------------------------------------------------------

/** Events are batched into a window this wide before any voice is scheduled.
 *  45ms is a little under three frames at 60fps: short enough that an isolated
 *  shot in a quiet moment fires effectively instantly (the window has already
 *  elapsed), long enough that a burst spanning several ticks is collapsed as
 *  one burst instead of once per tick. */
export const WINDOW_MS = 45;

/** Voices per kind per window. These are small on purpose — past two or three
 *  simultaneous copies of the same timbre the ear stops counting and starts
 *  hearing mud, so extra voices buy nothing but CPU and masking. */
export const PER_WINDOW_CAPS: Readonly<Record<EventKind, number>> = {
  // A whole battery can fire on the same tick. Three overlapping clicks read as
  // "several towers firing"; beyond that they smear into a single buzz.
  shotFired: 3,
  // Beams are tonal and near-sustained. Two is already a chord; three is mush.
  beam: 2,
  // The most common event by far — every projectile hit plus every splash
  // victim. Three noise bursts still sound like debris; ten sound like static.
  impact: 3,
  // The pitch-drop is the most melodic voice, so stacked copies read as a
  // broken arpeggio rather than as "several things died".
  critterDied: 2,
  // Loudest and longest voice, and the one that must never be ambiguous.
  // Several heart hits inside 45ms are one alarm, not several.
  heartHit: 1,
  // "You are being hurt" — a discrete signal. Doubling it only makes it vague.
  tankHit: 1,
};

/** Cap for a kind nobody budgeted for. An unbudgeted kind is by definition one
 *  whose burst behaviour we have not thought about, so it gets the most
 *  conservative audible answer: one voice per window, never unlimited. */
export const DEFAULT_CAP = 1;

/** Hard ceiling on voices scheduled in a single window, across all kinds.
 *  The per-kind caps sum to 12; in the worst frame that is ~267 voices/sec,
 *  which is more node churn than the frame budget should ever spend on audio.
 *  Six is comfortably above what a busy-but-legible moment needs. */
export const MAX_VOICES_PER_WINDOW = 6;

/** Ceiling on the pending kind list between flushes. The event buffer already
 *  caps at 512/tick, but `play()` may be called several times before a window
 *  elapses; this makes the pending array bounded by a constant rather than by
 *  how long the tab was starved. Anything past it is dropped, not queued —
 *  a dropped duplicate is inaudible, an unbounded queue is a leak. */
export const MAX_PENDING = 192;

/** Which voice wins when the global ceiling bites. Higher survives. This
 *  matters because events arrive in tick order — shots, then impacts, then
 *  deaths, then heart/tank hits — so a naive "first six" would systematically
 *  starve exactly the two voices the player most needs to hear. */
export const PRIORITY: Readonly<Record<EventKind, number>> = {
  heartHit: 5,
  tankHit: 4,
  critterDied: 3,
  impact: 2,
  beam: 1,
  shotFired: 0,
};

/**
 * Collapse a window's worth of event kinds down to the kinds that will actually
 * be voiced. Order of the survivors is preserved (arrival order), so the caller
 * can still schedule them with a natural stagger.
 *
 * A kind absent from `caps` falls back to DEFAULT_CAP — never to "unlimited",
 * which is the failure mode this whole function exists to prevent.
 */
export function throttle(kinds: readonly string[], caps: Record<string, number>): string[] {
  const used = new Map<string, number>();
  const out: string[] = [];
  for (const kind of kinds) {
    const cap = caps[kind] ?? DEFAULT_CAP;
    const seen = used.get(kind) ?? 0;
    if (seen >= cap) continue;
    used.set(kind, seen + 1);
    out.push(kind);
  }
  return out;
}

/**
 * Apply the global per-window ceiling, keeping the most important kinds.
 * Stable within a priority band, so equal-priority voices keep arrival order.
 */
export function capTotal(kinds: readonly string[], max: number, priority: Record<string, number>): string[] {
  if (max <= 0) return [];
  if (kinds.length <= max) return kinds.slice();
  return kinds
    .map((kind, i) => ({ kind, i, p: priority[kind] ?? 0 }))
    .sort((a, b) => (b.p - a.p) || (a.i - b.i))
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.kind);
}

/**
 * Gain multiplier for a voice that stands in for `seen` simultaneous events but
 * is one of only `played` copies. Sub-linear on purpose: eight impacts at once
 * should read as one heavier impact, not as eight times the amplitude (which
 * would clip, and would make a splash louder than a heart hit).
 */
export function collapseGain(seen: number, played: number): number {
  if (played <= 0 || seen <= played) return 1;
  return Math.min(1.7, 1 + 0.22 * Math.log2(seen / played + 1));
}

/** Count occurrences per kind — the input to collapseGain. */
export function countKinds(kinds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return counts;
}

/**
 * Push this tick's event kinds onto the pending window, stopping dead at `max`.
 * Split out and exported for exactly one reason: the difference between "drops
 * the overflow" and "grows forever" is invisible from the outside of makeSound()
 * but is the single worst bug this module could ship, so it needs a test that
 * can actually see it. Mutates and returns `pending`.
 */
export function accumulate(pending: string[], events: readonly WorldEvent[], max: number): string[] {
  for (const e of events) {
    if (pending.length >= max) break;
    pending.push(e.kind);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Synthesis — everything below this line needs a real AudioContext.
// ---------------------------------------------------------------------------

type Rig = {
  ctx: AudioContext;
  /** Everything lands here; master gain and the limiter sit downstream. */
  out: GainNode;
  /** One reusable white-noise buffer. The donor allocated and filled a fresh
   *  buffer per detonation; at TTD's event rates that is a per-frame malloc of
   *  tens of thousands of floats. Fill it once, read windows out of it. */
  noise: AudioBuffer;
};

type Voice = (rig: Rig, t0: number, boost: number) => void;

/** Small per-voice detune so repeats do not phase-lock into a machine-gun
 *  artefact. Audio-only randomness — see the header note. */
function jitter(spread = 0.06): number {
  return 1 + (Math.random() - 0.5) * spread;
}

/** exponentialRampToValueAtTime cannot reach or cross zero. */
const EPS = 0.0001;

function envelope(g: GainNode, t0: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(EPS, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, EPS * 2), t0 + attack);
  g.gain.exponentialRampToValueAtTime(EPS, t0 + attack + decay);
}

/** A windowed read out of the shared noise buffer, at a random offset. */
function noiseSource(rig: Rig, t0: number, dur: number): AudioBufferSourceNode {
  const n = rig.ctx.createBufferSource();
  n.buffer = rig.noise;
  const offset = Math.random() * Math.max(rig.noise.duration - dur, 0);
  n.start(t0, offset, dur);
  n.stop(t0 + dur + 0.02);
  return n;
}

// --- shotFired: a short dry click. Square blip snapping downward, with a thin
// noise transient in front of it for the mechanical "crack" of the muzzle.
// ~55ms total — this is the highest-frequency event, so it must not linger.
const shotFired: Voice = (rig, t0, boost) => {
  const { ctx } = rig;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880 * jitter(), t0);
  osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.05);
  envelope(g, t0, 0.09 * boost, 0.003, 0.045);
  osc.connect(g).connect(rig.out);
  osc.start(t0);
  osc.stop(t0 + 0.07);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.06 * boost, t0);
  ng.gain.exponentialRampToValueAtTime(EPS, t0 + 0.02);
  noiseSource(rig, t0, 0.02).connect(hp).connect(ng).connect(rig.out);
};

// --- beam: a filtered zap. Sawtooth swept down through a resonant bandpass
// that sweeps with it, which is what gives it the "energy discharge" character
// rather than the "falling siren" of a bare glide. ~0.18s.
const beam: Voice = (rig, t0, boost) => {
  const { ctx } = rig;
  const dur = 0.18;
  const osc = ctx.createOscillator();
  const bp = ctx.createBiquadFilter();
  const g = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1400 * jitter(0.1), t0);
  osc.frequency.exponentialRampToValueAtTime(320, t0 + dur);
  bp.type = 'bandpass';
  bp.Q.value = 5;
  bp.frequency.setValueAtTime(2600, t0);
  bp.frequency.exponentialRampToValueAtTime(700, t0 + dur);
  envelope(g, t0, 0.1 * boost, 0.008, dur);
  osc.connect(bp).connect(g).connect(rig.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
};

// --- impact: noise burst through a lowpass falling from bright to dull (debris
// settling), plus a short 95Hz body thump so it has weight on small speakers.
// This is the donor's detonation, shortened from 0.28s to 0.13s because TTD
// fires it far more often than DeepWatch ever fired an orbital strike.
const impact: Voice = (rig, t0, boost) => {
  const { ctx } = rig;
  const dur = 0.13;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3200, t0);
  lp.frequency.exponentialRampToValueAtTime(500, t0 + dur);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.22 * boost, t0);
  ng.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
  noiseSource(rig, t0, dur).connect(lp).connect(ng).connect(rig.out);

  const thump = ctx.createOscillator();
  const tg = ctx.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(95 * jitter(), t0);
  thump.frequency.exponentialRampToValueAtTime(48, t0 + 0.1);
  envelope(tg, t0, 0.2 * boost, 0.004, 0.1);
  thump.connect(tg).connect(rig.out);
  thump.start(t0);
  thump.stop(t0 + 0.12);
};

// --- critterDied: the reward voice. Triangle dropping ~2.5 octaves with a
// lowpass following it down, so it reads as something deflating rather than as
// a tone sliding. Triangle (not saw) keeps it soft enough to fire constantly.
const critterDied: Voice = (rig, t0, boost) => {
  const { ctx } = rig;
  const dur = 0.22;
  const osc = ctx.createOscillator();
  const lp = ctx.createBiquadFilter();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(760 * jitter(0.09), t0);
  osc.frequency.exponentialRampToValueAtTime(140, t0 + dur);
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(4000, t0);
  lp.frequency.exponentialRampToValueAtTime(900, t0 + dur);
  envelope(g, t0, 0.11 * boost, 0.006, dur);
  osc.connect(lp).connect(g).connect(rig.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
};

// --- heartHit: the one long voice (~0.75s). Two detuned low sawtooths a fifth
// apart through a lowpass, over a filtered noise rumble. The detuning is what
// makes it *alarming* rather than merely low: the beat frequency between 66 and
// 99 Hz is an unstable, throbbing interval the ear reads as wrong.
const heartHit: Voice = (rig, t0, boost) => {
  const { ctx } = rig;
  const dur = 0.75;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1200, t0);
  lp.frequency.exponentialRampToValueAtTime(180, t0 + dur);
  const g = ctx.createGain();
  envelope(g, t0, 0.3 * boost, 0.012, dur);
  lp.connect(g).connect(rig.out);

  for (const f of [66, 99]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 0.62, t0 + dur);
    osc.connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.12 * boost, t0);
  ng.gain.exponentialRampToValueAtTime(EPS, t0 + dur * 0.6);
  noiseSource(rig, t0, dur * 0.6).connect(lp).connect(ng).connect(rig.out);
};

// --- tankHit: sharper and shorter than the heart (~0.12s) — armour taking a
// hit, not the world ending. Bandpassed noise for the metallic strike plus a
// fast 240->90Hz body thunk. This is the donor's safetyClick idea (transient +
// resonance) retuned into a damage cue.
const tankHit: Voice = (rig, t0, boost) => {
  const { ctx } = rig;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3000 * jitter();
  bp.Q.value = 4;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.3 * boost, t0);
  ng.gain.exponentialRampToValueAtTime(EPS, t0 + 0.07);
  noiseSource(rig, t0, 0.07).connect(bp).connect(ng).connect(rig.out);

  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(240, t0);
  osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.1);
  envelope(g, t0, 0.2 * boost, 0.004, 0.095);
  osc.connect(g).connect(rig.out);
  osc.start(t0);
  osc.stop(t0 + 0.12);
};

/** Typed as a full Record over EventKind so adding a WorldEvent variant is a
 *  compile error here rather than a silent hole in the mix. */
const VOICES: Readonly<Record<EventKind, Voice>> = {
  shotFired,
  beam,
  impact,
  critterDied,
  heartHit,
  tankHit,
};

/** String-keyed view of the above — throttle() deals in plain strings. */
const VOICE_BY_KIND: ReadonlyMap<string, Voice> = new Map(Object.entries(VOICES));

// ---------------------------------------------------------------------------
// The public object.
// ---------------------------------------------------------------------------

export type Sound = {
  /** Must be called from a user gesture; Web Audio is blocked until then. */
  resume(): Promise<void>;
  readonly ready: boolean;
  /** Feed one tick's events. Applies its own rate limiting. */
  play(events: readonly WorldEvent[]): void;
  setMuted(m: boolean): void;
  setVolume(v: number): void;
};

type AudioCtor = new () => AudioContext;

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 0.5s of white noise, filled once. Every noise voice reads a random window
 *  out of it, which is indistinguishable from fresh noise and costs nothing. */
function fillNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function makeSound(): Sound {
  let rig: Rig | null = null;
  let master: GainNode | null = null;
  let ready = false;
  let muted = false;
  let volume = 0.6;

  /** Kind strings seen since the last flush. Bounded by MAX_PENDING. */
  let pending: string[] = [];
  /** Wall-clock ms of the last flush. Deliberately NOT sim time — audio
   *  scheduling belongs to the real clock even when the sim is hitstopped. */
  let lastFlush = 0;

  function applyGain(): void {
    if (master === null || rig === null) return;
    master.gain.setTargetAtTime(muted ? 0 : volume, rig.ctx.currentTime, 0.02);
  }

  function build(): Rig | null {
    const Ctor = audioCtor();
    if (Ctor === null) return null;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    // A limiter-ish compressor on the master bus. The per-window caps stop the
    // *voice count* exploding; this stops the residual stacking from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    const m = ctx.createGain();
    m.gain.value = muted ? 0 : volume;
    const bus = ctx.createGain();
    bus.connect(comp).connect(m).connect(ctx.destination);
    master = m;
    return { ctx, out: bus, noise: fillNoise(ctx) };
  }

  function flush(now: number): void {
    const r = rig;
    if (r === null) {
      pending.length = 0;
      return;
    }
    lastFlush = now;
    const seen = countKinds(pending);
    const kept = capTotal(throttle(pending, PER_WINDOW_CAPS), MAX_VOICES_PER_WINDOW, PRIORITY);
    pending = [];

    // How many survivors each kind got, so collapseGain knows the ratio.
    const played = countKinds(kept);
    const t0 = r.ctx.currentTime;
    let i = 0;
    for (const kind of kept) {
      const voice = VOICE_BY_KIND.get(kind);
      if (voice === undefined) continue;
      const boost = collapseGain(seen.get(kind) ?? 1, played.get(kind) ?? 1);
      // 7ms stagger: simultaneous copies of a voice phase-cancel into a single
      // thin click, and a hair of spread makes a burst read as a burst.
      voice(r, t0 + i * 0.007, boost);
      i++;
    }
  }

  return {
    async resume(): Promise<void> {
      if (rig === null) {
        rig = build();
        if (rig === null) return; // no Web Audio here — stay silent, never throw
      }
      if (rig.ctx.state === 'suspended') {
        try {
          await rig.ctx.resume();
        } catch {
          return;
        }
      }
      ready = rig.ctx.state === 'running';
      applyGain();
    },

    get ready(): boolean {
      return ready;
    },

    play(events: readonly WorldEvent[]): void {
      // Pre-gesture, muted, or auto-suspended (backgrounded tab): a hard no-op.
      // Nothing is buffered, so there is no backlog to dump when audio wakes.
      if (!ready || muted || rig === null || rig.ctx.state !== 'running') {
        if (pending.length > 0) pending.length = 0;
        return;
      }
      accumulate(pending, events, MAX_PENDING);
      const now = Date.now();
      // Never let a stale/forward clock wedge the window shut.
      if (now < lastFlush) lastFlush = now;
      if (now - lastFlush < WINDOW_MS) return;
      if (pending.length === 0) {
        lastFlush = now; // quiet stretch: keep the window from accruing debt
        return;
      }
      flush(now);
    },

    setMuted(m: boolean): void {
      muted = m;
      if (muted) pending.length = 0;
      applyGain();
    },

    setVolume(v: number): void {
      volume = Math.min(1, Math.max(0, v));
      applyGain();
    },
  };
}
