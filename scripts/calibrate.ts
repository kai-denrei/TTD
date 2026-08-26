// Usage: node --experimental-strip-types scripts/calibrate.ts [preset]
//
// Simulates COMPETENT PLAY and reports how far it gets. The sweep answers "did
// this lever move the needle"; this answers the question the sweep cannot:
// IS THE GAME WINNABLE, and by how much.
//
// The simulated player is deliberately decent-but-not-perfect: it buys the best
// tower it can afford on high ground overlooking the route to the heart,
// re-buys whenever it can, upgrades when it cannot afford anything new, and
// drives the tank at whatever is nearest. That is a reasonable ceiling for a
// human who understands the game and a floor for one who does not.

import { makeWorld } from '../src/core/sim/world.ts';
import { makeTuning } from '../src/core/tuning/store.ts';
import { patrolInput } from '../src/core/sim/runner.ts';
import { isFrontierWall, bfsDist } from '../src/core/sphere/dungeon.ts';
import { TOWER_BY_KEY, unlockedKeys, MAX_TIER } from '../src/core/sim/towerspec.ts';

const preset = process.argv[2] ?? '';
const SEEDS = [7, 42, 43, 44, 45];
const MAX_TICKS = 60 * 60 * 6; // six minutes of game time

type Row = Record<string, number | string>;
const rows: Row[] = [];

for (const seed of SEEDS) {
  const t = makeTuning();
  if (preset) t.import(preset);
  const w = makeWorld({ seed, tuning: t });

  // Rank buildable high ground by how close it sits to the enemy route: cells
  // near the path see traffic, cells behind the heart never fire a shot.
  // bfsDist takes (adj, sources[], passable?) — distance over OPEN cells only,
  // so a wall's neighbouring corridor distance is the traffic it will see.
  const distFromSpawn = bfsDist(
    w.mesh.adj, [w.dungeon.spawn], (i) => w.dungeon.tags[i] !== 0,
  );
  const sites = w.mesh.quads
    .map((_q, i) => i)
    .filter((i) => isFrontierWall(w.mesh, w.dungeon, i))
    .map((i) => {
      // Prefer walls whose OPEN neighbours are on the route.
      const near = (w.mesh.adj[i] ?? []).reduce((best, n) => {
        const d = distFromSpawn[n];
        return d !== undefined && d >= 0 && d < best ? d : best;
      }, Infinity);
      return { cell: i, routeDist: near };
    })
    .filter((s) => Number.isFinite(s.routeDist))
    .sort((a, b) => a.routeDist - b.routeDist);

  let cursor = 0;
  for (let i = 0; i < MAX_TICKS && !w.over; i++) {
    // Spend, roughly once a second, the way a player checking their wallet does.
    if (i % 60 === 0) {
      const affordable = unlockedKeys(w.waves.wave)
        .map((k) => TOWER_BY_KEY.get(k)!)
        .filter((s) => w.economy.canAfford(s.cost))
        .sort((a, b) => b.cost - a.cost); // best you can afford
      const pick = affordable[0];
      let bought = false;
      if (pick !== undefined) {
        while (cursor < sites.length && !bought) {
          bought = w.placeTower(sites[cursor]!.cell, pick.key);
          cursor++;
        }
      }
      // Nothing new to buy: deepen what is already standing.
      if (!bought) {
        for (const tw of w.towers) {
          if (tw.tier < MAX_TIER && w.upgradeTower(tw.cell)) break;
        }
      }
    }
    w.tick(1 / 60, patrolInput(i, w));
  }

  const s = w.telemetry.summary();
  rows.push({
    seed,
    outcome: w.won ? 'WON' : w.heartDied ? 'lost' : 'timeout',
    wave: w.waves.wave,
    survivedFor: +s['survivedFor']!.toFixed(1),
    towers: w.towers.length,
    kills: s['kills']!,
    leaks: s['leaks']!,
    heart: w.heartHp,
    playerShare: +s['playerKillShare']!.toFixed(2),
    credit: w.economy.credit,
    earned: s['creditEarned']!,
    bestStreak: s['streakBest']!,
  });
}

console.table(rows);
const won = rows.filter((r) => r.outcome === 'WON').length;
console.log(`\nWON ${won}/${rows.length} seeds` + (preset ? `  ·  preset: ${preset}` : '  ·  defaults'));
