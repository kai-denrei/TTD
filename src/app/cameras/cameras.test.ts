import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_MODES } from './modes.ts';
import type { CamContext } from './modes.ts';
import { makeCameraRig } from './registry.ts';

function ctxAt(
  anchor: readonly [number, number, number],
  heading: readonly [number, number, number] = [0, 1, 0],
): CamContext {
  const l = Math.hypot(anchor[0], anchor[1], anchor[2]) || 1;
  return {
    anchor,
    normal: [anchor[0] / l, anchor[1] / l, anchor[2] / l],
    heading,
    t: 3.5,
    zoom: 1,
    orbitYaw: 0.7,
    orbitPitch: 0.3,
  };
}

// The poles are the degenerate case: a naive [0,1,0] up-vector is parallel to
// the view direction there, and the camera spins.
const PLACES: Array<readonly [number, number, number]> = [
  [0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1], [0.577, 0.577, 0.577],
];

describe('camera modes', () => {
  test('there are five modes across two families', () => {
    assert.equal(CAMERA_MODES.length, 5);
    assert.equal(CAMERA_MODES.filter((m) => m.family === 'build').length, 3);
    assert.equal(CAMERA_MODES.filter((m) => m.family === 'tank').length, 2);
  });

  test('mode ids are unique', () => {
    const ids = CAMERA_MODES.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  for (const mode of CAMERA_MODES) {
    test(`${mode.id} produces finite vectors everywhere, including the poles`, () => {
      for (const place of PLACES) {
        const f = mode.frame(ctxAt(place));
        for (const v of [f.pos, f.look, f.up]) {
          for (const c of v) assert.ok(Number.isFinite(c), `${mode.id} at ${place}: non-finite`);
        }
      }
    });

    test(`${mode.id} never returns an up-vector parallel to the view direction`, () => {
      for (const place of PLACES) {
        const f = mode.frame(ctxAt(place));
        const dir: [number, number, number] = [
          f.look[0] - f.pos[0], f.look[1] - f.pos[1], f.look[2] - f.pos[2],
        ];
        const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        const ul = Math.hypot(f.up[0], f.up[1], f.up[2]) || 1;
        const cos = Math.abs((dir[0] * f.up[0] + dir[1] * f.up[1] + dir[2] * f.up[2]) / (dl * ul));
        assert.ok(cos < 0.999, `${mode.id} at ${place}: up parallel to view (cos=${cos}) — will spin`);
      }
    });

    test(`${mode.id} places the camera off the anchor`, () => {
      const f = mode.frame(ctxAt([0, 1, 0]));
      assert.ok(Math.hypot(f.pos[0], f.pos[1] - 1, f.pos[2]) > 0.01, `${mode.id}: camera sits on its subject`);
    });
  }
});

describe('camera rig', () => {
  test('starts in the build family', () => {
    assert.equal(makeCameraRig().family, 'build');
  });

  test('toggleFamily alternates and reports the new family', () => {
    const rig = makeCameraRig();
    assert.equal(rig.toggleFamily(), 'tank');
    assert.equal(rig.family, 'tank');
    assert.equal(rig.toggleFamily(), 'build');
  });

  test('setFamily reports whether it actually changed', () => {
    const rig = makeCameraRig();
    assert.equal(rig.setFamily('build'), false, 'no-op switch must report false');
    assert.equal(rig.setFamily('tank'), true);
    assert.equal(rig.setFamily('tank'), false);
  });

  test('cycle stays inside the current family and wraps', () => {
    const rig = makeCameraRig();
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) seen.add(rig.cycle().id);
    for (const id of seen) {
      assert.equal(CAMERA_MODES.find((m) => m.id === id)!.family, 'build');
    }
    assert.equal(seen.size, 3, 'cycling 3 times in a 3-mode family should visit all 3');
  });

  test('switching family switches the active mode too', () => {
    const rig = makeCameraRig();
    rig.setFamily('tank');
    assert.equal(rig.mode.family, 'tank');
  });

  test('transitions ease rather than cut', () => {
    const rig = makeCameraRig(0.5);
    const ctx = ctxAt([0, 1, 0]);
    const before = rig.update(1 / 60, ctx, 0);
    const beforeCopy = { pos: [...before.pos] as const };
    rig.setFamily('tank');
    const during = rig.update(1 / 60, ctx, 0);
    const target = rig.mode.frame(ctx);
    const dBefore = Math.hypot(
      during.pos[0] - beforeCopy.pos[0]!, during.pos[1] - beforeCopy.pos[1]!, during.pos[2] - beforeCopy.pos[2]!,
    );
    const dTarget = Math.hypot(
      during.pos[0] - target.pos[0], during.pos[1] - target.pos[1], during.pos[2] - target.pos[2],
    );
    assert.ok(dBefore > 0, 'camera did not move at all');
    assert.ok(dTarget > 1e-6, 'camera cut straight to the target instead of easing');
  });

  test('shake is deterministic and scales with gain', () => {
    const ctx = ctxAt([0, 1, 0]);
    const a = makeCameraRig();
    const b = makeCameraRig();
    a.addTrauma(1);
    b.addTrauma(1);
    assert.deepEqual(a.update(1 / 60, ctx, 1), b.update(1 / 60, ctx, 1));

    const quiet = makeCameraRig();
    const loud = makeCameraRig();
    quiet.addTrauma(1);
    loud.addTrauma(1);
    assert.notDeepEqual(
      quiet.update(1 / 60, ctx, 0).pos,
      loud.update(1 / 60, ctx, 2).pos,
      'shakeGain had no effect',
    );
  });

  test('trauma decays to nothing', () => {
    const ctx = ctxAt([0, 1, 0]);
    const rig = makeCameraRig();
    rig.addTrauma(1);
    for (let i = 0; i < 600; i++) rig.update(1 / 60, ctx, 1);
    const settled = rig.update(1 / 60, ctx, 1);
    const clean = makeCameraRig();
    for (let i = 0; i < 600; i++) clean.update(1 / 60, ctx, 1);
    const ref = clean.update(1 / 60, ctx, 1);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(settled.pos[i]! - ref.pos[i]!) < 1e-6, 'trauma never decayed');
    }
  });
});
