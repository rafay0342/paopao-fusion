import campaignFixture from '../../shared/fixtures/campaign-v1.json';
import { COLOR_KEYS, GRID, LEVELS, type ColorKey } from '../config';

export const CAMPAIGN_GENERATION_SCHEMA_VERSION = 1 as const;
export const CAMPAIGN_CONTENT_VERSION = campaignFixture.contentVersion;

export const CAMPAIGN_MODES = ['classic', 'rush', 'precision'] as const;
export type CampaignMode = typeof CAMPAIGN_MODES[number];

export interface CampaignGenerationIdentity {
  level: number;
  mode: CampaignMode;
  contentVersion?: string;
}

export interface CampaignOpening {
  schemaVersion: typeof CAMPAIGN_GENERATION_SCHEMA_VERSION;
  contentVersion: string;
  level: number;
  mode: CampaignMode;
  seed: number;
  rows: number;
  columns: number;
  palette: readonly ColorKey[];
  grid: readonly (readonly ColorKey[])[];
}

export interface CampaignGridAddress {
  row: number;
  col: number;
}

export interface TutorialFirstShotContract {
  loadedColor: ColorKey;
  target: CampaignGridAddress;
  anchorPair: readonly [CampaignGridAddress, CampaignGridAddress];
  hangingCluster: readonly CampaignGridAddress[];
  persistentTopAnchors: readonly CampaignGridAddress[];
  expectedMatchCount: 3;
  expectedDropCount: number;
}

export interface LevelZeroTutorialOpening {
  schemaVersion: typeof CAMPAIGN_GENERATION_SCHEMA_VERSION;
  variant: 'level-zero-first-shot';
  contentVersion: string;
  level: 0;
  mode: CampaignMode;
  seed: number;
  rows: number;
  columns: number;
  palette: readonly ColorKey[];
  grid: readonly (readonly (ColorKey | null)[])[];
  firstShot: TutorialFirstShotContract;
}

export interface ColorBagState {
  schemaVersion: typeof CAMPAIGN_GENERATION_SCHEMA_VERSION;
  seed: number;
  rngState: number;
  activeColors: readonly ColorKey[];
  remaining: readonly ColorKey[];
  lastDrawn: ColorKey | null;
  drawCount: number;
}

export interface ColorBagDraw {
  color: ColorKey;
  state: ColorBagState;
}

export interface ColorBagDrawMany {
  colors: readonly ColorKey[];
  state: ColorBagState;
}

export interface ShotQueueState {
  schemaVersion: typeof CAMPAIGN_GENERATION_SCHEMA_VERSION;
  seed: number;
  shot: number;
  current: ColorKey;
  next: ColorKey;
  swappedThisShot: boolean;
  /**
   * Explicit future shots that are consumed before returning to the bag.
   * Keeping this buffer separate means authored/tutorial queues never forge
   * bag drawCount, lastDrawn, rngState or remaining metadata.
   */
  preloaded?: readonly ColorKey[];
  bag: ColorBagState;
}

export interface ShotQueueSwap {
  applied: boolean;
  state: ShotQueueState;
}

export type ShotQueuePreload = readonly [ColorKey, ColorKey, ...ColorKey[]];

const UINT32_RANGE = 0x1_0000_0000;
const MULBERRY32_INCREMENT = 0x6d2b79f5;
const MAX_BULK_DRAWS = 1_000_000;
const MODE_SET = new Set<string>(CAMPAIGN_MODES);
const COLOR_SET = new Set<string>(COLOR_KEYS);

function fnv1a32(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  return value >>> 0;
}

function assertIdentity(input: CampaignGenerationIdentity): {
  level: number;
  mode: CampaignMode;
  contentVersion: string;
} {
  if (!Number.isInteger(input.level) || input.level < 0 || input.level >= LEVELS.length) {
    throw new RangeError(`Campaign level must be an integer from 0 to ${LEVELS.length - 1}`);
  }
  if (!MODE_SET.has(input.mode)) {
    throw new RangeError(`Unsupported campaign mode: ${String(input.mode)}`);
  }
  const contentVersion = input.contentVersion ?? CAMPAIGN_CONTENT_VERSION;
  if (typeof contentVersion !== 'string'
    || contentVersion.length < 1
    || contentVersion.length > 128
    || contentVersion.trim() !== contentVersion
    || /[\u0000-\u001f\u007f]/u.test(contentVersion)) {
    throw new RangeError('Campaign content version must be a non-empty, trimmed identifier');
  }
  return { level: input.level, mode: input.mode, contentVersion };
}

/**
 * Stable campaign identity seed. Content revision, level and mode are all
 * domain-separated, so replay data can name exactly which board it targets.
 */
export function campaignGenerationSeed(input: CampaignGenerationIdentity): number {
  const identity = assertIdentity(input);
  return fnv1a32(
    `paopao:campaign-generation:v${CAMPAIGN_GENERATION_SCHEMA_VERSION}`
    + `:${identity.contentVersion}:${identity.mode}:${identity.level}`,
  );
}

function streamSeed(identitySeed: number, stream: 'opening' | 'queue' | 'mechanics'): number {
  return fnv1a32(
    `paopao:campaign-generation:v${CAMPAIGN_GENERATION_SCHEMA_VERSION}`
    + `:${identitySeed >>> 0}:${stream}`,
  );
}

/** Independent deterministic stream for runtime mechanics after the opening. */
export function campaignMechanicSeed(input: CampaignGenerationIdentity): number {
  const identity = assertIdentity(input);
  return streamSeed(campaignGenerationSeed(identity), 'mechanics');
}

function nextRandom(state: number): { state: number; value: number } {
  const nextState = (state + MULBERRY32_INCREMENT) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return {
    state: nextState,
    value: ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE,
  };
}

function normalizeActiveColors(colors: readonly ColorKey[]): ColorKey[] {
  const requested = new Set<string>();
  for (const color of colors) {
    if (!COLOR_SET.has(color)) throw new RangeError(`Unsupported campaign color: ${String(color)}`);
    requested.add(color);
  }
  const normalized = COLOR_KEYS.filter((color) => requested.has(color));
  if (normalized.length === 0) throw new RangeError('At least one active campaign color is required');
  return normalized;
}

function sameColors(left: readonly ColorKey[], right: readonly ColorKey[]): boolean {
  return left.length === right.length && left.every((color, index) => color === right[index]);
}

function shuffledBag(
  colors: readonly ColorKey[],
  rngState: number,
  lastDrawn: ColorKey | null,
): { remaining: ColorKey[]; rngState: number } {
  const remaining = [...colors];
  let state = rngState >>> 0;
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const random = nextRandom(state);
    state = random.state;
    const other = Math.floor(random.value * (index + 1));
    [remaining[index], remaining[other]] = [remaining[other], remaining[index]];
  }

  // Keep a bag boundary from producing an avoidable duplicate while
  // preserving the exactly-once membership of every colour in the bag.
  if (remaining.length > 1 && remaining[0] === lastDrawn) {
    const replacement = remaining.findIndex((color) => color !== lastDrawn);
    [remaining[0], remaining[replacement]] = [remaining[replacement], remaining[0]];
  }
  return { remaining, rngState: state };
}

function rebaseBag(state: ColorBagState, activeColors: readonly ColorKey[]): ColorBagState {
  if (sameColors(state.activeColors, activeColors)) return state;
  return {
    ...state,
    activeColors: [...activeColors],
    remaining: [],
    lastDrawn: state.lastDrawn != null && activeColors.includes(state.lastDrawn)
      ? state.lastDrawn
      : null,
  };
}

/** Create a serializable deterministic colour-bag without consuming a draw. */
export function createColorBag(seed: number, activeColors: readonly ColorKey[]): ColorBagState {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Color-bag seed must be a safe integer');
  return {
    schemaVersion: CAMPAIGN_GENERATION_SCHEMA_VERSION,
    seed: seed >>> 0,
    rngState: seed >>> 0,
    activeColors: normalizeActiveColors(activeColors),
    remaining: [],
    lastDrawn: null,
    drawCount: 0,
  };
}

/**
 * Draw one colour. Passing the current board colours rebases the bag whenever
 * the board palette shrinks, so an obsolete colour can never escape.
 */
export function drawColorBag(
  inputState: ColorBagState,
  activeColors: readonly ColorKey[] = inputState.activeColors,
): ColorBagDraw {
  const normalized = normalizeActiveColors(activeColors);
  let state = rebaseBag(inputState, normalized);
  let remaining = state.remaining.filter((color) => normalized.includes(color));
  let rngState = state.rngState >>> 0;
  if (remaining.length === 0) {
    const refill = shuffledBag(normalized, rngState, state.lastDrawn);
    remaining = refill.remaining;
    rngState = refill.rngState;
  }
  const color = remaining[0];
  if (color == null || !normalized.includes(color)) {
    throw new Error('Color-bag invariant failed: no active color available');
  }
  state = {
    ...state,
    rngState,
    activeColors: normalized,
    remaining: remaining.slice(1),
    lastDrawn: color,
    drawCount: state.drawCount + 1,
  };
  return { color, state };
}

export function drawColorBagMany(
  inputState: ColorBagState,
  count: number,
  activeColors: readonly ColorKey[] = inputState.activeColors,
): ColorBagDrawMany {
  if (!Number.isInteger(count) || count < 0 || count > MAX_BULK_DRAWS) {
    throw new RangeError(`Color-bag draw count must be an integer from 0 to ${MAX_BULK_DRAWS}`);
  }
  const colors: ColorKey[] = [];
  let state = inputState;
  for (let index = 0; index < count; index += 1) {
    const draw = drawColorBag(state, activeColors);
    colors.push(draw.color);
    state = draw.state;
  }
  return { colors, state };
}

/**
 * Build the complete opening hex layout for one of the 30 campaign levels.
 * Even rows use GRID.cols and odd rows use GRID.cols - 1, matching Phaser's
 * existing hex geometry exactly.
 */
export function buildCampaignOpening(input: CampaignGenerationIdentity): CampaignOpening {
  const identity = assertIdentity(input);
  const definition = LEVELS[identity.level];
  const palette = COLOR_KEYS.slice(0, definition.colors);
  const seed = streamSeed(campaignGenerationSeed(identity), 'opening');
  let bag = createColorBag(seed, palette);
  const grid: ColorKey[][] = [];

  for (let row = 0; row < definition.rows; row += 1) {
    const columns = row % 2 === 0 ? GRID.cols : GRID.cols - 1;
    const drawn = drawColorBagMany(bag, columns, palette);
    grid.push([...drawn.colors]);
    bag = drawn.state;
  }

  return {
    schemaVersion: CAMPAIGN_GENERATION_SCHEMA_VERSION,
    contentVersion: identity.contentVersion,
    level: identity.level,
    mode: identity.mode,
    seed,
    rows: definition.rows,
    columns: GRID.cols,
    palette,
    grid,
  };
}

/**
 * Sparse Level-0 teaching board. The declared first shot is a complete,
 * machine-verifiable contract:
 *
 * - a red shot at row 1 / col 1 joins the two red anchor cells;
 * - that three-cell match removes the only support for the two-cell blue limb;
 * - distant top-row anchors remain, so the board stays active for step two.
 */
export function buildLevelZeroTutorialOpening(
  input: Omit<CampaignGenerationIdentity, 'level'> = { mode: 'classic' },
): LevelZeroTutorialOpening {
  const identity = assertIdentity({ ...input, level: 0 });
  const definition = LEVELS[0];
  const palette = COLOR_KEYS.slice(0, definition.colors);
  const emptyRow = (row: number): (ColorKey | null)[] => (
    Array.from({ length: row % 2 === 0 ? GRID.cols : GRID.cols - 1 }, () => null)
  );
  const grid = Array.from({ length: definition.rows }, (_unused, row) => emptyRow(row));

  grid[0][1] = 'red';
  grid[1][0] = 'red';
  grid[2][0] = 'blue';
  grid[3][0] = 'blue';

  // This independent island deliberately survives the teaching shot.
  grid[0][8] = 'green';
  grid[0][9] = 'yellow';
  grid[0][10] = 'blue';
  grid[1][8] = 'green';

  const hangingCluster: readonly CampaignGridAddress[] = [
    { row: 2, col: 0 },
    { row: 3, col: 0 },
  ];
  return {
    schemaVersion: CAMPAIGN_GENERATION_SCHEMA_VERSION,
    variant: 'level-zero-first-shot',
    contentVersion: identity.contentVersion,
    level: 0,
    mode: identity.mode,
    seed: streamSeed(campaignGenerationSeed(identity), 'opening'),
    rows: definition.rows,
    columns: GRID.cols,
    palette,
    grid,
    firstShot: {
      loadedColor: 'red',
      target: { row: 1, col: 1 },
      anchorPair: [
        { row: 0, col: 1 },
        { row: 1, col: 0 },
      ],
      hangingCluster,
      persistentTopAnchors: [
        { row: 0, col: 8 },
        { row: 0, col: 9 },
        { row: 0, col: 10 },
      ],
      expectedMatchCount: 3,
      expectedDropCount: hangingCluster.length,
    },
  };
}

/** Create current/next colours backed by an independent campaign queue stream. */
export function createCampaignShotQueue(
  input: CampaignGenerationIdentity,
  activeColors?: readonly ColorKey[],
): ShotQueueState {
  const identity = assertIdentity(input);
  const palette = activeColors ?? COLOR_KEYS.slice(0, LEVELS[identity.level].colors);
  return createShotQueue(streamSeed(campaignGenerationSeed(identity), 'queue'), palette);
}

/** Create a general deterministic current/next queue from an explicit seed. */
export function createShotQueue(seed: number, activeColors: readonly ColorKey[]): ShotQueueState {
  const first = drawColorBag(createColorBag(seed, activeColors), activeColors);
  const second = drawColorBag(first.state, activeColors);
  return {
    schemaVersion: CAMPAIGN_GENERATION_SCHEMA_VERSION,
    seed: seed >>> 0,
    shot: 0,
    current: first.color,
    next: second.color,
    swappedThisShot: false,
    bag: second.state,
  };
}

/**
 * Replace the visible queue with an authored sequence without pretending the
 * sequence came from the deterministic colour bag. The first two colours
 * become current/next; later colours remain in a dedicated FIFO buffer.
 *
 * This is intentionally pure and preserves the bag object and all bag
 * metadata exactly. It is suitable for tutorial and replay initialization.
 */
export function preloadShotQueue(
  inputState: ShotQueueState,
  colors: ShotQueuePreload,
): ShotQueueState {
  if (colors.length < 2) {
    throw new RangeError('Shot-queue preload requires current and next colours');
  }
  if (colors.length > MAX_BULK_DRAWS) {
    throw new RangeError(`Shot-queue preload must contain at most ${MAX_BULK_DRAWS} colours`);
  }
  const activeColors = normalizeActiveColors(inputState.bag.activeColors);
  for (const color of colors) {
    if (!activeColors.includes(color)) {
      throw new RangeError(`Preloaded shot colour is not active: ${String(color)}`);
    }
  }
  return {
    ...inputState,
    current: colors[0],
    next: colors[1],
    swappedThisShot: false,
    preloaded: colors.slice(2),
  };
}

/**
 * Reconcile preloaded colours after board colours disappear. Existing valid
 * current/next colours remain stable; invalid ones are deterministically
 * replaced from a freshly rebased bag.
 */
export function reconcileShotQueue(
  inputState: ShotQueueState,
  activeColors: readonly ColorKey[],
): ShotQueueState {
  const normalized = normalizeActiveColors(activeColors);
  let bag = rebaseBag(inputState.bag, normalized);
  let current = inputState.current;
  let next = inputState.next;
  const inputPreloaded = inputState.preloaded;
  const preloaded = inputPreloaded?.filter((color) => normalized.includes(color));
  if (!normalized.includes(current)) {
    const replacement = drawColorBag(bag, normalized);
    current = replacement.color;
    bag = replacement.state;
  }
  if (!normalized.includes(next)) {
    const replacement = drawColorBag(bag, normalized);
    next = replacement.color;
    bag = replacement.state;
  }
  const preloadUnchanged = inputPreloaded == null
    || (preloaded?.length === inputPreloaded.length);
  if (bag === inputState.bag
    && current === inputState.current
    && next === inputState.next
    && preloadUnchanged) {
    return inputState;
  }
  return { ...inputState, current, next, preloaded, bag };
}

/**
 * Swap current and next at most once before a shot. A repeated request is a
 * pure no-op until advanceShotQueue commits the shot and resets the gate.
 */
export function swapShotQueue(
  inputState: ShotQueueState,
  activeColors: readonly ColorKey[] = inputState.bag.activeColors,
): ShotQueueSwap {
  const state = reconcileShotQueue(inputState, activeColors);
  if (state.swappedThisShot) return { applied: false, state };
  return {
    applied: true,
    state: {
      ...state,
      current: state.next,
      next: state.current,
      swappedThisShot: true,
    },
  };
}

/**
 * Commit the fired current colour, promote next, draw a replacement and reset
 * the one-swap gate for the following shot.
 */
export function advanceShotQueue(
  inputState: ShotQueueState,
  activeColors: readonly ColorKey[],
): ShotQueueState {
  const state = reconcileShotQueue(inputState, activeColors);
  const preloaded = state.preloaded ?? [];
  if (preloaded.length > 0) {
    return {
      ...state,
      shot: state.shot + 1,
      current: state.next,
      next: preloaded[0],
      swappedThisShot: false,
      preloaded: preloaded.slice(1),
    };
  }
  const draw = drawColorBag(state.bag, activeColors);
  return {
    ...state,
    shot: state.shot + 1,
    current: state.next,
    next: draw.color,
    swappedThisShot: false,
    bag: draw.state,
  };
}
