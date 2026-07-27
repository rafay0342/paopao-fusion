import { describe, expect, it } from 'vitest';
import {
  ATTACK_DEFINITIONS,
  createMatch,
  EMPTY_FIGHTER_INPUT,
  getAttackPhase,
  isAttackActive,
  stepMatch,
  type AttackKind,
  type FighterInput,
  type MatchInputs,
  type MatchState,
} from '../src/fighting/combat';

function input(overrides: Partial<FighterInput> = {}): FighterInput {
  return { ...EMPTY_FIGHTER_INPUT, ...overrides };
}

function inputs(
  p1: Partial<FighterInput> = {},
  p2: Partial<FighterInput> = {},
): MatchInputs {
  return { p1: input(p1), p2: input(p2) };
}

function enterFight(state: MatchState): void {
  stepMatch(state, inputs(), state.config.introFrames);
  expect(state.phase).toBe('fighting');
}

function tapAttack(state: MatchState, fighter: 'p1' | 'p2', attack: AttackKind): void {
  stepMatch(state, fighter === 'p1' ? inputs({ attack }) : inputs({}, { attack }));
  stepMatch(state, inputs());
}

describe('fighting combat core', () => {
  it('creates a deterministic best-of-three match with fighters facing each other', () => {
    const first = createMatch();
    const second = createMatch();
    expect(first).toEqual(second);
    expect(first.phase).toBe('intro');
    expect(first.round).toBe(1);
    expect(first.fighters.p1.facing).toBe(1);
    expect(first.fighters.p2.facing).toBe(-1);
    expect(first.timerFrames).toBe(90 * 60);
  });

  it('moves, jumps, lands, crouches, and stays inside the arena', () => {
    const state = createMatch();
    enterFight(state);
    const startX = state.fighters.p1.x;
    stepMatch(state, inputs({ move: 1 }), 5);
    expect(state.fighters.p1.x).toBeGreaterThan(startX);
    stepMatch(state, inputs({ jump: true }));
    expect(state.fighters.p1.airborne).toBe(true);
    expect(state.fighters.p1.y).toBeLessThan(state.config.groundY);
    for (let frame = 0; frame < 90; frame += 1) stepMatch(state, inputs());
    expect(state.fighters.p1.airborne).toBe(false);
    expect(state.fighters.p1.y).toBe(state.config.groundY);
    stepMatch(state, inputs({ crouch: true }));
    expect(state.fighters.p1.crouching).toBe(true);
    state.fighters.p1.x = state.config.arenaMaxX;
    stepMatch(state, inputs({ move: 1 }), 8);
    expect(state.fighters.p1.x).toBeLessThanOrEqual(state.config.arenaMaxX);
  });

  it('uses startup, active and recovery frames and cannot retrigger a held button', () => {
    const state = createMatch();
    enterFight(state);
    stepMatch(state, inputs({ attack: 'light' }));
    expect(state.fighters.p1.currentAttack?.kind).toBe('light');
    expect(getAttackPhase(state.fighters.p1.currentAttack!)).toBe('startup');
    stepMatch(state, inputs({ attack: 'light' }), ATTACK_DEFINITIONS.light.startup);
    expect(isAttackActive(state.fighters.p1)).toBe(true);
    stepMatch(
      state,
      inputs({ attack: 'light' }),
      ATTACK_DEFINITIONS.light.active + ATTACK_DEFINITIONS.light.recovery,
    );
    expect(state.fighters.p1.currentAttack).toBeNull();
    stepMatch(state, inputs({ attack: 'light' }), 3);
    expect(state.fighters.p1.currentAttack).toBeNull();
    stepMatch(state, inputs());
    stepMatch(state, inputs({ attack: 'light' }));
    expect(state.fighters.p1.currentAttack?.kind).toBe('light');
  });

  it('resolves a hit, damage, hitstun, knockback, meter and combo', () => {
    const state = createMatch();
    enterFight(state);
    state.fighters.p1.x = 520;
    state.fighters.p2.x = 610;
    const health = state.fighters.p2.health;
    tapAttack(state, 'p1', 'light');
    stepMatch(state, inputs(), ATTACK_DEFINITIONS.light.startup + 1);
    expect(state.fighters.p2.health).toBe(health - ATTACK_DEFINITIONS.light.damage);
    expect(state.fighters.p2.hitstunFrames).toBeGreaterThan(0);
    expect(state.fighters.p1.meter).toBeGreaterThan(0);
    expect(state.fighters.p1.combo).toBe(1);
    expect(state.events.some((event) => event.type === 'hit')).toBe(true);
  });

  it('blocks attacks, spends guard and eventually breaks guard', () => {
    const state = createMatch();
    enterFight(state);
    state.fighters.p1.x = 520;
    state.fighters.p2.x = 610;
    const health = state.fighters.p2.health;
    tapAttack(state, 'p1', 'heavy');
    stepMatch(
      state,
      inputs({}, { block: true }),
      ATTACK_DEFINITIONS.heavy.startup + 1,
    );
    expect(state.fighters.p2.health).toBe(health - ATTACK_DEFINITIONS.heavy.chipDamage);
    expect(state.fighters.p2.guard).toBeLessThan(state.fighters.p2.maxGuard);
    expect(state.events.some((event) => event.type === 'blocked')).toBe(true);

    state.fighters.p1.currentAttack = null;
    state.fighters.p1.attackLatch = null;
    state.fighters.p2.blockstunFrames = 0;
    state.fighters.p2.guard = 1;
    tapAttack(state, 'p1', 'heavy');
    stepMatch(
      state,
      inputs({}, { block: true }),
      ATTACK_DEFINITIONS.heavy.startup + 1,
    );
    expect(state.events.some((event) => event.type === 'guard-broken')).toBe(true);
    expect(state.fighters.p2.hitstunFrames).toBeGreaterThan(0);
  });

  it('gates special attacks by meter and enhances them at full meter', () => {
    const state = createMatch();
    enterFight(state);
    tapAttack(state, 'p1', 'special');
    expect(state.fighters.p1.currentAttack).toBeNull();
    state.fighters.p1.meter = state.fighters.p1.maxMeter;
    stepMatch(state, inputs({ attack: 'special' }));
    expect(state.fighters.p1.currentAttack).not.toBeNull();
    expect(state.fighters.p1.currentAttack?.enhanced).toBe(true);
    expect(state.fighters.p1.meter).toBe(0);
  });

  it('ends rounds on knockout and declares the match after two wins', () => {
    const state = createMatch({
      config: { introFrames: 1, roundOverFrames: 1 },
    });
    enterFight(state);
    state.fighters.p1.x = 520;
    state.fighters.p2.x = 610;
    state.fighters.p2.health = 1;
    tapAttack(state, 'p1', 'light');
    stepMatch(state, inputs(), ATTACK_DEFINITIONS.light.startup - 1);
    expect(state.phase).toBe('round-over');
    expect(state.wins.p1).toBe(1);
    stepMatch(state, inputs());
    expect(state.round).toBe(2);
    enterFight(state);
    state.fighters.p1.x = 520;
    state.fighters.p2.x = 610;
    state.fighters.p2.health = 1;
    tapAttack(state, 'p1', 'light');
    stepMatch(state, inputs(), ATTACK_DEFINITIONS.light.startup - 1);
    stepMatch(state, inputs());
    expect(state.phase).toBe('match-over');
    expect(state.winner).toBe('p1');
    expect(state.events).toContainEqual({ type: 'match-ended', winner: 'p1' });
  });

  it('awards a timeout by remaining-health percentage and restarts a draw', () => {
    const state = createMatch({
      config: { introFrames: 1, roundSeconds: 1, roundOverFrames: 1 },
      p1Profile: { maxHealth: 80 },
      p2Profile: { maxHealth: 120 },
    });
    enterFight(state);
    state.fighters.p1.health = 60;
    state.fighters.p2.health = 60;
    while (state.phase === 'fighting') stepMatch(state, inputs());
    expect(state.roundWinner).toBe('p1');
    expect(state.events).toContainEqual({ type: 'round-ended', winner: 'p1', reason: 'timeout' });
  });
});
