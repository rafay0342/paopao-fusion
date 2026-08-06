import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LEVELS, MAP_NODES, WORLD_THEMES, nextStoryLevel } from '../src/config';
import {
  CAMPAIGN_CONTENT_VERSION,
  LEGACY_CAMPAIGN_CONTENT_VERSION,
  campaignGenerationSeed,
} from '../src/game/campaign-generation';
import { isLevelUnlocked, normalizeGameProgress } from '../src/game/progression';
import { STORY_BEATS, validateStoryCanon } from '../src/game/story';
import {
  classicAuthorityRequiredShots,
  classicAuthorityTarget,
  evaluateClassicAuthorityTrace,
} from '../shared/runtime/classic-authority.mjs';

describe('V16 Crown Echoes expansion', () => {
  it('appends twelve immutable Echo IDs without changing the original campaign identity', () => {
    expect(LEVELS).toHaveLength(42);
    expect(LEVELS.slice(0, 30).every((level) => level.act === 'crown')).toBe(true);
    expect(LEVELS.slice(30).map((level) => ({ world: level.world, act: level.act, tier: level.masteryTier }))).toEqual([
      { world: 0, act: 'echoes', tier: 1 }, { world: 0, act: 'echoes', tier: 2 },
      { world: 1, act: 'echoes', tier: 1 }, { world: 1, act: 'echoes', tier: 2 },
      { world: 2, act: 'echoes', tier: 1 }, { world: 2, act: 'echoes', tier: 2 },
      { world: 3, act: 'echoes', tier: 1 }, { world: 3, act: 'echoes', tier: 2 },
      { world: 4, act: 'echoes', tier: 1 }, { world: 4, act: 'echoes', tier: 2 },
      { world: 5, act: 'echoes', tier: 1 }, { world: 5, act: 'echoes', tier: 2 },
    ]);
    expect(CAMPAIGN_CONTENT_VERSION).toBe('2026.08.06-v16-crown-echoes');
    expect(campaignGenerationSeed({ level: 0, mode: 'classic' })).toBe(
      campaignGenerationSeed({ level: 0, mode: 'classic', contentVersion: LEGACY_CAMPAIGN_CONTENT_VERSION }),
    );
    expect(campaignGenerationSeed({ level: 30, mode: 'classic' })).toBe(
      campaignGenerationSeed({ level: 30, mode: 'classic', contentVersion: CAMPAIGN_CONTENT_VERSION }),
    );
  });

  it('unlocks every realm mastery path only after the original Crown finale', () => {
    const locked = normalizeGameProgress({});
    const restored = normalizeGameProgress({ cleared: [17], stars: Array.from({ length: 18 }, (_, level) => level === 17 ? 1 : 0) });
    for (const world of WORLD_THEMES) {
      expect(isLevelUnlocked(world.echoLevels[0], locked)).toBe(false);
      expect(isLevelUnlocked(world.echoLevels[0], restored)).toBe(true);
      expect(isLevelUnlocked(world.echoLevels[1], restored)).toBe(false);
    }
    expect(MAP_NODES).toHaveLength(42);
  });

  it('keeps the Crown ending and the Ascended route as separate deterministic sequences', () => {
    expect(nextStoryLevel(WORLD_THEMES[5].levels[4])).toBeNull();
    expect(nextStoryLevel(WORLD_THEMES[0].echoLevels[0])).toBe(WORLD_THEMES[0].echoLevels[1]);
    expect(nextStoryLevel(WORLD_THEMES[0].echoLevels[1])).toBe(WORLD_THEMES[1].echoLevels[0]);
    expect(nextStoryLevel(WORLD_THEMES[5].echoLevels[1])).toBeNull();
    expect(STORY_BEATS).toHaveLength(42);
    expect(validateStoryCanon()).toBe(true);
  });

  it('keeps Maryam-Rafay content out of the full-game runtime entry', () => {
    const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    const runtime = [read('../src/main.ts'), read('../src/scenes/BootScene.ts'), read('../src/scenes/GameScene.ts')].join('\n');
    expect(runtime).not.toMatch(/Maryam|focused-experience|focus=1|LOVE MOMENT|HEARTS\s+♥/u);
  });

  it('accepts authoritative proof targets for the new stage 42 boundary', () => {
    const requiredShots = classicAuthorityRequiredShots(41);
    const shotTrace = Array.from({ length: requiredShots }, (_, sequence) => {
      const target = classicAuthorityTarget({ seed: 424_216, level: 41, sequence });
      expect(target.ok).toBe(true);
      return {
        sequence,
        atMs: 1_000 + sequence * 1_000,
        angleMilliDegrees: target.ok ? target.target.angleMilliDegrees : 0,
      };
    });
    const evaluation = evaluateClassicAuthorityTrace({ seed: 424_216, level: 41, shotTrace });
    expect(evaluation.ok).toBe(true);
    expect(evaluation.ok && evaluation.result.completed).toBe(true);
  });

  it('ships the Cloudflare authority storage and routes with V16', () => {
    const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    expect(read('../cloudflare/migrations/0004_classic_authority.sql')).toContain('level BETWEEN 0 AND 41');
    const worker = read('../cloudflare/src/index.ts');
    expect(worker).toContain("'/api/v3/classic/runs/start'");
    expect(worker).toContain('settleClassicInput');
    expect(worker).toContain("'skin:nexus_crown_optical'");
  });
});
