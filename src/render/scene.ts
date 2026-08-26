// scene.ts — renderer, scene, camera and the post chain, assembled once.
//
// Owns nothing about the game. It is handed a canvas and gives back a Stage
// the shell drives. Keeping this separate from the shell means the render
// plumbing can be read in one screen.

import * as THREE from 'three';
import { makePostFx } from './postfx.ts';
import type { PostFx } from './postfx.ts';

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  postfx: PostFx;
  resize(): void;
};

export function makeStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Cap DPR at 2: a 3x phone screen triples the bloom chain's fill cost for
  // no visible gain on a dot-cloud look.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  const postfx = makePostFx(renderer, scene, camera);

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    postfx.setSize(w, h);
  }

  window.addEventListener('resize', resize);
  return { renderer, scene, camera, postfx, resize };
}
