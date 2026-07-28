import type {
  GameplayInputMode,
  GameplayTutorialStep,
} from './gameplay-telemetry';
import {
  buildLevelZeroTutorialOpening,
  type LevelZeroTutorialOpening,
} from './campaign-generation';
import type { ColorKey } from '../config';

export const LEVEL_ZERO_TUTORIAL_VERSION = 1;
export const LEVEL_ZERO_TUTORIAL_ID = 'level-zero-v1';
export const TUTORIAL_PROGRESS_STORAGE_KEY = 'paopao.level-zero-tutorial.v1';
export const TUTORIAL_PROGRESS_CORRUPT_STORAGE_KEY = `${TUTORIAL_PROGRESS_STORAGE_KEY}.corrupt`;

const MAX_PROGRESS_COUNTER = 1_000_000;
const MAX_TUTORIAL_VERSION = 1_000_000;
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const MAX_CORRUPT_EVIDENCE_LENGTH = 32_768;

export type TutorialInputMode = Exclude<GameplayInputMode, 'unknown'>;
export type TutorialStepId = GameplayTutorialStep;
export type TutorialStatus = 'idle' | 'active' | 'completed' | 'skipped';
export type TutorialRunMode = 'first-run' | 'replay';
export type TutorialOrbColor = ColorKey;

export type TutorialPlayerAction =
  | 'aim'
  | 'fire'
  | 'swap'
  | 'inspect-next-orb'
  | 'inspect-danger-line'
  | 'inspect-objective'
  | 'hand-touch'
  | 'pause'
  | 'skip';

export interface TutorialFixtureCell {
  readonly row: number;
  readonly col: number;
  readonly color: TutorialOrbColor;
}

export interface TutorialCellAddress {
  readonly row: number;
  readonly col: number;
}

const LEVEL_ZERO_OPENING: LevelZeroTutorialOpening = buildLevelZeroTutorialOpening();
LEVEL_ZERO_OPENING.grid.forEach((row) => Object.freeze(row));
LEVEL_ZERO_OPENING.firstShot.anchorPair.forEach((address) => Object.freeze(address));
LEVEL_ZERO_OPENING.firstShot.hangingCluster.forEach((address) => Object.freeze(address));
LEVEL_ZERO_OPENING.firstShot.persistentTopAnchors.forEach((address) => Object.freeze(address));
Object.freeze(LEVEL_ZERO_OPENING.grid);
Object.freeze(LEVEL_ZERO_OPENING.palette);
Object.freeze(LEVEL_ZERO_OPENING.firstShot.target);
Object.freeze(LEVEL_ZERO_OPENING.firstShot.anchorPair);
Object.freeze(LEVEL_ZERO_OPENING.firstShot.hangingCluster);
Object.freeze(LEVEL_ZERO_OPENING.firstShot.persistentTopAnchors);
Object.freeze(LEVEL_ZERO_OPENING.firstShot);
Object.freeze(LEVEL_ZERO_OPENING);
const INITIAL_CURRENT_COLOR = LEVEL_ZERO_OPENING.palette.find(
  (color) => color !== LEVEL_ZERO_OPENING.firstShot.loadedColor,
);
const INITIAL_FOLLOWING_COLOR = LEVEL_ZERO_OPENING.palette.find(
  (color) => color !== LEVEL_ZERO_OPENING.firstShot.loadedColor && color !== INITIAL_CURRENT_COLOR,
);
if (!INITIAL_CURRENT_COLOR || !INITIAL_FOLLOWING_COLOR) {
  throw new Error('Level-0 tutorial requires three distinct active colours');
}

const LEVEL_ZERO_BOARD = Object.freeze(LEVEL_ZERO_OPENING.grid.flatMap(
  (row, rowIndex): TutorialFixtureCell[] => row.flatMap((color, colIndex) => (
    color == null
      ? []
      : [Object.freeze({ row: rowIndex, col: colIndex, color })]
  )),
));

/**
 * The board and first-shot proof are derived from campaign-generation's
 * `buildLevelZeroTutorialOpening()` contract. Tutorial UI adds only the
 * pre-shot queue needed to teach a real swap into that authored shot.
 */
export const LEVEL_ZERO_TUTORIAL_FIXTURE = Object.freeze({
  id: LEVEL_ZERO_TUTORIAL_ID,
  opening: LEVEL_ZERO_OPENING,
  seed: LEVEL_ZERO_OPENING.seed,
  board: LEVEL_ZERO_BOARD,
  initialQueue: Object.freeze([
    INITIAL_CURRENT_COLOR,
    LEVEL_ZERO_OPENING.firstShot.loadedColor,
    INITIAL_FOLLOWING_COLOR,
  ] satisfies readonly [TutorialOrbColor, TutorialOrbColor, ...TutorialOrbColor[]]),
  guaranteedShot: Object.freeze({
    color: LEVEL_ZERO_OPENING.firstShot.loadedColor,
    target: Object.freeze({ ...LEVEL_ZERO_OPENING.firstShot.target }),
    minimumMatched: LEVEL_ZERO_OPENING.firstShot.expectedMatchCount,
    minimumDropped: LEVEL_ZERO_OPENING.firstShot.expectedDropCount,
  }),
  dangerLineRow: 9,
  objective: Object.freeze({
    kind: 'clear-grid' as const,
    current: 0,
    target: 1,
  }),
});

const STANDARD_STEP_ORDER = Object.freeze([
  'objective',
  'danger-line',
  'next-orb',
  'swap',
  'aim',
  'fire',
  'match-three',
  'drop-cluster',
] satisfies readonly TutorialStepId[]);

const HAND_STEP_ORDER = Object.freeze([
  'objective',
  'danger-line',
  'next-orb',
  'swap',
  'aim',
  'hand-touch-one',
  'fire',
  'match-three',
  'drop-cluster',
] satisfies readonly TutorialStepId[]);

export function levelZeroTutorialSteps(inputMode: GameplayInputMode): readonly TutorialStepId[] {
  return inputMode === 'hand' || inputMode === 'gaze-hand'
    ? HAND_STEP_ORDER
    : STANDARD_STEP_ORDER;
}

export interface TutorialPrompt {
  readonly step: TutorialStepId;
  readonly titleKey: string;
  readonly instructionKey: string;
  readonly title: string;
  readonly instruction: string;
}

export type TutorialGateRequirement =
  | { readonly type: 'objective-viewed'; readonly kind: 'clear-grid'; readonly target: 1 }
  | { readonly type: 'danger-line-viewed'; readonly row: number }
  | {
    readonly type: 'next-orb-viewed';
    readonly currentColor: TutorialOrbColor;
    readonly nextColor: TutorialOrbColor;
  }
  | {
    readonly type: 'orb-swapped';
    readonly beforeCurrent: TutorialOrbColor;
    readonly beforeNext: TutorialOrbColor;
    readonly afterCurrent: TutorialOrbColor;
    readonly afterNext: TutorialOrbColor;
  }
  | {
    readonly type: 'aim-targeted';
    readonly target: TutorialCellAddress;
    readonly maximumAngularErrorDegrees: number;
  }
  | { readonly type: 'hand-touch-one'; readonly reliableReleaseRequired: true }
  | { readonly type: 'hand-touch-two'; readonly reliableReleaseRequired: true }
  | {
    readonly type: 'shot-fired';
    readonly fixtureId: string;
    readonly color: TutorialOrbColor;
    readonly target: TutorialCellAddress;
  }
  | {
    readonly type: 'shot-resolved';
    readonly fixtureId: string;
    readonly minimumMatched: number;
    readonly minimumDropped: number;
  };

export interface TutorialGate {
  readonly step: TutorialStepId;
  readonly requirement: TutorialGateRequirement;
  readonly allowedActions: readonly TutorialPlayerAction[];
  readonly canAim: boolean;
  readonly canShoot: boolean;
}

export type TutorialSignal =
  | {
    readonly type: 'objective-viewed';
    readonly visible: boolean;
    readonly kind: 'clear-grid';
    readonly current: number;
    readonly target: number;
  }
  | {
    readonly type: 'danger-line-viewed';
    readonly visible: boolean;
    readonly row: number;
  }
  | {
    readonly type: 'next-orb-viewed';
    readonly visible: boolean;
    readonly currentColor: TutorialOrbColor;
    readonly nextColor: TutorialOrbColor;
  }
  | {
    readonly type: 'orb-swapped';
    readonly beforeCurrent: TutorialOrbColor;
    readonly beforeNext: TutorialOrbColor;
    readonly afterCurrent: TutorialOrbColor;
    readonly afterNext: TutorialOrbColor;
  }
  | {
    readonly type: 'aim-targeted';
    readonly target: TutorialCellAddress;
    readonly angularErrorDegrees: number;
  }
  | {
    readonly type: 'hand-touch-one';
    readonly reliable: boolean;
    readonly releaseConfirmed: boolean;
  }
  | {
    readonly type: 'hand-touch-two';
    readonly reliable: boolean;
    readonly releaseConfirmed: boolean;
  }
  | {
    readonly type: 'shot-fired';
    readonly fixtureId: string;
    readonly color: TutorialOrbColor;
    readonly target: TutorialCellAddress;
  }
  | {
    readonly type: 'shot-resolved';
    readonly fixtureId: string;
    readonly matched: number;
    readonly dropped: number;
  };

export type TutorialDirectorAction =
  | { readonly type: 'load-fixture'; readonly fixtureId: string }
  | {
    readonly type: 'show-step';
    readonly step: TutorialStepId;
    readonly prompt: TutorialPrompt;
    readonly gate: TutorialGate;
  }
  | { readonly type: 'step-completed'; readonly step: TutorialStepId }
  | {
    readonly type: 'tutorial-completed';
    readonly tutorialVersion: number;
    readonly runMode: TutorialRunMode;
  }
  | {
    readonly type: 'tutorial-skipped';
    readonly tutorialVersion: number;
    readonly runMode: TutorialRunMode;
  };

export interface TutorialSnapshot {
  readonly tutorialId: string;
  readonly tutorialVersion: number;
  readonly inputMode: TutorialInputMode;
  readonly runMode: TutorialRunMode;
  readonly status: TutorialStatus;
  readonly currentStep: TutorialStepId | null;
  readonly currentPrompt: TutorialPrompt | null;
  readonly currentGate: TutorialGate | null;
  readonly completedSteps: readonly TutorialStepId[];
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly canAim: boolean;
  readonly canShoot: boolean;
  readonly canSkip: boolean;
  readonly allowedActions: readonly TutorialPlayerAction[];
}

export interface TutorialTransition {
  readonly accepted: boolean;
  readonly completedSteps: readonly TutorialStepId[];
  readonly actions: readonly TutorialDirectorAction[];
  readonly snapshot: TutorialSnapshot;
}

const ALWAYS_AVAILABLE_ACTIONS = Object.freeze([
  'pause',
  'skip',
] satisfies readonly TutorialPlayerAction[]);

function freezeActions(actions: readonly TutorialPlayerAction[]): readonly TutorialPlayerAction[] {
  return Object.freeze(Array.from(new Set([...actions, ...ALWAYS_AVAILABLE_ACTIONS])));
}

function instructionForAim(inputMode: TutorialInputMode): string {
  switch (inputMode) {
    case 'hand':
      return 'Move your index fingertip until the guide settles over the glowing red socket.';
    case 'gaze':
      return 'Look at the glowing red socket and hold your eyes steady until the guide settles.';
    case 'gaze-hand':
      return 'Look at the glowing red socket; your eyes aim while your hand confirms the shot.';
    case 'keyboard':
      return 'Use Left and Right until the guide settles over the glowing red socket.';
    case 'gamepad':
      return 'Use the left stick until the guide settles over the glowing red socket.';
    case 'mouse':
      return 'Move the pointer until the guide settles over the glowing red socket.';
    case 'touch':
      return 'Drag toward the glowing red socket and hold the guide steady.';
  }
}

function instructionForFire(inputMode: TutorialInputMode): string {
  switch (inputMode) {
    case 'hand':
      return 'Touch thumb and index to pinch, then separate them slightly to launch the orb.';
    case 'gaze':
      return 'Keep looking at the socket, then make two deliberate quick blinks to launch the orb.';
    case 'gaze-hand':
      return 'Keep looking at the socket, touch thumb and index, then separate them slightly to launch.';
    case 'keyboard':
      return 'Press Space to launch the red orb.';
    case 'gamepad':
      return 'Press the primary action button to launch the red orb.';
    case 'mouse':
      return 'Release the pointer to launch the red orb.';
    case 'touch':
      return 'Lift your finger to launch the red orb.';
  }
}

export function tutorialPrompt(step: TutorialStepId, inputMode: GameplayInputMode): TutorialPrompt {
  const normalizedInput = normalizeTutorialInputMode(inputMode);
  const copy: Record<TutorialStepId, readonly [string, string]> = {
    objective: [
      'Know the mission',
      'Open the objective panel: clear the grid to complete this training board.',
    ],
    'danger-line': [
      'Protect the danger line',
      'Inspect the glowing line. Any orb crossing it ends the run.',
    ],
    'next-orb': [
      'Plan one move ahead',
      `Inspect the NEXT slot: ${LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[1].toUpperCase()} is waiting behind the loaded ${LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[0].toUpperCase()} orb.`,
    ],
    swap: [
      'Swap into the winning colour',
      `Swap the loaded ${LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[0].toUpperCase()} orb with the next ${LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[1].toUpperCase()} orb.`,
    ],
    aim: [
      'Line up the guaranteed match',
      instructionForAim(normalizedInput),
    ],
    'hand-touch-one': [
      'Pinch and release',
      'Touch thumb and index while aiming, then separate them slightly to launch. No second pinch is needed.',
    ],
    'hand-touch-two': [
      'Second touch: confirm',
      'Touch thumb and index once more, then release to confirm the shot.',
    ],
    fire: [
      `Launch the ${LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.color.toUpperCase()} orb`,
      instructionForFire(normalizedInput),
    ],
    'match-three': [
      'Create the match',
      `Let the shot resolve against the two ${LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.color.toUpperCase()} support orbs to make a group of three.`,
    ],
    'drop-cluster': [
      'Drop the unsupported cluster',
      'Watch the unsupported hanging orbs lose their ceiling connection and fall.',
    ],
  };
  const [title, instruction] = copy[step];
  return Object.freeze({
    step,
    titleKey: `tutorial.level-zero.${step}.title`,
    instructionKey: `tutorial.level-zero.${step}.instruction`,
    title,
    instruction,
  });
}

export function tutorialGate(step: TutorialStepId): TutorialGate {
  const target = LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.target;
  const requirements: Record<TutorialStepId, TutorialGateRequirement> = {
    objective: {
      type: 'objective-viewed',
      kind: LEVEL_ZERO_TUTORIAL_FIXTURE.objective.kind,
      target: LEVEL_ZERO_TUTORIAL_FIXTURE.objective.target,
    },
    'danger-line': {
      type: 'danger-line-viewed',
      row: LEVEL_ZERO_TUTORIAL_FIXTURE.dangerLineRow,
    },
    'next-orb': {
      type: 'next-orb-viewed',
      currentColor: LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[0],
      nextColor: LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[1],
    },
    swap: {
      type: 'orb-swapped',
      beforeCurrent: LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[0],
      beforeNext: LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[1],
      afterCurrent: LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[1],
      afterNext: LEVEL_ZERO_TUTORIAL_FIXTURE.initialQueue[0],
    },
    aim: {
      type: 'aim-targeted',
      target,
      maximumAngularErrorDegrees: 2.5,
    },
    'hand-touch-one': {
      type: 'hand-touch-one',
      reliableReleaseRequired: true,
    },
    'hand-touch-two': {
      type: 'hand-touch-two',
      reliableReleaseRequired: true,
    },
    fire: {
      type: 'shot-fired',
      fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id,
      color: LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.color,
      target,
    },
    'match-three': {
      type: 'shot-resolved',
      fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id,
      minimumMatched: LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.minimumMatched,
      minimumDropped: 0,
    },
    'drop-cluster': {
      type: 'shot-resolved',
      fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id,
      minimumMatched: LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.minimumMatched,
      minimumDropped: LEVEL_ZERO_TUTORIAL_FIXTURE.guaranteedShot.minimumDropped,
    },
  };
  const actionByStep: Record<TutorialStepId, readonly TutorialPlayerAction[]> = {
    objective: ['inspect-objective'],
    'danger-line': ['inspect-danger-line'],
    'next-orb': ['inspect-next-orb'],
    swap: ['swap'],
    aim: ['aim'],
    'hand-touch-one': ['aim', 'hand-touch'],
    'hand-touch-two': ['aim', 'hand-touch'],
    fire: ['aim', 'fire'],
    'match-three': [],
    'drop-cluster': [],
  };
  const allowedActions = freezeActions(actionByStep[step]);
  return Object.freeze({
    step,
    requirement: Object.freeze(requirements[step]),
    allowedActions,
    canAim: allowedActions.includes('aim'),
    canShoot: allowedActions.includes('fire'),
  });
}

function isExactCell(actual: TutorialCellAddress, expected: TutorialCellAddress): boolean {
  return Number.isInteger(actual.row)
    && Number.isInteger(actual.col)
    && actual.row === expected.row
    && actual.col === expected.col;
}

function isBoundedCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_PROGRESS_COUNTER;
}

/** Exact, side-effect-free gate evaluation used by the state machine and tests. */
export function tutorialSignalCompletesStep(step: TutorialStepId, signal: TutorialSignal): boolean {
  const gate = tutorialGate(step).requirement;
  switch (gate.type) {
    case 'objective-viewed':
      return signal.type === gate.type
        && signal.visible
        && signal.kind === gate.kind
        && isBoundedCount(signal.current)
        && signal.current <= signal.target
        && signal.target === gate.target;
    case 'danger-line-viewed':
      return signal.type === gate.type
        && signal.visible
        && Number.isInteger(signal.row)
        && signal.row === gate.row;
    case 'next-orb-viewed':
      return signal.type === gate.type
        && signal.visible
        && signal.currentColor === gate.currentColor
        && signal.nextColor === gate.nextColor;
    case 'orb-swapped':
      return signal.type === gate.type
        && signal.beforeCurrent === gate.beforeCurrent
        && signal.beforeNext === gate.beforeNext
        && signal.afterCurrent === gate.afterCurrent
        && signal.afterNext === gate.afterNext;
    case 'aim-targeted':
      return signal.type === gate.type
        && isExactCell(signal.target, gate.target)
        && Number.isFinite(signal.angularErrorDegrees)
        && Math.abs(signal.angularErrorDegrees) <= gate.maximumAngularErrorDegrees;
    case 'hand-touch-one':
    case 'hand-touch-two':
      return signal.type === gate.type && signal.reliable && signal.releaseConfirmed;
    case 'shot-fired':
      return signal.type === gate.type
        && signal.fixtureId === gate.fixtureId
        && signal.color === gate.color
        && isExactCell(signal.target, gate.target);
    case 'shot-resolved':
      return signal.type === gate.type
        && signal.fixtureId === gate.fixtureId
        && isBoundedCount(signal.matched)
        && isBoundedCount(signal.dropped)
        && signal.matched >= gate.minimumMatched
        && signal.dropped >= gate.minimumDropped;
  }
}

function normalizeTutorialInputMode(inputMode: GameplayInputMode): TutorialInputMode {
  return inputMode === 'hand'
    || inputMode === 'gaze'
    || inputMode === 'gaze-hand'
    || inputMode === 'keyboard'
    || inputMode === 'gamepad'
    || inputMode === 'mouse'
    || inputMode === 'touch'
    ? inputMode
    : 'touch';
}

function showStepAction(step: TutorialStepId, inputMode: TutorialInputMode): TutorialDirectorAction {
  return Object.freeze({
    type: 'show-step' as const,
    step,
    prompt: tutorialPrompt(step, inputMode),
    gate: tutorialGate(step),
  });
}

export interface TutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TutorialProgress {
  readonly schemaVersion: 1;
  readonly completedVersion: number;
  readonly skippedVersion: number;
  readonly playCount: number;
  readonly replayCount: number;
  readonly updatedAtMs: number;
  readonly completedAtMs: number;
  readonly skippedAtMs: number;
}

const EMPTY_TUTORIAL_PROGRESS: TutorialProgress = Object.freeze({
  schemaVersion: 1,
  completedVersion: 0,
  skippedVersion: 0,
  playCount: 0,
  replayCount: 0,
  updatedAtMs: 0,
  completedAtMs: 0,
  skippedAtMs: 0,
});

const PROGRESS_KEYS = new Set([
  'schemaVersion',
  'completedVersion',
  'skippedVersion',
  'playCount',
  'replayCount',
  'updatedAtMs',
  'completedAtMs',
  'skippedAtMs',
]);

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

/** Strictly validates persisted progress rather than coercing attacker/corrupt input. */
export function parseTutorialProgress(value: unknown): TutorialProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !PROGRESS_KEYS.has(key))) return null;
  if (source.schemaVersion !== 1) return null;
  const completedVersion = boundedInteger(source.completedVersion, 0, MAX_TUTORIAL_VERSION);
  const skippedVersion = boundedInteger(source.skippedVersion, 0, MAX_TUTORIAL_VERSION);
  const playCount = boundedInteger(source.playCount, 0, MAX_PROGRESS_COUNTER);
  const replayCount = boundedInteger(source.replayCount, 0, MAX_PROGRESS_COUNTER);
  const updatedAtMs = boundedInteger(source.updatedAtMs, 0, MAX_TIMESTAMP_MS);
  const completedAtMs = boundedInteger(source.completedAtMs, 0, MAX_TIMESTAMP_MS);
  const skippedAtMs = boundedInteger(source.skippedAtMs, 0, MAX_TIMESTAMP_MS);
  if (completedVersion === null
    || skippedVersion === null
    || playCount === null
    || replayCount === null
    || updatedAtMs === null
    || completedAtMs === null
    || skippedAtMs === null
    || replayCount > playCount
    || (completedVersion === 0 && completedAtMs !== 0)
    || (skippedVersion === 0 && skippedAtMs !== 0)
    || completedAtMs > updatedAtMs
    || skippedAtMs > updatedAtMs) return null;
  return Object.freeze({
    schemaVersion: 1,
    completedVersion,
    skippedVersion,
    playCount,
    replayCount,
    updatedAtMs,
    completedAtMs,
    skippedAtMs,
  });
}

function boundedTimestamp(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.min(MAX_TIMESTAMP_MS, Math.trunc(nowMs)));
}

function checkedTutorialVersion(tutorialVersion: number): number {
  if (!Number.isInteger(tutorialVersion) || tutorialVersion < 1 || tutorialVersion > MAX_TUTORIAL_VERSION) {
    throw new RangeError('invalid-tutorial-version');
  }
  return tutorialVersion;
}

export interface TutorialProgressStoreOptions {
  readonly storage?: TutorialStorage;
  readonly now?: () => number;
}

function availableTutorialStorage(): TutorialStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Safe, injected persistence. Corrupt JSON is quarantined, write failures keep
 * a coherent in-memory copy, and version flags can only move forward.
 */
export class TutorialProgressStore {
  private readonly storage?: TutorialStorage;
  private readonly now: () => number;
  private progress: TutorialProgress = EMPTY_TUTORIAL_PROGRESS;
  private loaded = false;

  constructor(options: TutorialProgressStoreOptions = {}) {
    this.storage = options.storage ?? availableTutorialStorage();
    this.now = options.now ?? Date.now;
  }

  read(): TutorialProgress {
    if (this.loaded) return this.progress;
    this.loaded = true;
    if (!this.storage) return this.progress;
    let raw: string | null;
    try {
      raw = this.storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY);
    } catch {
      return this.progress;
    }
    if (raw === null) return this.progress;
    try {
      const parsed = parseTutorialProgress(JSON.parse(raw));
      if (parsed) {
        this.progress = parsed;
        return this.progress;
      }
    } catch {
      // Quarantine below keeps bounded diagnostic evidence without blocking play.
    }
    try {
      this.storage.setItem(TUTORIAL_PROGRESS_CORRUPT_STORAGE_KEY, JSON.stringify({
        capturedAtMs: boundedTimestamp(this.now()),
        raw: raw.slice(0, MAX_CORRUPT_EVIDENCE_LENGTH),
      }));
      this.storage.removeItem(TUTORIAL_PROGRESS_STORAGE_KEY);
    } catch {
      // In-memory defaults still make normal play and explicit replay available.
    }
    return this.progress;
  }

  markStarted(tutorialVersion: number, replay: boolean): TutorialProgress {
    checkedTutorialVersion(tutorialVersion);
    const current = this.read();
    const nextPlayCount = Math.min(MAX_PROGRESS_COUNTER, current.playCount + 1);
    const nowMs = Math.max(current.updatedAtMs, boundedTimestamp(this.now()));
    return this.persist({
      ...current,
      playCount: nextPlayCount,
      replayCount: replay
        ? Math.min(nextPlayCount, current.replayCount + 1)
        : current.replayCount,
      updatedAtMs: nowMs,
    });
  }

  markCompleted(tutorialVersion: number): TutorialProgress {
    const version = checkedTutorialVersion(tutorialVersion);
    const current = this.read();
    const nowMs = Math.max(current.updatedAtMs, boundedTimestamp(this.now()));
    return this.persist({
      ...current,
      completedVersion: Math.max(current.completedVersion, version),
      completedAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  }

  markSkipped(tutorialVersion: number): TutorialProgress {
    const version = checkedTutorialVersion(tutorialVersion);
    const current = this.read();
    const nowMs = Math.max(current.updatedAtMs, boundedTimestamp(this.now()));
    return this.persist({
      ...current,
      skippedVersion: Math.max(current.skippedVersion, version),
      skippedAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  }

  private persist(candidate: TutorialProgress): TutorialProgress {
    const parsed = parseTutorialProgress(candidate);
    if (!parsed) throw new Error('invalid-tutorial-progress');
    this.progress = parsed;
    if (this.storage) {
      try {
        this.storage.setItem(TUTORIAL_PROGRESS_STORAGE_KEY, JSON.stringify(parsed));
      } catch {
        // The active session retains its monotonic in-memory record.
      }
    }
    return parsed;
  }
}

export type TutorialLaunchReason =
  | 'first-run'
  | 'force-replay'
  | 'completed'
  | 'skipped'
  | 'returning-player';

export interface TutorialLaunchContext {
  readonly isReturningPlayer: boolean;
  readonly forceReplay?: boolean;
  readonly tutorialVersion?: number;
}

export interface TutorialLaunchDecision {
  readonly shouldStart: boolean;
  readonly runMode: TutorialRunMode | null;
  readonly reason: TutorialLaunchReason;
  /** The launcher must always leave ordinary play available. */
  readonly blocksNormalPlay: false;
}

export function decideLevelZeroTutorialLaunch(
  progress: TutorialProgress,
  context: TutorialLaunchContext,
): TutorialLaunchDecision {
  const version = checkedTutorialVersion(context.tutorialVersion ?? LEVEL_ZERO_TUTORIAL_VERSION);
  if (context.forceReplay === true) {
    return Object.freeze({
      shouldStart: true,
      runMode: 'replay',
      reason: 'force-replay',
      blocksNormalPlay: false,
    });
  }
  if (progress.completedVersion >= version) {
    return Object.freeze({
      shouldStart: false,
      runMode: null,
      reason: 'completed',
      blocksNormalPlay: false,
    });
  }
  if (progress.skippedVersion >= version) {
    return Object.freeze({
      shouldStart: false,
      runMode: null,
      reason: 'skipped',
      blocksNormalPlay: false,
    });
  }
  if (context.isReturningPlayer) {
    return Object.freeze({
      shouldStart: false,
      runMode: null,
      reason: 'returning-player',
      blocksNormalPlay: false,
    });
  }
  return Object.freeze({
    shouldStart: true,
    runMode: 'first-run',
    reason: 'first-run',
    blocksNormalPlay: false,
  });
}

export interface LevelZeroTutorialMachineOptions {
  readonly inputMode: GameplayInputMode;
  readonly runMode?: TutorialRunMode;
  readonly progressStore?: TutorialProgressStore;
}

/**
 * Phaser-independent Level-0 state machine. The only accepted transitions are
 * typed gameplay facts from the authored fixture; UI "continue" clicks cannot
 * fake aim, swap, fire, match, drop, or hand contact.
 */
export class LevelZeroTutorialMachine {
  private inputMode: TutorialInputMode;
  private runMode: TutorialRunMode;
  private readonly progressStore?: TutorialProgressStore;
  private steps: readonly TutorialStepId[];
  private completedSteps: TutorialStepId[] = [];
  private status: TutorialStatus = 'idle';
  private stepIndex = 0;

  constructor(options: LevelZeroTutorialMachineOptions) {
    this.inputMode = normalizeTutorialInputMode(options.inputMode);
    this.runMode = options.runMode ?? 'first-run';
    this.progressStore = options.progressStore;
    this.steps = levelZeroTutorialSteps(this.inputMode);
  }

  start(): TutorialTransition {
    if (this.status !== 'idle') return this.transition(false, [], []);
    this.status = 'active';
    this.stepIndex = 0;
    this.completedSteps = [];
    this.steps = levelZeroTutorialSteps(this.inputMode);
    this.progressStore?.markStarted(LEVEL_ZERO_TUTORIAL_VERSION, this.runMode === 'replay');
    return this.transition(true, [], [
      Object.freeze({ type: 'load-fixture', fixtureId: LEVEL_ZERO_TUTORIAL_FIXTURE.id }),
      showStepAction(this.steps[0], this.inputMode),
    ]);
  }

  /** Explicitly restarts the complete flow and records a replay launch. */
  forceReplay(inputMode: GameplayInputMode = this.inputMode): TutorialTransition {
    this.inputMode = normalizeTutorialInputMode(inputMode);
    this.runMode = 'replay';
    this.status = 'idle';
    return this.start();
  }

  /**
   * Remove hand-only gates after camera failure or an explicit HAND-off.
   * Completed common steps are retained and an in-progress touch confirmation
   * resumes at FIRE, so pointer controls can never be trapped behind a camera.
   */
  fallbackToPointer(inputMode: GameplayInputMode): TutorialTransition {
    if (this.status !== 'active'
      || !['hand', 'gaze', 'gaze-hand'].includes(this.inputMode)) {
      return this.transition(false, [], []);
    }
    const pointerMode = normalizeTutorialInputMode(inputMode);
    if (['hand', 'gaze', 'gaze-hand'].includes(pointerMode)) {
      return this.transition(false, [], []);
    }
    const currentStep = this.steps[this.stepIndex];
    this.inputMode = pointerMode;
    this.steps = levelZeroTutorialSteps(pointerMode);
    this.completedSteps = this.completedSteps.filter((step) => this.steps.includes(step));
    const resumedStep = currentStep === 'hand-touch-one' || currentStep === 'hand-touch-two'
      ? 'fire'
      : currentStep;
    const resumedIndex = this.steps.indexOf(resumedStep);
    if (resumedIndex < 0) return this.transition(false, [], []);
    this.stepIndex = resumedIndex;
    return this.transition(true, [], [showStepAction(resumedStep, this.inputMode)]);
  }

  dispatch(signal: TutorialSignal): TutorialTransition {
    if (this.status !== 'active') return this.transition(false, [], []);
    const completed: TutorialStepId[] = [];
    const actions: TutorialDirectorAction[] = [];
    while (this.stepIndex < this.steps.length) {
      const step = this.steps[this.stepIndex];
      if (!tutorialSignalCompletesStep(step, signal)) break;
      completed.push(step);
      this.completedSteps.push(step);
      actions.push(Object.freeze({ type: 'step-completed', step }));
      this.stepIndex += 1;
    }
    if (completed.length === 0) return this.transition(false, [], []);
    if (this.stepIndex >= this.steps.length) {
      this.status = 'completed';
      this.progressStore?.markCompleted(LEVEL_ZERO_TUTORIAL_VERSION);
      actions.push(Object.freeze({
        type: 'tutorial-completed',
        tutorialVersion: LEVEL_ZERO_TUTORIAL_VERSION,
        runMode: this.runMode,
      }));
    } else {
      actions.push(showStepAction(this.steps[this.stepIndex], this.inputMode));
    }
    return this.transition(true, completed, actions);
  }

  skip(): TutorialTransition {
    if (this.status !== 'active') return this.transition(false, [], []);
    this.status = 'skipped';
    this.progressStore?.markSkipped(LEVEL_ZERO_TUTORIAL_VERSION);
    return this.transition(true, [], [
      Object.freeze({
        type: 'tutorial-skipped',
        tutorialVersion: LEVEL_ZERO_TUTORIAL_VERSION,
        runMode: this.runMode,
      }),
    ]);
  }

  canPerform(action: TutorialPlayerAction): boolean {
    if (this.status !== 'active') return true;
    return tutorialGate(this.steps[this.stepIndex]).allowedActions.includes(action);
  }

  snapshot(): TutorialSnapshot {
    const active = this.status === 'active';
    const currentStep = active ? this.steps[this.stepIndex] : null;
    const currentGate = currentStep ? tutorialGate(currentStep) : null;
    const currentPrompt = currentStep ? tutorialPrompt(currentStep, this.inputMode) : null;
    const allowedActions = currentGate?.allowedActions
      ?? Object.freeze([
        'aim',
        'fire',
        'swap',
        'inspect-next-orb',
        'inspect-danger-line',
        'inspect-objective',
        'hand-touch',
        'pause',
        'skip',
      ] satisfies TutorialPlayerAction[]);
    return Object.freeze({
      tutorialId: LEVEL_ZERO_TUTORIAL_ID,
      tutorialVersion: LEVEL_ZERO_TUTORIAL_VERSION,
      inputMode: this.inputMode,
      runMode: this.runMode,
      status: this.status,
      currentStep,
      currentPrompt,
      currentGate,
      completedSteps: Object.freeze([...this.completedSteps]),
      stepIndex: this.stepIndex,
      stepCount: this.steps.length,
      canAim: currentGate?.canAim ?? true,
      canShoot: currentGate?.canShoot ?? true,
      canSkip: active,
      allowedActions,
    });
  }

  private transition(
    accepted: boolean,
    completedSteps: readonly TutorialStepId[],
    actions: readonly TutorialDirectorAction[],
  ): TutorialTransition {
    return Object.freeze({
      accepted,
      completedSteps: Object.freeze([...completedSteps]),
      actions: Object.freeze([...actions]),
      snapshot: this.snapshot(),
    });
  }
}
