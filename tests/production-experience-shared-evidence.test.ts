import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createProductionExperienceEntry,
  productionExperienceTestFullName,
  runProductionExperienceOracle,
} from '../shared/runtime/production-experience.mjs';
import { loadProductionExperienceCatalog } from '../tools/production-experience-lib.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs', 'production', 'upgrade-ledger.json'), 'utf8'));
const audit = loadProductionExperienceCatalog({ projectRoot, ledger });
const ledgerById = new Map(ledger.items.map((item: { id: string }) => [item.id, item]));

describe('production experience shared evidence', () => {
  for (const entry of audit.entries) {
    it(productionExperienceTestFullName(entry, 'shared').replace('production experience shared evidence ', ''), () => {
      const ledgerItem = ledgerById.get(entry.id);
      expect(ledgerItem).toBeDefined();
      expect(entry).toEqual(createProductionExperienceEntry(ledgerItem));

      const action = entry.specification.kind === 'ux' ? entry.specification.interaction.event : 'idle';
      const normal = runProductionExperienceOracle(entry, { timeMs: 733, action });
      const reduced = runProductionExperienceOracle(entry, { timeMs: 733, action, reducedMotion: true });
      const reset = runProductionExperienceOracle(entry, { timeMs: 733, action: 'reset' });
      expect(normal.id).toBe(entry.id);
      expect(normal.acceptanceId).toBe(entry.acceptanceId);
      expect(normal.accessibility.label.length).toBeGreaterThan(4);
      expect(normal.accessibility.description.length).toBeGreaterThan(20);
      expect(normal.frame.x).toBeGreaterThanOrEqual(-32);
      expect(normal.frame.x).toBeLessThanOrEqual(32);
      expect(normal.frame.y).toBeGreaterThanOrEqual(-32);
      expect(normal.frame.y).toBeLessThanOrEqual(32);
      expect(normal.frame.scale).toBeGreaterThanOrEqual(0.75);
      expect(normal.frame.scale).toBeLessThanOrEqual(1.25);
      expect(normal.frame.rotation).toBeGreaterThanOrEqual(-0.25);
      expect(normal.frame.rotation).toBeLessThanOrEqual(0.25);
      expect(normal.frame.alpha).toBeGreaterThanOrEqual(0);
      expect(normal.frame.alpha).toBeLessThanOrEqual(1);
      expect(reduced.frame.x).toBe(0);
      expect(reduced.frame.y).toBe(0);
      expect(reduced.frame.rotation).toBe(0);
      expect(reset.frame).toMatchObject({ x: 0, y: 0, scale: 1, rotation: 0, alpha: 1 });

      if (entry.category === 'ux-element') {
        expect(['button', 'tooltip', 'img', 'region', 'note', 'alert', 'definition', 'progressbar', 'status'])
          .toContain(normal.accessibility.role);
        expect(entry.specification.component.minHeight).toBeGreaterThanOrEqual(44);
        expect(entry.specification.interaction.disabledPolicy).toBe('block-action-announce-reason');
        expect(normal.state).not.toBe('disabled');
      } else if (entry.category === 'animated-element') {
        expect(entry.specification.timeline.durationMs).toBeLessThanOrEqual(960);
        expect(entry.specification.timeline.repeat).toBeLessThanOrEqual(2);
        expect(entry.specification.reducedMotion.substitute).toBe('opacity-only');
      } else {
        expect(entry.specification.clip.keyframes).toHaveLength(4);
        expect(entry.specification.clip.durationMs).toBeLessThanOrEqual(1920);
        expect(entry.specification.reducedMotion.substitute).toBe('crossfade');
      }
    });
  }
});
