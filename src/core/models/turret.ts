// turret.ts — the M0 tower model: pedestal + boxy housing + one swept barrel.
//
// Chosen in docs/03-braille-assets.md for silhouette legibility at small scale
// on a sphere: it reads as "defensive emplacement" instantly, and the barrel
// gives an obvious aim direction to orient. The muzzle is the model's single
// highlight dot.
//
// Model convention: +Y is up (the surface normal when placed), +X is the
// barrel/aim direction.

import { fibDir, fitUnit, normV, crossV } from './helpers.ts';
import type { ModelPoint, V3 } from './helpers.ts';

/** Tapered pedestal (9 stacked rings of 22) + a domed top plate (the upper
 *  half of a 54-point Fibonacci sphere). 198 + 27 = 225 points. */
function pedestal(out: ModelPoint[], r: number, yTop: number, yBot: number): void {
  for (let iy = 0; iy <= 8; iy++) {
    const f = iy / 8;
    const y = yBot + (yTop - yBot) * f;
    const rr = r * (0.78 + 0.22 * f);
    for (let a = 0; a < 22; a++) {
      const ang = (a / 22) * 2 * Math.PI;
      out.push([rr * Math.cos(ang), y, rr * Math.sin(ang), 0]);
    }
  }
  for (let i = 0; i < 54; i++) {
    const d = fibDir(i, 54);
    if (d[1] < 0) continue;
    out.push([d[0] * r, yTop + d[1] * 0.05, d[2] * r, 0]);
  }
}

/** Solid-surface box: an (n+1)x(n+1) grid on each of the six faces.
 *  n = 6 gives 49 * 6 = 294 points. */
function box(out: ModelPoint[], c: V3, h: V3, n: number): void {
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const u = (i / n) * 2 - 1;
      const v = (j / n) * 2 - 1;
      out.push([c[0] + u * h[0], c[1] + v * h[1], c[2] - h[2], 0]);
      out.push([c[0] + u * h[0], c[1] + v * h[1], c[2] + h[2], 0]);
      out.push([c[0] - h[0], c[1] + v * h[1], c[2] + u * h[2], 0]);
      out.push([c[0] + h[0], c[1] + v * h[1], c[2] + u * h[2], 0]);
      out.push([c[0] + u * h[0], c[1] - h[1], c[2] + v * h[2], 0]);
      out.push([c[0] + u * h[0], c[1] + h[1], c[2] + v * h[2], 0]);
    }
  }
}

/** Swept cylinder of `steps + 1` rings of 7, plus a bright muzzle bore dot.
 *  len 0.72 / r 0.06 gives steps = 9, so 70 + 1 = 71 points. */
function barrel(out: ModelPoint[], base: V3, dir: V3, len: number, r: number): void {
  const T = normV(dir);
  const steps = Math.max(6, Math.round(len / 0.08));
  let n1 = normV(crossV(T, [0, 1, 0.011]));
  if (!(n1[0] || n1[1] || n1[2])) n1 = [1, 0, 0];
  const n2 = crossV(T, n1);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const cx = base[0] + T[0] * len * f;
    const cy = base[1] + T[1] * len * f;
    const cz = base[2] + T[2] * len * f;
    for (let m = 0; m < 7; m++) {
      const a = (m / 7) * 2 * Math.PI;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      out.push([
        cx + r * (cs * n1[0] + sn * n2[0]),
        cy + r * (cs * n1[1] + sn * n2[1]),
        cz + r * (cs * n1[2] + sn * n2[2]),
        0,
      ]);
    }
  }
  out.push([base[0] + T[0] * len, base[1] + T[1] * len, base[2] + T[2] * len, 1]);
}

/** The M0 tower. 225 + 294 + 71 = 590 points, 1 highlight (the muzzle). */
export function turretPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  pedestal(pts, 0.42, -0.4, -0.95);
  box(pts, [0, -0.12, 0], [0.32, 0.22, 0.3], 6);
  barrel(pts, [0.28, -0.05, 0], [1, 0, 0.02], 0.72, 0.06);
  return fitUnit(pts);
}
