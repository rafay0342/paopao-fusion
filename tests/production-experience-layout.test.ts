import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  productionExperienceCardLines,
  PRODUCTION_EXPERIENCE_CARD_HEIGHT,
  PRODUCTION_EXPERIENCE_CARD_TEXT_WIDTH,
  PRODUCTION_EXPERIENCE_CARD_WIDTH,
} from '../src/game/production-experience';
import { resolveTextFitScale } from '../src/gfx/text-layout';

interface CardEntry {
  id: string;
  subject: string;
  facet: string;
}

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const pageDirectory = projectFile('public/assets/production-experience/pages');
const entries = readdirSync(pageDirectory)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort()
  .flatMap((fileName) => {
    const page = JSON.parse(readFileSync(`${pageDirectory}/${fileName}`, 'utf8')) as { entries: CardEntry[] };
    return page.entries;
  });

describe('Production Experience layout regression', () => {
  it('honors the caller-provided text floor and resets text that already fits', () => {
    expect(resolveTextFitScale(1_000, 500, 0.7)).toBe(0.7);
    expect(resolveTextFitScale(1_000, 750, 0.7)).toBe(0.75);
    expect(resolveTextFitScale(300, 500, 0.7)).toBe(1);
    expect(resolveTextFitScale(1_000, 100, 0.4)).toBe(0.5);
  });

  it('splits all 1,500 card labels into independently bounded rows', () => {
    expect(entries).toHaveLength(1_500);
    expect(PRODUCTION_EXPERIENCE_CARD_TEXT_WIDTH).toBeLessThan(PRODUCTION_EXPERIENCE_CARD_WIDTH);

    for (const entry of entries) {
      const lines = productionExperienceCardLines(entry);
      expect(lines.map((line) => line.role)).toEqual(['id', 'subject', 'facet']);
      expect(lines.map((line) => line.text)).toEqual([
        entry.id.toUpperCase(),
        entry.subject.toUpperCase(),
        entry.facet.toUpperCase(),
      ]);
      expect(lines.every((line) => !line.text.includes(' • '))).toBe(true);

      for (const line of lines) {
        // One full em per character plus tracking is deliberately conservative
        // for Fusion Sans. Even that worst case remains inside the card gutter.
        const conservativeWidth = line.text.length * (line.fontSize + 0.3) * line.minScale;
        const conservativeHalfHeight = line.fontSize * line.minScale * 0.62 + 2;
        expect(conservativeWidth, `${entry.id} ${line.role} can leave its card`).toBeLessThanOrEqual(PRODUCTION_EXPERIENCE_CARD_TEXT_WIDTH);
        expect(Math.abs(line.y) + conservativeHalfHeight, `${entry.id} ${line.role} can leave its card`).toBeLessThanOrEqual(PRODUCTION_EXPERIENCE_CARD_HEIGHT / 2);
      }
    }
  });

  it('renders the three bounded rows and refits every dynamic header/status value', () => {
    const scene = readFileSync(projectFile('src/scenes/ProductionExperienceScene.ts'), 'utf8');
    expect(scene).toContain("addArtButton(this, x, y, '',");
    expect(scene).toContain('productionExperienceCardLines(entry).map');
    expect(scene).toContain('PRODUCTION_EXPERIENCE_CARD_TEXT_WIDTH, line.minScale');
    expect(scene).not.toContain('${entry.subject.toUpperCase()} • ${entry.facet.toUpperCase()}');
    expect(scene).toContain('private setStatus(message: string, color: string)');
    expect(scene).toContain('fitText(this.statusText.setText(message).setColor(color), 600, 0.68)');
  });
});
