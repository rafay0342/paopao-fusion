import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { productionExperienceTestFullName } from '../shared/runtime/production-experience.mjs';
import {
  applyPhaserExperienceTransform,
  createPhaserExperienceFrame,
  type PhaserTransformTarget,
} from '../src/game/production-experience';
import { loadProductionExperienceCatalog } from '../tools/production-experience-lib.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs', 'production', 'upgrade-ledger.json'), 'utf8'));
const audit = loadProductionExperienceCatalog({ projectRoot, ledger });

class TransformProbe implements PhaserTransformTarget {
  x = 0;
  y = 0;
  scale = 1;
  rotation = 0;
  alpha = 1;
  visible = true;

  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setScale(scale: number): this { this.scale = scale; return this; }
  setRotation(rotation: number): this { this.rotation = rotation; return this; }
  setAlpha(alpha: number): this { this.alpha = alpha; return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
}

describe('production experience phaser evidence', () => {
  for (const entry of audit.entries) {
    it(productionExperienceTestFullName(entry, 'phaser').replace('production experience phaser evidence ', ''), () => {
      const action = entry.specification.kind === 'ux' ? entry.specification.interaction.event : 'idle';
      const frame = createPhaserExperienceFrame(entry, { timeMs: 733, action });
      const reduced = createPhaserExperienceFrame(entry, { timeMs: 733, action, reducedMotion: true });
      const probe = new TransformProbe();
      expect(applyPhaserExperienceTransform(probe, frame, 360, 400)).toBe(probe);
      expect(probe.x).toBe(360 + frame.transform.x);
      expect(probe.y).toBe(400 + frame.transform.y);
      expect(probe.scale).toBe(frame.transform.scale);
      expect(probe.rotation).toBe(frame.transform.rotation);
      expect(probe.alpha).toBe(frame.transform.alpha);
      expect(probe.visible).toBe(frame.transform.visible);
      expect(frame.id).toBe(entry.id);
      expect(frame.geometry.width).toBeGreaterThanOrEqual(44);
      expect(frame.geometry.height).toBeGreaterThanOrEqual(44);
      expect(frame.geometry.color).toBeGreaterThanOrEqual(0);
      expect(frame.geometry.color).toBeLessThanOrEqual(0xffffff);
      expect(frame.accessibility.label).toBe(frame.label);
      expect(frame.description.length).toBeGreaterThan(20);
      expect(reduced.transform.x).toBe(0);
      expect(reduced.transform.y).toBe(0);
      expect(reduced.transform.rotation).toBe(0);
      expect(frame.progress).toBeGreaterThanOrEqual(0);
      expect(frame.progress).toBeLessThanOrEqual(1);

      if (entry.category === 'ux-element') {
        expect(frame.geometry.height).toBeGreaterThanOrEqual(44);
        expect(frame.feedback.visual).not.toBe('none');
        expect(frame.accessibility.role).toBe(entry.specification.component.role);
      } else if (entry.category === 'animated-element') {
        expect(frame.kind).toBe('motion');
        expect(frame.geometry.primitive).toBe(entry.specification.actor.primitive);
      } else {
        expect(frame.kind).toBe('clip');
        expect(frame.geometry.primitive).toBe(entry.specification.actor.primitive);
      }
    });
  }
});
