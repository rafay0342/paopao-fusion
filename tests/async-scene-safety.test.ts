import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('async scene result ownership', () => {
  it('rejects stale leaderboard and ghost responses and freezes replay context', () => {
    const source = read('src/scenes/CompetitiveScene.ts');
    expect(source).toContain('request !== this.boardRequest');
    expect(source).toContain('request !== this.ghostRequest');
    expect(source).toContain('const challenge = this.activeChallenge');
    expect(source).toContain('challenge,');
  });

  it('applies durable purchase receipts without reopening an exited scene', () => {
    for (const file of ['src/scenes/StoreScene.ts', 'src/scenes/RewardsScene.ts']) {
      const source = read(file);
      expect(source).toContain('if (!this.scene.isActive()) return;');
    }
  });
});
