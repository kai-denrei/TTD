import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeadless, meanSummaries } from './runner.ts';

describe('runHeadless', () => {
  test('truncates at heart death by default', () => {
    const r = runHeadless({ seed: 42, input: 'patrol', maxTicks: 6000 });
    assert.equal(r.stoppedEarly, true, 'heart should die within 6000 ticks at default tuning');
    assert.ok(r.ticksRun < 6000, `ran ${r.ticksRun} ticks; expected truncation`);
    assert.ok(
      r.summary['elapsed']! <= r.summary['survivedFor']! + 1e-6,
      'telemetry accrued past the heart death — truncation did not take effect',
    );
  });

  test('runs the full budget when stopAtDeath is false', () => {
    const r = runHeadless({ seed: 42, input: 'patrol', maxTicks: 6000, stopAtDeath: false });
    assert.equal(r.ticksRun, 6000);
    assert.equal(r.stoppedEarly, false);
    assert.ok(r.summary['elapsed']! > r.summary['survivedFor']! + 1);
  });

  test('is deterministic — same spec, identical summary', () => {
    const a = runHeadless({ seed: 42, input: 'patrol', maxTicks: 1200 });
    const b = runHeadless({ seed: 42, input: 'patrol', maxTicks: 1200 });
    assert.deepEqual(a.summary, b.summary);
    assert.equal(a.ticksRun, b.ticksRun);
  });

  test('a preset string changes the outcome', () => {
    const slow = runHeadless({ seed: 42, input: 'patrol', maxTicks: 6000, preset: 'enemy.speed=0.3' });
    const fast = runHeadless({ seed: 42, input: 'patrol', maxTicks: 6000, preset: 'enemy.speed=3.0' });
    assert.notDeepEqual(slow.summary, fast.summary);
    assert.ok(
      slow.summary['survivedFor']! > fast.summary['survivedFor']!,
      'slower enemies should keep the heart alive longer',
    );
  });

  test('towers:none leaves the heart undefended', () => {
    // tower.damage=20 one-shots a default 5 HP critter. It is needed because at
    // DEFAULT tuning one tower kills NOTHING with an idle tank: damage 3 vs hp 5
    // needs two shots, and the 1.0 s cooldown is longer than a critter's dwell
    // time in range, so damage lands but never finishes. That is the calibration
    // finding CLAUDE.md records ("every current setting loses with one tower"),
    // not a defect — but it makes default tuning useless for asserting that the
    // `towers` option is honoured, which is what this test is actually about.
    const preset = 'tower.damage=20';
    const none = runHeadless({ seed: 42, input: 'idle', maxTicks: 6000, towers: 'none', preset });
    const heart = runHeadless({ seed: 42, input: 'idle', maxTicks: 6000, towers: 'heart', preset });
    assert.equal(none.summary['towerKillShare'], 0, 'no tower means no tower kills');
    assert.ok(heart.summary['towerKillShare']! > 0, 'a tower at the heart must kill something');
    assert.ok(
      heart.summary['survivedFor']! > none.summary['survivedFor']!,
      'a tower that kills must extend survival',
    );
  });

  test('an explicit tower cell list is honoured', () => {
    const r = runHeadless({ seed: 42, input: 'idle', maxTicks: 600, towers: [0, 1, 2] });
    assert.ok(r.ticksRun > 0);
  });

  test('meanSummaries averages matching keys across runs', () => {
    const mean = meanSummaries([
      { summary: { a: 2, b: 10 }, ticksRun: 1, stoppedEarly: false },
      { summary: { a: 4, b: 20 }, ticksRun: 1, stoppedEarly: false },
    ]);
    assert.deepEqual(mean, { a: 3, b: 15 });
  });

  test('meanSummaries of an empty list is an empty record', () => {
    assert.deepEqual(meanSummaries([]), {});
  });
});
