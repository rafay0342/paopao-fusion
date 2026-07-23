import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProductionSystemRuntime,
  exerciseProductionSystem,
  productionSystemEntry,
  productionSystemManifest,
  productionSystemsFor,
} from '../src/game/production-systems';
import type { ProductionSystemEntry } from '../shared/runtime/production-systems.mjs';
import {
  productionSystemPhaserTestFullName,
  validateProductionSystemsFixture,
} from '../tools/production-systems-evidence-lib.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs/production/upgrade-ledger.json'), 'utf8'));
const audit = validateProductionSystemsFixture({ projectRoot, ledger });

describe('production systems Phaser evidence', () => {
  for (const entry of audit.manifest.entries as ProductionSystemEntry[]) {
    const fullName = productionSystemPhaserTestFullName(entry);
    it(fullName.replace('production systems Phaser evidence ', ''), () => {
      const result = exerciseProductionSystem(entry.id);
      const replay = exerciseProductionSystem(entry.id, { repeated: true });
      const unavailable = exerciseProductionSystem(entry.id, { available: false });
      const runtime = new ProductionSystemRuntime(2);
      const sameCategory = productionSystemsFor(entry.category).slice(0, 3);
      for (const item of sameCategory) runtime.exercise(item.id);

      expect(productionSystemManifest().total).toBe(850);
      expect(productionSystemEntry(entry.id)).toEqual(entry);
      expect(result.observation).toMatchObject({ id: entry.id, ok: true, reason: 'accepted' });
      expect(result.presentation).toMatchObject({
        id: entry.id,
        title: `${entry.subject} — ${entry.facet}`,
        releaseLabel: `RELEASE ${entry.release}`,
        statusLabel: 'CONTRACT VERIFIED',
        accessibleRole: entry.contract.accessibilityRole,
      });
      expect(result.presentation.detailLines.length).toBeGreaterThanOrEqual(4);
      expect(result.presentation.accentCss).toMatch(/^#[a-f0-9]{6}$/i);
      expect(result.presentation.durationMs).toBeGreaterThanOrEqual(result.input.reducedMotion ? 0 : 90);
      expect(replay.presentation.statusLabel).toBe('REPLAY VERIFIED');
      expect(unavailable.presentation.statusLabel).toBe('FAIL-CLOSED');
      expect(unavailable.observation.rewards.delta).toBe(0);
      expect(runtime.size()).toBeLessThanOrEqual(2);
    });
  }
});

