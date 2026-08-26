// registry.ts — the rig: which mode is active, how switches ease, and shake.
//
// THE LOAD-BEARING PART. Switching family is what the shell turns into a
// world.setMacro() call. M0a's brain notes §5.2 record that modeSwitches and
// macroShare read 0 in every sweep because nothing ever called setMacro — the
// layer-balance pane of the telemetry, which vision §0 calls the headline
// measurement the rig exists for, has never had data. This is where it starts
// getting some.
//
// SHAKE IS DETERMINISTIC. No Math.random: a sine-sum over elapsed time. Two
// rigs given the same trauma at the same time produce identical output, so a
// replay stays a replay.

import { CAMERA_MODES } from './modes.ts';
import type { CamContext, CamFamily, CamFrame, CameraMode } from './modes.ts';
import type { Vec3 } from '../../core/sphere/vec3.ts';

export type CameraRig = {
  update(dt: number, ctx: CamContext, shakeGain: number): CamFrame;
  setFamily(f: CamFamily): boolean;
  toggleFamily(): CamFamily;
  cycle(): CameraMode;
  addTrauma(amount: number): void;
  readonly family: CamFamily;
  readonly mode: CameraMode;
};

const TRAUMA_DECAY = 1.4; // per second

export function makeCameraRig(transitionSeconds = 0.55): CameraRig {
  let family: CamFamily = 'build';
  let mode: CameraMode = CAMERA_MODES.find((m) => m.family === 'build')!;
  let blend = 1; // 1 = fully settled on `mode`
  let from: CamFrame | null = null;
  let current: CamFrame | null = null;
  let trauma = 0;
  let clock = 0;

  function inFamily(): CameraMode[] {
    return CAMERA_MODES.filter((m) => m.family === family);
  }

  function beginTransition(next: CameraMode): void {
    if (current !== null) {
      from = current;
      blend = 0;
    }
    mode = next;
  }

  function setFamily(f: CamFamily): boolean {
    if (f === family) return false;
    family = f;
    beginTransition(inFamily()[0]!);
    return true;
  }

  function toggleFamily(): CamFamily {
    setFamily(family === 'build' ? 'tank' : 'build');
    return family;
  }

  function cycle(): CameraMode {
    const list = inFamily();
    const i = list.findIndex((m) => m.id === mode.id);
    beginTransition(list[(i + 1) % list.length]!);
    return mode;
  }

  function update(dt: number, ctx: CamContext, shakeGain: number): CamFrame {
    clock += dt;
    trauma = Math.max(0, trauma - TRAUMA_DECAY * dt);

    const target = mode.frame(ctx);

    if (blend < 1 && from !== null) {
      blend = Math.min(1, blend + dt / Math.max(1e-6, transitionSeconds));
      // smoothstep so a switch reads as a beat rather than a linear slide
      const k = blend * blend * (3 - 2 * blend);
      current = {
        pos: mix(from.pos, target.pos, k),
        look: mix(from.look, target.look, k),
        up: mix(from.up, target.up, k),
      };
    } else {
      from = null;
      current = target;
    }

    if (trauma > 0 && shakeGain > 0) {
      // Squared trauma: a small knock barely registers, a big one is felt.
      const a = trauma * trauma * shakeGain * 0.03;
      current = {
        pos: [
          current.pos[0] + a * Math.sin(clock * 47.3),
          current.pos[1] + a * Math.sin(clock * 53.7 + 1.7),
          current.pos[2] + a * Math.sin(clock * 61.1 + 3.1),
        ],
        look: current.look,
        up: current.up,
      };
    }

    return current;
  }

  return {
    update,
    setFamily,
    toggleFamily,
    cycle,
    addTrauma(amount: number) { trauma = Math.min(1, trauma + amount); },
    get family() { return family; },
    get mode() { return mode; },
  };
}

function mix(a: Vec3, b: Vec3, k: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
