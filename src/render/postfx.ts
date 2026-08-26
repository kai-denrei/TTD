// postfx.ts — EffectComposer + UnrealBloom.
//
// Vision §4: post-processing is foundational, not polish. The PoC's decision
// log deferred the "6-module EffectComposer cost until a look earns it", and
// vision §2 blames that deferral for a large part of why HokorobiTawaa feels
// better than the PoC did. It goes in at first light, not at the end.
//
// applyBloom() takes the plain-data shape RenderTarget.bloom produces, so the
// tuning path stays testable in Node (see render/bindings.ts) and this file
// stays the only place that knows what an UnrealBloomPass is.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export type PostFx = {
  setSize(w: number, h: number): void;
  applyBloom(b: { strength: number; radius: number; threshold: number }): void;
  render(): void;
};

export function makePostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostFx {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const bloom = new UnrealBloomPass(size, 0.8, 0.4, 0.5);
  composer.addPass(bloom);

  return {
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    applyBloom(b) {
      bloom.strength = b.strength;
      bloom.radius = b.radius;
      bloom.threshold = b.threshold;
    },
    render() {
      composer.render();
    },
  };
}
