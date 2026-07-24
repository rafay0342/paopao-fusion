import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(
  fileURLToPath(new URL(`../${path}`, import.meta.url)),
  'utf8',
);

const section = (source: string, start: string, end: string): string => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
};

const executableSource = (source: string): string => source.replace(/\/\/.*$/gm, '');

describe('measured hand aim authority', () => {
  it('locks GameScene aim on confirmed contact and never fires prediction', () => {
    const game = read('src/scenes/GameScene.ts');
    const handPoll = section(game, '  private pollHand(): void {', '  /** Interpolate every Phaser frame');
    const latch = section(handPoll, "if (pinchEvent === 'latched')", "} else if (pinchEvent === 'aim-locked')");
    const release = section(handPoll, "if (pinchEvent === 'released')", '    const phase =');

    expect(latch).toContain('const measuredAim = this.handTarget');
    expect(latch).toContain('this.handLockedAim = measuredAim ? { ...measuredAim } : null');
    expect(release).toContain('const aim = this.handLockedAim;');
    expect(release).toContain('this.shootAt(aim.x, aim.y)');
    expect(release).not.toContain('this.shootAt(predicted');
  });

  it('locks EndlessScene lane on contact and keeps prediction render-only', () => {
    const endless = read('src/scenes/EndlessScene.ts');
    const handPoll = section(endless, '  private pollHand(): void {', '  /** Fill recognition gaps');
    const latch = section(handPoll, "if (event === 'latched')", "} else if (event === 'aim-locked')");
    const release = section(handPoll, "else if (event === 'released')", '    const phase =');
    const advance = section(endless, '  private advanceHandAim(): void {', '  private failClosed');

    expect(latch).toContain('this.handLockedLane = lane');
    expect(release).toContain('const lockedLane = this.handLockedLane');
    expect(release).toContain('this.selectedLane = lockedLane');
    expect(release).toContain("this.fireSelectedLane('hand')");
    expect(executableSource(release)).not.toContain(
      'this.selectedLane = endlessLaneForBoardX(this.grid, releasePoint.x)',
    );
    expect(advance).toContain('this.drawAim(visualLane)');
    expect(advance).not.toContain('this.selectedLane = endlessLaneForBoardX');
  });
});
