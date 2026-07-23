import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalSystemInput,
  executeProductionSystem,
  validateProductionSystemsManifest,
  type ProductionSystemEntry,
} from '../shared/runtime/production-systems.mjs';
import {
  productionSystemSharedTestFullName,
  validateProductionSystemsFixture,
} from '../tools/production-systems-evidence-lib.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs/production/upgrade-ledger.json'), 'utf8'));
const audit = validateProductionSystemsFixture({ projectRoot, ledger });
validateProductionSystemsManifest(audit.manifest);

function assertCategoryBehavior(entry: ProductionSystemEntry, detail: Readonly<Record<string, unknown>>): void {
  if (entry.category === 'upgrade') expect(detail).toMatchObject({ supported: true, runtime: entry.subject, capability: entry.facet, compatibility: 'compatible' });
  else if (entry.category === 'improvement') expect(detail).toMatchObject({ metric: entry.subject, audit: entry.facet, regression: false });
  else if (entry.category === 'ui') expect(detail).toMatchObject({ surface: entry.subject, requestedState: entry.facet.replace(/ /g, '-'), ariaRole: 'region' });
  else if (entry.category === 'frontend') expect(detail).toMatchObject({ capability: entry.subject, contract: entry.facet, phase: 'ready', abortable: true });
  else if (entry.category === 'flow') expect(detail).toMatchObject({ journey: entry.subject, affordance: entry.facet, to: 'completed', exitGuaranteed: true });
  else if (entry.category === 'rendering') expect(detail).toMatchObject({ pipeline: entry.subject, policy: entry.facet, degradedWithoutRuleChange: false });
  else {
    const expectedMode = ({
      mouse: 'mouse', keyboard: 'keyboard', touch: 'touch', controller: 'controller',
      'single hand': 'hand', 'two hand': 'hand', 'camera pointer': 'hand',
      'assistive switch': 'switch', 'replay input': 'replay', 'input remapping': 'keyboard',
    } as Record<string, string>)[entry.subject];
    expect(detail).toMatchObject({ source: entry.subject, refinement: entry.facet, inputMode: expectedMode, cancelled: false });
  }
}

describe('production systems shared evidence', () => {
  for (const rawEntry of audit.manifest.entries as ProductionSystemEntry[]) {
    const fullName = productionSystemSharedTestFullName(rawEntry);
    it(fullName.replace('production systems shared evidence ', ''), () => {
      const input = canonicalSystemInput(rawEntry);
      const first = executeProductionSystem(rawEntry, input);
      const second = executeProductionSystem(rawEntry, input);
      const replay = executeProductionSystem(rawEntry, { ...input, repeated: true });
      const unavailable = executeProductionSystem(rawEntry, { ...input, available: false });
      const interrupted = executeProductionSystem(rawEntry, { ...input, interrupted: true });
      const invalid = executeProductionSystem(rawEntry, { ...input, unexpected: true });

      expect(first).toEqual(second);
      expect(first).toMatchObject({
        id: rawEntry.id,
        acceptanceId: rawEntry.acceptanceId,
        ok: true,
        reason: 'accepted',
        rewards: { grantable: false, delta: 0 },
        stateTransitions: ['ready', 'active', 'complete'],
      });
      expect(first.signature).toMatch(/^[a-f0-9]{8}$/);
      expect(first.timing.frameBudgetMs).toBeLessThanOrEqual(rawEntry.contract.frameBudgetMs);
      expect(first.feedbackPurpose).toContain(rawEntry.subject);
      expect(replay).toMatchObject({ ok: true, reason: 'idempotent-replay', rules: { idempotent: true } });
      expect(unavailable).toMatchObject({ ok: false, reason: 'unavailable', rewards: { delta: 0 }, detail: { blocked: true } });
      expect(interrupted).toMatchObject({ ok: false, reason: 'interrupted', rules: { stateMutation: false } });
      expect(invalid).toMatchObject({ ok: false, reason: 'invalid-input', stateTransitions: ['input-rejected', 'recovery-ready'] });
      assertCategoryBehavior(rawEntry, first.detail);
    });
  }
});
