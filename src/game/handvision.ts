export type HandLightingMode = 'normal' | 'dark' | 'bright' | 'backlit' | 'low-contrast' | 'blurred';

export interface HandLightingStats {
  mean: number;
  p10: number;
  p90: number;
  darkFraction: number;
  brightFraction: number;
  gradient: number;
}

export interface HandLightingProfile {
  mode: HandLightingMode;
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface HandCapturePolicyInput {
  recentlyTracked: boolean;
  missingFrames: number;
  stableFrames: number;
  palmScale: number;
}

/**
 * Compares enhanced-frame cost with the device's own unenhanced baseline.
 * A rolling window avoids disabling useful lighting correction for one GC or
 * scheduler spike while still bounding sustained Canvas/filter overhead.
 */
export class HandEnhancementBudget {
  private normalFrameEmaMs = 0;
  private enhancedFrameMs: number[] = [];

  observe(totalFrameMs: number, enhanced: boolean): boolean {
    if (!Number.isFinite(totalFrameMs) || totalFrameMs < 0) return false;
    if (!enhanced) {
      this.normalFrameEmaMs = this.normalFrameEmaMs === 0
        ? totalFrameMs
        : this.normalFrameEmaMs * 0.82 + totalFrameMs * 0.18;
      return false;
    }

    this.enhancedFrameMs.push(totalFrameMs);
    if (this.enhancedFrameMs.length > 8) this.enhancedFrameMs.shift();
    if (this.enhancedFrameMs.length < 4) return false;

    // Slow CPUs may already take more than one 30 FPS interval for ordinary
    // MediaPipe inference. Judge enhancement against that measured baseline,
    // while retaining an absolute floor for fast devices.
    const allowedMs = Math.max(42, this.normalFrameEmaMs + 10);
    const ordered = [...this.enhancedFrameMs].sort((a, b) => a - b);
    const p75 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.75))];
    const overBudget = this.enhancedFrameMs.filter((value) => value > allowedMs).length;
    return overBudget >= 3 && p75 > allowedMs;
  }

  hasBaseline(): boolean {
    return this.normalFrameEmaMs > 0;
  }

  clearEnhancedWindow(): void {
    this.enhancedFrameMs = [];
  }

  reset(): void {
    this.normalFrameEmaMs = 0;
    this.clearEnhancedWindow();
  }
}

export const HAND_TRACKING_EDGE = 384;
export const HAND_DETAIL_FALLBACK_EDGE = 416;
export const HAND_DETAIL_EDGE = 512;
export const HAND_LOW_POWER_EDGE = 320;
export const HAND_FAR_PALM_SCALE = 0.1;
export const HAND_FAR_DETAIL_ENTER_SCALE = 0.085;
export const HAND_FAR_DETAIL_EXIT_SCALE = 0.12;
export const HAND_DETAIL_STABLE_FRAMES = 6;

const HAND_INFERENCE_TIERS = Object.freeze([
  HAND_LOW_POWER_EDGE,
  HAND_TRACKING_EDGE,
  HAND_DETAIL_EDGE,
]);
const HAND_TIER_SLOW_FRAMES = 3;
const HAND_TIER_RECOVERY_MS = 8_000;

const clamp = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
);

/**
 * Fast thermal/load governor for the bitmap sent to MediaPipe. It reacts to
 * end-to-end frame age, not inference alone, and recovers one tier at a time
 * only after a sustained healthy window to prevent resize oscillation.
 */
export class HandInferenceGovernor {
  // 384 px is the cold-start production balance. Acquisition can still ask
  // for 512, but a new/slow device is never forced through six expensive
  // detail frames before the governor learns its sustainable cadence.
  private tierIndex = HAND_INFERENCE_TIERS.indexOf(HAND_TRACKING_EDGE);
  private slowFrames = 0;
  private healthySinceMs = 0;
  private lastObservationMs = Number.NEGATIVE_INFINITY;

  observe(pipelineMs: number, targetFps: 15 | 20 | 30, timestampMs: number): number {
    if (!Number.isFinite(pipelineMs)
      || pipelineMs < 0
      || !Number.isFinite(timestampMs)
      || timestampMs <= this.lastObservationMs) return this.edgeCap();
    this.lastObservationMs = timestampMs;

    const frameBudgetMs = 1_000 / targetFps;
    const slow = pipelineMs > Math.max(42, frameBudgetMs * 1.25);
    if (slow) {
      this.healthySinceMs = 0;
      this.slowFrames++;
      if (this.slowFrames >= HAND_TIER_SLOW_FRAMES && this.tierIndex > 0) {
        this.tierIndex--;
        this.slowFrames = 0;
      }
      return this.edgeCap();
    }

    this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.healthySinceMs === 0) this.healthySinceMs = timestampMs;
    if (timestampMs - this.healthySinceMs >= HAND_TIER_RECOVERY_MS
      && this.tierIndex < HAND_INFERENCE_TIERS.length - 1) {
      this.tierIndex++;
      this.slowFrames = 0;
      this.healthySinceMs = timestampMs;
    }
    return this.edgeCap();
  }

  edgeCap(): number {
    return HAND_INFERENCE_TIERS[this.tierIndex];
  }

  reset(): void {
    this.tierIndex = HAND_INFERENCE_TIERS.indexOf(HAND_TRACKING_EDGE);
    this.slowFrames = 0;
    this.healthySinceMs = 0;
    this.lastObservationMs = Number.NEGATIVE_INFINITY;
  }
}

/** Keeps acquisition/far/dropout frames detailed without permanently taxing inference. */
export function handInferenceEdge(input: HandCapturePolicyInput): number {
  const needsDetail = !input.recentlyTracked
    || input.missingFrames > 0
    || input.stableFrames < HAND_DETAIL_STABLE_FRAMES
    || !Number.isFinite(input.palmScale)
    || input.palmScale < HAND_FAR_PALM_SCALE;
  return needsDetail ? HAND_DETAIL_EDGE : HAND_TRACKING_EDGE;
}

/** Schmitt gate preventing 512/384 resize thrash as a hand hovers near far range. */
export function handFarDetailMode(active: boolean, palmScale: number): boolean {
  if (!Number.isFinite(palmScale)) return true;
  return active
    ? palmScale < HAND_FAR_DETAIL_EXIT_SCALE
    : palmScale < HAND_FAR_DETAIL_ENTER_SCALE;
}

/** Aspect-preserving bounded resize; small camera sources are never enlarged. */
export function handInferenceSize(
  sourceWidth: number,
  sourceHeight: number,
  maximumEdge: number,
): { width: number; height: number } {
  const width = Math.max(1, Math.round(Number.isFinite(sourceWidth) ? sourceWidth : 1));
  const height = Math.max(1, Math.round(Number.isFinite(sourceHeight) ? sourceHeight : 1));
  const edge = Math.max(1, Number.isFinite(maximumEdge) ? maximumEdge : HAND_TRACKING_EDGE);
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Conservative global tone correction for frames that still contain recoverable detail. */
export function handLightingProfile(stats: HandLightingStats): HandLightingProfile {
  const mean = clamp(stats.mean, 1, 255);
  const p10 = clamp(stats.p10, 0, 255);
  const p90 = clamp(stats.p90, 0, 255);
  const darkFraction = clamp(stats.darkFraction, 0, 1);
  const brightFraction = clamp(stats.brightFraction, 0, 1);
  const gradient = clamp(stats.gradient, 0, 255);
  const range = Math.max(0, p90 - p10);

  if (p10 < 38 && p90 > 188 && darkFraction > 0.18) {
    // Compress highlights while lifting the shadow floor. Contrast above one
    // would crush the already-dark hand before MediaPipe sees it.
    return { mode: 'backlit', brightness: 1.14, contrast: 0.84, saturation: 0.94 };
  }
  if (mean < 68 || darkFraction > 0.58) {
    return {
      mode: 'dark',
      brightness: clamp(106 / mean, 1.14, 1.58),
      contrast: range < 48 ? 0.88 : 0.96,
      saturation: 0.92,
    };
  }
  if (mean > 205 || brightFraction > 0.58) {
    return {
      mode: 'bright',
      brightness: clamp(154 / mean, 0.72, 0.9),
      contrast: range < 48 ? 1.16 : 1.04,
      saturation: 0.94,
    };
  }
  // Blur is advisory. There is no safe realtime sharpening step: it amplifies
  // sensor/compression noise into false fingertip edges. Continuous camera
  // focus may still recover subsequent frames while recognition sees the
  // original pixels unchanged.
  if (range >= 52 && gradient < 7) {
    return { mode: 'blurred', brightness: 1, contrast: 1, saturation: 1 };
  }
  if (range < 52) {
    return {
      mode: 'low-contrast',
      brightness: clamp(122 / mean, 0.92, 1.22),
      contrast: 1.2,
      saturation: 0.96,
    };
  }
  return { mode: 'normal', brightness: 1, contrast: 1, saturation: 1 };
}
