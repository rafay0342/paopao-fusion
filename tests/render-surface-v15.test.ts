import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { START: 'scene-start', CREATE: 'scene-create' } },
    Core: { Events: { DESTROY: 'game-destroy' } },
  },
}));

import {
  currentRenderSurfaceResolution,
  installLogicalRenderSurface,
  normalizeRenderSurfaceEnvironment,
  selectRenderSurfaceResolution,
} from '../src/game/render-surface';

class EventHarness {
  private readonly listeners = new Map<string, Set<() => void>>();

  readonly on = vi.fn((event: string, listener: () => void) => {
    const listeners = this.listeners.get(event) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  });

  readonly once = vi.fn((event: string, listener: () => void) => {
    const once = (): void => {
      this.off(event, once);
      listener();
    };
    return this.on(event, once);
  });

  readonly off = vi.fn((event: string, listener: () => void) => {
    this.listeners.get(event)?.delete(listener);
    return this;
  });

  emit(event: string): void {
    [...(this.listeners.get(event) ?? [])].forEach((listener) => listener());
  }
}

function sceneHarness(active: boolean) {
  const events = new EventHarness();
  const camera = {
    setViewport: vi.fn(),
    setZoom: vi.fn(),
    centerOn: vi.fn(),
  };
  camera.setViewport.mockReturnValue(camera);
  camera.setZoom.mockReturnValue(camera);
  camera.centerOn.mockReturnValue(camera);
  return {
    events,
    cameras: { main: camera },
    scene: { isActive: vi.fn(() => active) },
    camera,
  };
}

describe('V15 capability-bounded render surface selection', () => {
  it('normalizes hostile capability values into finite bounded inputs', () => {
    expect(normalizeRenderSurfaceEnvironment({
      devicePixelRatio: Number.POSITIVE_INFINITY,
      hardwareConcurrency: -12,
      deviceMemoryGb: Number.NaN,
      viewportPixels: 0,
    })).toEqual({
      devicePixelRatio: 1,
      hardwareConcurrency: 2,
      deviceMemoryGb: null,
      viewportPixels: 921_600,
    });

    expect(normalizeRenderSurfaceEnvironment({
      devicePixelRatio: 9,
      hardwareConcurrency: 91.8,
      deviceMemoryGb: 128,
      viewportPixels: 400_000_000,
    })).toEqual({
      devicePixelRatio: 4,
      hardwareConcurrency: 64,
      deviceMemoryGb: 64,
      viewportPixels: 100_000_000,
    });
  });

  it('keeps performance at 1x and only grants balanced 1.25x to capable displays', () => {
    const strong = {
      devicePixelRatio: 3,
      hardwareConcurrency: 12,
      deviceMemoryGb: 16,
      viewportPixels: 2_073_600,
    };
    expect(selectRenderSurfaceResolution('performance', strong)).toBe(1);
    expect(selectRenderSurfaceResolution('balanced', strong)).toBe(1.25);
    expect(selectRenderSurfaceResolution('balanced', {
      ...strong,
      devicePixelRatio: 1.19,
    })).toBe(1);
    expect(selectRenderSurfaceResolution('balanced', {
      ...strong,
      hardwareConcurrency: 3,
    })).toBe(1);
  });

  it('selects Ultra 1.5x only inside CPU, memory and framebuffer budgets', () => {
    const strong = {
      devicePixelRatio: 2,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      viewportPixels: 3_686_400,
    };
    expect(selectRenderSurfaceResolution('ultra', strong)).toBe(1.5);
    expect(selectRenderSurfaceResolution('ultra', {
      ...strong,
      deviceMemoryGb: null,
    })).toBe(1.5);

    expect(selectRenderSurfaceResolution('ultra', {
      ...strong,
      deviceMemoryGb: 3,
    })).toBe(1.25);
    expect(selectRenderSurfaceResolution('ultra', {
      ...strong,
      viewportPixels: 12_000_001,
    })).toBe(1.25);
    expect(selectRenderSurfaceResolution('ultra', {
      ...strong,
      devicePixelRatio: 1.14,
    })).toBe(1);
    expect(selectRenderSurfaceResolution('ultra', {
      ...strong,
      hardwareConcurrency: 2,
    })).toBe(1);
  });

  it('uses the 1x fail-closed surface outside a browser runtime', () => {
    expect(currentRenderSurfaceResolution('ultra')).toBe(1);
  });

  it('preserves the logical plane for active and newly started scenes and removes hooks', () => {
    const active = sceneHarness(true);
    const sleeping = sceneHarness(false);
    const gameEvents = new EventHarness();
    const game = {
      scene: { scenes: [active, sleeping] },
      canvas: { dataset: {} as Record<string, string> },
      events: gameEvents,
    };

    installLogicalRenderSurface(
      game as unknown as Parameters<typeof installLogicalRenderSurface>[0],
      1.5,
    );

    expect(game.canvas.dataset.paopaoRenderSurface).toBe('1.5');
    expect(active.camera.setViewport).toHaveBeenCalledWith(0, 0, 1_080, 1_920);
    expect(active.camera.setZoom).toHaveBeenCalledOnce();
    expect(active.camera.setZoom).toHaveBeenLastCalledWith(1.5);
    expect(active.camera.centerOn).toHaveBeenLastCalledWith(360, 640);
    expect(sleeping.camera.setZoom).toHaveBeenCalledOnce();
    expect(active.events.on).toHaveBeenCalledWith('scene-start', expect.any(Function));
    expect(sleeping.events.on).toHaveBeenCalledWith('scene-start', expect.any(Function));
    expect(active.events.on).toHaveBeenCalledWith('scene-create', expect.any(Function));
    expect(sleeping.events.on).toHaveBeenCalledWith('scene-create', expect.any(Function));

    sleeping.events.emit('scene-start');
    sleeping.events.emit('scene-create');
    expect(sleeping.camera.setZoom).toHaveBeenCalledTimes(3);
    expect(sleeping.camera.setZoom).toHaveBeenLastCalledWith(1.5);
    expect(sleeping.camera.centerOn).toHaveBeenLastCalledWith(360, 640);

    gameEvents.emit('game-destroy');
    expect(active.events.off).toHaveBeenCalledWith('scene-start', expect.any(Function));
    expect(sleeping.events.off).toHaveBeenCalledWith('scene-start', expect.any(Function));
    expect(active.events.off).toHaveBeenCalledWith('scene-create', expect.any(Function));
    expect(sleeping.events.off).toHaveBeenCalledWith('scene-create', expect.any(Function));
  });
});
