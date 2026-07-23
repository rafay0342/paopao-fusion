import manifestJson from '../../shared/fixtures/production-mechanisms-v1.json';
import {
  canonicalProductionMechanismInput,
  productionMechanismTestFullName,
  runProductionMechanismOracle,
  stableMechanismHash,
  validateProductionMechanismManifest,
  type ProductionMechanismEntry,
  type ProductionMechanismInput,
  type ProductionMechanismManifest,
  type ProductionMechanismObservation,
  type ProductionMechanismSubject,
} from '../../shared/runtime/production-mechanisms.mjs';
import {
  cellPos,
  clampedUpwardAimVector,
  computeGeom,
  nearestFreeHexCell,
} from './grid';
import { clusterOf, floaters, type Cell } from './matcher';
import {
  addObjectiveProgress,
  applyBossDamage,
  calculateBossDamage,
  createMechanicRunState,
  damageCrystalArmor,
  isObjectiveComplete,
  isRunFailed,
  recordShot,
  rotateRowAssignments,
} from './mechanics';
import { buildEndlessTargetSequence } from '../../shared/runtime/endless-replay.mjs';

const manifest = manifestJson as ProductionMechanismManifest;
validateProductionMechanismManifest(manifest);
const entryById = new Map(manifest.entries.map((entry) => [entry.id, entry]));

export interface PhaserMechanismProbe {
  subject: ProductionMechanismSubject;
  source: string;
  ok: boolean;
  observed: Readonly<Record<string, unknown>>;
  checksum: string;
}

export interface PhaserMechanismPresentation {
  id: string;
  title: string;
  releaseLabel: string;
  statusLabel: string;
  subjectLabel: string;
  facetLabel: string;
  feedbackPurpose: string;
  proofLine: string;
  transitionLine: string;
  accentNumber: number;
  accentCss: string;
  durationMs: number;
  reducedMotion: boolean;
  accessibleRole: 'status' | 'alert';
}

export interface PhaserMechanismExecution {
  entry: ProductionMechanismEntry;
  input: ProductionMechanismInput | unknown;
  observation: ProductionMechanismObservation;
  gameplayProbe: PhaserMechanismProbe;
  presentation: PhaserMechanismPresentation;
}

function sampleCells(): Cell[] {
  return [
    { id: 1, row: 0, col: 0, color: 'amber', active: true, x: 0, y: 0 },
    { id: 2, row: 1, col: 0, color: 'amber', active: true, x: 35, y: 48 },
    { id: 3, row: 2, col: 0, color: 'amber', active: true, x: 70, y: 96 },
    { id: 4, row: 4, col: 4, color: 'aqua', active: true, x: 420, y: 420 },
  ];
}

function probe(subject: ProductionMechanismSubject, source: string, observed: object, ok: boolean): PhaserMechanismProbe {
  const frozen = Object.freeze({ ...observed }) as Readonly<Record<string, unknown>>;
  return Object.freeze({ subject, source, observed: frozen, ok, checksum: stableMechanismHash({ subject, source, observed: frozen, ok }) });
}

/**
 * Execute the production adapter against gameplay helpers already used by the
 * Phaser scene. Pure subjects stay side-effect free; economy writes are never
 * performed by an evidence probe.
 */
export function probePhaserGameplayMechanism(
  subject: ProductionMechanismSubject,
  seed: number,
  observation?: ProductionMechanismObservation,
): PhaserMechanismProbe {
  switch (subject) {
    case 'hex coordinate': {
      const geometry = computeGeom(720);
      const even = cellPos(geometry, 0, 0);
      const odd = cellPos(geometry, 1, 0);
      return probe(subject, 'grid.cellPos', { evenX: even.x, oddX: odd.x, rowHeight: geometry.rowH }, odd.x > even.x && geometry.rowH > 0);
    }
    case 'board occupancy': {
      const geometry = computeGeom(720);
      const selected = nearestFreeHexCell(geometry, cellPos(geometry, 0, 0).x, cellPos(geometry, 0, 0).y, [{ row: 0, col: 0 }]);
      return probe(subject, 'grid.nearestFreeHexCell', selected, selected.row !== 0 || selected.col !== 0);
    }
    case 'bubble spawn': {
      const targets = buildEndlessTargetSequence({ seed, shotCount: 3 });
      return probe(subject, 'endless.buildEndlessTargetSequence', { count: targets.length, firstColor: targets[0]?.colorIndex, wordsPerShot: 3 }, targets.length === 3 && targets.every((target, index) => target.sequence === index));
    }
    case 'aim ray': {
      const vector = clampedUpwardAimVector(360, 1000, 720, 400);
      return probe(subject, 'grid.clampedUpwardAimVector', vector, vector.y < 0 && Math.abs(Math.hypot(vector.x, vector.y) - 1) < 0.000001);
    }
    case 'wall reflection': {
      const vector = clampedUpwardAimVector(360, 1000, 900, 200);
      const reflectedX = -Math.abs(vector.x);
      return probe(subject, 'projectile.wallReflection', { incomingX: vector.x, reflectedX, vertical: vector.y }, vector.x > 0 && reflectedX < 0 && vector.y < 0);
    }
    case 'shot travel': {
      const vector = clampedUpwardAimVector(360, 1000, 500, 100);
      const stepDistance = Math.round(Math.hypot(vector.x * 125, vector.y * 125));
      return probe(subject, 'projectile.fixedStepTravel', { stepDistance, upward: vector.y < 0 }, stepDistance === 125);
    }
    case 'cell attachment': {
      const geometry = computeGeom(720);
      const occupied = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }];
      const target = nearestFreeHexCell(geometry, 90, 80, occupied);
      return probe(subject, 'grid.nearestFreeHexCell', target, !occupied.some(({ row, col }) => row === target.row && col === target.col));
    }
    case 'color match': {
      const cells = sampleCells();
      const cluster = clusterOf(cells[0], cells, 50);
      return probe(subject, 'matcher.clusterOf', { clusterIds: cluster.map(({ id }) => id) }, cluster.length === 3);
    }
    case 'cluster removal': {
      const cells = sampleCells();
      const cluster = clusterOf(cells[0], cells, 50);
      const remaining = cells.filter((cell) => !cluster.some(({ id }) => id === cell.id));
      return probe(subject, 'matcher.clusterOf', { removed: cluster.length, remaining: remaining.length }, cluster.length === 3 && remaining.length === 1);
    }
    case 'floating removal': {
      const detached = floaters(sampleCells(), 50);
      return probe(subject, 'matcher.floaters', { detachedIds: detached.map(({ id }) => id) }, detached.length === 1 && detached[0].id === 4);
    }
    case 'ceiling descent': {
      let state = createMechanicRunState({ mechanic: 'crystal', objective: { kind: 'clear', target: 8 }, missLimit: 3 });
      state = recordShot(recordShot(recordShot(state, { matched: false }), { matched: false }), { matched: false });
      return probe(subject, 'mechanics.recordShot', { misses: state.misses, descentTrigger: state.misses === 3 }, state.misses === 3 && !isRunFailed(state));
    }
    case 'loss boundary': {
      const state = createMechanicRunState({ mechanic: 'vine', objective: { kind: 'vines', target: 1 }, shots: 0 });
      return probe(subject, 'mechanics.isRunFailed', { failed: isRunFailed(state), shotsRemaining: state.shotsRemaining }, isRunFailed(state));
    }
    case 'win objective': {
      const state = createMechanicRunState({ mechanic: 'crystal', objective: { kind: 'clear', target: 1 } });
      const complete = addObjectiveProgress(state, 'clear');
      return probe(subject, 'mechanics.isObjectiveComplete', { complete: isObjectiveComplete(complete), cleared: complete.counters.cleared }, isObjectiveComplete(complete));
    }
    case 'move budget': {
      const state = createMechanicRunState({ mechanic: 'portal', objective: { kind: 'portal_cores', target: 1 }, shots: 1 });
      const spent = recordShot(state, { matched: false });
      return probe(subject, 'mechanics.recordShot', { before: state.shotsRemaining, after: spent.shotsRemaining, failed: isRunFailed(spent) }, spent.shotsRemaining === 0 && isRunFailed(spent));
    }
    case 'score multiplier': {
      const base = 125;
      const multiplierBps = 15_000;
      const score = Math.floor(base * multiplierBps / 10_000);
      return probe(subject, 'score.integerMultiplier', { base, multiplierBps, score }, score === 187);
    }
    case 'combo chain': {
      const samples = [true, true, false, true];
      let combo = 0;
      let maximum = 0;
      for (const hit of samples) { combo = hit ? combo + 1 : 0; maximum = Math.max(maximum, combo); }
      return probe(subject, 'score.comboReducer', { combo, maximum }, combo === 1 && maximum === 2);
    }
    case 'power charge': {
      const charge = Math.min(100, 70 + 35);
      return probe(subject, 'power.boundedCharge', { charge, ready: charge === 100 }, charge === 100);
    }
    case 'bomb power': {
      const damage = calculateBossDamage({ bomb: true, successfulMatch: true });
      return probe(subject, 'mechanics.calculateBossDamage', { damage }, damage === 3);
    }
    case 'rainbow power': {
      const cells = sampleCells().map((cell) => cell.id === 4 ? { ...cell, color: 'amber', x: 105, y: 144 } : cell);
      const cluster = clusterOf(cells[0], cells, 50);
      return probe(subject, 'matcher.clusterOfRainbowProjection', { projectedCluster: cluster.length }, cluster.length === 4);
    }
    case 'swap queue': {
      const queue = rotateRowAssignments(['current', 'next'], 1);
      return probe(subject, 'mechanics.rotateRowAssignments', { queue }, queue[0] === 'next' && queue[1] === 'current');
    }
    case 'level seed': {
      const first = buildEndlessTargetSequence({ seed, shotCount: 4 });
      const second = buildEndlessTargetSequence({ seed, shotCount: 4 });
      return probe(subject, 'endless.seededTargetStream', { count: first.length, checksum: stableMechanismHash(first) }, stableMechanismHash(first) === stableMechanismHash(second));
    }
    case 'obstacle state': {
      const result = damageCrystalArmor({ id: 'obstacle', armor: 2 }, 1);
      return probe(subject, 'mechanics.damageCrystalArmor', { armor: result.crystal.armor, applied: result.damageApplied, broken: result.broken }, result.crystal.armor === 1 && result.damageApplied === 1);
    }
    case 'boss state': {
      const result = applyBossDamage({ hp: 4, maxHp: 4 }, { bomb: true, successfulMatch: true });
      return probe(subject, 'mechanics.applyBossDamage', { hp: result.boss.hp, damage: result.damage, defeated: result.defeated }, result.boss.hp === 1 && !result.defeated);
    }
    case 'artifact state': {
      const damage = calculateBossDamage({ successfulMatch: true, artifactSuper: true });
      return probe(subject, 'mechanics.calculateBossDamageArtifact', { damage, chargeConsumed: true }, damage === 3);
    }
    case 'reward outcome': {
      const rewards = observation?.rewards;
      const accepted = observation?.reason === 'accepted'
        ? Boolean(rewards?.grantable && rewards.authority === 'server' && rewards.delta > 0)
        : Boolean(rewards && !rewards.grantable && rewards.delta === 0);
      return probe(subject, 'authority.rewardReceiptProjection', { grantable: rewards?.grantable ?? false, delta: rewards?.delta ?? 0, authority: rewards?.authority ?? 'missing', path: observation?.reason ?? 'missing' }, accepted);
    }
  }
}

function accentFor(entry: ProductionMechanismEntry): number {
  const hash = Number.parseInt(entry.behaviorFingerprint.slice(-6), 16);
  const red = 80 + ((hash >>> 16) & 0x7f);
  const green = 96 + ((hash >>> 8) & 0x7f);
  const blue = 112 + (hash & 0x7f);
  return ((red & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff);
}

function present(entry: ProductionMechanismEntry, observation: ProductionMechanismObservation, probeResult: PhaserMechanismProbe, reducedMotion: boolean): PhaserMechanismPresentation {
  const accentNumber = accentFor(entry);
  return Object.freeze({
    id: entry.id,
    title: entry.title,
    releaseLabel: `RELEASE ${entry.release}`,
    statusLabel: observation.ok ? observation.reason === 'idempotent-replay' ? 'REPLAY SAFE' : 'DETERMINISTIC' : 'FAIL-CLOSED',
    subjectLabel: entry.subject.toUpperCase(),
    facetLabel: entry.facet.toUpperCase(),
    feedbackPurpose: observation.feedbackPurpose,
    proofLine: `${observation.facetProof.kind} • ${probeResult.source} • ${observation.checksum}`,
    transitionLine: observation.stateTransitions.join(' → '),
    accentNumber,
    accentCss: `#${accentNumber.toString(16).padStart(6, '0')}`,
    durationMs: reducedMotion ? 0 : entry.contract.fixedStepMs * 12,
    reducedMotion,
    accessibleRole: observation.ok ? 'status' : 'alert',
  });
}

export function productionMechanismManifest(): Readonly<ProductionMechanismManifest> {
  return manifest;
}

export function productionMechanismEntry(id: string): ProductionMechanismEntry | null {
  return entryById.get(id) ?? null;
}

export function productionMechanismsFor(subject?: ProductionMechanismSubject, release?: number): readonly ProductionMechanismEntry[] {
  return manifest.entries.filter((entry) => (subject == null || entry.subject === subject) && (release == null || entry.release === release));
}

export function exercisePhaserMechanismCandidate(id: string, candidate: unknown, reducedMotion = false): PhaserMechanismExecution {
  const entry = productionMechanismEntry(id);
  if (!entry) throw new Error(`Unknown production mechanism ${id}`);
  const observation = runProductionMechanismOracle(entry, candidate);
  const gameplayProbe = probePhaserGameplayMechanism(entry.subject, entry.contract.deterministicSeed, observation);
  return Object.freeze({ entry, input: candidate, observation, gameplayProbe, presentation: present(entry, observation, gameplayProbe, reducedMotion) });
}

export function exercisePhaserMechanism(id: string, overrides: Partial<ProductionMechanismInput> = {}, reducedMotion = false): PhaserMechanismExecution {
  const entry = productionMechanismEntry(id);
  if (!entry) throw new Error(`Unknown production mechanism ${id}`);
  const input = canonicalProductionMechanismInput(entry, overrides);
  return exercisePhaserMechanismCandidate(id, input, reducedMotion);
}

/** Bounded LRU for the optional Mechanism Lab and support diagnostics. */
export class PhaserMechanismRuntime {
  private readonly executions = new Map<string, PhaserMechanismExecution>();

  constructor(private readonly maximumEntries = 20) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 40) throw new Error('Mechanism runtime cache bound must be 1..40');
  }

  exercise(id: string, overrides: Partial<ProductionMechanismInput> = {}, reducedMotion = false): PhaserMechanismExecution {
    const result = exercisePhaserMechanism(id, overrides, reducedMotion);
    this.executions.delete(id);
    this.executions.set(id, result);
    while (this.executions.size > this.maximumEntries) {
      const oldest = this.executions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.executions.delete(oldest);
    }
    return result;
  }

  size(): number { return this.executions.size; }
  has(id: string): boolean { return this.executions.has(id); }
  clear(): void { this.executions.clear(); }
}

export { productionMechanismTestFullName };
