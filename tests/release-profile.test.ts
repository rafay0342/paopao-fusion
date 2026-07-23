import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertPhaserReleaseProfile,
  parsePhaserReleaseGate,
  phaserReleaseProfile,
} from '../tools/release-profile-lib.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

describe('Phaser release profile contract', () => {
  it('defines the exact cumulative feature boundary for all five gates', () => {
    const profiles = [1, 2, 3, 4, 5].map((gate) => phaserReleaseProfile(gate));
    expect(profiles.map((profile) => profile.releaseSlug)).toEqual([
      'foundation-and-migration',
      'complete-gameplay-coverage',
      'cinematic-presentation',
      'endless-live-operations',
      'production-hardening',
    ]);
    expect(profiles.map((profile) => Object.values(profile.features).filter(Boolean).length))
      .toEqual([1, 2, 3, 4, 5]);
    profiles.forEach((profile, index) => {
      expect(assertPhaserReleaseProfile(JSON.parse(JSON.stringify(profile)), index + 1))
        .toEqual(profile);
    });
  });

  it('fails closed on invalid gates, metadata drift and undeclared feature flags', () => {
    for (const gate of [undefined, '', 0, 6, 1.5, 'latest']) {
      expect(() => parsePhaserReleaseGate(gate)).toThrow('integer from 1 through 5');
    }
    expect(() => assertPhaserReleaseProfile({
      ...phaserReleaseProfile(4),
      releaseSlug: 'production-hardening',
    }, 4)).toThrow('does not exactly match gate 4');
    expect(() => assertPhaserReleaseProfile({
      ...phaserReleaseProfile(5),
      features: { ...phaserReleaseProfile(5).features, undeclared: true },
    }, 5)).toThrow('does not exactly match gate 5');
  });

  it('rejects destructive source output paths before invoking a compiler or Vite', () => {
    const mainPath = join(projectRoot, 'src', 'main.ts');
    expect(existsSync(mainPath)).toBe(true);
    const result = spawnSync(process.execPath, [
      join(projectRoot, 'tools', 'build-release.mjs'), '1', 'src',
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cannot overlap protected project directory src');
    expect(existsSync(mainPath)).toBe(true);
  });
});

