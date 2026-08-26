// economy.ts — credits: what a tower costs and where the money comes from.
//
// WHY THIS EXISTS. Until now towers were free and unlimited: you could tap
// fifty turrets onto the board. No lever setting produces difficulty against
// unlimited free defence, so "is this balanced?" had no cost to trade against.
// An economy is what turns tower placement from a click into a decision.
//
// PURE AND SEPARATE. Credits are simple enough to inline into world.ts, but
// keeping them here means the earn/spend rules can be unit-tested exhaustively
// without building a sphere, and a future economy lever cannot quietly grow
// tendrils through the tick.
//
// INCOME IS KILLS ONLY, AND THE STREAK IS THE POINT. Both references converge
// on this: no passive trickle, no per-wave bonus, flat bounties against
// compounding enemy HP — so money tightens every wave automatically and you can
// never out-farm the ramp. On top of that, a kill streak multiplies bounty up
// to 5x and ANY leak resets it to zero. That is what makes a leak cost twice:
// a life and your income curve. The HokorobiTawaa report names it the single
// biggest reason the game feels tense rather than idle.
//
// A trickle lever exists but defaults to 0, so the reference behaviour is the
// default and the alternative is one slider away rather than a rewrite.
//
// NO FLOATING-POINT CREDIT. Amounts are integers. A player who "cannot afford"
// a 50-credit tower while holding 49.999999 has hit a rounding artefact, not a
// decision, and that class of bug is invisible until someone complains the
// shop is lying.

import type { TuningStore } from '../tuning/store.ts';

export type Economy = {
  /** Current spendable credit. Always a non-negative integer. */
  readonly credit: number;
  /** Lifetime credit earned, for telemetry — spending does not reduce it. */
  readonly earned: number;
  /** Total credit sunk into towers still standing plus those sold. */
  readonly spent: number;
  canAfford(cost: number): boolean;
  /** Spend if affordable. Returns false and changes nothing otherwise. */
  spend(cost: number): boolean;
  /** Current kill streak; any leak resets it. */
  readonly streak: number;
  /** Bounty multiplier the streak currently earns: 1 + step*streak, capped. */
  readonly multiplier: number;
  /** Award a kill's bounty, scaled by the streak, and extend the streak.
   *  `ramPremium` is applied for tank-ram kills (the PoC pays 1.5x). */
  rewardKill(bounty: number, ramPremium?: boolean): void;
  /** A critter reached the heart: the streak dies. */
  leak(): void;
  /** Passive trickle, called once per tick with dt. */
  tick(dt: number): void;
  /** Refund for selling something that cost `originalCost`. */
  refundFor(originalCost: number): number;
  credited(amount: number): void;
};

export function makeEconomy(tuning: TuningStore): Economy {
  let credit = Math.floor(tuning.get('eco.startCredit'));
  let earned = credit;
  let spent = 0;
  let streak = 0;
  // Trickle accumulates as a fraction and is banked only at whole credits, so
  // a slow drip is not silently rounded away to nothing every tick.
  let trickle = 0;

  function credited(amount: number): void {
    const whole = Math.floor(amount);
    if (whole <= 0) return;
    credit += whole;
    earned += whole;
  }

  return {
    get credit() { return credit; },
    get earned() { return earned; },
    get spent() { return spent; },
    canAfford(cost) { return credit >= Math.ceil(cost); },
    spend(cost) {
      const c = Math.ceil(cost);
      if (credit < c) return false;
      credit -= c;
      spent += c;
      return true;
    },
    get streak() { return streak; },
    get multiplier() {
      return Math.min(
        tuning.get('eco.streakCap'),
        1 + tuning.get('eco.streakStep') * streak,
      );
    },
    rewardKill(bounty, ramPremium = false) {
      // Streak increments BEFORE the payout, matching the reference: the kill
      // that starts a streak already earns a little more than the last one.
      streak += 1;
      const mult = Math.min(
        tuning.get('eco.streakCap'),
        1 + tuning.get('eco.streakStep') * streak,
      );
      const ram = ramPremium ? tuning.get('eco.ramPremium') : 1;
      credited(Math.round(bounty * mult * ram));
    },
    leak() {
      streak = 0;
    },
    tick(dt) {
      trickle += tuning.get('eco.trickle') * dt;
      if (trickle >= 1) {
        const whole = Math.floor(trickle);
        trickle -= whole;
        credited(whole);
      }
    },
    refundFor(originalCost) {
      return Math.floor(originalCost * tuning.get('eco.sellRefund'));
    },
    credited,
  };
}
