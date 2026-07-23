import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ledger = JSON.parse(readFileSync(fileURLToPath(new URL('../docs/production/upgrade-ledger.json', import.meta.url)), 'utf8'));

describe('literal Phaser production ledger', () => {
  it('contains 3,710 literal unique items with five exact 742-item releases', () => {
    expect(ledger.items).toHaveLength(3710);
    expect(new Set(ledger.items.map(({ id }: { id: string }) => id)).size).toBe(3710);
    for (let release = 1; release <= 5; release += 1) {
      expect(ledger.items.filter((item: { release: number }) => item.release === release)).toHaveLength(742);
    }
  });

  it('derives completion credit from exact shared and Phaser evidence targets', () => {
    expect(ledger.schemaVersion).toBe(3);
    expect(ledger.title).toBe('PaoPao Fusion Level-100 Phaser Production Ledger');
    expect(ledger.countingPolicy.uniqueAcceptanceAssertionRequired).toBe(true);
    expect(ledger.evidenceRegistry).toMatchObject({
      schemaVersion: 1,
      claimsPath: 'docs/production/evidence/claims.json',
      receiptsPath: 'docs/production/evidence/receipts.json',
    });
    for (const item of ledger.items) {
      expect(item.definition.length).toBeGreaterThan(80);
      expect(item.acceptanceTest.id).toBe(`AT-${item.id}`);
      expect(item.acceptanceTest.procedure.length).toBeGreaterThan(50);
      expect(item.acceptanceTest.expected.length).toBeGreaterThan(50);
      expect(Object.keys(item.evidence).sort()).toEqual(['phaser', 'shared', 'status']);
      if (item.clientFacing) {
        expect(item.evidence.phaser.state).not.toBe('not-applicable');
      } else {
        expect(item.evidence.phaser.state).toBe('not-applicable');
      }
    }
    expect(JSON.stringify(ledger)).not.toMatch(/\b(?:Unity|URP|Addressables|Timeline|dual-client|cross-client)\b/i);
    const verifiedByRelease = new Map<number, number>();
    for (const item of ledger.items) {
      const requiredTargets = item.clientFacing ? ['shared', 'phaser'] : ['shared'];
      const fullyVerified = requiredTargets.every((target) => item.evidence[target].state === 'verified');
      expect(item.evidence.status === 'verified').toBe(fullyVerified);
      if (fullyVerified) verifiedByRelease.set(item.release, (verifiedByRelease.get(item.release) ?? 0) + 1);
    }
    for (const gate of ledger.releases) {
      const verified = verifiedByRelease.get(gate.release) ?? 0;
      if (gate.state === 'closed') expect(verified).toBe(742);
      else expect(['planned', 'active', 'blocked']).toContain(gate.state);
    }
  });

  it('allocates exactly 500 source masters without counting delivery variants', () => {
    const assetItems = ledger.items.filter((item: { category: string }) => item.category === 'asset');
    const counts = Object.fromEntries(ledger.assetAllocation.map(({ key }: { key: string }) => [key, assetItems.filter((item: { assetAllocation: string }) => item.assetAllocation === key).length]));
    expect(counts).toEqual({
      'characters-orbs-bosses-rigs': 100,
      'environment-models-props': 100,
      'material-texture-vfx-packs': 100,
      'ui-icons-illustrations': 80,
      'music-ambience-sfx': 60,
      'cinematic-sequences': 40,
      'tutorial-accessibility-promotion': 20,
    });
    expect(ledger.countingPolicy.variantsAndCompressedCopiesDoNotCount).toBe(true);
  });
});
