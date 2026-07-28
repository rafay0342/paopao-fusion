import { describe, expect, it } from 'vitest';
import {
  WORLD_PRESENTATION_PROFILES,
  resolveWorldPresentation,
} from '../src/game/world-presentation';

describe('world presentation-only corruption states', () => {
  it('covers the six stable campaign realms without inventing a new world ID', () => {
    expect(Object.keys(WORLD_PRESENTATION_PROFILES)).toEqual([
      'crystal',
      'emerald',
      'celestial',
      'ember',
      'frost',
      'nexus',
    ]);
  });

  it('keeps an uncleared realm corrupted and resolves integrity-stable layer keys', () => {
    const cleared: number[] = [25, 26];
    const result = resolveWorldPresentation({
      worldId: 'nexus',
      worldIndex: 5,
      finalLevel: 29,
      clearedLevels: cleared,
      mode: 'bubble-shooter',
      backgroundKey: 'world_nexus',
    });

    expect(result.state).toBe('corrupted');
    expect(result.backgroundKey).toBe('world_nexus');
    expect(result.atmosphereKey).toBe('world_nexus_atmosphere');
    expect(result.label).toBe('RIFT VEIL ACTIVE');
    expect(result.intensity).toBeLessThanOrEqual(0.84);
    expect(cleared).toEqual([25, 26]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('derives restoration from the existing final-level clear without writing save state', () => {
    const cleared = Object.freeze([25, 26, 27, 28, 29]);
    const result = resolveWorldPresentation({
      worldId: 'nexus',
      worldIndex: 5,
      finalLevel: 29,
      clearedLevels: cleared,
      mode: 'match3',
      backgroundKey: 'world_nexus',
    });

    expect(result.state).toBe('restored');
    expect(result.label).toBe('RIFT STABILIZED');
    expect(result.intensity).toBe(0.14);
    expect(cleared).toEqual([25, 26, 27, 28, 29]);
  });

  it('uses a bounded fallback profile for malformed presentation input only', () => {
    const result = resolveWorldPresentation({
      worldId: 'unknown',
      worldIndex: Number.POSITIVE_INFINITY,
      finalLevel: -1,
      clearedLevels: [],
      mode: 'match3',
      backgroundKey: 'world_crystal',
    });

    expect(result.worldIndex).toBe(0);
    expect(result.state).toBe('corrupted');
    expect(result.accent).toBe(WORLD_PRESENTATION_PROFILES.crystal.accent);
  });
});
