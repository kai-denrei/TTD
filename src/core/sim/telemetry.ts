// telemetry.ts — difficulty + layer-balance counters for the tuning rig.
//
// Pure: time arrives as `dt` in tick(); no wall-clock, no DOM. A headless
// sweep produces byte-identical results to a played session.
//
// Two panes (spec §5):
//   Difficulty  — heart hits, tank hits, leaks, kills, TTK, wave clears, peak
//   Layer balance — macro/tactical split, mode switches, tank idle-under-threat,
//                   decisions per phase, player kills vs tower kills

export type Telemetry = {
  // difficulty
  heartHits: number;
  tankHits: number;
  leaks: number;
  kills: number;
  killsByTower: number;
  killsByPlayer: number;
  ttk: number[];             // seconds from first hit to death (true TTK); 0 for one-shot kills (firstHitAt stamped before damage); always a plain number (null-safe at call sites)
  lifespan: number[];        // seconds from spawn to death (total age)
  waveClearTimes: number[];  // seconds each wave took to clear
  peakConcurrent: number;    // high-water mark of simultaneous live enemies
  heartDeathAt: number | null; // null = still alive; set once when heartHp first hits 0
  // layer balance (spec §5)
  timeMacro: number;         // seconds spent in macro mode
  timeTactical: number;      // seconds spent in tactical mode
  modeSwitches: number;      // transitions between macro/tactical (not frames)
  tankIdleUnderThreat: number; // seconds: enemies alive AND tank not acting
  decisionsThisPhase: number;  // towers placed/upgraded/sold in current macro phase
  decisionsTotal: number;      // lifetime total of all decisions across all phases
  elapsed: number;             // total time accumulated via tick()
};

export function makeTelemetry(): {
  data: Telemetry;
  tick(dt: number, ctx: { macro: boolean; enemiesAlive: number; tankActing: boolean }): void;
  kill(by: 'tower' | 'player', lifespan: number, ttk: number): void;
  heartHit(): void;
  tankHit(): void;
  leak(): void;
  decision(): void;
  waveCleared(seconds: number): void;
  recordHeartDeath(elapsed: number): void;
  resetPhaseCounters(): void;
  summary(): Record<string, number>;
  reset(): void;
} {
  // Track previous macro flag to detect transitions (undefined = first tick)
  let prevMacro: boolean | undefined = undefined;

  const data: Telemetry = {
    heartHits: 0,
    tankHits: 0,
    leaks: 0,
    kills: 0,
    killsByTower: 0,
    killsByPlayer: 0,
    ttk: [],
    lifespan: [],
    waveClearTimes: [],
    peakConcurrent: 0,
    heartDeathAt: null,
    timeMacro: 0,
    timeTactical: 0,
    modeSwitches: 0,
    tankIdleUnderThreat: 0,
    decisionsThisPhase: 0,
    decisionsTotal: 0,
    elapsed: 0,
  };

  function tick(dt: number, ctx: { macro: boolean; enemiesAlive: number; tankActing: boolean }): void {
    data.elapsed += dt;

    // Mode time accumulation
    if (ctx.macro) {
      data.timeMacro += dt;
    } else {
      data.timeTactical += dt;
    }

    // Mode switch detection: count transitions, not frames-in-mode
    if (prevMacro !== undefined && ctx.macro !== prevMacro) {
      data.modeSwitches += 1;
    }
    prevMacro = ctx.macro;

    // Peak concurrent enemies high-water mark
    if (ctx.enemiesAlive > data.peakConcurrent) {
      data.peakConcurrent = ctx.enemiesAlive;
    }

    // Tank idle-under-threat: enemies alive AND tank not acting
    if (ctx.enemiesAlive > 0 && !ctx.tankActing) {
      data.tankIdleUnderThreat += dt;
    }
  }

  function kill(by: 'tower' | 'player', lifespan: number, ttk: number): void {
    data.kills += 1;
    data.lifespan.push(lifespan);
    data.ttk.push(ttk);
    if (by === 'tower') {
      data.killsByTower += 1;
    } else {
      data.killsByPlayer += 1;
    }
  }

  function heartHit(): void {
    data.heartHits += 1;
  }

  function tankHit(): void {
    data.tankHits += 1;
  }

  function leak(): void {
    data.leaks += 1;
  }

  function decision(): void {
    data.decisionsThisPhase += 1;
    data.decisionsTotal += 1;
  }

  function recordHeartDeath(elapsed: number): void {
    if (data.heartDeathAt === null) {
      data.heartDeathAt = elapsed;
    }
  }

  function resetPhaseCounters(): void {
    data.decisionsThisPhase = 0;
  }

  function waveCleared(seconds: number): void {
    data.waveClearTimes.push(seconds);
  }

  /**
   * Derived values — keep clearly separate from raw counters.
   *
   * Shares: ratios of a part to a whole; 0 when denominator is 0.
   * Means: arithmetic mean of an array; NaN-free (0 on empty).
   * p90: 90th-percentile of an array using nearest-rank (index = ceil(0.9*n)-1,
   *      sorted ascending). On a short or empty sample: 0.
   */
  function summary(): Record<string, number> {
    const totalTime = data.timeMacro + data.timeTactical;

    // --- shares ---
    const macroShare = totalTime > 0 ? data.timeMacro / totalTime : 0;
    const playerKillShare = data.kills > 0 ? data.killsByPlayer / data.kills : 0;
    const towerKillShare = data.kills > 0 ? data.killsByTower / data.kills : 0;

    // --- TTK stats (true TTK: first hit to death) ---
    const ttkMean = mean(data.ttk);
    const ttkP90 = p90(data.ttk);

    // --- lifespan stats (total age from spawn to death) ---
    const lifespanMean = mean(data.lifespan);
    const lifespanP90 = p90(data.lifespan);

    // --- wave clear stats ---
    const waveClearMean = mean(data.waveClearTimes);
    const waveClearP90 = p90(data.waveClearTimes);

    // --- heart survival ---
    const survived = data.heartDeathAt === null ? 1 : 0;
    const survivedFor = data.heartDeathAt !== null ? data.heartDeathAt : data.elapsed;

    return {
      macroShare,
      playerKillShare,
      towerKillShare,
      ttkMean,
      ttkP90,
      lifespanMean,
      lifespanP90,
      waveClearMean,
      waveClearP90,
      survived,
      survivedFor,
      heartDeathAt: data.heartDeathAt ?? 0,
      elapsed: data.elapsed,
      kills: data.kills,
      heartHits: data.heartHits,
      tankHits: data.tankHits,
      leaks: data.leaks,
      modeSwitches: data.modeSwitches,
      tankIdleUnderThreat: data.tankIdleUnderThreat,
      peakConcurrent: data.peakConcurrent,
      decisionsThisPhase: data.decisionsThisPhase,
      decisionsTotal: data.decisionsTotal,
    };
  }

  function reset(): void {
    prevMacro = undefined;
    data.heartHits = 0;
    data.tankHits = 0;
    data.leaks = 0;
    data.kills = 0;
    data.killsByTower = 0;
    data.killsByPlayer = 0;
    data.ttk.length = 0;
    data.lifespan.length = 0;
    data.waveClearTimes.length = 0;
    data.peakConcurrent = 0;
    data.heartDeathAt = null;
    data.timeMacro = 0;
    data.timeTactical = 0;
    data.modeSwitches = 0;
    data.tankIdleUnderThreat = 0;
    data.decisionsThisPhase = 0;
    data.decisionsTotal = 0;
    data.elapsed = 0;
  }

  return { data, tick, kill, heartHit, tankHit, leak, decision, waveCleared, recordHeartDeath, resetPhaseCounters, summary, reset };
}

// --- private helpers ---

function mean(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

/**
 * Nearest-rank p90: sort ascending, index = ceil(0.9 * n) - 1.
 * Returns 0 on empty array.
 */
function p90(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.ceil(0.9 * sorted.length) - 1;
  const val = sorted[idx];
  return val !== undefined ? val : 0;
}
