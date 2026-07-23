export const CANVAS_FALLBACK_QUERY = 'paopao-renderer';
export const CANVAS_FALLBACK_VALUE = 'canvas';
export const CANVAS_FALLBACK_SESSION_KEY = 'paopao:webgl-canvas-fallback:v1';
export const WEBGL_RESTORE_TIMEOUT_MS = 10_000;

export type RendererKind = 'webgl' | 'canvas';
export type RenderContextStatus =
  | 'ready'
  | 'lost'
  | 'restoring'
  | 'fallback-pending'
  | 'fallback-blocked'
  | 'canvas';

export type RenderContextEventSource = 'canvas' | 'renderer' | 'probe' | null;

export interface RenderContextReport {
  renderer: RendererKind;
  status: RenderContextStatus;
  contextLost: boolean;
  lossCount: number;
  restoredCount: number;
  lostAt: number | null;
  lastRestoredAt: number | null;
  recoveryDeadlineAt: number | null;
  fallbackAttempted: boolean;
  lastEventSource: RenderContextEventSource;
}

export interface TimeoutScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface RenderContextControllerOptions {
  renderer: RendererKind;
  restoreTimeoutMs?: number;
  now?: () => number;
  scheduler?: TimeoutScheduler;
  onSuspend?: () => void;
  onResume?: () => void;
  /** Return true only when a compatibility navigation was started. */
  onFallback?: () => boolean;
  onStatus?: (report: RenderContextReport) => void;
}

const browserScheduler: TimeoutScheduler = {
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle as number),
};

function isUnavailable(status: RenderContextStatus): boolean {
  return status === 'lost'
    || status === 'restoring'
    || status === 'fallback-pending'
    || status === 'fallback-blocked';
}

/**
 * Pure, injected state controller for a single renderer lifetime. Canvas mode
 * is deliberately inert: it must never inherit a stale WebGL failure.
 */
export class RenderContextRecoveryController {
  private readonly now: () => number;
  private readonly scheduler: TimeoutScheduler;
  private readonly restoreTimeoutMs: number;
  private readonly onSuspend: () => void;
  private readonly onResume: () => void;
  private readonly onFallback: () => boolean;
  private readonly onStatus: (report: RenderContextReport) => void;
  private status: RenderContextStatus;
  private lossCount = 0;
  private restoredCount = 0;
  private lostAt: number | null = null;
  private lastRestoredAt: number | null = null;
  private recoveryDeadlineAt: number | null = null;
  private fallbackAttempted = false;
  private lastEventSource: RenderContextEventSource = null;
  private recoveryTimer: unknown = null;
  private suspended = false;
  private destroyed = false;

  constructor(private readonly options: RenderContextControllerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.scheduler = options.scheduler ?? browserScheduler;
    this.restoreTimeoutMs = Math.max(1_000, options.restoreTimeoutMs ?? WEBGL_RESTORE_TIMEOUT_MS);
    this.onSuspend = options.onSuspend ?? (() => undefined);
    this.onResume = options.onResume ?? (() => undefined);
    this.onFallback = options.onFallback ?? (() => false);
    this.onStatus = options.onStatus ?? (() => undefined);
    this.status = options.renderer === 'canvas' ? 'canvas' : 'ready';
  }

  /** DOM loss is a fallback listener for browsers where Phaser's event is delayed. */
  canvasLost(): void { this.markLost('canvas'); }

  /** Phaser renderer loss is authoritative but idempotent with the DOM event. */
  rendererLost(): void { this.markLost('renderer'); }

  /** The DOM restore fires before Phaser has rebuilt resources; do not resume yet. */
  canvasRestored(): void {
    if (this.destroyed || this.options.renderer === 'canvas' || !isUnavailable(this.status)) return;
    if (this.status === 'lost') {
      this.status = 'restoring';
      this.lastEventSource = 'canvas';
      this.publish();
    }
  }

  /** Resume only after Phaser has recreated textures, buffers and pipelines. */
  rendererRestored(): void {
    if (this.destroyed || this.options.renderer === 'canvas' || !isUnavailable(this.status)) return;
    if (this.status === 'fallback-pending') return;
    this.clearRecoveryTimer();
    this.status = 'ready';
    this.restoredCount += 1;
    this.lastRestoredAt = this.now();
    this.recoveryDeadlineAt = null;
    this.lastEventSource = 'renderer';
    if (this.suspended) {
      this.suspended = false;
      this.onResume();
    }
    this.publish();
  }

  /** Independent GL probing catches a missed event and closes diagnostic gaps. */
  observeContextLost(contextLost: boolean): RenderContextReport {
    if (this.options.renderer === 'webgl' && contextLost) this.markLost('probe');
    else if (this.options.renderer === 'webgl' && this.status === 'lost') {
      // A clear GL flag alone is not enough to resume: Phaser still has to
      // rebuild every GPU resource and emit its renderer-restored event.
      this.status = 'restoring';
      this.lastEventSource = 'probe';
      this.publish();
    }
    return this.report();
  }

  fallbackNow(): void {
    if (this.destroyed
      || this.options.renderer === 'canvas'
      || !isUnavailable(this.status)
      || this.fallbackAttempted) return;
    this.clearRecoveryTimer();
    this.fallbackAttempted = true;
    this.recoveryDeadlineAt = null;
    this.status = this.onFallback() ? 'fallback-pending' : 'fallback-blocked';
    this.publish();
  }

  report(): RenderContextReport {
    return {
      renderer: this.options.renderer,
      status: this.status,
      contextLost: isUnavailable(this.status),
      lossCount: this.lossCount,
      restoredCount: this.restoredCount,
      lostAt: this.lostAt,
      lastRestoredAt: this.lastRestoredAt,
      recoveryDeadlineAt: this.recoveryDeadlineAt,
      fallbackAttempted: this.fallbackAttempted,
      lastEventSource: this.lastEventSource,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.clearRecoveryTimer();
  }

  private markLost(source: Exclude<RenderContextEventSource, null>): void {
    if (this.destroyed || this.options.renderer === 'canvas') return;
    if (isUnavailable(this.status)) {
      this.lastEventSource = source;
      return;
    }
    const now = this.now();
    this.status = 'lost';
    this.lossCount += 1;
    this.lostAt = now;
    this.recoveryDeadlineAt = now + this.restoreTimeoutMs;
    this.lastEventSource = source;
    if (!this.suspended) {
      this.suspended = true;
      this.onSuspend();
    }
    this.recoveryTimer = this.scheduler.schedule(() => {
      this.recoveryTimer = null;
      this.fallbackNow();
    }, this.restoreTimeoutMs);
    this.publish();
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer === null) return;
    this.scheduler.cancel(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private publish(): void {
    this.onStatus(this.report());
  }
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isCanvasFallbackRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get(CANVAS_FALLBACK_QUERY) === CANVAS_FALLBACK_VALUE;
  } catch {
    return false;
  }
}

export function buildCanvasFallbackUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set(CANVAS_FALLBACK_QUERY, CANVAS_FALLBACK_VALUE);
  return url.toString();
}

/** Claims the one automatic reload allowed in this browser-tab session. */
export function claimCanvasFallbackUrl(
  href: string,
  storage: SessionStorageLike | null,
  now = Date.now(),
): string | null {
  const target = buildCanvasFallbackUrl(href);
  if (isCanvasFallbackRequested(new URL(href).search)) return null;
  if (storage) {
    try {
      if (storage.getItem(CANVAS_FALLBACK_SESSION_KEY) !== null) return null;
      // The timestamp is diagnostic only; key presence is the loop guard.
      storage.setItem(CANVAS_FALLBACK_SESSION_KEY, String(now));
    } catch {
      // URL mode remains its own loop guard when sessionStorage is blocked.
    }
  }
  return target;
}

export function applyRenderContextBudget<
  T extends { snapshot: { budget: 'warming' | 'pass' | 'fail' } },
>(report: T, context: Pick<RenderContextReport, 'contextLost'>): T {
  if (!context.contextLost || report.snapshot.budget === 'fail') return report;
  return {
    ...report,
    snapshot: { ...report.snapshot, budget: 'fail' },
  };
}

export interface RenderRecoveryOverlay {
  update(report: RenderContextReport): void;
  remove(): void;
}

/** Accessible DOM status remains visible even while Phaser rendering is gone. */
export function createRenderRecoveryOverlay(
  documentRef: Document,
  useCanvasFallback: () => void,
): RenderRecoveryOverlay {
  let root: HTMLDivElement | null = null;
  let title: HTMLHeadingElement | null = null;
  let message: HTMLParagraphElement | null = null;
  let previousFocus: HTMLElement | null = null;

  const ensure = (): void => {
    if (root) return;
    previousFocus = documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
    root = documentRef.createElement('div');
    root.id = 'paopao-render-recovery';
    root.setAttribute('role', 'alert');
    root.setAttribute('aria-live', 'assertive');
    root.setAttribute('aria-atomic', 'true');
    root.setAttribute('aria-busy', 'true');
    root.tabIndex = -1;
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center',
      padding: '24px', color: '#f7edcf', background: 'rgba(3, 5, 16, 0.96)',
      fontFamily: '"Fusion Sans", "Avenir Next", Arial, sans-serif', textAlign: 'center',
    });
    const panel = documentRef.createElement('section');
    Object.assign(panel.style, {
      width: 'min(92vw, 520px)', padding: '30px 26px', border: '1px solid rgba(98, 243, 239, .55)',
      borderRadius: '18px', background: 'linear-gradient(180deg, #10152d, #090d20)',
      boxShadow: '0 24px 90px rgba(0, 0, 0, .7)',
    });
    title = documentRef.createElement('h1');
    title.style.cssText = 'margin:0 0 12px;font-size:24px;line-height:1.2;color:#ffe39a';
    message = documentRef.createElement('p');
    message.style.cssText = 'margin:0 auto 22px;max-width:430px;font-size:15px;line-height:1.6;color:#cbd9ea';
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.textContent = 'USE COMPATIBILITY MODE';
    button.setAttribute('aria-label', 'Reload PaoPao Fusion using the Canvas compatibility renderer');
    button.style.cssText = [
      'min-height:48px', 'padding:0 20px', 'border:1px solid #ffe39a', 'border-radius:999px',
      'background:#171d38', 'color:#fff3c5', 'font:700 13px "Fusion Sans",Arial,sans-serif',
      'letter-spacing:.08em', 'cursor:pointer',
    ].join(';');
    button.addEventListener('click', useCanvasFallback);
    panel.append(title, message, button);
    root.append(panel);
    documentRef.body.append(root);
    try { root.focus({ preventScroll: true }); } catch { root.focus(); }
  };

  const remove = (): void => {
    root?.remove();
    root = null;
    title = null;
    message = null;
    if (previousFocus?.isConnected) {
      try { previousFocus.focus({ preventScroll: true }); } catch { previousFocus.focus(); }
    }
    previousFocus = null;
  };

  return {
    update(report): void {
      if (!report.contextLost) {
        remove();
        return;
      }
      ensure();
      if (!title || !message || !root) return;
      if (report.status === 'restoring') {
        title.textContent = 'RESTORING GRAPHICS';
        message.textContent = 'The browser restored the graphics device. PaoPao is rebuilding the board safely.';
      } else if (report.status === 'fallback-pending') {
        title.textContent = 'SWITCHING RENDERER';
        message.textContent = 'Loading Canvas compatibility mode. Your persistent save remains on this device.';
      } else if (report.status === 'fallback-blocked') {
        title.textContent = 'GRAPHICS RECOVERY NEEDED';
        message.textContent = 'Automatic recovery was already attempted in this tab. Use compatibility mode below.';
      } else {
        title.textContent = 'GRAPHICS PAUSED';
        message.textContent = 'The browser graphics device was interrupted. Gameplay and hand input are safely paused while it recovers.';
      }
      root.setAttribute('aria-busy', report.status === 'fallback-blocked' ? 'false' : 'true');
    },
    remove,
  };
}
