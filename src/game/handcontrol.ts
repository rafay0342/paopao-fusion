export interface HandPoint {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
// A corrupt landmark must never propagate NaN into Phaser coordinates. The
// neutral centre is safer than snapping an uncertain hand to a screen edge.
const clamp01 = (value: number): number => clamp(Number.isFinite(value) ? value : 0.5, 0, 1);

class LowPassFilter {
  private value: number | null = null;

  filter(next: number, alpha: number): number {
    this.value = this.value === null ? next : alpha * next + (1 - alpha) * this.value;
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

/**
 * A time-aware One Euro filter. It removes stationary landmark shimmer while
 * opening up automatically during fast movement, so aiming stays responsive.
 */
export class OneEuroFilter {
  private readonly signal = new LowPassFilter();
  private readonly derivative = new LowPassFilter();
  private lastTimeMs: number | null = null;
  private lastRaw: number | null = null;

  constructor(
    private readonly minCutoff = 1.7,
    private readonly beta = 0.32,
    private readonly derivativeCutoff = 1,
  ) {}

  private alpha(cutoff: number, dtSeconds: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dtSeconds);
  }

  filter(value: number, timeMs: number): number {
    if (this.lastTimeMs === null || this.lastRaw === null) {
      this.lastTimeMs = timeMs;
      this.lastRaw = value;
      return this.signal.filter(value, 1);
    }

    const dt = clamp((timeMs - this.lastTimeMs) / 1000, 1 / 120, 0.12);
    const rawDerivative = (value - this.lastRaw) / dt;
    const filteredDerivative = this.derivative.filter(rawDerivative, this.alpha(this.derivativeCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative);
    const filtered = this.signal.filter(value, this.alpha(cutoff, dt));
    this.lastTimeMs = timeMs;
    this.lastRaw = value;
    return filtered;
  }

  reset(): void {
    this.signal.reset();
    this.derivative.reset();
    this.lastTimeMs = null;
    this.lastRaw = null;
  }
}

export class HandAimFilter {
  // Fast motion opens the filter aggressively while a still fingertip remains
  // damped. This avoids stacking a full recognition-frame of aim lag on top of
  // MediaPipe and the final Phaser interpolation.
  private readonly x: OneEuroFilter;
  private readonly y: OneEuroFilter;

  constructor(stability: 'balanced' | 'heavy' = 'balanced') {
    this.x = stability === 'heavy' ? new OneEuroFilter(1.35, 2.25, 1) : new OneEuroFilter(2.4, 4.2, 1.2);
    this.y = stability === 'heavy' ? new OneEuroFilter(1.2, 2.1, 1) : new OneEuroFilter(2.2, 4, 1.2);
  }

  filter(point: HandPoint, timeMs: number): HandPoint {
    return {
      x: clamp01(this.x.filter(point.x, timeMs)),
      y: clamp01(this.y.filter(point.y, timeMs)),
    };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
  }
}

/**
 * Bounded render-time prediction for a camera cursor.
 *
 * MediaPipe results arrive less often than Phaser renders. This predictor uses
 * only a few milliseconds of measured fingertip velocity to fill that visual
 * gap; gesture decisions continue to consume the original timestamped
 * landmarks. Prediction stops quickly after loss and can never leave 0..1.
 */
export class HandAimPredictor {
  private point: HandPoint | null = null;
  private velocity: HandPoint = { x: 0, y: 0 };
  private sampleAtMs = Number.NEGATIVE_INFINITY;
  private receivedAtMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly maximumHorizonMs = 30,
    private readonly maximumLead = 0.035,
    private readonly staleAfterMs = 180,
  ) {}

  push(point: HandPoint, timestampMs: number, receivedTimestampMs = timestampMs): void {
    const next = { x: clamp01(point.x), y: clamp01(point.y) };
    if (!Number.isFinite(timestampMs) || !Number.isFinite(receivedTimestampMs)) return;
    if (!this.point || !Number.isFinite(this.sampleAtMs) || timestampMs - this.sampleAtMs > this.staleAfterMs) {
      this.point = next;
      this.velocity = { x: 0, y: 0 };
      this.sampleAtMs = timestampMs;
      this.receivedAtMs = receivedTimestampMs;
      return;
    }
    if (timestampMs <= this.sampleAtMs) return;

    const elapsedMs = clamp(timestampMs - this.sampleAtMs, 8, 140);
    const elapsedSeconds = elapsedMs / 1_000;
    const rawVelocity = {
      x: clamp((next.x - this.point.x) / elapsedSeconds, -4.5, 4.5),
      y: clamp((next.y - this.point.y) / elapsedSeconds, -4.5, 4.5),
    };
    const reversal = rawVelocity.x * this.velocity.x < 0 || rawVelocity.y * this.velocity.y < 0;
    const follow = reversal
      ? 0.82
      : 1 - Math.exp(-elapsedMs / 34);
    this.velocity.x += (rawVelocity.x - this.velocity.x) * follow;
    this.velocity.y += (rawVelocity.y - this.velocity.y) * follow;
    this.point = next;
    this.sampleAtMs = timestampMs;
    this.receivedAtMs = receivedTimestampMs;
  }

  predict(nowMs: number): HandPoint | null {
    if (!this.point
      || !Number.isFinite(nowMs)
      || !Number.isFinite(this.sampleAtMs)
      || !Number.isFinite(this.receivedAtMs)) return null;
    const receivedAgeMs = Math.max(0, nowMs - this.receivedAtMs);
    if (receivedAgeMs > this.staleAfterMs) return null;
    const ageMs = Math.max(0, nowMs - this.sampleAtMs);
    const horizonSeconds = Math.min(ageMs, this.maximumHorizonMs) / 1_000;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const leadScale = speed > 0
      ? Math.min(1, this.maximumLead / Math.max(0.000_001, speed * horizonSeconds))
      : 0;
    return {
      x: clamp01(this.point.x + this.velocity.x * horizonSeconds * leadScale),
      y: clamp01(this.point.y + this.velocity.y * horizonSeconds * leadScale),
    };
  }

  reset(): void {
    this.point = null;
    this.velocity = { x: 0, y: 0 };
    this.sampleAtMs = Number.NEGATIVE_INFINITY;
    this.receivedAtMs = Number.NEGATIVE_INFINITY;
  }
}

export type HandGestureContinuityDecision = 'usable' | 'hold' | 'cancel';

/**
 * A single uncertain recognition may not create an edge, but it also should not
 * destroy a real pinch already in progress. Five consecutive uncertain frames
 * (or 320 ms) cancel fail-closed.
 */
export class HandGestureContinuityGate {
  private uncertainFrames = 0;
  private uncertainSinceMs = 0;

  observe(usable: boolean, timestampMs: number): HandGestureContinuityDecision {
    if (usable) {
      this.reset();
      return 'usable';
    }
    if (!Number.isFinite(timestampMs)) {
      this.reset();
      return 'cancel';
    }
    if (this.uncertainFrames === 0) this.uncertainSinceMs = timestampMs;
    this.uncertainFrames++;
    if (this.uncertainFrames >= 5 || timestampMs - this.uncertainSinceMs >= 320) {
      this.reset();
      return 'cancel';
    }
    return 'hold';
  }

  reset(): void {
    this.uncertainFrames = 0;
    this.uncertainSinceMs = 0;
  }
}

export interface FilterableLandmark {
  x: number;
  y: number;
  z: number;
}

/**
 * Independent adaptive filters for all 21 hand points. Gameplay aim still uses
 * the raw index ray through HandAimFilter; these stabilised points are used for
 * palm geometry and the preview skeleton so fingers do not shimmer in place.
 */
export class HandLandmarkFilter {
  private filters: Array<{ x: OneEuroFilter; y: OneEuroFilter; z: OneEuroFilter }> = [];

  filter(landmarks: readonly FilterableLandmark[], timeMs: number): FilterableLandmark[] {
    while (this.filters.length < landmarks.length) {
      this.filters.push({
        x: new OneEuroFilter(3.4, 1.25, 1.2),
        y: new OneEuroFilter(3.2, 1.15, 1.2),
        z: new OneEuroFilter(2.2, 0.7, 1),
      });
    }
    return landmarks.map((point, index) => ({
      x: this.filters[index].x.filter(point.x, timeMs),
      y: this.filters[index].y.filter(point.y, timeMs),
      z: this.filters[index].z.filter(point.z, timeMs),
    }));
  }

  reset(): void {
    this.filters.forEach((axis) => {
      axis.x.reset();
      axis.y.reset();
      axis.z.reset();
    });
  }
}

export interface HandGridCell {
  row: number;
  col: number;
}

export interface HandGridDragFrame {
  timestampMs: number;
  cell: HandGridCell | null;
  palmX: number;
  palmY: number;
  palmScale: number;
  /** True when raw camera X must be mirrored to match the on-screen cursor. */
  mirrorX: boolean;
}

export interface HandGridSwap {
  from: HandGridCell;
  to: HandGridCell;
}

const sameGridCell = (first: HandGridCell | null, second: HandGridCell | null): boolean => (
  Boolean(first && second && first.row === second.row && first.col === second.col)
);

/**
 * Grid-specific pinch drag authority.
 *
 * Fingertips move as thumb and index close, so using the cursor displacement
 * itself can manufacture a swap. This controller locks the source from the
 * last measured open-hand cells, then uses palm displacement (normalised by
 * live palm size) with a Schmitt threshold and two-sample confirmation.
 * Prediction is intentionally absent: callers may predict only the ghost.
 */
export class HandDragSwapController {
  private readonly openHistory: Array<{ cell: HandGridCell; timestampMs: number }> = [];
  private source: HandGridCell | null = null;
  private anchor: { x: number; y: number; scale: number } | null = null;
  private candidate: HandGridCell | null = null;
  private candidateFrames = 0;
  private candidateAtMs = 0;
  private candidateUncertainFrames = 0;
  private candidateContradictionFrames = 0;

  constructor(
    private readonly engageThreshold = 0.3,
    private readonly releaseThreshold = 0.19,
    private readonly dominanceRatio = 1.28,
  ) {}

  observeOpen(frame: HandGridDragFrame): void {
    if (!frame.cell || !Number.isFinite(frame.timestampMs)) return;
    this.openHistory.push({
      cell: { ...frame.cell },
      timestampMs: frame.timestampMs,
    });
    while (this.openHistory.length > 3) this.openHistory.shift();
  }

  latch(frame: HandGridDragFrame): HandGridCell | null {
    const fallback = frame.cell ? { ...frame.cell } : null;
    let source = fallback;
    // Fingertips shift while closing. Use only the last two genuinely recent,
    // agreeing open observations; a stale three-frame majority must never
    // override the cell currently under the hand.
    const recent = this.openHistory
      .filter(({ timestampMs }) => frame.timestampMs - timestampMs <= 100)
      .slice(-2);
    if (recent.length === 2 && sameGridCell(recent[0].cell, recent[1].cell)) {
      source = { ...recent[1].cell };
    }
    if (!source
      || ![frame.palmX, frame.palmY, frame.palmScale].every(Number.isFinite)
      || frame.palmScale <= 0.001) {
      this.cancel();
      return null;
    }
    this.source = { ...source };
    this.anchor = { x: frame.palmX, y: frame.palmY, scale: frame.palmScale };
    this.candidate = null;
    this.candidateFrames = 0;
    this.candidateAtMs = 0;
    this.candidateUncertainFrames = 0;
    this.candidateContradictionFrames = 0;
    return { ...this.source };
  }

  updateContact(frame: HandGridDragFrame): HandGridCell | null {
    if (!this.source || !this.anchor) return null;
    if (![frame.timestampMs, frame.palmX, frame.palmY, frame.palmScale].every(Number.isFinite)) {
      return this.holdConfirmedCandidateThroughUncertainty();
    }
    const scale = Math.max(0.001, (this.anchor.scale + frame.palmScale) * 0.5);
    // Palm landmarks stay in camera space. Respect the same horizontal mirror
    // contract as the cursor so drag direction never changes between settings.
    const dx = (frame.mirrorX ? -1 : 1) * (frame.palmX - this.anchor.x) / scale;
    const dy = (frame.palmY - this.anchor.y) / scale;
    const absoluteX = Math.abs(dx);
    const absoluteY = Math.abs(dy);
    const magnitude = Math.max(absoluteX, absoluteY);
    if (magnitude <= this.releaseThreshold) {
      // Once a deliberate one-cell swipe is confirmed, relaxing the palm while
      // separating the fingertips must not erase the pending move.
      if (this.candidateFrames >= 2 && this.candidate) {
        this.candidateUncertainFrames = 0;
        this.candidateContradictionFrames = 0;
        return { ...this.candidate };
      }
      this.clearCandidate();
      return null;
    }
    if (magnitude < this.engageThreshold) {
      this.candidateUncertainFrames = 0;
      this.candidateContradictionFrames = 0;
      return this.candidate ? { ...this.candidate } : null;
    }

    let next: HandGridCell | null = null;
    if (absoluteX >= absoluteY * this.dominanceRatio) {
      next = { row: this.source.row, col: this.source.col + (dx > 0 ? 1 : -1) };
    } else if (absoluteY >= absoluteX * this.dominanceRatio) {
      next = { row: this.source.row + (dy > 0 ? 1 : -1), col: this.source.col };
    }
    if (!next || next.row < 0 || next.row >= 8 || next.col < 0 || next.col >= 8) {
      return this.rejectConfirmedCandidateDirection();
    }
    if (this.candidateFrames >= 2 && this.candidate && !sameGridCell(next, this.candidate)) {
      return this.rejectConfirmedCandidateDirection();
    }
    if (!sameGridCell(next, this.candidate)
      || (this.candidateFrames < 2
        && this.candidateAtMs > 0
        && frame.timestampMs - this.candidateAtMs > 170)) {
      this.candidate = next;
      this.candidateFrames = 1;
    } else {
      this.candidateFrames += 1;
    }
    this.candidateUncertainFrames = 0;
    this.candidateContradictionFrames = 0;
    this.candidateAtMs = frame.timestampMs;
    return this.candidateFrames >= 2 ? { ...next } : null;
  }

  release(): HandGridSwap | null {
    const result = this.source && this.candidate && this.candidateFrames >= 2
      ? { from: { ...this.source }, to: { ...this.candidate } }
      : null;
    this.cancel();
    return result;
  }

  cancel(): void {
    this.source = null;
    this.anchor = null;
    this.clearCandidate();
  }

  private clearCandidate(): void {
    this.candidate = null;
    this.candidateFrames = 0;
    this.candidateAtMs = 0;
    this.candidateUncertainFrames = 0;
    this.candidateContradictionFrames = 0;
  }

  private holdConfirmedCandidateThroughUncertainty(): HandGridCell | null {
    if (this.candidateFrames < 2 || !this.candidate) {
      this.clearCandidate();
      return null;
    }
    this.candidateUncertainFrames++;
    if (this.candidateUncertainFrames >= 2) {
      this.clearCandidate();
      return null;
    }
    return { ...this.candidate };
  }

  private rejectConfirmedCandidateDirection(): HandGridCell | null {
    if (this.candidateFrames < 2 || !this.candidate) {
      this.clearCandidate();
      return null;
    }
    this.candidateUncertainFrames = 0;
    this.candidateContradictionFrames++;
    if (this.candidateContradictionFrames >= 2) {
      this.clearCandidate();
      return null;
    }
    return { ...this.candidate };
  }
}

/** Converts an unmirrored camera landmark into a comfortable full-screen range. */
export function normaliseCameraPoint(point: HandPoint): HandPoint {
  // Keeping a small camera margin prevents ordinary hand movement from being
  // trapped at the edges while still allowing the entire game field to reach.
  const mirroredX = 1 - point.x;
  return {
    x: clamp01((mirroredX - 0.12) / 0.76),
    y: clamp01((point.y - 0.1) / 0.8),
  };
}

/** Maps hand space to the useful aim field, never below the launcher. */
export function mapHandToAim(
  point: HandPoint,
  width: number,
  top: number,
  bottom: number,
): HandPoint {
  const marginX = width * 0.035;
  return {
    x: marginX + clamp01(point.x) * (width - marginX * 2),
    y: top + clamp01(point.y) * Math.max(1, bottom - top),
  };
}

export interface PinchGestureFrame {
  timestampMs: number;
  rawPinch: number;
  filteredPinch: number;
  palmX: number;
  palmY: number;
  rawPalmScale: number;
  palmScale: number;
  palmPixels: number;
  pinchDepth: number;
  pinch3d: number;
  depthSource: 'world' | 'image';
  fingertipsVisible: boolean;
  palmAnchorsVisible: boolean;
  handedness: string;
  handednessScore: number;
}

export type PinchControlEvent = 'none' | 'latched' | 'aim-locked' | 'released' | 'cancelled';
export type PinchControlPhase = 'open' | 'ready' | 'aim' | 'tap-two';

export interface PinchTiming {
  rearmOpenMs: number;
  edgeConfirmMs: number;
  minimumAimHoldMs: number;
  secondTapMinGapMs: number;
  secondTapMaxGapMs: number;
  tapContactMinMs: number;
  tapContactMaxMs: number;
  sequenceMaxMs: number;
  lossCancelMs: number;
  neutralGraceMs: number;
  /** Gameplay mode: the first confirmed physical release fires immediately. */
  fireOnFirstRelease: boolean;
}

const DEFAULT_PINCH_TIMING: PinchTiming = {
  rearmOpenMs: 20,
  edgeConfirmMs: 20,
  minimumAimHoldMs: 60,
  secondTapMinGapMs: 20,
  secondTapMaxGapMs: 700,
  tapContactMinMs: 20,
  tapContactMaxMs: 450,
  sequenceMaxMs: 1_400,
  lossCancelMs: 330,
  // One neutral recognition is tolerated even at 15 FPS, but it never counts
  // as an edge sample and a longer ambiguous pose restarts confirmation.
  neutralGraceMs: 140,
  fireOnFirstRelease: false,
};

type PinchState =
  | 'rearming'
  | 'ready'
  | 'aim-arming'
  | 'aim-held'
  | 'aim-opening'
  | 'wait-tap'
  | 'tap-arming'
  | 'tap-held'
  | 'tap-opening';

type PinchEvidence = 'contact' | 'world-contact' | 'separated' | 'world-separated' | 'neutral' | 'invalid';

// A reliable-world fallback is needed before a contact-specific depth baseline
// exists (cold start, a full reset, or a world/image source transition). These
// conservative distances only classify sustained depth separation; image-z is
// deliberately excluded from this path.
const WORLD_FALLBACK_RELEASE_DEPTH = 0.38;
const WORLD_FALLBACK_RELEASE_3D = 0.52;
const WORLD_ANGLED_CONTACT_RAW_MAX = 0.72;
const CONTACT_EDGE_MIN_RAW_DROP = 0.015;
const CONTACT_EDGE_MIN_WORLD_DEPTH_DROP = 0.06;
const CONTACT_EDGE_MIN_WORLD_DISTANCE_DROP = 0.08;

/**
 * Conservative camera gesture recogniser:
 *
 * stable fingertip separation -> touch/release -> fire in gameplay mode.
 *
 * A single raw landmark crossing can never advance this machine. Every edge
 * needs raw and filtered agreement, consecutive samples and elapsed time.
 * Legacy two-cycle confirmation remains available for replay compatibility;
 * any stale, implausible or different-hand sequence is cancelled back to a
 * stable-open baseline.
 */
export class PinchDoubleTapControl {
  private state: PinchState = 'rearming';
  private phaseSince = 0;
  private phaseSamples = 0;
  private aimContactSince = 0;
  private tapContactSince = 0;
  private sequenceStartedAt = 0;
  private lastTapAt = 0;
  private lastTimestampMs = Number.NEGATIVE_INFINITY;
  private lastEdgeEvidenceAt = 0;
  private invalidFrames = 0;
  private handednessMismatches = 0;
  private lockedPalm: { x: number; y: number; scale: number; handedness: string } | null = null;
  private contactDistances: number[] = [];
  private contactDepths: number[] = [];
  private contactDistances3d: number[] = [];
  /** Last confirmed release gap, used only to rearm—not to narrow the next touch. */
  private adaptiveReleaseOff: number | null = null;
  private worldContradictionFrames = 0;
  private worldContactFrames = 0;
  private lastWorldContactAt = 0;
  private worldAngleActive = false;
  private worldContactCandidate: {
    palmX: number;
    palmY: number;
    palmScale: number;
    pinchDepth: number;
    pinch3d: number;
    handedness: string;
  } | null = null;
  private physicalContact = false;
  private armedOpen: {
    rawPinch: number;
    pinchDepth: number;
    pinch3d: number;
    depthSource: PinchGestureFrame['depthSource'];
  } | null = null;
  private freshContactEdgeRequired = false;
  private readonly pinchOn: number;
  private readonly pinchOff: number;
  private readonly timing: PinchTiming;

  constructor(
    pinchOn = 0.44,
    pinchOff = 0.5,
    timing: Partial<PinchTiming> = {},
  ) {
    this.pinchOn = clamp(Number.isFinite(pinchOn) ? pinchOn : 0.44, 0.18, 0.62);
    const configuredOff = Number.isFinite(pinchOff) ? pinchOff : 0.5;
    this.pinchOff = clamp(
      Math.min(configuredOff, this.pinchOn + 0.1),
      this.pinchOn + 0.03,
      0.74,
    );
    this.timing = { ...DEFAULT_PINCH_TIMING, ...timing };
  }

  private enter(state: PinchState, nowMs: number, firstSample = false): void {
    this.state = state;
    this.phaseSince = nowMs;
    this.phaseSamples = firstSample ? 1 : 0;
    this.lastEdgeEvidenceAt = firstSample ? nowMs : 0;
    if (state === 'rearming' || state === 'ready' || state === 'wait-tap') {
      this.clearContactBaseline();
    }
  }

  private clearContactBaseline(): void {
    this.contactDistances = [];
    this.contactDepths = [];
    this.contactDistances3d = [];
    this.worldAngleActive = false;
    this.clearWorldContactCandidate();
  }

  private clearWorldContactCandidate(): void {
    this.worldContactFrames = 0;
    this.lastWorldContactAt = 0;
    this.worldContactCandidate = null;
  }

  private beginContact(frame: PinchGestureFrame): void {
    this.contactDistances = [frame.rawPinch];
    this.contactDepths = frame.depthSource === 'world' ? [frame.pinchDepth] : [];
    this.contactDistances3d = frame.depthSource === 'world' ? [frame.pinch3d] : [];
  }

  private recordContact(frame: PinchGestureFrame): void {
    // Only the first few fresh samples define this physical touch. Freezing the
    // baseline prevents a long hold from slowly adapting into a wide release.
    if (this.contactDistances.length < 5) this.contactDistances.push(frame.rawPinch);
    if (frame.depthSource === 'world') {
      if (this.contactDepths.length < 5) this.contactDepths.push(frame.pinchDepth);
      if (this.contactDistances3d.length < 5) this.contactDistances3d.push(frame.pinch3d);
    }
  }

  private median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  private contactReleaseThreshold(): number {
    const configured = this.pinchOff;
    if (this.contactDistances.length < 2) return configured;
    const center = this.median(this.contactDistances);
    const deviation = this.median(this.contactDistances.map((value) => Math.abs(value - center)));
    const liveMargin = clamp(Math.max(0.045, deviation * 4), 0.045, 0.09);
    if (center >= this.pinchOff - 0.02) return Math.min(0.74, center + liveMargin);
    return Math.min(configured, center + liveMargin);
  }

  private contactEntryThreshold(): number {
    return this.pinchOn;
  }

  private worldReleaseThresholds(): { depth: number; distance3d: number } | null {
    if (this.contactDepths.length >= 1 && this.contactDistances3d.length >= 1) {
      const depthCenter = this.median(this.contactDepths);
      const depthDeviation = this.median(this.contactDepths.map((value) => Math.abs(value - depthCenter)));
      const distanceCenter = this.median(this.contactDistances3d);
      const distanceDeviation = this.median(this.contactDistances3d.map((value) => Math.abs(value - distanceCenter)));
      return {
        depth: depthCenter + clamp(Math.max(0.1, depthDeviation * 5), 0.1, 0.22),
        distance3d: distanceCenter + clamp(Math.max(0.12, distanceDeviation * 5), 0.12, 0.25),
      };
    }
    return null;
  }

  private rememberContactModel(): void {
    if (this.contactDistances.length >= 2) {
      // Carry the physical gap just long enough to rearm after this release.
      // Never feed it back into the next contact threshold: doing so made one
      // unusually hard pinch permanently reject every softer later pinch.
      this.adaptiveReleaseOff = this.contactReleaseThreshold();
    }
  }

  private ownsContactBaseline(): boolean {
    return this.state === 'aim-arming'
      || this.state === 'aim-held'
      || this.state === 'aim-opening'
      || this.state === 'tap-arming'
      || this.state === 'tap-held'
      || this.state === 'tap-opening';
  }

  private clearSequence(preserveClock: boolean, preserveAdaptiveRelease = false): void {
    this.state = 'rearming';
    this.phaseSince = 0;
    this.phaseSamples = 0;
    this.aimContactSince = 0;
    this.tapContactSince = 0;
    this.sequenceStartedAt = 0;
    this.lastTapAt = 0;
    this.lastEdgeEvidenceAt = 0;
    this.invalidFrames = 0;
    this.handednessMismatches = 0;
    this.lockedPalm = null;
    this.physicalContact = false;
    this.armedOpen = null;
    this.freshContactEdgeRequired = true;
    this.worldContradictionFrames = 0;
    this.clearContactBaseline();
    if (!preserveAdaptiveRelease) {
      this.adaptiveReleaseOff = null;
    }
    if (!preserveClock) this.lastTimestampMs = Number.NEGATIVE_INFINITY;
  }

  private cancel(preserveAdaptiveRelease = true): PinchControlEvent {
    this.clearSequence(true, preserveAdaptiveRelease);
    return 'cancelled';
  }

  private rememberArmedOpen(frame: PinchGestureFrame): void {
    this.armedOpen = {
      rawPinch: frame.rawPinch,
      pinchDepth: frame.pinchDepth,
      pinch3d: frame.pinch3d,
      depthSource: frame.depthSource,
    };
  }

  /**
   * Rearming proves that the fingers separated; it must not itself become the
   * next contact. A new latch needs a measurable downward edge from that exact
   * open pose in normalized image distance or reliable world depth.
   */
  private hasFreshContactEdge(frame: PinchGestureFrame): boolean {
    if (!this.armedOpen) return false;
    const rawEdge = frame.rawPinch <= Math.min(
      this.pinchOn,
      this.armedOpen.rawPinch - CONTACT_EDGE_MIN_RAW_DROP,
    );
    const worldEdge = frame.depthSource === 'world'
      && this.armedOpen.depthSource === 'world'
      && frame.pinchDepth <= 0.3
      && frame.pinch3d <= 0.46
      && frame.pinchDepth <= this.armedOpen.pinchDepth - CONTACT_EDGE_MIN_WORLD_DEPTH_DROP
      && frame.pinch3d <= this.armedOpen.pinch3d - CONTACT_EDGE_MIN_WORLD_DISTANCE_DROP;
    return rawEdge || worldEdge;
  }

  private evidence(frame: PinchGestureFrame): PinchEvidence {
    const finite = [
      frame.rawPinch,
      frame.filteredPinch,
      frame.palmX,
      frame.palmY,
      frame.rawPalmScale,
      frame.palmScale,
      frame.palmPixels,
      frame.pinchDepth,
      frame.pinch3d,
    ].every(Number.isFinite);
    if (!finite
      || !frame.fingertipsVisible
      || !frame.palmAnchorsVisible
      || frame.palmPixels < 12
      || frame.rawPalmScale < 0.035
      || frame.rawPalmScale > 0.75
      || frame.palmScale < 0.035
      || frame.palmScale > 0.75
      || frame.pinchDepth < 0) return 'invalid';

    const contactOn = this.contactEntryThreshold();
    const contactOff = this.contactReleaseThreshold();
    const currentRawContact = frame.rawPinch <= contactOn;
    const filteredContact = frame.filteredPinch <= contactOn + 0.035;
    const decisiveRawContact = frame.rawPinch <= contactOn - 0.02;
    const imageDepthPlausible = frame.depthSource === 'world'
      || (frame.pinchDepth <= 0.58 && frame.pinch3d <= 0.78);
    const extremeWorldContradiction = frame.depthSource === 'world'
      && frame.pinchDepth >= 0.62
      && frame.pinch3d >= 0.8;
    this.worldContradictionFrames = extremeWorldContradiction
      ? this.worldContradictionFrames + 1
      : 0;
    const strongWorldAngleGeometry = frame.depthSource === 'world'
      && frame.pinchDepth <= 0.3
      && frame.pinch3d <= 0.46;
    const rearmOff = this.adaptiveReleaseOff ?? this.pinchOff;
    if (this.state === 'rearming' && frame.rawPinch >= rearmOff) return 'separated';
    const worldRelease = frame.depthSource === 'world' ? this.worldReleaseThresholds() : null;
    const fallbackWorldSeparation = frame.depthSource === 'world'
      && worldRelease === null
      && frame.pinchDepth >= WORLD_FALLBACK_RELEASE_DEPTH
      && frame.pinch3d >= WORLD_FALLBACK_RELEASE_3D;
    if (this.state === 'rearming' && fallbackWorldSeparation) return 'world-separated';

    // A contact-specific 2D gap remains authoritative even for an angled
    // touch. World geometry supplements side views; it must not trap the user
    // in a pinch when the camera's inferred depth jitters.
    if (this.worldAngleActive && this.ownsContactBaseline()) {
      if (frame.rawPinch >= contactOff) return 'separated';
      if (strongWorldAngleGeometry) return 'world-contact';
      const activeWorldRelease = this.worldReleaseThresholds();
      if (activeWorldRelease
        && frame.pinchDepth >= activeWorldRelease.depth
        && frame.pinch3d >= activeWorldRelease.distance3d) return 'world-separated';
      if (currentRawContact && imageDepthPlausible) return 'contact';
      return 'neutral';
    }
    const worldAngleContact = frame.depthSource === 'world'
      && (
        (frame.rawPinch > contactOn && frame.rawPinch < contactOff)
        || (frame.rawPinch >= 0.52 && frame.rawPinch <= WORLD_ANGLED_CONTACT_RAW_MAX)
      )
      && strongWorldAngleGeometry;
    if (this.ownsContactBaseline()
      && this.contactDistances.length >= 2
      && frame.rawPinch >= contactOff
      && !worldAngleContact) return 'separated';
    if (worldAngleContact) return 'world-contact';
    if (this.ownsContactBaseline()
      && worldRelease
      && frame.pinchDepth >= worldRelease.depth
      && frame.pinch3d >= worldRelease.distance3d) return 'world-separated';
    if (this.ownsContactBaseline() && fallbackWorldSeparation) return 'world-separated';
    if (this.state === 'wait-tap' && fallbackWorldSeparation) return 'world-separated';
    if (currentRawContact
      && imageDepthPlausible
      && this.worldContradictionFrames < 2
      && (filteredContact || decisiveRawContact)) return 'contact';
    // Raw separation remains the fastest route. A side-view release may be
    // mostly in depth, so reliable world geometry can also separate after its
    // own live contact baseline. The normal two-sample edge state machine
    // confirms this path; image-z can never create a release.
    if (fallbackWorldSeparation) return 'world-separated';
    if (currentRawContact && (!imageDepthPlausible || this.worldContradictionFrames >= 2)) return 'invalid';
    if (frame.rawPinch >= contactOff) return 'separated';
    return 'neutral';
  }

  private temporallyGateWorldSeparation(evidence: PinchEvidence): PinchEvidence {
    // The state machine below already requires two fresh edge samples.
    return evidence === 'world-separated' ? 'separated' : evidence;
  }

  private temporallyGateWorldContact(
    evidence: PinchEvidence,
    frame: PinchGestureFrame,
    nowMs: number,
  ): PinchEvidence {
    if (evidence !== 'world-contact') {
      const unconfirmedWorldContact = this.worldContactFrames === 1;
      this.clearWorldContactCandidate();
      // A world-angle candidate must be followed by a second fresh matching
      // world observation. Do not combine it with image-z, an ordinary 2D
      // frame, or a neutral sample to complete a gameplay edge.
      if (unconfirmedWorldContact
        && (this.state === 'aim-arming' || this.state === 'tap-arming')) return 'invalid';
      return evidence;
    }

    if (this.worldAngleActive) return 'contact';

    const handedness = frame.handednessScore >= 0.75 ? frame.handedness.trim().toLowerCase() : '';
    const candidate = this.worldContactCandidate;
    const stale = this.lastWorldContactAt > 0
      && nowMs - this.lastWorldContactAt > this.timing.neutralGraceMs;
    const scaleRatio = candidate ? frame.palmScale / Math.max(0.001, candidate.palmScale) : 1;
    const inconsistent = Boolean(candidate) && (
      Math.hypot(frame.palmX - candidate!.palmX, frame.palmY - candidate!.palmY) > 0.1
      || scaleRatio < 0.7
      || scaleRatio > 1.4
      || Math.abs(frame.pinchDepth - candidate!.pinchDepth) > 0.12
      || Math.abs(frame.pinch3d - candidate!.pinch3d) > 0.15
      || Boolean(candidate!.handedness && handedness && candidate!.handedness !== handedness)
    );

    if (!candidate || stale || inconsistent) {
      const replacingUnconfirmedCandidate = Boolean(candidate) && this.worldContactFrames === 1;
      this.worldContactCandidate = {
        palmX: frame.palmX,
        palmY: frame.palmY,
        palmScale: frame.palmScale,
        pinchDepth: frame.pinchDepth,
        pinch3d: frame.pinch3d,
        handedness,
      };
      this.worldContactFrames = 1;
      this.lastWorldContactAt = nowMs;
      return replacingUnconfirmedCandidate ? 'invalid' : 'contact';
    }

    this.worldContactFrames++;
    this.lastWorldContactAt = nowMs;
    this.worldAngleActive = true;
    return 'contact';
  }

  private frameMatchesLockedHand(frame: PinchGestureFrame): boolean {
    if (!this.lockedPalm) return true;
    const drift = Math.hypot(frame.palmX - this.lockedPalm.x, frame.palmY - this.lockedPalm.y);
    const scaleRatio = frame.palmScale / Math.max(0.001, this.lockedPalm.scale);
    if (drift > 0.22 || scaleRatio < 0.6 || scaleRatio > 1.65) return false;

    const nextHand = frame.handedness.trim().toLowerCase();
    if (this.lockedPalm.handedness
      && nextHand
      && frame.handednessScore >= 0.75
      && nextHand !== this.lockedPalm.handedness) {
      this.handednessMismatches++;
      return false;
    }
    this.handednessMismatches = 0;
    return true;
  }

  private resetEdgeCandidate(nowMs: number): void {
    if (this.state === 'rearming') {
      this.phaseSince = nowMs;
      this.phaseSamples = 0;
    } else if (this.state === 'aim-arming') {
      this.enter('ready', nowMs);
    } else if (this.state === 'aim-opening') {
      this.enter('aim-held', nowMs);
    } else if (this.state === 'tap-arming') {
      this.enter('wait-tap', nowMs);
    } else if (this.state === 'tap-opening') {
      this.enter('tap-held', nowMs);
    }
  }

  private edgeConfirmed(nowMs: number): boolean {
    return this.phaseSamples >= 2 && nowMs - this.phaseSince >= this.timing.edgeConfirmMs;
  }

  private tapWindowExpired(nowMs: number): boolean {
    if (!this.sequenceStartedAt) return false;
    if (nowMs - this.sequenceStartedAt > this.timing.sequenceMaxMs) return true;
    if (this.state !== 'wait-tap' && this.state !== 'tap-arming') return false;
    return nowMs - this.lastTapAt > this.timing.secondTapMaxGapMs;
  }

  update(frame: PinchGestureFrame): PinchControlEvent {
    const nowMs = frame.timestampMs;
    if (!Number.isFinite(nowMs) || nowMs <= this.lastTimestampMs) return 'none';
    this.lastTimestampMs = nowMs;

    if (this.tapWindowExpired(nowMs)) return this.cancel();

    const separationEvidence = this.temporallyGateWorldSeparation(this.evidence(frame));
    const evidence = this.temporallyGateWorldContact(separationEvidence, frame, nowMs);
    const checkingLockedHand = this.state === 'wait-tap'
      || this.state === 'tap-arming'
      || this.state === 'tap-held'
      || this.state === 'tap-opening';
    const consistent = !checkingLockedHand || this.frameMatchesLockedHand(frame);
    if (evidence === 'invalid' || !consistent) {
      this.invalidFrames++;
      const confirmedDepthContradiction = this.worldContradictionFrames >= 2;
      // Contradictory geometry never completes an edge across time. Physical
      // contact feedback survives one generic invalid frame, but a confirmed
      // depth contradiction or hand switch clears it immediately.
      this.resetEdgeCandidate(nowMs);
      if (!consistent || confirmedDepthContradiction) this.physicalContact = false;
      if (this.invalidFrames < 3) return 'none';
      this.physicalContact = false;
      return this.isEngaged() ? this.cancel(consistent) : 'none';
    }
    this.invalidFrames = 0;
    if (evidence === 'contact') this.physicalContact = true;
    else if (evidence === 'separated') this.physicalContact = false;

    if (evidence === 'contact' && this.contactDistances.length) this.recordContact(frame);

    if (evidence === 'neutral') {
      const preservingEdge = this.state === 'aim-arming'
        || this.state === 'aim-opening'
        || this.state === 'tap-arming'
        || this.state === 'tap-opening';
      if (preservingEdge && nowMs - this.lastEdgeEvidenceAt <= this.timing.neutralGraceMs) return 'none';
      this.resetEdgeCandidate(nowMs);
      return 'none';
    }

    const staleEdgeCandidate = this.state === 'aim-arming'
      || this.state === 'aim-opening'
      || this.state === 'tap-arming'
      || this.state === 'tap-opening';
    if (staleEdgeCandidate
      && this.lastEdgeEvidenceAt > 0
      && nowMs - this.lastEdgeEvidenceAt > this.timing.neutralGraceMs) {
      this.resetEdgeCandidate(nowMs);
    }

    if (this.state === 'rearming') {
      if (evidence !== 'separated') {
        this.phaseSince = nowMs;
        this.phaseSamples = 0;
        return 'none';
      }
      this.rememberArmedOpen(frame);
      if (this.phaseSamples === 0) this.phaseSince = nowMs;
      this.phaseSamples++;
      if (this.phaseSamples >= 2 && nowMs - this.phaseSince >= this.timing.rearmOpenMs) {
        this.enter('ready', nowMs);
      }
      return 'none';
    }

    if (this.state === 'ready') {
      if (evidence === 'separated') {
        this.rememberArmedOpen(frame);
        this.physicalContact = false;
        return 'none';
      }
      if (evidence === 'contact') {
        if (this.freshContactEdgeRequired && !this.hasFreshContactEdge(frame)) {
          this.physicalContact = false;
          return 'none';
        }
        this.freshContactEdgeRequired = false;
        this.aimContactSince = nowMs;
        this.beginContact(frame);
        this.enter('aim-arming', nowMs, true);
      }
      return 'none';
    }

    if (this.state === 'aim-arming') {
      if (evidence !== 'contact') {
        this.enter('ready', nowMs);
        return 'none';
      }
      this.phaseSamples++;
      this.lastEdgeEvidenceAt = nowMs;
      if (this.edgeConfirmed(nowMs)) {
        this.enter('aim-held', nowMs);
        return 'latched';
      }
      return 'none';
    }

    if (this.state === 'aim-held') {
      if (evidence === 'separated') {
        if (nowMs - this.aimContactSince < this.timing.minimumAimHoldMs) return this.cancel();
        this.enter('aim-opening', nowMs, true);
      }
      return 'none';
    }

    if (this.state === 'aim-opening') {
      if (evidence !== 'separated') {
        this.enter('aim-held', nowMs);
        return 'none';
      }
      this.phaseSamples++;
      this.lastEdgeEvidenceAt = nowMs;
      if (!this.edgeConfirmed(nowMs)) return 'none';
      this.rememberContactModel();
      if (this.timing.fireOnFirstRelease) {
        this.clearSequence(true, true);
        return 'released';
      }
      this.sequenceStartedAt = nowMs;
      this.lastTapAt = nowMs;
      this.lockedPalm = {
        x: frame.palmX,
        y: frame.palmY,
        scale: frame.palmScale,
        handedness: frame.handednessScore >= 0.65 ? frame.handedness.trim().toLowerCase() : '',
      };
      this.enter('wait-tap', nowMs);
      return 'aim-locked';
    }

    if (this.state === 'wait-tap') {
      const reliableAngledTouch = frame.depthSource === 'world'
        && frame.rawPinch > this.pinchOn
        && frame.rawPinch <= WORLD_ANGLED_CONTACT_RAW_MAX
        && frame.pinchDepth <= 0.3
        && frame.pinch3d <= 0.46;
      if (this.adaptiveReleaseOff != null
        && frame.rawPinch >= this.adaptiveReleaseOff
        && !reliableAngledTouch) {
        this.physicalContact = false;
        return 'none';
      }
      if (evidence !== 'contact') return 'none';
      if (nowMs - this.lastTapAt < this.timing.secondTapMinGapMs) return 'none';
      this.tapContactSince = nowMs;
      this.beginContact(frame);
      this.enter('tap-arming', nowMs, true);
      return 'none';
    }

    if (this.state === 'tap-arming') {
      if (evidence !== 'contact') {
        this.enter('wait-tap', nowMs);
        return 'none';
      }
      this.phaseSamples++;
      this.lastEdgeEvidenceAt = nowMs;
      if (this.edgeConfirmed(nowMs)) this.enter('tap-held', nowMs);
      return 'none';
    }

    if (this.state === 'tap-held') {
      const contactMs = nowMs - this.tapContactSince;
      if (contactMs > this.timing.tapContactMaxMs) return this.cancel();
      if (evidence === 'separated') {
        if (contactMs < this.timing.tapContactMinMs) return this.cancel();
        this.enter('tap-opening', nowMs, true);
      }
      return 'none';
    }

    if (this.state === 'tap-opening') {
      if (evidence !== 'separated') {
        this.enter('tap-held', nowMs);
        return 'none';
      }
      this.phaseSamples++;
      this.lastEdgeEvidenceAt = nowMs;
      if (!this.edgeConfirmed(nowMs)) return 'none';
      if (nowMs - this.sequenceStartedAt > this.timing.sequenceMaxMs) return this.cancel();
      this.rememberContactModel();
      this.clearSequence(true, true);
      return 'released';
    }

    return 'none';
  }

  cancelForLoss(nowMs: number, lastSampleAtMs: number): PinchControlEvent {
    if (nowMs - lastSampleAtMs < this.timing.lossCancelMs) return 'none';
    const wasEngaged = this.isEngaged();
    this.clearSequence(true, true);
    // Samples use capture timestamps. Do not overwrite that clock with render
    // time or the first recovered worker result will look stale and be ignored.
    return wasEngaged ? 'cancelled' : 'none';
  }

  getPhase(): PinchControlPhase {
    if (this.state === 'rearming') return 'open';
    if (this.state === 'ready') return 'ready';
    if (this.state === 'aim-arming' || this.state === 'aim-held' || this.state === 'aim-opening') return 'aim';
    return 'tap-two';
  }

  isLatched(): boolean {
    return this.state === 'aim-held'
      || this.state === 'aim-opening'
      || this.state === 'wait-tap'
      || this.state === 'tap-arming'
      || this.state === 'tap-held'
      || this.state === 'tap-opening';
  }

  /** Current physical thumb/index contact, independent of double-tap phase. */
  isContacting(): boolean {
    return this.physicalContact;
  }

  isEngaged(): boolean {
    return this.state !== 'rearming' && this.state !== 'ready';
  }

  reset(): void {
    this.clearSequence(false);
  }

  /** Shot boundary reset that retains the just-learned touch/release gap. */
  resetForShot(): void {
    this.clearSequence(true, true);
  }

  /** Pipeline continuity boundary that retains calibrated physical separation. */
  resetForContinuity(): void {
    this.clearSequence(true, true);
  }

  /**
   * Preserve a confirmed physical contact through one brief confidence dip,
   * and retain one good edge sample. The scene continuity gate cancels after
   * sustained uncertainty, while a one-frame fingertip occlusion stays smooth.
   */
  holdForUncertainty(timestampMs: number): void {
    if (!Number.isFinite(timestampMs) || timestampMs <= this.lastTimestampMs) return;
    this.lastTimestampMs = timestampMs;
  }
}
