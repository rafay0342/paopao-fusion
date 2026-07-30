import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../src/scenes/GameScene.ts', import.meta.url)), 'utf8');

function section(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing section end: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('GameScene lifecycle hardening', () => {
  it('clears every projectile transient whenever create runs', () => {
    const create = section('  create(): void {', '  /** Build a faceted crystal command plate');
    expect(create).toContain('this.flying = false;');
    expect(create).toContain('this.vel = { x: 0, y: 0 };');
    expect(create).toContain('this.ballSprite = undefined;');
    expect(create).toContain('this.lastAim = { x: VIEW.width / 2, y: VIEW.height * 0.35 };');
    expect(create).toContain('this.terminalLatch.reset();');
  });

  it('preserves challenge and ghost retries while routing arena restart to its lobby', () => {
    const payload = section('  private restartRunData():', '  // ── helpers');
    const pause = section('  private showPauseCard(): void {', '  // ── fx');
    const ending = section('  private endCard(msg: string, color: number): void {', '  private connectArena(): void {');
    expect(payload).toContain('challenge: this.challenge');
    expect(payload).toContain('ghost: this.replayTrace.slice()');
    expect(pause).toContain("this.scene.start('Competitive')");
    expect(pause).toContain('this.scene.restart(this.restartRunData())');
    expect(ending).toContain("this.scene.start('Competitive')");
    expect(ending).toContain('this.scene.restart(this.restartRunData())');
  });

  it('owns Escape pause requests only for the active scene lifecycle', () => {
    const create = section('  create(): void {', '  /** Build a faceted crystal command plate');
    expect(create).toContain("this.events.on('paopao:back-request', handleBackRequest)");
    expect(create).toContain("this.events.off('paopao:back-request', handleBackRequest)");
    expect(create).toContain('const handleBackRequest = (): void => this.showPauseCard();');
  });
});

describe('GameScene transactional effects', () => {
  it('does not commit special-mechanic progress before inventory consumption succeeds', () => {
    const power = section('  private async usePowerUp(kind: PowerUp): Promise<void> {', '  private useArtifactSuper(): void {');
    const serverDebit = power.indexOf('await consumeInventoryV2(kind, 1)');
    const localDebit = power.indexOf('const consumed = consumeInventoryItem(kind);');
    const failedReturn = power.indexOf("this.toast('SUPPLY VAULT EMPTY  •  VISIT THE STORE')");
    const commit = power.indexOf('this.commitSpecialMechanicRemoval(b);');
    expect(serverDebit).toBeGreaterThanOrEqual(0);
    expect(localDebit).toBeGreaterThan(serverDebit);
    expect(failedReturn).toBeGreaterThan(localDebit);
    expect(commit).toBeGreaterThan(failedReturn);
    expect(power).toContain('this.powerUsePending = true;');
    expect(power).toContain('this.powerUsePending = false;');
    expect(power).toContain('SERVER INVENTORY CHECK FAILED  •  SUPPLY WAS NOT USED');
  });

  it('guards both terminal cards with the same one-way latch', () => {
    const clear = section('  private levelClearCard(): void {', '  private showPauseCard(): void {');
    const end = section('  private endCard(msg: string, color: number): void {', '  private connectArena(): void {');
    expect(clear).toContain('if (!this.terminalLatch.tryEnter()) return;');
    expect(end).toContain('if (!this.terminalLatch.tryEnter()) return;');
  });
});

describe('GameScene premium gameplay art integrity', () => {
  it('keeps the original launcher proportions and muzzle geometry', () => {
    const create = section('  create(): void {', '  /** Build a faceted crystal command plate');
    const muzzle = section('  private muzzlePosition():', '  private tutorialTargetPoint');
    expect(create).toContain('this.launcherPivotY = this.shooter.y + 111;');
    expect(create).toContain('.setDisplaySize(244, 244)');
    expect(create).toContain('.setDisplaySize(226, 226)');
    expect(muzzle).toContain('const barrelLength = 111;');
  });

  it('renders equipped orb textures without hard-coded glyph overlays', () => {
    expect(source).not.toContain('orbCueGfx');
    expect(source).not.toContain('drawOrbAccessibilityCues');
    expect(source).not.toContain('strokeTriangle');
  });
});
