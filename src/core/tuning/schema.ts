// schema.ts — the single source of truth for every M0 tuning lever.
//
// A new lever is ONE entry here. The dashboard, presets, docs, and URL hooks
// all derive from LEVERS — never four edits.
//
// Conventions:
//   - Booleans: min:0, max:1, step:1 (flag() reads them as value !== 0)
//   - "live: true" is implicit for all M0 levers — the whole point of this
//     system is that nothing is baked at construction.

export type LeverGroup = 'intensity' | 'critters' | 'player' | 'feel' | 'camera' | 'god';

export type Lever = {
  key: string;
  group: LeverGroup;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  help: string;
};

export const LEVERS: readonly Lever[] = [
  // ── intensity ──────────────────────────────────────────────────────────────
  {
    key: 'wave.size',
    group: 'intensity',
    label: 'Wave size',
    min: 1, max: 40, step: 1, value: 10,
    help: 'Number of enemies per wave. The baseline headcount before growth scaling.',
  },
  {
    key: 'wave.dripRate',
    group: 'intensity',
    label: 'Drip rate (s)',
    min: 0.1, max: 2.0, step: 0.05, value: 0.5,
    help: 'Gap in seconds between individual enemy spawns within a wave. Low = lump, high = trickle. The HK finding: this changes the feel of every fight.',
  },
  {
    key: 'wave.dripJitter',
    group: 'intensity',
    label: 'Drip jitter',
    min: 0, max: 1, step: 0.05, value: 0.2,
    help: 'Randomness applied to the drip gap. 0 = metronome, 1 = maximum variance. Kills the mechanical pulse that makes spacing feel synthetic.',
  },
  {
    key: 'wave.overlap',
    group: 'intensity',
    label: 'Wave overlap',
    min: 0, max: 1, step: 0.05, value: 0.0,
    help: '0 = wait for the field to clear before the next wave; 1 = never wait. Values between create partial overlap based on remaining enemy count.',
  },
  {
    key: 'wave.gap',
    group: 'intensity',
    label: 'Wave gap (s)',
    min: 0, max: 20, step: 0.5, value: 8,
    help: 'The macro breath between waves in seconds. The calm before the storm — long gaps let the player rebuild; short gaps keep pressure constant.',
  },
  {
    key: 'wave.sizeGrowth',
    group: 'intensity',
    label: 'Wave size growth',
    min: 0, max: 3, step: 0.1, value: 1,
    help: 'How many extra enemies are added per subsequent wave. 0 = flat; 3 = steep escalation.',
  },
  {
    key: 'wave.hpGrowth',
    group: 'intensity',
    label: 'Wave HP growth',
    min: 1.0, max: 1.3, step: 0.01, value: 1.05,
    help: 'Per-wave multiplier on enemy max HP. 1.0 = no scaling; 1.3 = enemies have 30% more HP each wave.',
  },

  // ── critters ───────────────────────────────────────────────────────────────
  {
    key: 'enemy.speed',
    group: 'critters',
    label: 'Enemy speed',
    min: 0.2, max: 3.0, step: 0.05, value: 1.0,
    help: 'Global enemy movement speed. The lever the PoC never had — this single value retimes the entire game. Read per-tick, never baked.',
  },
  {
    key: 'enemy.hp',
    group: 'critters',
    label: 'Enemy HP',
    min: 1, max: 20, step: 1, value: 5,
    help: 'Base hit-points for a critter before wave HP growth is applied.',
  },
  {
    key: 'enemy.surgeAmp',
    group: 'critters',
    label: 'Surge amplitude',
    min: 0, max: 0.8, step: 0.05, value: 0.3,
    help: 'Amplitude of the per-critter speed envelope: actual speed varies in [1-amp, 1+amp] × base. 0 = flat; 0.8 = wide range, creates the accel/decel stressor.',
  },
  {
    key: 'enemy.surgeCadence',
    group: 'critters',
    label: 'Surge cadence (s)',
    min: 0.2, max: 3.0, step: 0.1, value: 1.0,
    help: 'How often in seconds the speed envelope picks a new target within its amplitude range.',
  },
  {
    key: 'enemy.surgeJitter',
    group: 'critters',
    label: 'Surge jitter',
    min: 0, max: 1, step: 0.05, value: 0.3,
    help: 'Variance on the surge cadence timer. 0 = every critter re-targets on the same beat; 1 = fully randomised.',
  },
  {
    key: 'enemy.accelOnHit',
    group: 'critters',
    label: 'Accel on hit',
    min: 0.5, max: 2.0, step: 0.05, value: 1.0,
    help: 'Speed multiplier applied the moment a critter takes a hit. <1 staggers (slows); >1 inverts dominance (they speed up under fire).',
  },
  {
    key: 'enemy.reactionDur',
    group: 'critters',
    label: 'Hit reaction dur (s)',
    min: 0, max: 3, step: 0.1, value: 0.5,
    help: 'How long in seconds the accelOnHit multiplier is held after a hit before reverting to the surge envelope.',
  },

  // ── player ─────────────────────────────────────────────────────────────────
  {
    key: 'tower.damage',
    group: 'player',
    label: 'Tower damage',
    min: 0.5, max: 20, step: 0.5, value: 3,
    help: 'Damage dealt per tower shot. The single tower type in M0.',
  },
  {
    key: 'tower.range',
    group: 'player',
    label: 'Tower range',
    min: 0.05, max: 0.6, step: 0.025, value: 0.25,
    help: 'Tower targeting radius in world chord distance. Typical cell spacing ~0.07; 0.25 covers ~3–4 cells.',
  },
  {
    key: 'tower.rate',
    group: 'player',
    label: 'Tower fire rate (s)',
    min: 0.2, max: 5.0, step: 0.1, value: 1.0,
    help: 'Seconds between tower shots. Lower = faster fire rate.',
  },
  {
    key: 'tank.speed',
    group: 'player',
    label: 'Tank speed',
    min: 0.5, max: 10, step: 0.25, value: 4,
    help: 'Player tank movement speed. Needs to feel snappy without being uncontrollable.',
  },
  {
    key: 'tank.damage',
    group: 'player',
    label: 'Tank damage',
    min: 0.5, max: 20, step: 0.5, value: 4,
    help: 'Damage dealt per tank shot or ram. Affects the player-kills vs tower-kills telemetry ratio.',
  },
  {
    key: 'tank.fireRate',
    group: 'player',
    label: 'Tank fire rate (s)',
    min: 0.1, max: 3.0, step: 0.1, value: 0.5,
    help: 'Seconds between tank shots. Lower = faster.',
  },
  {
    key: 'tank.range',
    group: 'player',
    label: 'Tank range',
    min: 0.05, max: 0.6, step: 0.025, value: 0.25,
    help: 'Tank shot range in world chord distance. Typical cell spacing ~0.07; 0.25 covers ~3–4 cells.',
  },

  // ── feel ───────────────────────────────────────────────────────────────────
  {
    key: 'bloom.strength',
    group: 'feel',
    label: 'Bloom strength',
    min: 0, max: 3, step: 0.05, value: 0.8,
    help: 'Post-processing bloom intensity. Aesthetic only — no gameplay effect.',
  },
  {
    key: 'bloom.radius',
    group: 'feel',
    label: 'Bloom radius',
    min: 0, max: 1, step: 0.05, value: 0.4,
    help: 'Bloom spread radius (normalized). Larger = softer, more diffuse glow.',
  },
  {
    key: 'bloom.threshold',
    group: 'feel',
    label: 'Bloom threshold',
    min: 0, max: 1, step: 0.05, value: 0.5,
    help: 'Luminance threshold above which bloom is applied. Higher = only the brightest pixels bloom.',
  },

  // ── camera ─────────────────────────────────────────────────────────────────
  {
    key: 'shake.amount',
    group: 'camera',
    label: 'Camera shake',
    min: 0, max: 2, step: 0.05, value: 0.5,
    help: 'Magnitude of camera shake on impacts. 0 = no shake; 2 = intense. Aesthetic — affects feel without changing play.',
  },

  // ── god ────────────────────────────────────────────────────────────────────
  {
    key: 'god.heartInvulnerable',
    group: 'god',
    label: 'Heart invulnerable',
    min: 0, max: 1, step: 1, value: 0,
    help: 'Boolean toggle. When on, the heart cannot be destroyed — but hit counts still accrue in telemetry. Use to study wave pressure without ending the run.',
  },
  {
    key: 'god.tankInvulnerable',
    group: 'god',
    label: 'Tank invulnerable',
    min: 0, max: 1, step: 1, value: 0,
    help: 'Boolean toggle. When on, the player tank cannot be destroyed — hit counts still accrue. Use to study the map without babysitting the tank.',
  },
  {
    key: 'time.scale',
    group: 'god',
    label: 'Time scale',
    min: 0.1, max: 4, step: 0.05, value: 1.0,
    help: 'Global simulation time multiplier. <1 = slow motion (inspect details); >1 = fast-forward (burn through waves quickly). Applied to every dt before systems see it.',
  },
] as const satisfies Lever[];
