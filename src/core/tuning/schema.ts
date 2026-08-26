// schema.ts — the single source of truth for every M0 tuning lever.
//
// A new lever is ONE entry here. The dashboard, presets, docs, and URL hooks
// all derive from LEVERS — never four edits.
//
// Conventions:
//   - Booleans: min:0, max:1, step:1 (flag() reads them as value !== 0)
//   - "live: true" is implicit for all M0 levers — the whole point of this
//     system is that nothing is baked at construction.

export type LeverGroup = 'intensity' | 'critters' | 'player' | 'economy' | 'feel' | 'camera' | 'god';

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

  {
    key: 'wave.winAt',
    group: 'intensity',
    label: 'Waves to win',
    min: 1, max: 30, step: 1, value: 12,
    help: 'Clear this many waves with the heart alive and the board empty, and the run is WON. Twelve is the reference length. Until M0c-3 a run could only ever be lost, which meant difficulty had no success state to calibrate against — a curve with no top.',
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
    label: 'Tower damage ×',
    min: 0.1, max: 8, step: 0.1, value: 1,
    help: 'Scales the damage of EVERY tower in the roster. Since M0c-3 each tower carries its own damage and the roster supplies identity; this lever tunes the whole board at once, which is what a difficulty pass actually wants. 1.0 is the reference balance.',
  },
  {
    key: 'tower.range',
    group: 'player',
    label: 'Tower range ×',
    min: 0.2, max: 3, step: 0.05, value: 1,
    help: 'Scales every tower\'s range. Per-tower range is in CELLS (3.1–7.0 across the roster) and is converted to world units using the mesh\'s mean chord, so the roster stays correct on any board resolution.',
  },
  {
    key: 'tower.rate',
    group: 'player',
    label: 'Tower fire rate ×',
    min: 0.1, max: 4, step: 0.1, value: 1,
    help: 'Scales every tower\'s shots-per-second. Higher = faster. Per-tower rate ranges 0.7/s (sniper) to 3.0/s (rapid), and that spread is the roster\'s tempo identity — this lever moves all of it together.',
  },
  {
    key: 'tower.projSpeed',
    group: 'player',
    label: 'Shot speed ×',
    min: 0.2, max: 4, step: 0.1, value: 1,
    help: 'Scales every tower\'s projectile speed. Per-tower speed is in CELLS/sec (3.5 for the lofted mortar up to 42 for the sniper) — that spread is what makes a mortar dodgeable and a sniper round not. Calibrate against critters, which move 0.67 u/s at enemy.speed 1 and 2.83 at 3.0: a shot slower than its target can never catch it. Vision §6.4 names per-tower projectile speed as what stops towers feeling samey.',
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
    key: 'tank.fireArc',
    group: 'player',
    label: 'Tank fire arc (°)',
    min: 10, max: 180, step: 5, value: 45,
    help: 'How far off the barrel the tank can hit, in degrees either side. Below M0c-2 the tank fired in every direction and the barrel was decoration, which is why steering felt pointless. 180 reproduces that old behaviour, so the lever\'s own top end is the migration path rather than a cliff.',
  },
  {
    key: 'tank.heatMax',
    group: 'player',
    label: 'Tank heat max (s)',
    min: 0.5, max: 6.0, step: 0.1, value: 2.4,
    help: 'Seconds of continuous fire before the guns lock out. The PoC\'s value. The point is that you cannot hold the trigger: tank damage becomes a resource you spend rather than a constant, which is the same idea as the orbital strike\'s commit ritual in vision §6.4.',
  },
  {
    key: 'tank.coolRate',
    group: 'player',
    label: 'Tank cool rate (/s)',
    min: 0.2, max: 4.0, step: 0.1, value: 1.4,
    help: 'Heat shed per second while not firing. With the PoC\'s defaults (2.4 max, 1.4 cool) a full lockout lasts about 1.7 s — long enough to feel, short enough not to be a punishment.',
  },
  {
    key: 'tank.range',
    group: 'player',
    label: 'Tank range',
    min: 0.05, max: 0.6, step: 0.025, value: 0.25,
    help: 'Tank shot range in world chord distance. Typical cell spacing ~0.07; 0.25 covers ~3–4 cells.',
  },

  // ── economy ────────────────────────────────────────────────────────────────
  {
    key: 'eco.startCredit',
    group: 'economy',
    label: 'Starting credit',
    min: 0, max: 1000, step: 10, value: 190,
    help: 'Credit at the start of a run. Both reference games start at 190. This sets how much defence you can commit before the first wave teaches you anything.',
  },
  {
    key: 'eco.bounty',
    group: 'economy',
    label: 'Kill bounty',
    min: 0, max: 60, step: 1, value: 8,
    help: 'Base credit for a kill, before the streak multiplier. Bounties are FLAT while enemy counts rise, so money tightens every wave automatically and you cannot out-farm the ramp — that is the reference design, not an oversight.',
  },
  {
    key: 'eco.streakStep',
    group: 'economy',
    label: 'Streak step',
    min: 0, max: 0.2, step: 0.01, value: 0.05,
    help: 'Bounty multiplier gained per consecutive kill. At 0.05 it takes 80 unbroken kills to reach the cap. 0 disables the streak entirely, which is the cleanest way to test how much of the tension it is actually carrying.',
  },
  {
    key: 'eco.streakCap',
    group: 'economy',
    label: 'Streak cap',
    min: 1, max: 6, step: 0.5, value: 5,
    help: 'Ceiling on the streak multiplier. Any leak resets the streak to zero, so a leak costs a life AND your income curve — the reference calls that the main reason play feels tense rather than idle.',
  },
  {
    key: 'eco.ramPremium',
    group: 'economy',
    label: 'Ram premium',
    min: 1, max: 3, step: 0.1, value: 1.5,
    help: 'Bounty multiplier for kills the tank makes by ramming rather than shooting. The PoC pays 1.5x, rewarding the riskiest way to kill something.',
  },
  {
    key: 'eco.trickle',
    group: 'economy',
    label: 'Passive income (/s)',
    min: 0, max: 20, step: 0.5, value: 0,
    help: 'Credit per second regardless of kills. DEFAULT 0, matching both references: income from kills only, with flat bounties against rising enemy counts, means money tightens automatically and you can never out-farm the ramp. Raise it to find out what that pressure was worth.',
  },
  {
    key: 'eco.sellRefund',
    group: 'economy',
    label: 'Sell refund',
    min: 0, max: 1, step: 0.05, value: 0.75,
    help: 'Fraction of everything sunk into a tower (purchase plus upgrades) returned on sale. Both references use 0.75, which makes repositioning cheap enough to be a real option.',
  },

  // ── feel ───────────────────────────────────────────────────────────────────
  {
    key: 'bloom.strength',
    group: 'feel',
    label: 'Bloom strength',
    min: 0, max: 3, step: 0.05, value: 1.5,
    help: 'Post-processing bloom intensity. Raised from 0.8 in M0c-2: the terrain sits deliberately below the bloom threshold (see render/geometry.ts), so bloom brightens ONLY units, shots and impacts. At 0.8 combat was legible but muted, which was the original complaint. Aesthetic only — no gameplay effect.',
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

  {
    key: 'fx.flashDur',
    group: 'feel',
    label: 'Flash duration (s)',
    min: 0.02, max: 0.5, step: 0.01, value: 0.12,
    help: 'Lifetime of muzzle flashes, hit flashes and tank beams. Short reads as a crisp snap; long smears the fight into a glow. Render-only — no gameplay effect.',
  },
  {
    key: 'fx.burstSize',
    group: 'feel',
    label: 'Death burst size',
    min: 0, max: 3, step: 0.1, value: 1,
    help: 'Radius multiplier on the burst a critter throws when it dies. 0 removes death bursts entirely. Render-only — no gameplay effect.',
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
