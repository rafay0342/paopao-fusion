import { describe, expect, it } from 'vitest';
import {
  addObjectiveProgress,
  advanceEmberCountdown,
  applyBossDamage,
  canSpecialRemoveMechanic,
  calculateBossDamage,
  coolEmber,
  createMechanicRunState,
  damageCrystalArmor,
  decidePortalTeleport,
  getObjectiveProgress,
  isObjectiveComplete,
  isRunFailed,
  pairPortalIds,
  protectsDetachedBubble,
  recordShot,
  rotateRowAssignments,
  RunTerminalLatch,
  selectVineSpreadTarget,
  setRunBoss,
  tickPortalCooldowns,
} from '../src/game/mechanics';

describe('mechanic run objectives', () => {
  it('tracks shots, misses, counters and objective completion immutably', () => {
    const initial = createMechanicRunState({
      mechanic: 'crystal',
      objective: { kind: 'seals', target: 2 },
      shots: 4,
      missLimit: 2,
    });
    const afterMiss = recordShot(initial, { matched: false });
    const afterHit = addObjectiveProgress(recordShot(afterMiss, { matched: true }), 'seals');
    const complete = addObjectiveProgress(afterHit, 'seals');

    expect(initial).toMatchObject({ misses: 0, shotsTaken: 0, shotsRemaining: 4 });
    expect(afterHit).toMatchObject({ misses: 1, shotsTaken: 2, shotsRemaining: 2 });
    expect(getObjectiveProgress(afterHit)).toEqual({ current: 1, target: 2, complete: false });
    expect(isObjectiveComplete(complete)).toBe(true);
    const atMissLimit = recordShot(afterHit, { matched: false });
    expect(isRunFailed(atMissLimit)).toBe(false);
    expect(isRunFailed(recordShot(atMissLimit, { matched: false }))).toBe(true);
    expect(isRunFailed(complete)).toBe(false);
  });

  it('allows exactly the configured miss allowance and fails on the next miss', () => {
    let state = createMechanicRunState({
      mechanic: 'crystal',
      objective: { kind: 'seals', target: 1 },
      missLimit: 5,
    });
    for (let miss = 1; miss <= 5; miss++) {
      state = recordShot(state, { matched: false });
      expect(isRunFailed(state), `miss ${miss} should remain playable`).toBe(false);
    }
    expect(isRunFailed(recordShot(state, { matched: false }))).toBe(true);
  });

  it.each([
    ['clear', 'clear'],
    ['vines', 'vines'],
    ['portal_cores', 'portal_cores'],
    ['embers', 'embers'],
  ] as const)('completes the %s counter objective', (objective, progressKind) => {
    const state = createMechanicRunState({ mechanic: 'vine', objective: { kind: objective, target: 1 } });
    expect(isObjectiveComplete(addObjectiveProgress(state, progressKind))).toBe(true);
  });
});

describe('crystal armor', () => {
  it('requires two matching damage events to break a two-armor crystal', () => {
    const crystal = { id: 'seal-a', armor: 2 };
    const first = damageCrystalArmor(crystal);
    const second = damageCrystalArmor(first.crystal);

    expect(crystal.armor).toBe(2);
    expect(first).toMatchObject({ damageApplied: 1, broken: false, justBroken: false });
    expect(second).toMatchObject({ damageApplied: 1, broken: true, justBroken: true });
    expect(damageCrystalArmor(second.crystal)).toMatchObject({ damageApplied: 0, justBroken: false });
  });
});

describe('polarity row rotation', () => {
  it('rotates unique assignments without losing a cell', () => {
    expect(rotateRowAssignments([1, 2, 3, 4], 1)).toEqual([4, 1, 2, 3]);
    expect(rotateRowAssignments([1, 2, 3, 4], -1)).toEqual([2, 3, 4, 1]);
    expect(rotateRowAssignments([1, 1, 2], 1)).toEqual([2, 1]);
  });
});

describe('scene hardening policies', () => {
  it('protects every objective-bearing detached bubble including polarity', () => {
    expect(protectsDetachedBubble('polarity')).toBe(true);
    expect(protectsDetachedBubble('crystal')).toBe(true);
    expect(protectsDetachedBubble(undefined)).toBe(false);
  });

  it('keeps special-removal eligibility pure and blocks match-only armour', () => {
    expect(canSpecialRemoveMechanic('crystal')).toBe(false);
    expect(canSpecialRemoveMechanic('vine')).toBe(false);
    expect(canSpecialRemoveMechanic('ice')).toBe(false);
    expect(canSpecialRemoveMechanic('polarity')).toBe(true);
    expect(canSpecialRemoveMechanic('ember')).toBe(true);
    expect(canSpecialRemoveMechanic(undefined)).toBe(true);
  });

  it('admits one terminal transition until explicitly reset', () => {
    const latch = new RunTerminalLatch();
    expect(latch.tryEnter()).toBe(true);
    expect(latch.isEntered()).toBe(true);
    expect(latch.tryEnter()).toBe(false);
    latch.reset();
    expect(latch.isEntered()).toBe(false);
    expect(latch.tryEnter()).toBe(true);
  });
});

describe('vine spread selection', () => {
  it('uses injected RNG over unique eligible IDs only', () => {
    const input = {
      candidateIds: [10, 11, 11, 12, 13],
      vineIds: [11],
      blockedIds: [12],
    };

    expect(selectVineSpreadTarget({ ...input, rng: () => 0 })).toBe(10);
    expect(selectVineSpreadTarget({ ...input, rng: () => 0.999 })).toBe(13);
    expect(selectVineSpreadTarget({ candidateIds: [1], vineIds: [1], rng: () => 0.5 })).toBeNull();
  });
});

describe('portals', () => {
  it('pairs IDs, enforces paired cooldown and becomes ready after it expires', () => {
    const pairs = pairPortalIds(['a', 'b', 'c', 'd', 'orphan']);
    expect(pairs).toEqual([
      { first: 'a', second: 'b' },
      { first: 'c', second: 'd' },
    ]);

    const first = decidePortalTeleport('a', pairs, [], 2);
    expect(first).toMatchObject({ canTeleport: true, destinationId: 'b', reason: 'ready' });
    expect(decidePortalTeleport('b', pairs, first.cooldowns, 2).reason).toBe('cooldown');
    const readyCooldowns = tickPortalCooldowns(first.cooldowns, 2);
    expect(readyCooldowns).toEqual([]);
    expect(decidePortalTeleport('b', pairs, readyCooldowns, 2)).toMatchObject({
      canTeleport: true,
      destinationId: 'a',
    });
    expect(decidePortalTeleport('orphan', pairs).reason).toBe('unpaired');
  });
});

describe('ember countdown', () => {
  it('reports newly erupted embers once and never advances cooled embers', () => {
    const safe = coolEmber({ id: 'safe', countdown: 1, cooled: false });
    const first = advanceEmberCountdown([
      { id: 'hot', countdown: 2, cooled: false },
      safe,
    ]);
    const second = advanceEmberCountdown(first.embers);
    const third = advanceEmberCountdown(second.embers);

    expect(first.eruptedIds).toEqual([]);
    expect(second.eruptedIds).toEqual(['hot']);
    expect(third.eruptedIds).toEqual([]);
    expect(third.embers.find(({ id }) => id === 'safe')).toMatchObject({ countdown: 1, cooled: true });
  });
});

describe('boss damage', () => {
  it('combines match, combo, floaters, bomb and artifact damage', () => {
    expect(calculateBossDamage({ successfulMatch: true })).toBe(1);
    expect(calculateBossDamage({ successfulMatch: true, combo: 3 })).toBe(2);
    expect(calculateBossDamage({ combo: 9 })).toBe(0);
    expect(calculateBossDamage({
      successfulMatch: true,
      combo: 3,
      floaters: 5,
      bomb: true,
      artifactSuper: true,
    })).toBe(7);
  });

  it('clamps damage to HP and completes a boss objective at zero', () => {
    const initial = createMechanicRunState({
      mechanic: 'ember',
      objective: { kind: 'boss', target: 12 },
    });
    const hit = applyBossDamage(initial.boss!, { bomb: true, artifactSuper: true });
    const defeated = applyBossDamage(hit.boss, { bomb: true, artifactSuper: true, floaters: 5 });
    const finished = setRunBoss(initial, applyBossDamage(defeated.boss, { bomb: true, artifactSuper: true }).boss);

    expect(hit).toMatchObject({ damage: 4, boss: { hp: 8, maxHp: 12 }, defeated: false });
    expect(defeated).toMatchObject({ damage: 5, boss: { hp: 3, maxHp: 12 }, defeated: false });
    expect(finished.boss).toEqual({ hp: 0, maxHp: 12 });
    expect(isObjectiveComplete(finished)).toBe(true);
    expect(getObjectiveProgress(finished)).toEqual({ current: 12, target: 12, complete: true });
  });
});
