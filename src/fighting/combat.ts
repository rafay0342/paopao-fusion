export type AttackKind = 'light' | 'heavy' | 'special';
export type FighterId = 'p1' | 'p2';
export type AttackPhase = 'startup' | 'active' | 'recovery';
export type MatchPhase = 'intro' | 'fighting' | 'round-over' | 'match-over';

export interface FighterInput {
  move: -1 | 0 | 1;
  jump: boolean;
  crouch: boolean;
  block: boolean;
  attack: AttackKind | null;
}

export type MatchInputs = Record<FighterId, FighterInput>;

export interface FighterProfile {
  maxHealth: number;
  speedScale: number;
  damageScale: number;
  defenseScale: number;
}

export interface AttackDefinition {
  kind: AttackKind;
  startup: number;
  active: number;
  recovery: number;
  range: number;
  damage: number;
  chipDamage: number;
  hitstun: number;
  blockstun: number;
  knockback: number;
  guardDamage: number;
  meterGain: number;
  meterCost: number;
}

export interface ActiveAttack {
  kind: AttackKind;
  frame: number;
  connected: boolean;
  enhanced: boolean;
}

export interface FighterState {
  id: FighterId;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  facing: -1 | 1;
  health: number;
  maxHealth: number;
  guard: number;
  maxGuard: number;
  meter: number;
  maxMeter: number;
  currentAttack: ActiveAttack | null;
  hitstunFrames: number;
  blockstunFrames: number;
  invulnerableFrames: number;
  airborne: boolean;
  crouching: boolean;
  blocking: boolean;
  defeated: boolean;
  combo: number;
  comboTimer: number;
  attackLatch: AttackKind | null;
  jumpLatch: boolean;
  profile: FighterProfile;
}

export type RoundEndReason = 'knockout' | 'timeout' | 'draw';

export type CombatEvent =
  | { type: 'round-started'; round: number }
  | { type: 'fight-called'; round: number }
  | { type: 'attack-started'; fighter: FighterId; attack: AttackKind; enhanced: boolean }
  | {
    type: 'hit';
    source: FighterId;
    target: FighterId;
    attack: AttackKind;
    damage: number;
    combo: number;
    enhanced: boolean;
  }
  | {
    type: 'blocked';
    source: FighterId;
    target: FighterId;
    attack: AttackKind;
    chipDamage: number;
  }
  | { type: 'guard-broken'; fighter: FighterId }
  | { type: 'landed'; fighter: FighterId }
  | { type: 'round-ended'; winner: FighterId | null; reason: RoundEndReason }
  | { type: 'match-ended'; winner: FighterId };

export interface CombatConfig {
  arenaMinX: number;
  arenaMaxX: number;
  groundY: number;
  minimumSpacing: number;
  movementSpeed: number;
  jumpVelocity: number;
  gravity: number;
  roundSeconds: number;
  introFrames: number;
  roundOverFrames: number;
  winsRequired: number;
  guardRecoveryPerFrame: number;
  comboWindowFrames: number;
}

export interface MatchState {
  frame: number;
  round: number;
  phase: MatchPhase;
  phaseFrame: number;
  timerFrames: number;
  wins: Record<FighterId, number>;
  roundWinner: FighterId | null;
  winner: FighterId | null;
  fighters: Record<FighterId, FighterState>;
  events: CombatEvent[];
  config: CombatConfig;
}

export interface CreateMatchOptions {
  config?: Partial<CombatConfig>;
  p1Profile?: Partial<FighterProfile>;
  p2Profile?: Partial<FighterProfile>;
}

export const EMPTY_FIGHTER_INPUT: FighterInput = {
  move: 0,
  jump: false,
  crouch: false,
  block: false,
  attack: null,
};

export const ATTACK_DEFINITIONS: Record<AttackKind, AttackDefinition> = {
  light: {
    kind: 'light',
    startup: 5,
    active: 4,
    recovery: 11,
    range: 235,
    damage: 7,
    chipDamage: 0,
    hitstun: 14,
    blockstun: 7,
    knockback: 6.2,
    guardDamage: 7,
    meterGain: 8,
    meterCost: 0,
  },
  heavy: {
    kind: 'heavy',
    startup: 12,
    active: 5,
    recovery: 21,
    range: 265,
    damage: 13,
    chipDamage: 1,
    hitstun: 22,
    blockstun: 12,
    knockback: 10.5,
    guardDamage: 14,
    meterGain: 12,
    meterCost: 0,
  },
  special: {
    kind: 'special',
    startup: 17,
    active: 8,
    recovery: 29,
    range: 345,
    damage: 18,
    chipDamage: 3,
    hitstun: 29,
    blockstun: 16,
    knockback: 14,
    guardDamage: 21,
    meterGain: 5,
    meterCost: 30,
  },
};

export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  arenaMinX: 128,
  arenaMaxX: 1152,
  groundY: 608,
  minimumSpacing: 210,
  movementSpeed: 5.1,
  jumpVelocity: -15.2,
  gravity: 0.82,
  roundSeconds: 90,
  introFrames: 126,
  roundOverFrames: 190,
  winsRequired: 2,
  guardRecoveryPerFrame: 0.16,
  comboWindowFrames: 75,
};

const DEFAULT_PROFILE: FighterProfile = {
  maxHealth: 100,
  speedScale: 1,
  damageScale: 1,
  defenseScale: 1,
};

export function createMatch(options: CreateMatchOptions = {}): MatchState {
  const config = { ...DEFAULT_COMBAT_CONFIG, ...options.config };
  const p1Profile = { ...DEFAULT_PROFILE, ...options.p1Profile };
  const p2Profile = { ...DEFAULT_PROFILE, ...options.p2Profile };
  return {
    frame: 0,
    round: 1,
    phase: 'intro',
    phaseFrame: 0,
    timerFrames: config.roundSeconds * 60,
    wins: { p1: 0, p2: 0 },
    roundWinner: null,
    winner: null,
    fighters: {
      p1: createFighter('p1', config.arenaMinX + 225, 1, p1Profile, config),
      p2: createFighter('p2', config.arenaMaxX - 225, -1, p2Profile, config),
    },
    events: [{ type: 'round-started', round: 1 }],
    config,
  };
}

export function stepMatch(
  state: MatchState,
  inputs: MatchInputs,
  dtFrames = 1,
): MatchState {
  const frames = Math.max(1, Math.min(600, Math.floor(dtFrames)));
  state.events = [];
  for (let index = 0; index < frames; index += 1) {
    stepSingleFrame(state, inputs);
  }
  return state;
}

export function getFighter(state: MatchState, id: FighterId): FighterState {
  return state.fighters[id];
}

export function getAttackPhase(attack: ActiveAttack): AttackPhase {
  const definition = ATTACK_DEFINITIONS[attack.kind];
  if (attack.frame < definition.startup) return 'startup';
  if (attack.frame < definition.startup + definition.active) return 'active';
  return 'recovery';
}

export function isAttackActive(fighter: FighterState): boolean {
  return fighter.currentAttack !== null && getAttackPhase(fighter.currentAttack) === 'active';
}

function createFighter(
  id: FighterId,
  x: number,
  facing: -1 | 1,
  profile: FighterProfile,
  config: CombatConfig,
): FighterState {
  return {
    id,
    x,
    y: config.groundY,
    velocityX: 0,
    velocityY: 0,
    facing,
    health: profile.maxHealth,
    maxHealth: profile.maxHealth,
    guard: 100,
    maxGuard: 100,
    meter: 0,
    maxMeter: 100,
    currentAttack: null,
    hitstunFrames: 0,
    blockstunFrames: 0,
    invulnerableFrames: 0,
    airborne: false,
    crouching: false,
    blocking: false,
    defeated: false,
    combo: 0,
    comboTimer: 0,
    attackLatch: null,
    jumpLatch: false,
    profile,
  };
}

function stepSingleFrame(state: MatchState, inputs: MatchInputs): void {
  state.frame += 1;
  state.phaseFrame += 1;

  if (state.phase === 'intro') {
    latchInputs(state.fighters.p1, inputs.p1);
    latchInputs(state.fighters.p2, inputs.p2);
    if (state.phaseFrame >= state.config.introFrames) {
      state.phase = 'fighting';
      state.phaseFrame = 0;
      state.events.push({ type: 'fight-called', round: state.round });
    }
    return;
  }

  if (state.phase === 'round-over') {
    latchInputs(state.fighters.p1, inputs.p1);
    latchInputs(state.fighters.p2, inputs.p2);
    dampRoundOverFighter(state.fighters.p1, state.config);
    dampRoundOverFighter(state.fighters.p2, state.config);
    if (state.phaseFrame >= state.config.roundOverFrames) {
      if (state.roundWinner && state.wins[state.roundWinner] >= state.config.winsRequired) {
        state.phase = 'match-over';
        state.phaseFrame = 0;
        state.winner = state.roundWinner;
        state.events.push({ type: 'match-ended', winner: state.roundWinner });
      } else {
        resetForNextRound(state);
      }
    }
    return;
  }

  if (state.phase === 'match-over') {
    latchInputs(state.fighters.p1, inputs.p1);
    latchInputs(state.fighters.p2, inputs.p2);
    return;
  }

  state.timerFrames = Math.max(0, state.timerFrames - 1);
  updateFighter(state, state.fighters.p1, inputs.p1);
  updateFighter(state, state.fighters.p2, inputs.p2);
  updateFacing(state);
  resolveSpacing(state);
  resolveAttack(state, state.fighters.p1, state.fighters.p2);
  resolveAttack(state, state.fighters.p2, state.fighters.p1);

  if (state.fighters.p1.health <= 0 || state.fighters.p2.health <= 0) {
    const winner = state.fighters.p1.health <= 0 ? 'p2' : 'p1';
    endRound(state, winner, 'knockout');
  } else if (state.timerFrames <= 0) {
    const p1Ratio = state.fighters.p1.health / state.fighters.p1.maxHealth;
    const p2Ratio = state.fighters.p2.health / state.fighters.p2.maxHealth;
    const winner = p1Ratio === p2Ratio ? null : p1Ratio > p2Ratio ? 'p1' : 'p2';
    endRound(state, winner, winner ? 'timeout' : 'draw');
  }
}

function latchInputs(fighter: FighterState, input: FighterInput): void {
  fighter.attackLatch = input.attack;
  fighter.jumpLatch = input.jump;
}

function updateFighter(state: MatchState, fighter: FighterState, input: FighterInput): void {
  const config = state.config;
  const wasAirborne = fighter.airborne;
  fighter.invulnerableFrames = Math.max(0, fighter.invulnerableFrames - 1);
  fighter.hitstunFrames = Math.max(0, fighter.hitstunFrames - 1);
  fighter.blockstunFrames = Math.max(0, fighter.blockstunFrames - 1);
  fighter.comboTimer = Math.max(0, fighter.comboTimer - 1);
  if (fighter.comboTimer === 0) fighter.combo = 0;

  const stunned = fighter.hitstunFrames > 0 || fighter.blockstunFrames > 0 || fighter.defeated;
  const newJump = input.jump && !fighter.jumpLatch;
  const newAttack = input.attack !== null && input.attack !== fighter.attackLatch;
  fighter.jumpLatch = input.jump;
  fighter.attackLatch = input.attack;

  if (fighter.currentAttack) {
    fighter.currentAttack.frame += 1;
    const definition = ATTACK_DEFINITIONS[fighter.currentAttack.kind];
    if (fighter.currentAttack.frame >= definition.startup + definition.active + definition.recovery) {
      fighter.currentAttack = null;
    }
  }

  fighter.blocking = !stunned
    && fighter.currentAttack === null
    && !fighter.airborne
    && input.block
    && fighter.guard > 0;
  fighter.crouching = !stunned
    && fighter.currentAttack === null
    && !fighter.airborne
    && input.crouch;

  if (!fighter.blocking && fighter.blockstunFrames === 0) {
    fighter.guard = Math.min(
      fighter.maxGuard,
      fighter.guard + config.guardRecoveryPerFrame,
    );
  }

  if (!stunned && fighter.currentAttack === null) {
    if (newJump && !fighter.airborne && !fighter.crouching && !fighter.blocking) {
      fighter.airborne = true;
      fighter.velocityY = config.jumpVelocity;
    }
    if (!fighter.crouching && !fighter.blocking) {
      fighter.velocityX = input.move * config.movementSpeed * fighter.profile.speedScale;
    } else {
      fighter.velocityX *= 0.65;
    }
    if (newAttack && !fighter.blocking) {
      startAttack(state, fighter, input.attack as AttackKind);
    }
  } else if (fighter.currentAttack) {
    fighter.velocityX *= 0.76;
  } else {
    fighter.velocityX *= fighter.airborne ? 0.96 : 0.78;
  }

  if (fighter.airborne) {
    fighter.velocityY += config.gravity;
    fighter.y += fighter.velocityY;
    if (fighter.y >= config.groundY) {
      fighter.y = config.groundY;
      fighter.velocityY = 0;
      fighter.airborne = false;
      if (wasAirborne) state.events.push({ type: 'landed', fighter: fighter.id });
    }
  }

  fighter.x += fighter.velocityX;
  fighter.x = clamp(fighter.x, config.arenaMinX, config.arenaMaxX);
}

function startAttack(state: MatchState, fighter: FighterState, kind: AttackKind): void {
  const definition = ATTACK_DEFINITIONS[kind];
  if (fighter.meter < definition.meterCost) return;
  const enhanced = kind === 'special' && fighter.meter >= fighter.maxMeter;
  fighter.meter -= enhanced ? fighter.maxMeter : definition.meterCost;
  fighter.currentAttack = { kind, frame: 0, connected: false, enhanced };
  state.events.push({ type: 'attack-started', fighter: fighter.id, attack: kind, enhanced });
}

function resolveAttack(
  state: MatchState,
  attacker: FighterState,
  defender: FighterState,
): void {
  const attack = attacker.currentAttack;
  if (!attack || attack.connected || !isAttackActive(attacker) || defender.invulnerableFrames > 0) {
    return;
  }
  const definition = ATTACK_DEFINITIONS[attack.kind];
  const enhancedRange = attack.enhanced ? definition.range * 1.3 : definition.range;
  const horizontalDistance = Math.abs(defender.x - attacker.x);
  const verticalDistance = Math.abs(defender.y - attacker.y);
  const inFront = (defender.x - attacker.x) * attacker.facing >= -24;
  if (horizontalDistance > enhancedRange || verticalDistance > 125 || !inFront) return;

  attack.connected = true;
  if (defender.blocking && defender.facing === -attacker.facing) {
    const guardDamage = definition.guardDamage * (attack.enhanced ? 1.45 : 1);
    defender.guard = Math.max(0, defender.guard - guardDamage);
    const chip = Math.min(
      Math.max(0, defender.health - 1),
      Math.round(definition.chipDamage * attacker.profile.damageScale),
    );
    defender.health -= chip;
    defender.blockstunFrames = definition.blockstun + (attack.enhanced ? 5 : 0);
    defender.velocityX = attacker.facing * definition.knockback * 0.42;
    attacker.meter = Math.min(attacker.maxMeter, attacker.meter + definition.meterGain * 0.4);
    state.events.push({
      type: 'blocked',
      source: attacker.id,
      target: defender.id,
      attack: attack.kind,
      chipDamage: chip,
    });
    if (defender.guard <= 0) {
      defender.blocking = false;
      defender.blockstunFrames = 0;
      defender.hitstunFrames = 34;
      defender.guard = defender.maxGuard * 0.22;
      state.events.push({ type: 'guard-broken', fighter: defender.id });
    }
    return;
  }

  const baseDamage = definition.damage * (attack.enhanced ? 1.55 : 1);
  const damage = Math.max(
    1,
    Math.round(baseDamage * attacker.profile.damageScale / defender.profile.defenseScale),
  );
  defender.health = Math.max(0, defender.health - damage);
  defender.hitstunFrames = definition.hitstun + (attack.enhanced ? 8 : 0);
  defender.blocking = false;
  defender.crouching = false;
  defender.currentAttack = null;
  defender.velocityX = attacker.facing * definition.knockback * (attack.enhanced ? 1.25 : 1);
  if (attack.kind === 'heavy' || attack.enhanced) {
    defender.velocityY = attack.enhanced ? -8.4 : -4.8;
    defender.airborne = true;
  }
  defender.invulnerableFrames = 2;
  attacker.combo = attacker.comboTimer > 0 ? attacker.combo + 1 : 1;
  attacker.comboTimer = state.config.comboWindowFrames;
  attacker.meter = Math.min(attacker.maxMeter, attacker.meter + definition.meterGain);
  defender.meter = Math.min(defender.maxMeter, defender.meter + damage * 0.55);
  state.events.push({
    type: 'hit',
    source: attacker.id,
    target: defender.id,
    attack: attack.kind,
    damage,
    combo: attacker.combo,
    enhanced: attack.enhanced,
  });
}

function updateFacing(state: MatchState): void {
  const { p1, p2 } = state.fighters;
  if (!p1.currentAttack && p1.hitstunFrames === 0) p1.facing = p1.x <= p2.x ? 1 : -1;
  if (!p2.currentAttack && p2.hitstunFrames === 0) p2.facing = p2.x <= p1.x ? 1 : -1;
}

function resolveSpacing(state: MatchState): void {
  const { p1, p2 } = state.fighters;
  const delta = p2.x - p1.x;
  const distance = Math.abs(delta);
  if (distance >= state.config.minimumSpacing) return;
  const correction = (state.config.minimumSpacing - distance) / 2;
  const direction = delta >= 0 ? 1 : -1;
  p1.x = clamp(p1.x - correction * direction, state.config.arenaMinX, state.config.arenaMaxX);
  p2.x = clamp(p2.x + correction * direction, state.config.arenaMinX, state.config.arenaMaxX);
}

function endRound(
  state: MatchState,
  winner: FighterId | null,
  reason: RoundEndReason,
): void {
  state.phase = 'round-over';
  state.phaseFrame = 0;
  state.roundWinner = winner;
  if (winner) state.wins[winner] += 1;
  state.fighters.p1.defeated = state.fighters.p1.health <= 0;
  state.fighters.p2.defeated = state.fighters.p2.health <= 0;
  state.events.push({ type: 'round-ended', winner, reason });
}

function dampRoundOverFighter(fighter: FighterState, config: CombatConfig): void {
  fighter.velocityX *= 0.88;
  fighter.x = clamp(fighter.x + fighter.velocityX, config.arenaMinX, config.arenaMaxX);
  if (fighter.airborne) {
    fighter.velocityY += config.gravity;
    fighter.y = Math.min(config.groundY, fighter.y + fighter.velocityY);
    if (fighter.y >= config.groundY) {
      fighter.y = config.groundY;
      fighter.velocityY = 0;
      fighter.airborne = false;
    }
  }
}

function resetForNextRound(state: MatchState): void {
  state.round += 1;
  state.phase = 'intro';
  state.phaseFrame = 0;
  state.timerFrames = state.config.roundSeconds * 60;
  state.roundWinner = null;
  const profiles = {
    p1: state.fighters.p1.profile,
    p2: state.fighters.p2.profile,
  };
  state.fighters = {
    p1: createFighter('p1', state.config.arenaMinX + 225, 1, profiles.p1, state.config),
    p2: createFighter('p2', state.config.arenaMaxX - 225, -1, profiles.p2, state.config),
  };
  state.events.push({ type: 'round-started', round: state.round });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
