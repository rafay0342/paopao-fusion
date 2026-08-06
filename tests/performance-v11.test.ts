import { describe, expect, it } from 'vitest';
import { MAP_NODES, WORLD_THEMES, nextStoryLevel } from '../src/config';
import {
  AdaptiveQualityController,
  BoundedFrameWindow,
  FRAME_SAMPLE_CAPACITY,
  PERFORMANCE_TELEMETRY_INTERVAL_MS,
  performanceTelemetryIsDue,
  resourceGrowthDetected,
  WEBGL_MEMORY_BUDGET_BYTES,
} from '../src/game/performance';

describe('V11 maps and adaptive rendering', () => {
  it('defines five dependency-backed nodes per realm and follows their story order', () => {
    expect(MAP_NODES).toHaveLength(42);
    WORLD_THEMES.forEach((world) => {
      expect(world.levels).toHaveLength(5);
      expect(nextStoryLevel(world.levels[0])).toBe(world.levels[1]);
      expect(nextStoryLevel(world.levels[3])).toBe(world.levels[4]);
      expect(world.echoLevels).toHaveLength(2);
      expect(nextStoryLevel(world.echoLevels[0])).toBe(world.echoLevels[1]);
    });
    expect(nextStoryLevel(WORLD_THEMES[5].levels[4])).toBeNull();
    expect(nextStoryLevel(WORLD_THEMES[5].echoLevels[1])).toBeNull();
  });

  it('downgrades after sustained frame pressure and upgrades only after a stable window', () => {
    const controller = new AdaptiveQualityController();
    expect(controller.evaluate({ sampledAt: 1000, averageFps: 42, p95FrameMs: 30, quality: 'ultra' })).toBe('ultra');
    expect(controller.evaluate({ sampledAt: 13000, averageFps: 42, p95FrameMs: 30, quality: 'ultra' })).toBe('balanced');
    expect(controller.evaluate({ sampledAt: 15000, averageFps: 60, p95FrameMs: 16, quality: 'balanced' })).toBe('balanced');
    expect(controller.evaluate({ sampledAt: 51000, averageFps: 60, p95FrameMs: 16, quality: 'balanced' })).toBe('ultra');
  });

  it('keeps frame history strictly bounded during long sessions and computes the real p95', () => {
    const frames = new BoundedFrameWindow(10);
    for (let index = 0; index < 1000; index += 1) {
      const frameMs = index >= 995 ? 40 : 16;
      frames.push(frameMs, 1000 / frameMs);
    }
    const summary = frames.summarize();
    expect(frames.size()).toBe(10);
    expect(summary.frameSamples).toBe(10);
    expect(summary.p95FrameMs).toBe(40);
    expect(summary.longFrames).toBe(5);
    expect(FRAME_SAMPLE_CAPACITY).toBe(600);
  });

  it('flags sustained resource growth but ignores bounded oscillation and warm-up noise', () => {
    expect(resourceGrowthDetected([10, 10, 11, 10, 11], 3)).toBe(false);
    expect(resourceGrowthDetected([100, 102, 101, 103, 102, 101, 103, 102, 101], 3)).toBe(false);
    expect(resourceGrowthDetected([100, 110, 120, 130, 140, 150, 160, 170, 180], 20)).toBe(true);
    expect(WEBGL_MEMORY_BUDGET_BYTES).toBe(1_200_000_000);
  });

  it('keeps performance telemetry disabled until the platform API is proven available', () => {
    expect(performanceTelemetryIsDue(PERFORMANCE_TELEMETRY_INTERVAL_MS * 2, 0, false)).toBe(false);
    expect(performanceTelemetryIsDue(PERFORMANCE_TELEMETRY_INTERVAL_MS - 1, 0, true)).toBe(false);
    expect(performanceTelemetryIsDue(PERFORMANCE_TELEMETRY_INTERVAL_MS, 0, true)).toBe(true);
  });
});
