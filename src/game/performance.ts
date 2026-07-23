import type Phaser from 'phaser';
import { getMeta, setQuality, type RenderQuality } from './meta';

export const FRAME_SAMPLE_CAPACITY = 600;
export const WEBGL_MEMORY_BUDGET_BYTES = 1_200_000_000;

export interface RuntimeResourceSnapshot {
  jsHeapBytes: number | null;
  peakJsHeapBytes: number | null;
  textureCount: number;
  gameObjectCount: number;
  activeSceneCount: number;
}

export interface FrameSnapshot extends RuntimeResourceSnapshot {
  sampledAt: number;
  averageFps: number;
  p95FrameMs: number;
  longFrames: number;
  frameSamples: number;
  quality: RenderQuality;
  displayHz: number;
  budget: 'warming' | 'pass' | 'fail';
}

export interface RuntimePerformanceReport {
  startedAt: number;
  samplesObserved: number;
  frameWindowCapacity: number;
  frameWindowSize: number;
  snapshot: FrameSnapshot;
  peakResources: Omit<RuntimeResourceSnapshot, 'jsHeapBytes'> & { jsHeapBytes: number | null };
  resourceGrowth: {
    textureCount: boolean;
    gameObjectCount: boolean;
    jsHeapBytes: boolean | null;
  };
}

class BoundedNumberWindow {
  private readonly values: number[];
  private cursor = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be a positive integer');
    this.values = new Array<number>(capacity);
  }

  push(value: number): void {
    if (!Number.isFinite(value)) return;
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  size(): number { return this.count; }

  toArray(): number[] {
    if (this.count < this.capacity) return this.values.slice(0, this.count);
    return [...this.values.slice(this.cursor), ...this.values.slice(0, this.cursor)];
  }
}

export class BoundedFrameWindow {
  private readonly frameTimes: BoundedNumberWindow;
  private readonly fpsValues: BoundedNumberWindow;

  constructor(readonly capacity = FRAME_SAMPLE_CAPACITY) {
    this.frameTimes = new BoundedNumberWindow(capacity);
    this.fpsValues = new BoundedNumberWindow(capacity);
  }

  push(frameMs: number, fps: number): void {
    this.frameTimes.push(Math.max(0, frameMs));
    this.fpsValues.push(Math.max(0, fps));
  }

  size(): number { return Math.min(this.frameTimes.size(), this.fpsValues.size()); }

  summarize(): Pick<FrameSnapshot, 'averageFps' | 'p95FrameMs' | 'longFrames' | 'frameSamples' | 'displayHz'> {
    const frameTimes = this.frameTimes.toArray();
    const fpsValues = this.fpsValues.toArray();
    if (!frameTimes.length || !fpsValues.length) {
      return { averageFps: 60, p95FrameMs: 16.7, longFrames: 0, frameSamples: 0, displayHz: 60 };
    }
    const ordered = [...frameTimes].sort((a, b) => a - b);
    const averageFps = fpsValues.reduce((sum, value) => sum + value, 0) / fpsValues.length;
    const p95Index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * 0.95) - 1));
    const median = ordered[Math.floor((ordered.length - 1) / 2)];
    return {
      averageFps: Math.round(averageFps * 10) / 10,
      p95FrameMs: Math.round(ordered[p95Index] * 10) / 10,
      longFrames: frameTimes.filter((value) => value > 33).length,
      frameSamples: frameTimes.length,
      displayHz: Math.max(1, Math.min(360, Math.round(1000 / Math.max(1, median)))),
    };
  }
}

const QUALITY_ORDER: readonly RenderQuality[] = ['performance', 'balanced', 'ultra'];

export class AdaptiveQualityController {
  private belowSince = 0;
  private stableSince = 0;
  private lastChangeAt = 0;
  private pendingChange: { from: RenderQuality; target: RenderQuality } | null = null;

  evaluate(
    snapshot: Pick<FrameSnapshot, 'sampledAt' | 'averageFps' | 'p95FrameMs' | 'quality'>,
    allowChange = true,
  ): RenderQuality {
    const { sampledAt, averageFps, p95FrameMs, quality } = snapshot;
    if (this.pendingChange) {
      if (quality !== this.pendingChange.from) {
        this.pendingChange = null;
      } else if (!allowChange) {
        return quality;
      } else {
        const target = this.pendingChange.target;
        this.pendingChange = null;
        this.commitChange(sampledAt);
        return target;
      }
    }
    const unhealthy = averageFps < 50 || p95FrameMs > 25;
    const healthy = averageFps >= 58 && p95FrameMs < 18;
    this.belowSince = unhealthy ? this.belowSince || sampledAt : 0;
    this.stableSince = healthy ? this.stableSince || sampledAt : 0;
    const index = QUALITY_ORDER.indexOf(quality);
    if (this.belowSince && sampledAt - this.belowSince >= 8_000 && index > 0 && sampledAt - this.lastChangeAt >= 12_000) {
      const target = QUALITY_ORDER[index - 1];
      if (!allowChange) {
        this.pendingChange = { from: quality, target };
        return quality;
      }
      this.commitChange(sampledAt);
      return target;
    }
    if (this.stableSince && sampledAt - this.stableSince >= 30_000 && index < QUALITY_ORDER.length - 1 && sampledAt - this.lastChangeAt >= 35_000) {
      if (!allowChange) return quality;
      this.commitChange(sampledAt);
      return QUALITY_ORDER[index + 1];
    }
    return quality;
  }

  private commitChange(sampledAt: number): void {
    this.lastChangeAt = sampledAt;
    this.belowSince = 0;
    this.stableSince = 0;
  }
}

type ChromiumPerformance = Performance & {
  memory?: { usedJSHeapSize?: number };
};

function finiteCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

export function resourceGrowthDetected(values: readonly number[], tolerance: number): boolean {
  if (values.length < 6) return false;
  const firstWindow = values.slice(0, Math.max(2, Math.floor(values.length / 3)));
  const lastWindow = values.slice(-Math.max(2, Math.floor(values.length / 3)));
  const average = (items: readonly number[]) => items.reduce((sum, value) => sum + value, 0) / items.length;
  const growth = average(lastWindow) - average(firstWindow);
  if (growth <= tolerance) return false;
  let rising = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] >= values[index - 1]) rising += 1;
  }
  return rising / (values.length - 1) >= 0.75;
}

function resourceSnapshot(game: Phaser.Game, peakHeap: number | null): RuntimeResourceSnapshot {
  const memory = (globalThis.performance as ChromiumPerformance | undefined)?.memory;
  const jsHeapBytes = Number.isFinite(memory?.usedJSHeapSize) ? finiteCount(memory?.usedJSHeapSize) : null;
  const textureList = (game.textures as unknown as { list?: Record<string, unknown> }).list ?? {};
  const activeScenes = game.scene.getScenes(true);
  return {
    jsHeapBytes,
    peakJsHeapBytes: jsHeapBytes == null ? peakHeap : Math.max(peakHeap ?? 0, jsHeapBytes),
    textureCount: Object.keys(textureList).length,
    gameObjectCount: activeScenes.reduce((sum, scene) => sum + finiteCount(scene.children?.list?.length), 0),
    activeSceneCount: activeScenes.length,
  };
}

class RuntimePerformanceMonitor {
  private readonly frames = new BoundedFrameWindow();
  private readonly textureHistory = new BoundedNumberWindow(120);
  private readonly objectHistory = new BoundedNumberWindow(120);
  private readonly heapHistory = new BoundedNumberWindow(120);
  private readonly startedAt = Date.now();
  private samplesObserved = 0;
  private lastEvaluateAt = 0;
  private lastTelemetryAt = 0;
  private controller = new AdaptiveQualityController();
  private peakResources = {
    jsHeapBytes: null as number | null,
    peakJsHeapBytes: null as number | null,
    textureCount: 0,
    gameObjectCount: 0,
    activeSceneCount: 0,
  };
  private snapshot: FrameSnapshot = {
    sampledAt: 0,
    averageFps: 60,
    p95FrameMs: 16.7,
    longFrames: 0,
    frameSamples: 0,
    quality: 'ultra',
    displayHz: 60,
    budget: 'warming',
    jsHeapBytes: null,
    peakJsHeapBytes: null,
    textureCount: 0,
    gameObjectCount: 0,
    activeSceneCount: 0,
  };

  sample(game: Phaser.Game): void {
    const now = performance.now();
    const frameMs = Math.max(0, Number(game.loop.delta) || 0);
    const fps = Math.max(0, Number(game.loop.actualFps) || (frameMs ? 1000 / frameMs : 60));
    this.frames.push(frameMs, fps);
    this.samplesObserved += 1;
    if (now - this.lastEvaluateAt < 5_000 || this.frames.size() < 30) return;
    this.lastEvaluateAt = now;

    const summary = this.frames.summarize();
    const resources = resourceSnapshot(game, this.peakResources.peakJsHeapBytes);
    this.textureHistory.push(resources.textureCount);
    this.objectHistory.push(resources.gameObjectCount);
    if (resources.jsHeapBytes != null) this.heapHistory.push(resources.jsHeapBytes);
    this.peakResources = {
      jsHeapBytes: resources.jsHeapBytes,
      peakJsHeapBytes: resources.peakJsHeapBytes,
      textureCount: Math.max(this.peakResources.textureCount, resources.textureCount),
      gameObjectCount: Math.max(this.peakResources.gameObjectCount, resources.gameObjectCount),
      activeSceneCount: Math.max(this.peakResources.activeSceneCount, resources.activeSceneCount),
    };
    const current = getMeta().quality;
    const warmed = summary.frameSamples >= 120;
    const memoryPass = resources.peakJsHeapBytes == null || resources.peakJsHeapBytes <= WEBGL_MEMORY_BUDGET_BYTES;
    this.snapshot = {
      sampledAt: Date.now(),
      ...summary,
      quality: current,
      budget: !warmed ? 'warming' : summary.averageFps >= 30 && summary.p95FrameMs <= 33 && memoryPass ? 'pass' : 'fail',
      ...resources,
    };

    // A downgrade is safe during gameplay because it only reduces visual work;
    // hand inference cadence and deterministic simulation clocks are separate.
    // Upgrades wait for a non-game scene to avoid introducing work mid-shot.
    const gameActive = game.scene.getScenes(true).some((scene) => scene.scene.key === 'Game');
    const candidate = this.controller.evaluate({ ...this.snapshot, sampledAt: now }, true);
    const next = gameActive && QUALITY_ORDER.indexOf(candidate) > QUALITY_ORDER.indexOf(current) ? current : candidate;
    if (next !== current) {
      setQuality(next);
      this.snapshot.quality = next;
      window.dispatchEvent(new CustomEvent('paopao:quality-adapted', { detail: this.current() }));
    }
    if (now - this.lastTelemetryAt >= 30_000) {
      this.lastTelemetryAt = now;
      void fetch('/api/telemetry/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ events: [{
          type: 'performance',
          averageFps: this.snapshot.averageFps,
          p95FrameMs: this.snapshot.p95FrameMs,
          longFrames: this.snapshot.longFrames,
          quality: this.snapshot.quality,
          displayHz: this.snapshot.displayHz,
        }] }),
      }).catch(() => undefined);
    }
  }

  current(): FrameSnapshot { return { ...this.snapshot }; }

  report(): RuntimePerformanceReport {
    const textures = this.textureHistory.toArray();
    const objects = this.objectHistory.toArray();
    const heaps = this.heapHistory.toArray();
    return {
      startedAt: this.startedAt,
      samplesObserved: this.samplesObserved,
      frameWindowCapacity: this.frames.capacity,
      frameWindowSize: this.frames.size(),
      snapshot: this.current(),
      peakResources: { ...this.peakResources },
      resourceGrowth: {
        textureCount: resourceGrowthDetected(textures, 3),
        gameObjectCount: resourceGrowthDetected(objects, 24),
        jsHeapBytes: heaps.length < 6 ? null : resourceGrowthDetected(heaps, 32 * 1024 * 1024),
      },
    };
  }
}

export const runtimePerformance = new RuntimePerformanceMonitor();
