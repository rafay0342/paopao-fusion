import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeOnlineGhost } from '../src/game/online';
import { normalizeGhostTrace } from '../src/game/retention';

const validTrace = [
  { atMs: 400, angle: -90, color: 'red' },
  { atMs: 1_250, angle: -72.5, color: 'blue' },
] as const;

describe('network ghost replay validation', () => {
  it('clones a bounded chronological trace without coercing network values', () => {
    const normalized = normalizeGhostTrace(validTrace, 2_000);
    expect(normalized).toEqual(validTrace);
    expect(normalized).not.toBe(validTrace);
    expect(normalizeGhostTrace([{ ...validTrace[0], atMs: '400' }], 2_000)).toBeUndefined();
    expect(normalizeGhostTrace([{ ...validTrace[0], angle: Number.NaN }], 2_000)).toBeUndefined();
    expect(normalizeGhostTrace([{ ...validTrace[0], color: 'ultraviolet' }], 2_000)).toBeUndefined();
  });

  it('fails the entire trace closed for reversed or out-of-duration timestamps', () => {
    expect(normalizeGhostTrace([
      validTrace[1],
      validTrace[0],
    ], 2_000)).toBeUndefined();
    expect(normalizeGhostTrace([
      { ...validTrace[0], atMs: 2_001 },
    ], 2_000)).toBeUndefined();
  });

  it('validates the public response envelope before CompetitiveScene can launch it', () => {
    expect(normalizeOnlineGhost({
      id: 'run_12345678',
      score: 1_200,
      durationMs: 2_000,
      ghost: validTrace,
    })).toEqual({
      id: 'run_12345678',
      score: 1_200,
      durationMs: 2_000,
      ghost: validTrace,
    });
    expect(normalizeOnlineGhost({
      id: 'run_12345678',
      score: 1_200,
      durationMs: 2_000,
      ghost: [{ ...validTrace[0], color: 'bad' }],
    })).toBeNull();
  });

  it('enforces the same nested shot contract at the legacy submission bridge', () => {
    const server = readFileSync(
      fileURLToPath(new URL('../server/index.mjs', import.meta.url)),
      'utf8',
    );
    expect(server).toContain("required: ['atMs', 'angle', 'color']");
    expect(server).toContain("color: { enum: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'] }");
    expect(server).toContain("return reply.code(422).send({ error: 'invalid-ghost-trace' })");
  });
});
