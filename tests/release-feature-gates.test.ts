import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('cumulative Phaser release feature gates', () => {
  it('registers gameplay, presentation, live-ops and hardening scenes only at their declared gates', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(/completeGameplay \? \[[\s\S]*ChronicleScene[\s\S]*CompetitiveScene/);
    expect(main).toMatch(/cinematicPresentation \? \[GalleryScene\]/);
    expect(main).toMatch(/endlessLiveOperations \? \[EndlessScene\]/);
    expect(main).toMatch(/productionHardening \? \[[\s\S]*ProductionArchiveScene[\s\S]*ProductionSystemsScene/);
    expect(main).toContain('if (PHASER_RELEASE_FEATURES.productionHardening)');
  });

  it('gates every player-facing entry point instead of relying on release metadata', () => {
    expect(read('src/scenes/BootScene.ts')).toContain("PHASER_RELEASE_FEATURES.cinematicPresentation ? 'Intro' : 'Menu'");
    expect(read('src/scenes/ModeSelectScene.ts')).toContain('PHASER_RELEASE_FEATURES.endlessLiveOperations');
    expect(read('src/scenes/MenuScene.ts')).toContain('PHASER_RELEASE_FEATURES.completeGameplay');
    expect(read('src/scenes/MenuScene.ts')).toContain('PHASER_RELEASE_FEATURES.cinematicPresentation');
    expect(read('src/scenes/WorldMapScene.ts')).toContain('PHASER_RELEASE_FEATURES.completeGameplay || level === 0');
    expect(read('src/scenes/ChallengesScene.ts')).toContain('PHASER_RELEASE_FEATURES.endlessLiveOperations');
    expect(read('src/scenes/GalleryScene.ts')).toContain('PHASER_RELEASE_FEATURES.productionHardening');
    expect(read('src/scenes/GameScene.ts')).toContain("PHASER_RELEASE_FEATURES.completeGameplay ? 'NEXT LEVEL' : 'FOUNDATION COMPLETE'");
  });
});
