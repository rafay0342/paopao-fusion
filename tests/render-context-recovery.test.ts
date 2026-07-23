import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CANVAS_FALLBACK_SESSION_KEY,
  RenderContextRecoveryController,
  applyRenderContextBudget,
  buildCanvasFallbackUrl,
  claimCanvasFallbackUrl,
  isCanvasFallbackRequested,
  type TimeoutScheduler,
} from '../src/game/render-context';

class ManualScheduler implements TimeoutScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  schedule(callback: () => void): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancel(handle: unknown): void {
    this.callbacks.delete(Number(handle));
  }

  flush(): void {
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    pending.forEach((callback) => callback());
  }

  size(): number { return this.callbacks.size; }
}

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('render-context recovery', () => {
  it('[AT-PF-improvement-096][phaser] closes WebGL failure recovery long-session boundary', () => {
    const scheduler = new ManualScheduler();
    let suspends = 0;
    let resumes = 0;
    let fallbacks = 0;
    const controller = new RenderContextRecoveryController({
      renderer: 'webgl',
      restoreTimeoutMs: 10_000,
      scheduler,
      onSuspend: () => { suspends += 1; },
      onResume: () => { resumes += 1; },
      onFallback: () => { fallbacks += 1; return true; },
    });

    controller.observeContextLost(true);
    expect(applyRenderContextBudget({ snapshot: { budget: 'pass' as const } }, controller.report()))
      .toMatchObject({ snapshot: { budget: 'fail' } });
    expect(controller.report()).toMatchObject({ status: 'lost', contextLost: true, lossCount: 1 });
    expect(suspends).toBe(1);

    controller.canvasRestored();
    expect(controller.report().status).toBe('restoring');
    expect(resumes).toBe(0);
    controller.rendererRestored();
    expect(controller.report()).toMatchObject({ status: 'ready', contextLost: false, restoredCount: 1 });
    expect(resumes).toBe(1);

    controller.rendererLost();
    scheduler.flush();
    controller.rendererLost();
    scheduler.flush();
    expect(fallbacks).toBe(1);
  });

  it('deduplicates canvas and Phaser loss events and resumes only after Phaser restores resources', () => {
    const scheduler = new ManualScheduler();
    let now = 1_000;
    let suspends = 0;
    let resumes = 0;
    const controller = new RenderContextRecoveryController({
      renderer: 'webgl',
      restoreTimeoutMs: 1_000,
      scheduler,
      now: () => now,
      onSuspend: () => { suspends += 1; },
      onResume: () => { resumes += 1; },
    });

    controller.rendererLost();
    controller.canvasLost();
    expect(controller.report()).toMatchObject({
      status: 'lost', contextLost: true, lossCount: 1, restoredCount: 0, recoveryDeadlineAt: 2_000,
    });
    expect(suspends).toBe(1);
    expect(scheduler.size()).toBe(1);

    controller.canvasRestored();
    expect(controller.report().status).toBe('restoring');
    expect(resumes).toBe(0);

    now = 1_400;
    controller.rendererRestored();
    expect(controller.report()).toMatchObject({
      status: 'ready', contextLost: false, lossCount: 1, restoredCount: 1, lastRestoredAt: 1_400,
    });
    expect(resumes).toBe(1);
    expect(scheduler.size()).toBe(0);
  });

  it('uses the independent GL probe and fails over once after a bounded timeout', () => {
    const scheduler = new ManualScheduler();
    let fallbacks = 0;
    const controller = new RenderContextRecoveryController({
      renderer: 'webgl',
      restoreTimeoutMs: 1_000,
      scheduler,
      onFallback: () => {
        fallbacks += 1;
        return true;
      },
    });

    expect(controller.observeContextLost(true)).toMatchObject({ status: 'lost', lossCount: 1 });
    scheduler.flush();
    expect(controller.report()).toMatchObject({
      status: 'fallback-pending', contextLost: true, fallbackAttempted: true,
    });
    controller.fallbackNow();
    controller.rendererLost();
    scheduler.flush();
    expect(fallbacks).toBe(1);
    expect(controller.report().lossCount).toBe(1);
  });

  it('never reports a Canvas renderer as context-lost and does not falsify its performance budget', () => {
    const controller = new RenderContextRecoveryController({ renderer: 'canvas' });
    controller.canvasLost();
    controller.rendererLost();
    expect(controller.observeContextLost(true)).toMatchObject({
      renderer: 'canvas', status: 'canvas', contextLost: false, lossCount: 0, restoredCount: 0,
    });

    const passing = { snapshot: { budget: 'pass' as const }, samplesObserved: 600 };
    expect(applyRenderContextBudget(passing, controller.report())).toBe(passing);
  });

  it('forces a copied performance report to fail throughout WebGL loss and recovery', () => {
    const report = { snapshot: { budget: 'pass' as const }, samplesObserved: 600 };
    const failed = applyRenderContextBudget(report, { contextLost: true });
    expect(failed.snapshot.budget).toBe('fail');
    expect(report.snapshot.budget).toBe('pass');
    expect(failed).not.toBe(report);
  });

  it('preserves URL state and claims at most one automatic Canvas reload per tab session', () => {
    const storage = new MemoryStorage();
    const href = 'https://game.example/classic/?mode=endless#board';
    const target = claimCanvasFallbackUrl(href, storage, 1_234);
    expect(target).toBe('https://game.example/classic/?mode=endless&paopao-renderer=canvas#board');
    expect(storage.getItem(CANVAS_FALLBACK_SESSION_KEY)).toBe('1234');
    expect(claimCanvasFallbackUrl(href, storage, 1_235)).toBeNull();
    expect(claimCanvasFallbackUrl(target!, new MemoryStorage(), 1_236)).toBeNull();
    expect(isCanvasFallbackRequested(new URL(target!).search)).toBe(true);
    expect(buildCanvasFallbackUrl(target!)).toBe(target);
  });

  it('still has a URL loop guard when sessionStorage is unavailable', () => {
    const storage = {
      getItem(): string | null { throw new Error('blocked'); },
      setItem(): void { throw new Error('blocked'); },
    };
    const href = 'https://game.example/play?quality=performance';
    const target = claimCanvasFallbackUrl(href, storage);
    expect(target).toBe('https://game.example/play?quality=performance&paopao-renderer=canvas');
    expect(claimCanvasFallbackUrl(target!, null)).toBeNull();
  });

  it('wires both browser and renderer events, safe input suspension, and gesture continuity resets', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const game = readFileSync(new URL('../src/scenes/GameScene.ts', import.meta.url), 'utf8');
    const endless = readFileSync(new URL('../src/scenes/EndlessScene.ts', import.meta.url), 'utf8');
    expect(main).toContain('Phaser.Renderer.Events.LOSE_WEBGL');
    expect(main).toContain('Phaser.Renderer.Events.RESTORE_WEBGL');
    expect(main).toContain("addEventListener('webglcontextlost'");
    expect(main).toContain("addEventListener('webglcontextrestored'");
    expect(main).toContain('game.input.enabled = false');
    expect(main).toContain('tracker.suspend()');
    expect(main).toContain('handWasActive = tracker.isWanted()');
    expect(main).toContain('game.loop.sleep()');
    expect(main).toContain("contextStatus: context.status");
    expect(main).toContain('contextLastLossAt: context.lostAt');
    expect(game).toContain("window.addEventListener('paopao:render-context-boundary'");
    expect(endless).toContain("window.addEventListener('paopao:render-context-boundary'");
    expect(game).toContain('this.pinchControl.resetForContinuity()');
    expect(endless).toContain('this.pinchControl.resetForContinuity()');
  });
});
