import { describe, expect, it } from 'vitest';
import campaign from '../shared/fixtures/campaign-v1.json';
import { LEVELS, WORLD_THEMES } from '../src/config';

describe('shared deterministic campaign fixture', () => {
  it('is the runtime source of truth for all 42 Phaser levels', () => {
    expect(LEVELS).toHaveLength(42);
    expect(LEVELS).toEqual(campaign.levels.map((level) => ({
      rows: level.rows,
      colors: level.colors,
      world: level.world,
      title: level.title,
      objective: level.objective,
      targetScore: level.targetScore,
      goal: level.goal,
      mechanic: level.mechanic,
      mechanicCount: level.mechanicCount,
      ...(level.shotLimit > 0 ? { shotLimit: level.shotLimit } : {}),
      ...('boss' in level && level.boss ? { boss: level.boss } : {}),
      act: 'act' in level && level.act === 'echoes' ? 'echoes' : 'crown',
      ...('masteryTier' in level ? { masteryTier: level.masteryTier } : {}),
    })));
  });

  it('drives all six Phaser world routes', () => {
    expect(WORLD_THEMES).toHaveLength(6);
    expect(WORLD_THEMES.map(({ id, name, subtitle, accentCss, levels, echoLevels }) => ({ id, name, subtitle, accent: accentCss, levels, echoLevels })))
      .toEqual(campaign.worlds.map(({ id, name, subtitle, accent, levels, echoLevels }) => ({ id, name, subtitle, accent, levels, echoLevels })));
  });

  it('partitions every level into exactly one world without gaps or duplicates', () => {
    const routedLevels = campaign.worlds.flatMap(({ levels, echoLevels }) => [...levels, ...echoLevels]);
    expect(routedLevels).toHaveLength(42);
    expect(new Set(routedLevels).size).toBe(42);
    expect([...routedLevels].sort((left, right) => left - right)).toEqual(
      Array.from({ length: 42 }, (_, index) => index),
    );
    expect(campaign.levels.map(({ index }) => index)).toEqual(Array.from({ length: 42 }, (_, index) => index));
    for (const world of campaign.worlds) {
      expect(world.levels).toHaveLength(5);
      for (const level of world.levels) expect(campaign.levels[level].world).toBe(world.index);
      expect(world.echoLevels).toHaveLength(2);
      for (const level of world.echoLevels) expect(campaign.levels[level].world).toBe(world.index);
    }
  });
});
