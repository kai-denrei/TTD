import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEconomy } from './economy.ts';
import { makeTuning } from '../tuning/store.ts';

function eco(over: Record<string, number> = {}) {
  const t = makeTuning();
  for (const [k, v] of Object.entries(over)) t.set(k, v);
  return { eco: makeEconomy(t), tuning: t };
}

describe('economy', () => {
  test('starts with the configured credit', () => {
    assert.equal(eco({ 'eco.startCredit': 120 }).eco.credit, 120);
  });

  test('spending deducts, and an unaffordable spend changes nothing', () => {
    const { eco: e } = eco({ 'eco.startCredit': 100 });
    assert.equal(e.spend(40), true);
    assert.equal(e.credit, 60);
    assert.equal(e.spend(61), false, 'spent more than it had');
    assert.equal(e.credit, 60, 'a refused spend still moved credit');
  });

  test('credit never goes negative', () => {
    const { eco: e } = eco({ 'eco.startCredit': 10 });
    for (let i = 0; i < 20; i++) e.spend(3);
    assert.ok(e.credit >= 0);
  });

  test('cost is rounded UP when spending — you cannot buy at a fraction', () => {
    const { eco: e } = eco({ 'eco.startCredit': 10 });
    assert.equal(e.canAfford(10.5), false, 'affording 10.5 with 10 credit is a rounding artefact');
    assert.equal(e.spend(9.2), true);
    assert.equal(e.credit, 0);
  });

  // NOTE: values must sit inside the lever's declared range — the store clamps,
  // so a test using eco.streakStep 0.5 silently gets 0.2 and asserts a number
  // the code never produced.
  test('a kill pays its bounty, scaled by the streak', () => {
    const { eco: e } = eco({ 'eco.startCredit': 0, 'eco.streakStep': 0.2, 'eco.streakCap': 10 });
    e.rewardKill(10);           // streak 1 -> x1.2
    assert.equal(e.credit, 12);
    e.rewardKill(10);           // streak 2 -> x1.4
    assert.equal(e.credit, 26);
  });

  test('the streak cap is respected', () => {
    const { eco: e } = eco({ 'eco.startCredit': 0, 'eco.streakStep': 0.05, 'eco.streakCap': 5 });
    for (let i = 0; i < 500; i++) e.rewardKill(10);
    assert.equal(e.multiplier, 5);
  });

  test('a leak resets the streak — a leak costs a life AND the income curve', () => {
    const { eco: e } = eco({ 'eco.startCredit': 0, 'eco.streakStep': 0.2, 'eco.streakCap': 10 });
    e.rewardKill(10);
    e.rewardKill(10);
    assert.equal(e.streak, 2);
    e.leak();
    assert.equal(e.streak, 0);
    const before = e.credit;
    e.rewardKill(10);           // back to streak 1 -> x1.2
    assert.equal(e.credit - before, 12);
  });

  test('streakStep 0 disables the streak entirely', () => {
    const { eco: e } = eco({ 'eco.startCredit': 0, 'eco.streakStep': 0 });
    e.rewardKill(10);
    e.rewardKill(10);
    assert.equal(e.credit, 20, 'multiplier applied despite a zero step');
  });

  test('a ram kill pays the premium', () => {
    const { eco: e } = eco({ 'eco.startCredit': 0, 'eco.streakStep': 0, 'eco.ramPremium': 1.5 });
    e.rewardKill(10, true);
    assert.equal(e.credit, 15);
  });

  test('the trickle accumulates instead of rounding away each tick', () => {
    // 2 credit/sec sampled at 1/60 is 0.033 per tick. Flooring per tick would
    // bank exactly nothing, forever.
    const { eco: e } = eco({ 'eco.startCredit': 0, 'eco.trickle': 2 });
    for (let i = 0; i < 60; i++) e.tick(1 / 60);
    assert.ok(e.credit >= 1, `a 2/sec trickle banked ${e.credit} over one second`);
    assert.ok(e.credit <= 2);
  });

  test('a zero trickle pays nothing', () => {
    const { eco: e } = eco({ 'eco.startCredit': 0, 'eco.trickle': 0 });
    for (let i = 0; i < 600; i++) e.tick(1 / 60);
    assert.equal(e.credit, 0);
  });

  test('selling refunds a fraction, floored', () => {
    const { eco: e } = eco({ 'eco.sellRefund': 0.6 });
    assert.equal(e.refundFor(50), 30);
    assert.equal(e.refundFor(51), 30, 'refund must floor, never round up into free money');
  });

  test('earned tracks lifetime income and is not reduced by spending', () => {
    const { eco: e } = eco({ 'eco.startCredit': 100, 'eco.streakStep': 0 });
    e.rewardKill(10);
    e.spend(80);
    assert.equal(e.earned, 110);
    assert.equal(e.spent, 80);
    assert.equal(e.credit, 30);
  });
});
