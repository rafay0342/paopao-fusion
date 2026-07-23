import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const menuPath = fileURLToPath(new URL('../src/scenes/MenuScene.ts', import.meta.url));
const menuSource = readFileSync(menuPath, 'utf8');

function sceneDestinations(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/this\.scene\.start\(\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1]),
  );
}

function ambientOrbIterationLimits(source: string): number[] {
  const constants = new Map(
    [...source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*;/g)]
      .map((match) => [match[1], Number(match[2])] as const),
  );
  const resolveLimit = (token: string): number | undefined => (
    /^\d+$/.test(token) ? Number(token) : constants.get(token)
  );
  const limits: number[] = [];

  for (const match of source.matchAll(/for\s*\([^;]+;[^;]+<\s*(\d+|[A-Za-z_$][\w$]*);[^)]*\)\s*\{/g)) {
    const start = match.index ?? 0;
    const nearbyBody = source.slice(start, start + 1800);
    if (!nearbyBody.includes('orbTexture(') || !nearbyBody.includes('this.add.image(')) continue;
    const limit = resolveLimit(match[1]);
    if (limit !== undefined) limits.push(limit);
  }

  for (const match of source.matchAll(/Array\.from\(\s*\{\s*length:\s*(\d+|[A-Za-z_$][\w$]*)/g)) {
    const start = match.index ?? 0;
    const nearbyBody = source.slice(start, start + 1800);
    if (!nearbyBody.includes('orbTexture(') || !nearbyBody.includes('this.add.image(')) continue;
    const limit = resolveLimit(match[1]);
    if (limit !== undefined) limits.push(limit);
  }

  return limits;
}

describe('simplified first-impression menu', () => {
  it('keeps every existing destination reachable after visual simplification', () => {
    const destinations = sceneDestinations(menuSource);

    for (const destination of [
      'ModeSelect',
      'Chronicle',
      'Inventory',
      'Account',
      'Store',
      'Rewards',
      'Challenges',
      'Gallery',
      'Competitive',
    ]) {
      expect(destinations.has(destination), `${destination} route should remain on the menu`).toBe(true);
    }
  });

  it('uses premium display type and the compact Keeper Hub / More hierarchy', () => {
    expect(menuSource).toMatch(/import\s*\{[^}]*\bDISPLAY_FONT\b[^}]*\}\s*from\s*['"]\.\.\/gfx\/ui['"]/s);
    expect(menuSource).toMatch(/fontFamily:\s*DISPLAY_FONT/);
    expect(menuSource).toContain('KEEPER HUB');
    expect(menuSource).toMatch(/['"]MORE['"]/);
  });

  it('does not restore the removed leaderboard card or shine overlays', () => {
    expect(menuSource).not.toContain('HALL OF HEROES');
    expect(menuSource).not.toContain('No heroes recorded yet');
    expect(menuSource).not.toContain('Your first run begins now');
    expect(menuSource).not.toContain('launcherGlint');
    expect(menuSource).not.toMatch(/\b(?:sweep|shimmer)\b/i);
  });

  it('caps decorative ambient hero orbs at six', () => {
    const limits = ambientOrbIterationLimits(menuSource);
    expect(limits.every((limit) => limit <= 6), `ambient orb limits were: ${limits.join(', ') || 'none'}`).toBe(true);
  });
});
