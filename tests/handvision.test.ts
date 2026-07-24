import { describe, expect, it } from 'vitest';
import {
  HAND_DETAIL_EDGE,
  HAND_DETAIL_FALLBACK_EDGE,
  HAND_LOW_POWER_EDGE,
  HAND_TRACKING_EDGE,
  HandEnhancementBudget,
  HandInferenceGovernor,
  handInferenceEdge,
  handFarDetailMode,
  handInferenceSize,
  handLightingProfile,
} from '../src/game/handvision';

describe('adaptive hand vision policy', () => {
  it('keeps acquisition, dropout and far hands in detail mode until stable', () => {
    expect(handInferenceEdge({ recentlyTracked: false, missingFrames: 0, stableFrames: 20, palmScale: 0.2 }))
      .toBe(HAND_DETAIL_EDGE);
    expect(handInferenceEdge({ recentlyTracked: true, missingFrames: 1, stableFrames: 20, palmScale: 0.2 }))
      .toBe(HAND_DETAIL_EDGE);
    expect(handInferenceEdge({ recentlyTracked: true, missingFrames: 0, stableFrames: 5, palmScale: 0.2 }))
      .toBe(HAND_DETAIL_EDGE);
    expect(handInferenceEdge({ recentlyTracked: true, missingFrames: 0, stableFrames: 20, palmScale: 0.08 }))
      .toBe(HAND_DETAIL_EDGE);
    expect(handInferenceEdge({ recentlyTracked: true, missingFrames: 0, stableFrames: 20, palmScale: 0.2 }))
      .toBe(HAND_TRACKING_EDGE);
  });

  it('preserves every aspect ratio and never enlarges a small camera source', () => {
    expect(handInferenceSize(1280, 720, HAND_DETAIL_EDGE)).toEqual({ width: 512, height: 288 });
    expect(handInferenceSize(960, 720, HAND_DETAIL_EDGE)).toEqual({ width: 512, height: 384 });
    expect(handInferenceSize(720, 1280, HAND_DETAIL_EDGE)).toEqual({ width: 288, height: 512 });
    expect(handInferenceSize(320, 240, HAND_DETAIL_EDGE)).toEqual({ width: 320, height: 240 });
  });

  it('uses far-hand hysteresis instead of alternating detail size near the boundary', () => {
    expect(HAND_DETAIL_FALLBACK_EDGE).toBeGreaterThan(HAND_TRACKING_EDGE);
    expect(HAND_DETAIL_FALLBACK_EDGE).toBeLessThan(HAND_DETAIL_EDGE);
    expect(handFarDetailMode(false, 0.101)).toBe(false);
    expect(handFarDetailMode(false, 0.099)).toBe(false);
    expect(handFarDetailMode(false, 0.08)).toBe(true);
    expect(handFarDetailMode(true, 0.101)).toBe(true);
    expect(handFarDetailMode(true, 0.119)).toBe(true);
    expect(handFarDetailMode(true, 0.121)).toBe(false);
    expect(handFarDetailMode(false, Number.NaN)).toBe(true);
  });

  it('drops slow inference through 384px to 320px and recovers with hysteresis', () => {
    const governor = new HandInferenceGovernor();
    expect(governor.edgeCap()).toBe(HAND_TRACKING_EDGE);
    [100, 200, 300].forEach((now) => governor.observe(90, 30, now));
    expect(governor.edgeCap()).toBe(HAND_LOW_POWER_EDGE);

    governor.observe(35, 30, 700);
    governor.observe(35, 30, 8_699);
    expect(governor.edgeCap()).toBe(HAND_LOW_POWER_EDGE);
    governor.observe(35, 30, 8_700);
    expect(governor.edgeCap()).toBe(HAND_TRACKING_EDGE);
    governor.observe(35, 30, 16_700);
    expect(governor.edgeCap()).toBe(HAND_DETAIL_EDGE);
  });

  it('does not downshift a deliberately lower 15 FPS target for a healthy cadence', () => {
    const governor = new HandInferenceGovernor();
    for (let index = 1; index <= 20; index++) governor.observe(75, 15, index * 100);
    expect(governor.edgeCap()).toBe(HAND_TRACKING_EDGE);
  });

  it.each([
    [{ mean: 125, p10: 55, p90: 198, darkFraction: 0.05, brightFraction: 0.04, gradient: 22 }, 'normal'],
    [{ mean: 34, p10: 4, p90: 88, darkFraction: 0.72, brightFraction: 0, gradient: 8 }, 'dark'],
    [{ mean: 224, p10: 190, p90: 252, darkFraction: 0, brightFraction: 0.7, gradient: 8 }, 'bright'],
    [{ mean: 112, p10: 15, p90: 230, darkFraction: 0.32, brightFraction: 0.18, gradient: 30 }, 'backlit'],
    [{ mean: 118, p10: 100, p90: 138, darkFraction: 0, brightFraction: 0, gradient: 3 }, 'low-contrast'],
    [{ mean: 126, p10: 50, p90: 205, darkFraction: 0.04, brightFraction: 0.04, gradient: 4 }, 'blurred'],
  ] as const)('selects bounded tone correction for %s', (stats, mode) => {
    const profile = handLightingProfile(stats);
    expect(profile.mode).toBe(mode);
    expect(profile.brightness).toBeGreaterThanOrEqual(0.72);
    expect(profile.brightness).toBeLessThanOrEqual(1.75);
    expect(profile.contrast).toBeGreaterThanOrEqual(0.84);
    expect(profile.contrast).toBeLessThanOrEqual(1.2);
  });

  it('lifts recoverable dark/backlit shadows and never sharpens blurred frames', () => {
    const dark = handLightingProfile({ mean: 34, p10: 3, p90: 80, darkFraction: 0.74, brightFraction: 0, gradient: 5 });
    const backlit = handLightingProfile({ mean: 110, p10: 14, p90: 232, darkFraction: 0.3, brightFraction: 0.2, gradient: 24 });
    const blurred = handLightingProfile({ mean: 126, p10: 48, p90: 204, darkFraction: 0.03, brightFraction: 0.03, gradient: 3 });

    expect(dark.contrast).toBeLessThanOrEqual(1);
    expect(backlit.contrast).toBeLessThan(1);
    expect(blurred).toEqual({ mode: 'blurred', brightness: 1, contrast: 1, saturation: 1 });
  });

  it('disables enhancement only after repeated rolling-budget misses', () => {
    const budget = new HandEnhancementBudget();
    budget.observe(24, false);
    budget.observe(26, false);

    expect(budget.observe(55, true)).toBe(false);
    expect(budget.observe(32, true)).toBe(false);
    expect(budget.observe(54, true)).toBe(false);
    expect(budget.observe(56, true)).toBe(true);

    budget.clearEnhancedWindow();
    expect(budget.observe(31, true)).toBe(false);
  });

  it('uses a measured slow-device baseline instead of an unsafe fixed cutoff', () => {
    const budget = new HandEnhancementBudget();
    expect(budget.hasBaseline()).toBe(false);
    budget.observe(60, false);
    budget.observe(62, false);
    expect(budget.hasBaseline()).toBe(true);
    expect([68, 69, 70, 68].some((value) => budget.observe(value, true))).toBe(false);
    expect(budget.observe(Number.NaN, true)).toBe(false);
  });
});
