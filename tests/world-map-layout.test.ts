import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readProjectFile = (path: string): string => readFileSync(projectFile(path), 'utf8');

describe('World map layout regression', () => {
  const worldMap = readProjectFile('src/scenes/WorldMapScene.ts');
  const story = readProjectFile('src/scenes/StoryScene.ts');
  const game = readProjectFile('src/scenes/GameScene.ts');
  const challenge = readProjectFile('src/scenes/ChallengesScene.ts');
  const ui = readProjectFile('src/gfx/ui.ts');
  const campaign = readProjectFile('shared/fixtures/campaign-v1.json');

  it('uses bounded, non-repeating reward and status presentation', () => {
    expect(worldMap).toContain('const collapsedSummary = presentation.guidance');
    expect(worldMap).toContain('wrapText(detailsSummary, 458, 2)');
    expect(worldMap).toContain("'LOCAL PLAY REMAINS AVAILABLE'");
    expect(worldMap).toContain('node.setSize(180, 180)');
    expect(worldMap).not.toContain('const rewardChest');
    expect(worldMap).not.toContain('SIGN IN  ·');
  });

  it('gives route kinds distinct shapes, readable labels, and large navigation targets', () => {
    expect(worldMap).toContain("standard: 'STANDARD'");
    expect(worldMap).toContain("mystery: 'MYSTERY'");
    expect(worldMap).toContain("challenge: 'CHALLENGE'");
    expect(worldMap).toContain("elite: 'ELITE'");
    expect(worldMap).toContain("boss: 'BOSS'");
    expect(worldMap).toContain('polygonPoints(4, 82)');
    expect(worldMap).toContain('polygonPoints(8, 76');
    expect(worldMap).toContain('polygonPoints(6, 79)');
    expect(worldMap).not.toContain('addWorldStateBadge(this');
    expect(worldMap).toContain("addArtButton(this, 84, 326, '‹'");
    expect(worldMap).toContain('clampFloatingCenterX');
    expect(worldMap).toContain('112,\n        104');
  });

  it('uses the route stage number on every classic campaign surface', () => {
    expect(worldMap).toContain('const displayStage = campaignStageNumber(level)');
    expect(story).toContain('const displayStage = campaignStageNumber(this.level)');
    expect(story).toContain('STAGE ${String(displayStage)');
    expect(game).toContain('PaoPao Fusion stage ${displayStage}');
    expect(game).toContain('STAGE ${String(campaignStageNumber(this.level))');
    expect(challenge).toContain('STAGE ${campaignStageNumber(challenge.level)}');
  });

  it('reserves enough height for both world-state badge lines and uses clear Pao copy', () => {
    expect(ui).toContain('const width = compact ? 438 : 568;');
    expect(ui).toContain('const height = compact ? 54 : 84;');
    expect(campaign).toContain('Anchor the escaping Pao spirits');
    expect(campaign).not.toContain('Anchor the escaping Paos');
  });
});
