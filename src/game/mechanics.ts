/**
 * Pure gameplay rules for world mechanics and level objectives.
 *
 * This module deliberately has no Phaser dependency. Scenes can feed it IDs
 * and shot outcomes, then render the returned state however they choose.
 */

export type MechanicKind = 'crystal' | 'vine' | 'portal' | 'ember' | 'ice' | 'polarity';
export type ObjectiveKind = 'clear' | 'seals' | 'vines' | 'portal_cores' | 'embers' | 'ice_cores' | 'polarity_nodes' | 'boss';
export type EntityId = string | number;
export type RandomSource = () => number;

export interface ObjectiveDefinition {
  kind: ObjectiveKind;
  target: number;
}

export interface ObjectiveCounters {
  cleared: number;
  seals: number;
  vines: number;
  portalCores: number;
  embers: number;
  iceCores: number;
  polarityNodes: number;
}

export interface BossState {
  hp: number;
  maxHp: number;
}

export interface MechanicRunState {
  mechanic: MechanicKind;
  objective: ObjectiveDefinition;
  counters: ObjectiveCounters;
  boss: BossState | null;
  misses: number;
  shotsTaken: number;
  shotsRemaining: number | null;
  missLimit: number | null;
}

export interface CreateMechanicRunStateInput {
  mechanic: MechanicKind;
  objective: ObjectiveDefinition;
  shots?: number | null;
  missLimit?: number | null;
  bossHp?: number;
  counters?: Partial<ObjectiveCounters>;
}

export interface ShotOutcome {
  matched: boolean;
}

/**
 * One-way latch for terminal run UI and rewards. Phaser scenes can receive the
 * same terminal signal from the timer, board and an async mode result in close
 * succession; only the first signal may create a card or claim rewards.
 */
export class RunTerminalLatch {
  private entered = false;

  tryEnter(): boolean {
    if (this.entered) return false;
    this.entered = true;
    return true;
  }

  isEntered(): boolean {
    return this.entered;
  }

  reset(): void {
    this.entered = false;
  }
}

const EMPTY_COUNTERS: ObjectiveCounters = {
  cleared: 0,
  seals: 0,
  vines: 0,
  portalCores: 0,
  embers: 0,
  iceCores: 0,
  polarityNodes: 0,
};

const COUNTER_BY_OBJECTIVE: Record<Exclude<ObjectiveKind, 'boss'>, keyof ObjectiveCounters> = {
  clear: 'cleared',
  seals: 'seals',
  vines: 'vines',
  portal_cores: 'portalCores',
  embers: 'embers',
  ice_cores: 'iceCores',
  polarity_nodes: 'polarityNodes',
};

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function optionalLimit(value: number | null | undefined): number | null {
  return value == null ? null : nonNegativeInteger(value);
}

function normalizeCounters(counters: Partial<ObjectiveCounters> = {}): ObjectiveCounters {
  return {
    cleared: nonNegativeInteger(counters.cleared ?? 0),
    seals: nonNegativeInteger(counters.seals ?? 0),
    vines: nonNegativeInteger(counters.vines ?? 0),
    portalCores: nonNegativeInteger(counters.portalCores ?? 0),
    embers: nonNegativeInteger(counters.embers ?? 0),
    iceCores: nonNegativeInteger(counters.iceCores ?? 0),
    polarityNodes: nonNegativeInteger(counters.polarityNodes ?? 0),
  };
}

/** Rotate a stable row assignment without losing or duplicating a cell. */
export function rotateRowAssignments<Id extends EntityId>(ids: readonly Id[], direction: -1 | 1): Id[] {
  const unique = Array.from(new Set(ids));
  if (unique.length < 2) return unique;
  return direction > 0
    ? [unique[unique.length - 1], ...unique.slice(0, -1)]
    : [...unique.slice(1), unique[0]];
}

/** Build the serializable rules state for one level attempt. */
export function createMechanicRunState(input: CreateMechanicRunStateInput): MechanicRunState {
  const objective = {
    kind: input.objective.kind,
    target: nonNegativeInteger(input.objective.target),
  };
  const maxHp = objective.kind === 'boss'
    ? nonNegativeInteger(input.bossHp ?? objective.target)
    : 0;

  return {
    mechanic: input.mechanic,
    objective,
    counters: normalizeCounters(input.counters),
    boss: objective.kind === 'boss' ? { hp: maxHp, maxHp } : null,
    misses: 0,
    shotsTaken: 0,
    shotsRemaining: optionalLimit(input.shots),
    missLimit: optionalLimit(input.missLimit),
  };
}

/** Count a launched shot and, when it missed, the precision penalty. */
export function recordShot(state: MechanicRunState, outcome: ShotOutcome): MechanicRunState {
  return {
    ...state,
    misses: state.misses + (outcome.matched ? 0 : 1),
    shotsTaken: state.shotsTaken + 1,
    shotsRemaining: state.shotsRemaining == null ? null : Math.max(0, state.shotsRemaining - 1),
  };
}

/** Add progress for a specific objective without mutating the previous state. */
export function addObjectiveProgress(
  state: MechanicRunState,
  kind: Exclude<ObjectiveKind, 'boss'>,
  amount = 1,
): MechanicRunState {
  const key = COUNTER_BY_OBJECTIVE[kind];
  return {
    ...state,
    counters: {
      ...state.counters,
      [key]: state.counters[key] + nonNegativeInteger(amount),
    },
  };
}

export interface ObjectiveProgress {
  current: number;
  target: number;
  complete: boolean;
}

/** Return a HUD-ready progress snapshot for the active objective. */
export function getObjectiveProgress(state: MechanicRunState): ObjectiveProgress {
  const current = state.objective.kind === 'boss'
    ? Math.max(0, (state.boss?.maxHp ?? state.objective.target) - (state.boss?.hp ?? 0))
    : state.counters[COUNTER_BY_OBJECTIVE[state.objective.kind]];
  const target = state.objective.kind === 'boss'
    ? state.boss?.maxHp ?? state.objective.target
    : state.objective.target;

  return { current: Math.min(current, target), target, complete: isObjectiveComplete(state) };
}

/** All objectives use counters except bosses, which complete at zero HP. */
export function isObjectiveComplete(state: MechanicRunState): boolean {
  if (state.objective.kind === 'boss') return state.boss != null && state.boss.hp <= 0;
  const key = COUNTER_BY_OBJECTIVE[state.objective.kind];
  return state.counters[key] >= state.objective.target;
}

/** A limit of zero means the run has no allowance remaining. */
export function isRunFailed(state: MechanicRunState): boolean {
  // A displayed limit means the player may use the full allowance. Precision
  // with "5 misses max" therefore fails on miss 6, not miss 5.
  const missesExhausted = state.missLimit != null && state.misses > state.missLimit;
  const shotsExhausted = state.shotsRemaining != null && state.shotsRemaining <= 0;
  return !isObjectiveComplete(state) && (missesExhausted || shotsExhausted);
}

/** Special clears cannot bypass mechanics that explicitly require matches. */
export function canSpecialRemoveMechanic(kind: MechanicKind | null | undefined): boolean {
  return kind !== 'crystal' && kind !== 'vine' && kind !== 'ice';
}

/**
 * Objective-bearing bubble mechanics stay on the board when their support is
 * removed. This includes polarity nodes: dropping one without credit would
 * make a fixed-target polarity objective impossible to complete.
 */
export function protectsDetachedBubble(kind: MechanicKind | null | undefined): boolean {
  return kind != null && kind !== 'portal';
}

export interface CrystalState<Id extends EntityId = EntityId> {
  id: Id;
  armor: number;
}

export interface CrystalDamageResult<Id extends EntityId = EntityId> {
  crystal: CrystalState<Id>;
  damageApplied: number;
  broken: boolean;
  justBroken: boolean;
}

/** Damage a crystal shell; armor is clamped at zero and never underflows. */
export function damageCrystalArmor<Id extends EntityId>(
  crystal: CrystalState<Id>,
  damage = 1,
): CrystalDamageResult<Id> {
  const previousArmor = nonNegativeInteger(crystal.armor);
  const requestedDamage = nonNegativeInteger(damage);
  const nextArmor = Math.max(0, previousArmor - requestedDamage);
  const damageApplied = previousArmor - nextArmor;

  return {
    crystal: { ...crystal, armor: nextArmor },
    damageApplied,
    broken: nextArmor === 0,
    justBroken: previousArmor > 0 && nextArmor === 0,
  };
}

export interface VineSpreadInput<Id extends EntityId = EntityId> {
  candidateIds: readonly Id[];
  vineIds?: readonly Id[];
  blockedIds?: readonly Id[];
  rng: RandomSource;
}

/**
 * Pick one eligible vine target using an injected random source. Candidate
 * order is stable, duplicates are ignored, and occupied/blocked IDs are never
 * selected.
 */
export function selectVineSpreadTarget<Id extends EntityId>(input: VineSpreadInput<Id>): Id | null {
  const unavailable = new Set<Id>([...(input.vineIds ?? []), ...(input.blockedIds ?? [])]);
  const seen = new Set<Id>();
  const eligible = input.candidateIds.filter((id) => {
    if (unavailable.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (eligible.length === 0) return null;

  const sample = input.rng();
  const normalized = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON) : 0;
  return eligible[Math.floor(normalized * eligible.length)] ?? eligible[0];
}

export interface PortalPair<Id extends EntityId = EntityId> {
  first: Id;
  second: Id;
}

export interface PortalCooldown<Id extends EntityId = EntityId> {
  portalId: Id;
  shotsRemaining: number;
}

export type PortalDecisionReason = 'ready' | 'unpaired' | 'cooldown';

export interface PortalTeleportDecision<Id extends EntityId = EntityId> {
  canTeleport: boolean;
  destinationId: Id | null;
  reason: PortalDecisionReason;
  cooldowns: PortalCooldown<Id>[];
}

/** Pair unique portal IDs in the order supplied; an odd final ID is unpaired. */
export function pairPortalIds<Id extends EntityId>(ids: readonly Id[]): PortalPair<Id>[] {
  const unique = Array.from(new Set(ids));
  const pairs: PortalPair<Id>[] = [];
  for (let index = 0; index + 1 < unique.length; index += 2) {
    pairs.push({ first: unique[index], second: unique[index + 1] });
  }
  return pairs;
}

/** Advance cooldowns after launched shots and discard entries that reached zero. */
export function tickPortalCooldowns<Id extends EntityId>(
  cooldowns: readonly PortalCooldown<Id>[],
  shots = 1,
): PortalCooldown<Id>[] {
  const elapsed = nonNegativeInteger(shots);
  return cooldowns
    .map((cooldown) => ({
      portalId: cooldown.portalId,
      shotsRemaining: Math.max(0, nonNegativeInteger(cooldown.shotsRemaining) - elapsed),
    }))
    .filter((cooldown) => cooldown.shotsRemaining > 0);
}

function cooldownFor<Id extends EntityId>(cooldowns: readonly PortalCooldown<Id>[], portalId: Id): number {
  return cooldowns.find((cooldown) => cooldown.portalId === portalId)?.shotsRemaining ?? 0;
}

function setPortalCooldown<Id extends EntityId>(
  cooldowns: readonly PortalCooldown<Id>[],
  portalIds: readonly Id[],
  shotsRemaining: number,
): PortalCooldown<Id>[] {
  const targets = new Set(portalIds);
  const next = cooldowns
    .filter((cooldown) => !targets.has(cooldown.portalId) && cooldown.shotsRemaining > 0)
    .map((cooldown) => ({ ...cooldown }));
  if (shotsRemaining > 0) {
    for (const portalId of portalIds) next.push({ portalId, shotsRemaining });
  }
  return next;
}

/** Decide whether an entry portal can transit and arm both paired endpoints. */
export function decidePortalTeleport<Id extends EntityId>(
  entryId: Id,
  pairs: readonly PortalPair<Id>[],
  cooldowns: readonly PortalCooldown<Id>[] = [],
  cooldownShots = 1,
): PortalTeleportDecision<Id> {
  const pair = pairs.find(({ first, second }) => first === entryId || second === entryId);
  if (!pair) {
    return { canTeleport: false, destinationId: null, reason: 'unpaired', cooldowns: [...cooldowns] };
  }
  const destinationId = pair.first === entryId ? pair.second : pair.first;
  if (cooldownFor(cooldowns, entryId) > 0 || cooldownFor(cooldowns, destinationId) > 0) {
    return { canTeleport: false, destinationId: null, reason: 'cooldown', cooldowns: [...cooldowns] };
  }

  return {
    canTeleport: true,
    destinationId,
    reason: 'ready',
    cooldowns: setPortalCooldown(cooldowns, [entryId, destinationId], nonNegativeInteger(cooldownShots)),
  };
}

export interface EmberState<Id extends EntityId = EntityId> {
  id: Id;
  countdown: number;
  cooled: boolean;
}

export interface EmberCountdownResult<Id extends EntityId = EntityId> {
  embers: EmberState<Id>[];
  eruptedIds: Id[];
}

/** Mark an ember safe; cooled embers no longer count down or erupt. */
export function coolEmber<Id extends EntityId>(ember: EmberState<Id>): EmberState<Id> {
  return { ...ember, cooled: true };
}

/** Advance all active ember timers and report only newly erupted IDs. */
export function advanceEmberCountdown<Id extends EntityId>(
  embers: readonly EmberState<Id>[],
  shots = 1,
): EmberCountdownResult<Id> {
  const elapsed = nonNegativeInteger(shots);
  const eruptedIds: Id[] = [];
  const next = embers.map((ember) => {
    const previous = nonNegativeInteger(ember.countdown);
    if (ember.cooled || previous === 0) return { ...ember, countdown: previous };
    const countdown = Math.max(0, previous - elapsed);
    if (countdown === 0) eruptedIds.push(ember.id);
    return { ...ember, countdown };
  });
  return { embers: next, eruptedIds };
}

export interface BossDamageEvent {
  successfulMatch?: boolean;
  combo?: number;
  floaters?: number;
  bomb?: boolean;
  artifactSuper?: boolean;
}

export interface BossDamageResult {
  boss: BossState;
  damage: number;
  defeated: boolean;
}

/**
 * Boss formula: match 1, combo of 3+ adds 1, 5+ floaters adds 1, bomb adds 2,
 * and an artifact super adds 2. Bonuses can combine in one resolution.
 */
export function calculateBossDamage(event: BossDamageEvent): number {
  let damage = event.successfulMatch ? 1 : 0;
  if (event.successfulMatch && nonNegativeInteger(event.combo ?? 0) >= 3) damage += 1;
  if (nonNegativeInteger(event.floaters ?? 0) >= 5) damage += 1;
  if (event.bomb) damage += 2;
  if (event.artifactSuper) damage += 2;
  return damage;
}

/** Apply one resolved gameplay event to boss HP without mutating input state. */
export function applyBossDamage(boss: BossState, event: BossDamageEvent): BossDamageResult {
  const maxHp = nonNegativeInteger(boss.maxHp);
  const hp = Math.min(nonNegativeInteger(boss.hp), maxHp);
  const damage = Math.min(calculateBossDamage(event), hp);
  const nextBoss = { hp: hp - damage, maxHp };
  return { boss: nextBoss, damage, defeated: nextBoss.hp === 0 };
}

/** Replace the boss snapshot held by a run after applyBossDamage(). */
export function setRunBoss(state: MechanicRunState, boss: BossState): MechanicRunState {
  if (state.objective.kind !== 'boss') return state;
  const maxHp = nonNegativeInteger(boss.maxHp);
  return {
    ...state,
    boss: { hp: Math.min(nonNegativeInteger(boss.hp), maxHp), maxHp },
  };
}
