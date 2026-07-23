import { describe, expect, it } from 'vitest';
import { LEVELS, WORLD_THEMES } from '../src/config';
import {
  CHARACTERS,
  CHRONICLE_LORE,
  ENDING_PASSAGES,
  PREMISE,
  STORY_BEATS,
  STORY_CHAPTERS,
  STORY_TITLE,
  storyBeatForLevel,
  storyProgressFromStars,
  validateStoryCanon,
} from '../src/game/story';

describe('Shattered Crown story canon', () => {
  it('binds one concise, meaningful story beat to every save-compatible level', () => {
    expect(STORY_BEATS).toHaveLength(LEVELS.length);
    expect(validateStoryCanon()).toBe(true);
    STORY_BEATS.forEach((beat, index) => {
      expect(beat.level).toBe(index);
      expect(beat.chapter).toBe(LEVELS[index].world);
      expect(beat.body.length).toBeGreaterThan(60);
      expect(beat.purpose.length).toBeGreaterThan(35);
      expect(beat.aftermath.length).toBeGreaterThan(35);
      expect(storyBeatForLevel(index)).toBe(beat);
    });
  });

  it('keeps the six realms, guardians and Crown Shards in campaign order', () => {
    expect(STORY_TITLE).toBe('PAOPAO FUSION: THE SHATTERED CROWN');
    expect(STORY_CHAPTERS.map(({ title }) => title)).toEqual(WORLD_THEMES.map(({ name }) => name));
    expect(STORY_CHAPTERS.map(({ levelRange }) => levelRange)).toEqual([
      [0, 2], [3, 5], [6, 8], [9, 11], [12, 14], [15, 17],
    ]);
    STORY_CHAPTERS.forEach((chapter) => {
      expect(LEVELS[chapter.levelRange[1]].boss?.name).toBe(chapter.guardian);
      expect(chapter.shard).toMatch(/^SHARD OF /);
    });
  });

  it('explains the central conflict, cast and established game-system lore', () => {
    expect(PREMISE).toContain('Aurora Crown');
    expect(PREMISE).toContain('Nexus Architect');
    expect(PREMISE).toContain('six Crown Shards');
    expect(PREMISE).toContain('last Prism Keeper');
    expect(PREMISE).toContain('sentient Pao spirits');
    expect(CHARACTERS.map(({ id }) => id)).toEqual(['keeper', 'lumi', 'guardians', 'architect']);
    expect(CHRONICLE_LORE.find(({ title }) => title.includes('KEEPER RELICS'))?.body).toContain('Mystery Vault');
    expect(CHRONICLE_LORE.find(({ title }) => title.includes('DAILY PRISM'))?.body).toContain('stable echoes');
  });

  it('derives Chronicle progress from cleared levels without creating a second save source', () => {
    expect(storyProgressFromStars(Array(18).fill(0))).toEqual({
      levelsCleared: 0, realmsRestored: 0, shardsRecovered: 0, crownRestored: false,
    });
    const partial = Array(18).fill(0);
    partial[0] = 2;
    partial[2] = 1;
    partial[5] = 3;
    expect(storyProgressFromStars(partial)).toEqual({
      levelsCleared: 3, realmsRestored: 2, shardsRecovered: 2, crownRestored: false,
    });
    expect(storyProgressFromStars(Array(18).fill(1))).toEqual({
      levelsCleared: 18, realmsRestored: 6, shardsRecovered: 6, crownRestored: true,
    });
  });

  it('ends by restoring shared harmony instead of making the Keeper a ruler', () => {
    expect(ENDING_PASSAGES).toHaveLength(5);
    expect(ENDING_PASSAGES.join(' ')).toContain('Aurora Crown reforms');
    expect(ENDING_PASSAGES.join(' ')).toContain('never their ruler');
    expect(ENDING_PASSAGES.join(' ')).toContain('Rift closes');
  });
});
