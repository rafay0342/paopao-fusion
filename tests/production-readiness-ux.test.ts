import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('production-readiness gameplay clarity pass', () => {
  it('separates the launcher and aim guide from the environment', () => {
    const source = read('../src/scenes/GameScene.ts');
    expect(source).toContain('launcherGlow');
    expect(source).toContain('690, 430, 0x05040f, 0.28');
    expect(source).toContain('fillCircle(point.x, point.y, 7.5)');
    expect(source).toContain('fillCircle(point.x, point.y, 3.2)');
    expect(source).toContain('this.cameras.main.shake(72, 0.0024)');
  });

  it('prioritizes stage, objective, mobile spacing and larger icon art', () => {
    const source = read('../src/scenes/GameScene.ts');
    expect(source).toContain('this.geom.topPad += 20');
    expect(source).toContain("width / 2, 58, width - 24, 82");
    expect(source).toContain("fontSize: '28px'");
    expect(source).toContain('this.time.delayedCall(3_000');
    expect(source).toContain('icon.lineStyle(4');
  });

  it('makes the current map route visually dominant', () => {
    const source = read('../src/scenes/WorldMapScene.ts');
    expect(source).toContain('const currentLevel =');
    expect(source).toContain('current ? 1 : unlocked ? 0.54 : 0.3');
    expect(source).toContain("current ? 'CURRENT' : ''");
    expect(source).toContain('labelAlpha = current ? 1 : unlocked ? 0.58 : 0.36');
    expect(source).toContain('fillRoundedRect(labelBoxLeft');
  });

  it('gives modes distinct identities and a dominant primary action', () => {
    const source = read('../src/scenes/ModeSelectScene.ts');
    expect(source).toContain('The silhouette below remains the secondary cue');
    expect(source).toContain('if (index === 0)');
    expect(source).toContain('} else if (index === 1) {');
    expect(source).toContain("'ACTIVE'");
    expect(source).toContain("selected ? 'PLAY SELECTED' : 'PLAY MODE'");
    expect(source).toContain('216, 64, 14');
  });

  it('presents the origin story as five short mobile cards', () => {
    const source = read('../src/scenes/ChronicleScene.ts');
    const cardsSource = source.split('const ORIGIN_CARDS = [')[1]?.split('] as const;')[0] ?? '';
    expect(source).toContain('const ORIGIN_CARDS = [');
    expect(cardsSource.match(/title: '/g)).toHaveLength(5);
    expect(source).toContain('ORIGIN_CARDS.forEach');
    expect(source).toContain('fillRoundedRect(67, y - 64, 586, 128, 16)');
  });
});
