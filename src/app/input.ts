// input.ts — keyboard/mouse and touch, at parity.
//
// WHY PARITY IS NOT A NICETY. The operator tunes on a phone, against the
// deployed build. Without touch driving, every phone session reports a tank
// that never acts: tankIdleUnderThreat pinned high, playerKillShare near zero
// — for a reason that is an input gap, not a balance finding. The rig would be
// lying about the exact ratio vision §0 calls its headline number.
//
// The fiddly maths (deadzone, normalisation, clamping) is exported as pure
// functions so it is Node-tested without a DOM; the event plumbing is verified
// by hand in a browser.
//
// #scene sets touch-action: none. Without it the browser claims drag and pinch
// for scroll and zoom, and none of this ever fires.

import type { TankInput } from '../core/sim/tank.ts';

const STICK_RADIUS = 60; // px to full deflection

/** Map a stick offset in pixels to tank input. Screen y grows downward, so
 *  pushing up (negative dy) must drive forward. */
export function applyStick(dx: number, dy: number, deadzone = 0.15): { forward: number; turn: number } {
  const nx = dx / STICK_RADIUS;
  const ny = dy / STICK_RADIUS;
  if (Math.hypot(nx, ny) < deadzone) return { forward: 0, turn: 0 };
  return {
    forward: Math.max(-1, Math.min(1, -ny)),
    turn: Math.max(-1, Math.min(1, nx)),
  };
}

export function clampZoom(z: number): number {
  return Math.max(0.35, Math.min(3, z));
}

export type InputState = {
  /** Current tank input. Recomputed on read: keyboard wins, else the stick. */
  readonly tank: TankInput;
  zoom: number;
  orbitYaw: number;
  orbitPitch: number;
  /** Screen-space taps since the last drain, in order. */
  drainTaps(): Array<{ x: number; y: number }>;
  toggleFamily: boolean;
  cycleCamera: boolean;
};

export type InputOpts = { isBuildFamily(): boolean };

export function makeInput(canvas: HTMLCanvasElement, opts: InputOpts): InputState {
  const taps: Array<{ x: number; y: number }> = [];
  const keys = new Set<string>();
  const tank: TankInput = { forward: 0, turn: 0, fire: false };
  let touchFire = false;

  const state = {
    zoom: 1,
    orbitYaw: 0.6,
    orbitPitch: 0.35,
    toggleFamily: false,
    cycleCamera: false,
    drainTaps(): Array<{ x: number; y: number }> {
      const out = taps.slice();
      taps.length = 0;
      return out;
    },
    get tank(): TankInput {
      const up = keys.has('KeyW') || keys.has('ArrowUp');
      const down = keys.has('KeyS') || keys.has('ArrowDown');
      const left = keys.has('KeyA') || keys.has('ArrowLeft');
      const right = keys.has('KeyD') || keys.has('ArrowRight');
      tank.forward = (up ? 1 : 0) + (down ? -1 : 0);
      tank.turn = (right ? 1 : 0) + (left ? -1 : 0);
      tank.fire = keys.has('Space') || touchFire;

      // The left-half virtual stick only drives when the keyboard is idle, so
      // a desktop session with a stray touch does not fight itself.
      if (tank.forward === 0 && tank.turn === 0 && !opts.isBuildFamily()) {
        for (const rec of touches.values()) {
          if (!rec.left) continue;
          const s = applyStick(rec.x - rec.x0, rec.y - rec.y0);
          tank.forward = s.forward;
          tank.turn = s.turn;
          break;
        }
      }
      return tank;
    },
  };

  // ── keyboard ──────────────────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); state.toggleFamily = true; return; }
    if (e.code === 'KeyC') { state.cycleCamera = true; return; }
    if (e.code === 'Space') e.preventDefault();
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // ── mouse: drag orbits (build), a stationary click places (build) ─────────
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // touch handled below
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (opts.isBuildFamily()) {
      state.orbitYaw += dx * 0.005;
      state.orbitPitch = Math.max(-1.4, Math.min(1.4, state.orbitPitch + dy * 0.005));
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    dragging = false;
    // A click counts as a tap only if the pointer barely moved — otherwise
    // every orbit-drag release would place a tower by accident.
    if (moved < 6 && opts.isBuildFamily()) taps.push({ x: e.clientX, y: e.clientY });
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.zoom = clampZoom(state.zoom * (1 + Math.sign(e.deltaY) * 0.1));
  }, { passive: false });

  // ── touch ─────────────────────────────────────────────────────────────────
  // Build: one finger orbits, two pinch, a stationary tap places.
  // Tank:  left half is a virtual stick, right half fires.
  const touches = new Map<number, { x: number; y: number; x0: number; y0: number; left: boolean }>();
  let pinchStart = 0;
  let pinchZoom0 = 1;

  function pinchDistance(): number {
    const pts = Array.from(touches.values());
    const a = pts[0];
    const b = pts[1];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const left = t.clientX < window.innerWidth / 2;
      touches.set(t.identifier, { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, left });
      if (!opts.isBuildFamily() && !left) touchFire = true;
    }
    if (touches.size === 2 && opts.isBuildFamily()) {
      pinchStart = pinchDistance();
      pinchZoom0 = state.zoom;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const rec = touches.get(t.identifier);
      if (rec === undefined) continue;
      const dx = t.clientX - rec.x;
      const dy = t.clientY - rec.y;
      rec.x = t.clientX;
      rec.y = t.clientY;
      if (opts.isBuildFamily() && touches.size === 1) {
        state.orbitYaw += dx * 0.005;
        state.orbitPitch = Math.max(-1.4, Math.min(1.4, state.orbitPitch + dy * 0.005));
      }
    }
    if (touches.size === 2 && opts.isBuildFamily() && pinchStart > 0) {
      state.zoom = clampZoom(pinchZoom0 * (pinchStart / Math.max(1, pinchDistance())));
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const rec = touches.get(t.identifier);
      touches.delete(t.identifier);
      if (rec === undefined) continue;
      if (opts.isBuildFamily() && Math.hypot(t.clientX - rec.x0, t.clientY - rec.y0) < 10 && touches.size === 0) {
        taps.push({ x: t.clientX, y: t.clientY });
      }
      if (!rec.left) touchFire = false;
    }
    if (touches.size < 2) pinchStart = 0;
  }, { passive: false });

  return state;
}
