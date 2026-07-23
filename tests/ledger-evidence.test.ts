import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditLedgerEvidence,
  buildEvidenceReceipt,
  materializeLedgerEvidence,
  plannedEvidence,
  validateEvidenceClaims,
  validateEvidenceReceipt,
} from '../tools/ledger-evidence-lib.mjs';

const roots: string[] = [];

function write(root: string, path: string, contents: string): void {
  const absolute = join(root, ...path.split('/'));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'paopao-ledger-evidence-test-'));
  roots.push(root);
  write(root, 'src/feature.ts', 'export const feature = true;\n');
  write(root, 'shared/contract.json', '{"feature":true}\n');
  write(root, 'tests/acceptance.test.ts', '/* acceptance-specific fixture */\n');
  const item = {
    id: 'PF-upgrade-001',
    category: 'upgrade',
    ordinal: 1,
    title: 'WebGL runtime — profile',
    definition: 'A sufficiently specific deterministic acceptance definition for the test fixture.',
    release: 1,
    clientFacing: true,
    acceptanceTest: {
      id: 'AT-PF-upgrade-001',
      procedure: 'Exercise the exact profile fixture and observe its bounded output.',
      expected: 'The canonical state and measured production bound both match.',
    },
    evidence: plannedEvidence(true),
    globalOrdinal: 1,
  };
  const ledger = {
    schemaVersion: 3,
    title: 'PaoPao Fusion Level-100 Phaser Production Ledger',
    total: 1,
    releaseCount: 5,
    itemsPerRelease: 742,
    items: [item],
  };
  const claim = (target: 'shared' | 'phaser') => ({
    claimId: `EC-${item.id}-${target}`,
    assertionId: `AE-${item.acceptanceTest.id}-${target}`,
    itemId: item.id,
    acceptanceId: item.acceptanceTest.id,
    target,
    implementationPaths: [target === 'shared' ? 'shared/contract.json' : 'src/feature.ts'],
    test: {
      path: 'tests/acceptance.test.ts',
      fullName: `ledger acceptance [${item.acceptanceTest.id}][${target}] proves ${target} profile behavior`,
    },
    note: `Acceptance-specific ${target} profile observation with bounded output.`,
  });
  const registry = (claims: ReturnType<typeof claim>[]) => ({
    schemaVersion: 1,
    ledgerSchemaVersion: 3,
    policy: {
      oneClaimPerItemTarget: true,
      uniqueAssertionPerClaim: true,
      exactTestCaseRequired: true,
      sourceHashesRequired: true,
    },
    claims,
  });
  return { root, ledger, claim, registry };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('acceptance-specific ledger evidence', () => {
  it('rejects a generic test name that is not bound to the exact acceptance ID and target', () => {
    const { root, ledger, claim, registry } = fixture();
    const generic = claim('shared');
    generic.test.fullName = 'generic smoke test';
    expect(() => validateEvidenceClaims({ ledger, projectRoot: root, claims: registry([generic]) }))
      .toThrow('must include the unique token [AT-PF-upgrade-001][shared]');
  });

  it('rejects duplicate claims and assertions instead of allowing repeated evidence credit', () => {
    const { root, ledger, claim, registry } = fixture();
    const first = claim('shared');
    const duplicate = { ...claim('shared') };
    expect(() => validateEvidenceClaims({ ledger, projectRoot: root, claims: registry([first, duplicate]) }))
      .toThrow(/duplicate evidence claimId|multiple evidence claims target/);
  });

  it('does not verify a client-facing item until both target-specific assertions pass', () => {
    const { root, ledger, claim, registry } = fixture();
    const shared = claim('shared');
    const claims = registry([shared]);
    const receipt = buildEvidenceReceipt({
      ledger,
      projectRoot: root,
      claims,
      outcomes: { [shared.assertionId]: 'passed' },
      generatedAt: '2026-07-22T00:00:00.000Z',
    });
    materializeLedgerEvidence({ ledger, projectRoot: root, claims, receipt });
    expect(ledger.items[0].evidence.shared.state).toBe('verified');
    expect(ledger.items[0].evidence.phaser.state).toBe('planned');
    expect(ledger.items[0].evidence.status).toBe('implemented');
    expect(auditLedgerEvidence({ ledger, projectRoot: root, claims, receipt }).verifiedItems).toBe(0);
  });

  it('credits exactly one item when its shared and Phaser assertions have distinct passing receipts', () => {
    const { root, ledger, claim, registry } = fixture();
    const shared = claim('shared');
    const phaser = claim('phaser');
    const claims = registry([shared, phaser]);
    const receipt = buildEvidenceReceipt({
      ledger,
      projectRoot: root,
      claims,
      outcomes: {
        [shared.assertionId]: 'passed',
        [phaser.assertionId]: 'passed',
      },
      generatedAt: '2026-07-22T00:00:00.000Z',
    });
    materializeLedgerEvidence({ ledger, projectRoot: root, claims, receipt });
    expect(ledger.items[0].evidence.status).toBe('verified');
    expect(auditLedgerEvidence({ ledger, projectRoot: root, claims, receipt })).toMatchObject({
      claims: 2,
      passedClaims: 2,
      verifiedItems: 1,
      verifiedByRelease: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it('invalidates a previously passing receipt when an implementation source changes', () => {
    const { root, ledger, claim, registry } = fixture();
    const shared = claim('shared');
    const claims = registry([shared]);
    const receipt = buildEvidenceReceipt({
      ledger,
      projectRoot: root,
      claims,
      outcomes: { [shared.assertionId]: 'passed' },
      generatedAt: '2026-07-22T00:00:00.000Z',
    });
    write(root, 'shared/contract.json', '{"feature":false}\n');
    expect(() => validateEvidenceReceipt({ ledger, projectRoot: root, claims, receipt }))
      .toThrow('stale or malformed');
  });
});
