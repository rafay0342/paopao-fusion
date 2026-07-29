import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/scenes/MemoryConstellationScene.ts', import.meta.url),
  'utf8',
);

describe('Memory Constellation scene wiring', () => {
  it('uses the pure deterministic 4x4 memory state and replays the exact seed', () => {
    expect(source).toContain("super('MemoryConstellation')");
    expect(source).toContain('createMemoryConstellationState(this.seed)');
    expect(source).toContain('revealMemoryConstellationCard(this.state, index)');
    expect(source).toContain('resolveMemoryConstellationMismatch(this.state)');
    expect(source).toContain('export function memoryConstellationDailySeed(');
    expect(source).toContain('this.scene.restart({ seed: this.seed })');
    expect(source).toContain('SAME-SEED REPLAY');
  });

  it('renders eight material identities with non-colour rune cues', () => {
    expect(source).toContain('const ORB_RUNES');
    expect(source).toContain("'artifact_chrono'");
    expect(source).toContain("'artifact_fortune'");
    expect(source).toContain('identity.rune');
    expect(source).toContain('rune ${identity.rune}');
    expect(source).toContain('CARD_WIDTH = 142');
    expect(source).toContain('CARD_HEIGHT = 148');
  });

  it('bounds mismatch visibility and records local result fields only', () => {
    expect(source).toContain('const MISMATCH_HIDE_MS = 650');
    expect(source).toContain('this.time.delayedCall(MISMATCH_HIDE_MS');
    expect(source).toContain("recordArcadeResult('memory-constellation', {");
    expect(source).toContain('score,');
    expect(source).toContain('timeMs,');
    expect(source).toContain('moves: this.state.moves');
    expect(source).toContain('NO COINS, WALLET BALANCE, INVENTORY, CAMPAIGN');
    expect(source).not.toMatch(/\b(?:addCoins|grantCoins|setCoins|submitRunV3|fetch)\s*\(/);
  });

  it('funnels pointer, keyboard, measured hand, gaze and hybrid input into one action', () => {
    for (const input of [
      "activateCard(index, 'pointer')",
      "activateCard(this.selectedIndex, 'keyboard')",
      "activateCard(lockedIndex, 'hand')",
      "activateCard(authoritativeIndex, 'gaze')",
      "activateCard(lockedIndex, 'gaze-hand')",
    ]) expect(source).toContain(input);
    expect(source).toContain("keyboard?.on('keydown-W'");
    expect(source).toContain("keyboard?.on('keydown-A'");
    expect(source).toContain("keyboard?.on('keydown-S'");
    expect(source).toContain("keyboard?.on('keydown-D'");
    expect(source).toContain("keyboard?.on('keydown-ENTER'");
    expect(source).toContain("keyboard?.on('keydown-SPACE'");
  });

  it('fails closed on stale vision frames and cleans every lifecycle boundary', () => {
    expect(source).toContain('ageMs <= CAMERA_FRAME_MAX_AGE_MS');
    expect(source).toContain('sample.gestureStable');
    expect(source).toContain('sample.usableForGesture');
    expect(source).toContain("event === 'latched'");
    expect(source).toContain("event === 'released'");
    expect(source).toContain('this.pinchControl.holdForUncertainty(sample.timestampMs)');
    expect(source).toContain('gazeCalibrationMatches(profile, identity)');
    expect(source).toContain("window.removeEventListener('paopao:render-context-boundary'");
    expect(source).toContain('getHandTracker().suspend()');
  });

  it('mounts a scene-level accessible board and provides every required exit/control', () => {
    expect(source).toContain("id: 'memory-constellation'");
    expect(source).toContain('this.a11y?.registerButton({');
    expect(source).toContain('ARCADE HUB');
    expect(source).toContain('RESTART SKY');
    expect(source).toContain('CAMERA SETUP');
    expect(source).toContain("this.scene.start('ArcadeHub')");
  });
});
