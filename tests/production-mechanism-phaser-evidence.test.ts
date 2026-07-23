import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalProductionMechanismInput, productionMechanismTestFullName } from '../shared/runtime/production-mechanisms.mjs';
import {
  exercisePhaserMechanism,
  exercisePhaserMechanismCandidate,
  PhaserMechanismRuntime,
  productionMechanismEntry,
  productionMechanismManifest,
} from '../src/game/production-mechanisms';
import { loadProductionMechanismCatalog } from '../tools/production-mechanisms-lib.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs/production/upgrade-ledger.json'), 'utf8'));
const audit = loadProductionMechanismCatalog({ projectRoot, ledger });

const SOURCE_BY_SUBJECT: Record<string, string> = {
  'hex coordinate': 'grid.cellPos',
  'board occupancy': 'grid.nearestFreeHexCell',
  'bubble spawn': 'endless.buildEndlessTargetSequence',
  'aim ray': 'grid.clampedUpwardAimVector',
  'wall reflection': 'projectile.wallReflection',
  'shot travel': 'projectile.fixedStepTravel',
  'cell attachment': 'grid.nearestFreeHexCell',
  'color match': 'matcher.clusterOf',
  'cluster removal': 'matcher.clusterOf',
  'floating removal': 'matcher.floaters',
  'ceiling descent': 'mechanics.recordShot',
  'loss boundary': 'mechanics.isRunFailed',
  'win objective': 'mechanics.isObjectiveComplete',
  'move budget': 'mechanics.recordShot',
  'score multiplier': 'score.integerMultiplier',
  'combo chain': 'score.comboReducer',
  'power charge': 'power.boundedCharge',
  'bomb power': 'mechanics.calculateBossDamage',
  'rainbow power': 'matcher.clusterOfRainbowProjection',
  'swap queue': 'mechanics.rotateRowAssignments',
  'level seed': 'endless.seededTargetStream',
  'obstacle state': 'mechanics.damageCrystalArmor',
  'boss state': 'mechanics.applyBossDamage',
  'artifact state': 'mechanics.calculateBossDamageArtifact',
  'reward outcome': 'authority.rewardReceiptProjection',
};

function expectGameplayProbe(subject: string, observed: Record<string, any>): void {
  switch (subject) {
    case 'hex coordinate': expect(observed.oddX).toBeGreaterThan(observed.evenX); expect(observed.rowHeight).toBeGreaterThan(0); break;
    case 'board occupancy': expect(`${observed.row}:${observed.col}`).not.toBe('0:0'); break;
    case 'bubble spawn': expect(observed).toMatchObject({ count: 3, wordsPerShot: 3 }); expect(observed.firstColor).toBeGreaterThanOrEqual(0); break;
    case 'aim ray': expect(observed.y).toBeLessThan(0); expect(Math.hypot(observed.x, observed.y)).toBeCloseTo(1, 8); break;
    case 'wall reflection': expect(observed.incomingX).toBeGreaterThan(0); expect(observed.reflectedX).toBeLessThan(0); expect(observed.vertical).toBeLessThan(0); break;
    case 'shot travel': expect(observed).toEqual({ stepDistance: 125, upward: true }); break;
    case 'cell attachment': expect(Number.isInteger(observed.row)).toBe(true); expect(Number.isInteger(observed.col)).toBe(true); break;
    case 'color match': expect(observed.clusterIds).toEqual([1, 2, 3]); break;
    case 'cluster removal': expect(observed).toEqual({ removed: 3, remaining: 1 }); break;
    case 'floating removal': expect(observed.detachedIds).toEqual([4]); break;
    case 'ceiling descent': expect(observed).toEqual({ misses: 3, descentTrigger: true }); break;
    case 'loss boundary': expect(observed).toEqual({ failed: true, shotsRemaining: 0 }); break;
    case 'win objective': expect(observed).toEqual({ complete: true, cleared: 1 }); break;
    case 'move budget': expect(observed).toEqual({ before: 1, after: 0, failed: true }); break;
    case 'score multiplier': expect(observed).toEqual({ base: 125, multiplierBps: 15_000, score: 187 }); break;
    case 'combo chain': expect(observed).toEqual({ combo: 1, maximum: 2 }); break;
    case 'power charge': expect(observed).toEqual({ charge: 100, ready: true }); break;
    case 'bomb power': expect(observed.damage).toBe(3); break;
    case 'rainbow power': expect(observed.projectedCluster).toBe(4); break;
    case 'swap queue': expect(observed.queue).toEqual(['next', 'current']); break;
    case 'level seed': expect(observed.count).toBe(4); expect(observed.checksum).toMatch(/^[a-f0-9]{16}$/); break;
    case 'obstacle state': expect(observed).toEqual({ armor: 1, applied: 1, broken: false }); break;
    case 'boss state': expect(observed).toEqual({ hp: 1, damage: 3, defeated: false }); break;
    case 'artifact state': expect(observed).toEqual({ damage: 3, chargeConsumed: true }); break;
    case 'reward outcome': expect(observed).toMatchObject({ grantable: true, authority: 'server', path: 'accepted' }); expect(observed.delta).toBeGreaterThan(0); break;
    default: throw new Error(`unhandled Phaser mechanism subject ${subject}`);
  }
}

describe('production mechanism phaser evidence', () => {
  for (const entry of audit.entries) {
    it(productionMechanismTestFullName(entry, 'phaser').replace('production mechanism phaser evidence ', ''), () => {
      expect(productionMechanismEntry(entry.id)).toEqual(entry);
      expect(productionMechanismManifest().entries).toHaveLength(500);

      const valid = exercisePhaserMechanism(entry.id);
      const reduced = exercisePhaserMechanism(entry.id, {}, true);
      const input = canonicalProductionMechanismInput(entry);
      const repeated = exercisePhaserMechanism(entry.id, { repeated: true });
      const interrupted = exercisePhaserMechanism(entry.id, { interrupted: true });
      const invalid = exercisePhaserMechanismCandidate(entry.id, {});

      expect(valid.observation).toMatchObject({ ok: true, reason: 'accepted', id: entry.id, acceptanceId: entry.acceptanceId });
      expect(valid.gameplayProbe).toMatchObject({ subject: entry.subject, source: SOURCE_BY_SUBJECT[entry.subject], ok: true });
      expect(valid.gameplayProbe.checksum).toMatch(/^[a-f0-9]{16}$/);
      expectGameplayProbe(entry.subject, valid.gameplayProbe.observed as Record<string, any>);
      expect(valid.presentation).toMatchObject({
        id: entry.id,
        title: entry.title,
        releaseLabel: `RELEASE ${entry.release}`,
        statusLabel: 'DETERMINISTIC',
        subjectLabel: entry.subject.toUpperCase(),
        facetLabel: entry.facet.toUpperCase(),
        accessibleRole: 'status',
        reducedMotion: false,
      });
      expect(valid.presentation.proofLine).toContain(valid.observation.checksum);
      expect(valid.presentation.transitionLine).toBe(valid.observation.stateTransitions.join(' → '));
      expect(valid.presentation.durationMs).toBe(192);
      expect(valid.presentation.accentNumber).toBeGreaterThanOrEqual(0);
      expect(valid.presentation.accentNumber).toBeLessThanOrEqual(0xffffff);
      expect(valid.presentation.accentCss).toMatch(/^#[a-f0-9]{6}$/);
      expect(reduced.presentation).toMatchObject({ reducedMotion: true, durationMs: 0 });

      expect(repeated.observation).toMatchObject({ ok: true, reason: 'idempotent-replay', rules: { stateMutation: false }, rewards: { delta: 0 } });
      expect(repeated.observation.state).toEqual(input.state);
      expect(repeated.gameplayProbe.ok).toBe(true);
      expect(repeated.presentation.statusLabel).toBe('REPLAY SAFE');
      expect(interrupted.observation).toMatchObject({ ok: false, reason: 'interrupted', rules: { stateMutation: false }, rewards: { delta: 0 } });
      expect(interrupted.observation.state).toEqual(input.state);
      expect(interrupted.gameplayProbe.ok).toBe(true);
      expect(interrupted.presentation).toMatchObject({ statusLabel: 'FAIL-CLOSED', accessibleRole: 'alert' });
      expect(invalid.observation).toMatchObject({ ok: false, reason: 'invalid-input', rules: { stateMutation: false }, rewards: { delta: 0 } });
      expect(invalid.gameplayProbe.ok).toBe(true);
      expect(invalid.presentation).toMatchObject({ statusLabel: 'FAIL-CLOSED', accessibleRole: 'alert' });

      if (entry.ordinal === 500) {
        const runtime = new PhaserMechanismRuntime(2);
        runtime.exercise('PF-mechanism-001');
        runtime.exercise('PF-mechanism-002');
        runtime.exercise('PF-mechanism-003');
        expect(runtime.size()).toBe(2);
        expect(runtime.has('PF-mechanism-001')).toBe(false);
        expect(runtime.has('PF-mechanism-003')).toBe(true);
        runtime.clear();
        expect(runtime.size()).toBe(0);
      }
    });
  }
});
