import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalProductionMechanismInput,
  createProductionMechanismEntry,
  productionMechanismTestFullName,
  runProductionMechanismOracle,
  stableMechanismHash,
} from '../shared/runtime/production-mechanisms.mjs';
import { loadProductionMechanismCatalog } from '../tools/production-mechanisms-lib.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs/production/upgrade-ledger.json'), 'utf8'));
const audit = loadProductionMechanismCatalog({ projectRoot, ledger });
const ledgerById = new Map(ledger.items.map((item: { id: string }) => [item.id, item]));

function expectSubjectTransition(subject: string, previous: Record<string, any>, data: Record<string, any>): void {
  switch (subject) {
    case 'hex coordinate': expect(data.q + data.r + data.s).toBe(0); break;
    case 'board occupancy': expect(data.occupied.length).toBe(previous.occupied.length + 1); break;
    case 'bubble spawn': expect(data).toMatchObject({ spawned: previous.spawned + 1, nextId: previous.nextId + 1 }); expect(data.queue).toHaveLength(3); break;
    case 'aim ray': expect(Math.hypot(data.directionXMillionths, data.directionYMillionths)).toBeCloseTo(1_000_000, -1); break;
    case 'wall reflection': expect(data.xMilli).toBeGreaterThanOrEqual(0); expect(data.xMilli).toBeLessThanOrEqual(data.widthMilli); break;
    case 'shot travel': expect(data.distanceMilli).toBeGreaterThan(previous.distanceMilli); expect(data.arrived).toBe(data.distanceMilli >= data.targetMilli); break;
    case 'cell attachment': expect(data.attached).toBe(true); expect(data.occupied).toContain(`${data.row}:${data.col}`); break;
    case 'color match': expect(data.connected).toBeGreaterThan(previous.connected); expect(data.matched).toBe(data.connected >= data.minimumMatch); break;
    case 'cluster removal': expect(data).toMatchObject({ removed: 4, remaining: 8 }); break;
    case 'floating removal': expect(data).toMatchObject({ anchored: 7, floating: 0, removed: 3 }); break;
    case 'ceiling descent': expect(data).toMatchObject({ misses: 3, rowDrops: 1, offsetMilli: 86_603 }); break;
    case 'loss boundary': expect(data.lowestRow).toBeGreaterThan(previous.lowestRow); expect(data.lost).toBe(data.lowestRow >= data.lossRow); break;
    case 'win objective': expect(data.current).toBeGreaterThan(previous.current); expect(data.current).toBeLessThanOrEqual(data.target); expect(data.won).toBe(data.current >= data.target); break;
    case 'move budget': expect(data).toMatchObject({ remaining: 7, used: 1, exhausted: false }); break;
    case 'score multiplier': expect(data.multiplierBps).toBeGreaterThanOrEqual(previous.multiplierBps); expect(data.totalScore).toBeGreaterThan(0); break;
    case 'combo chain': expect(data).toMatchObject({ combo: 3, maximumCombo: 3, decayTicks: 0 }); break;
    case 'power charge': expect(data.charge).toBeGreaterThan(previous.charge); expect(data.charge).toBeLessThanOrEqual(data.threshold); break;
    case 'bomb power': expect(data).toMatchObject({ radius: 2, targetCount: 9, removed: 7 }); break;
    case 'rainbow power': expect(data.matchedCount).toBeGreaterThan(previous.matchedCount); break;
    case 'swap queue': expect(data).toMatchObject({ current: previous.next, next: previous.current, swaps: 1 }); break;
    case 'level seed': expect(data.cursor).toBe(previous.cursor + 1); expect(data.lastWord).toBeGreaterThan(0); break;
    case 'obstacle state': expect(data.hp).toBeLessThan(previous.hp); expect(data.broken).toBe(data.hp === 0); break;
    case 'boss state': expect(data.hp).toBeLessThan(previous.hp); expect(data.defeated).toBe(data.hp === 0); expect(data.phase).toBeGreaterThanOrEqual(1); break;
    case 'artifact state': expect(data.charge).toBeGreaterThanOrEqual(0); expect(data.charge).toBeLessThanOrEqual(data.threshold); expect(data.cooldown).toBeGreaterThanOrEqual(0); break;
    case 'reward outcome': expect(data.claimed).toBe(true); expect(data.receiptId).toMatch(/^reward-[a-f0-9]{16}$/); expect(data.coins).toBeGreaterThan(0); expect(data.xp).toBeGreaterThan(0); break;
    default: throw new Error(`unhandled mechanism subject ${subject}`);
  }
}

function expectFacetProof(facet: string, proof: Record<string, any>): void {
  switch (facet) {
    case 'canonical representation': expect(proof).toMatchObject({ kind: 'canonical', keyOrderStable: true }); expect(proof.canonicalJson.length).toBeGreaterThan(80); break;
    case 'input normalization': expect(proof).toMatchObject({ kind: 'normalization', invariant: true }); expect(proof.boundedEvents).toBeLessThanOrEqual(8); break;
    case 'fixed-step transition': expect(proof).toMatchObject({ kind: 'fixed-step', fixedStepMs: 16, exactlyOneStep: true }); expect(proof.toTick).toBe(proof.fromTick + 1); break;
    case 'tie-break rule': expect(proof).toMatchObject({ kind: 'tie-break', stable: true, selected: { priority: 1, col: 0 } }); break;
    case 'seed consumption': expect(proof).toMatchObject({ kind: 'seed', consumedWords: 1, deterministic: true }); expect(proof.after).not.toBe(proof.before); break;
    case 'invariant check': expect(proof).toMatchObject({ kind: 'invariant', before: true, after: true }); expect(proof.canonicalFields.length).toBeGreaterThanOrEqual(2); break;
    case 'serialization': expect(proof).toMatchObject({ kind: 'serialization', roundTrip: true }); expect(proof.bytes).toBeLessThanOrEqual(4096); break;
    case 'replay event': expect(proof).toMatchObject({ kind: 'replay', exact: true }); expect(proof.event.type).toContain(':advance'); expect(proof.checksum).toMatch(/^[a-f0-9]{16}$/); break;
    case 'server-client oracle': expect(proof).toMatchObject({ kind: 'oracle', equal: true }); expect(proof.serverChecksum).toBe(proof.clientChecksum); break;
    case 'property test': expect(proof).toMatchObject({ kind: 'property', generatedCases: 16, passedCases: 16, deterministic: true }); break;
    case 'edge-case fixture': expect(proof).toMatchObject({ kind: 'edge', minimumInvariant: true, maximumInvariant: true }); break;
    case 'overflow guard': expect(proof).toMatchObject({ kind: 'overflow', invariant: true, withinBound: true }); expect(proof.serializedBytes).toBeLessThanOrEqual(4096); break;
    case 'rollback snapshot': expect(proof).toMatchObject({ kind: 'rollback', exact: true }); expect(proof.mutationChecksum).not.toBe(proof.restoredChecksum); break;
    case 'desync checksum': expect(proof).toMatchObject({ kind: 'desync', detectsMutation: true }); expect(proof.checksum).toBe(proof.repeatChecksum); expect(proof.changedChecksum).not.toBe(proof.checksum); break;
    case 'authoritative validation': expect(proof).toMatchObject({ kind: 'authority', authoritative: true, revisionMatched: true, accepted: true }); break;
    case 'prediction boundary': expect(proof).toMatchObject({ kind: 'prediction', requested: 2, applied: 2, limit: 3, bounded: true }); expect(proof.checksum).toMatch(/^[a-f0-9]{16}$/); break;
    case 'reconciliation': expect(proof).toMatchObject({ kind: 'reconciliation', exact: true }); expect(proof.reconciledChecksum).toBe(proof.authoritativeChecksum); break;
    case 'failure closure': expect(proof).toMatchObject({ kind: 'failure', invalidReason: 'invalid-input', interruptedReason: 'interrupted', statePreserved: true, rewardDelta: 0 }); break;
    case 'performance bound': expect(proof).toMatchObject({ kind: 'performance', operations: 64, operationBudget: 512, byteBudget: 4096 }); expect(proof.serializedBytes).toBeLessThanOrEqual(4096); expect(proof.events).toBeLessThanOrEqual(8); break;
    case 'evidence capture': expect(proof).toMatchObject({ kind: 'evidence', complete: true }); expect(proof.receipt.acceptanceId).toMatch(/^AT-PF-mechanism-/); expect(proof.receiptChecksum).toMatch(/^[a-f0-9]{16}$/); break;
    default: throw new Error(`unhandled mechanism facet ${facet}`);
  }
}

describe('production mechanism shared evidence', () => {
  for (const entry of audit.entries) {
    it(productionMechanismTestFullName(entry, 'shared').replace('production mechanism shared evidence ', ''), () => {
      const ledgerItem = ledgerById.get(entry.id);
      expect(ledgerItem).toBeDefined();
      expect(entry).toEqual(createProductionMechanismEntry(ledgerItem));

      const input = canonicalProductionMechanismInput(entry);
      const inputDigest = stableMechanismHash(input);
      const valid = runProductionMechanismOracle(entry, input);
      const repeated = runProductionMechanismOracle(entry, { ...input, repeated: true });
      const interrupted = runProductionMechanismOracle(entry, { ...input, interrupted: true });
      const invalid = runProductionMechanismOracle(entry, {});

      expect(valid).toMatchObject({ ok: true, reason: 'accepted', id: entry.id, acceptanceId: entry.acceptanceId });
      expect(valid.state).toMatchObject({ revision: 1, tick: 1, subject: entry.subject });
      expect(valid.state.events).toHaveLength(1);
      expect(valid.checksum).toMatch(/^[a-f0-9]{16}$/);
      expect(valid.signature).toMatch(/^[a-f0-9]{16}$/);
      expect(valid.timing.operations).toBeLessThanOrEqual(valid.timing.operationBudget);
      expect(stableMechanismHash(input)).toBe(inputDigest);
      expectSubjectTransition(entry.subject, valid.previousState.data as Record<string, any>, valid.state.data as Record<string, any>);
      expectFacetProof(entry.facet, valid.facetProof as Record<string, any>);

      expect(repeated).toMatchObject({ ok: true, reason: 'idempotent-replay', rules: { stateMutation: false, rewardMutation: false }, rewards: { delta: 0 } });
      expect(repeated.state).toEqual(input.state);
      expect(repeated.checksum).toBe(stableMechanismHash(input.state));
      expect(interrupted).toMatchObject({ ok: false, reason: 'interrupted', rules: { stateMutation: false, rewardMutation: false }, rewards: { delta: 0 } });
      expect(interrupted.state).toEqual(input.state);
      expect(invalid).toMatchObject({ ok: false, reason: 'invalid-input', rules: { stateMutation: false, rewardMutation: false }, rewards: { delta: 0 } });
      expect(invalid.state).toMatchObject({ subject: entry.subject, revision: 0, tick: 0 });

      if (entry.subject === 'reward outcome') expect(valid.rewards).toMatchObject({ grantable: true, authority: 'server' });
      else expect(valid.rewards).toEqual({ grantable: false, delta: 0, authority: 'not-applicable' });
    });
  }
});
