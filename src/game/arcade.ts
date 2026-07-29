export const ARCADE_GAME_IDS = [
  'prism-sprint',
  'nexus-aim',
  'memory-constellation',
] as const;

export type ArcadeGameId = typeof ARCADE_GAME_IDS[number];

export interface ArcadeGameDefinition {
  id: ArcadeGameId;
  title: string;
  tagline: string;
  description: string;
  accent: number;
  route: string;
  sceneData?: Readonly<Record<string, unknown>>;
}

export const ARCADE_GAME_CATALOG: readonly ArcadeGameDefinition[] = Object.freeze([
  {
    id: 'prism-sprint',
    title: 'Prism Sprint',
    tagline: '20-move daily score attack',
    description: 'Build the biggest cascade on the shared board.',
    accent: 0x50e6ff,
    route: 'Match3',
    sceneData: Object.freeze({ variant: 'sprint' }),
  },
  {
    id: 'nexus-aim',
    title: 'Nexus Aim',
    tagline: '30 shots • 11 lanes',
    description: 'Master the deterministic target stream.',
    accent: 0xb993ff,
    route: 'Endless',
    sceneData: Object.freeze({ practice: true }),
  },
  {
    id: 'memory-constellation',
    title: 'Memory Constellation',
    tagline: 'Find eight Pao pairs',
    description: 'Restore all eight pairs in fewer moves.',
    accent: 0xffcf70,
    route: 'MemoryConstellation',
  },
]);

const ARCADE_GAME_ID_SET: ReadonlySet<string> = new Set(ARCADE_GAME_IDS);

export function isArcadeGameId(value: unknown): value is ArcadeGameId {
  return typeof value === 'string' && ARCADE_GAME_ID_SET.has(value);
}

export function getArcadeGameDefinition(id: ArcadeGameId): ArcadeGameDefinition {
  const definition = ARCADE_GAME_CATALOG.find((entry) => entry.id === id);
  if (!definition) throw new RangeError(`Unknown arcade game: ${String(id)}`);
  return definition;
}

export const MEMORY_CONSTELLATION_ROWS = 4 as const;
export const MEMORY_CONSTELLATION_COLUMNS = 4 as const;
export const MEMORY_CONSTELLATION_PAIR_COUNT = 8 as const;
export const MEMORY_CONSTELLATION_CARD_COUNT = 16 as const;

/**
 * Stable indices bind memory pieces to the eight approved Pao symbol/material
 * identities. Runtime art can change without changing deterministic replays.
 */
export const MEMORY_CONSTELLATION_IDENTITIES = Object.freeze([
  { symbolIndex: 0, colorIndex: 0 },
  { symbolIndex: 1, colorIndex: 1 },
  { symbolIndex: 2, colorIndex: 2 },
  { symbolIndex: 3, colorIndex: 3 },
  { symbolIndex: 4, colorIndex: 4 },
  { symbolIndex: 5, colorIndex: 5 },
  { symbolIndex: 6, colorIndex: 6 },
  { symbolIndex: 7, colorIndex: 7 },
] as const);

export type MemoryConstellationPhase =
  | 'ready'
  | 'one-revealed'
  | 'mismatch'
  | 'completed';

export type MemoryConstellationCardState = 'hidden' | 'revealed' | 'matched';

export interface MemoryConstellationCard {
  /** Stable card identity before shuffling. */
  id: number;
  pairIndex: number;
  symbolIndex: number;
  colorIndex: number;
  state: MemoryConstellationCardState;
}

export interface MemoryConstellationState {
  version: 1;
  seed: number;
  phase: MemoryConstellationPhase;
  cards: MemoryConstellationCard[];
  /** Board slot indices, not stable card ids. */
  firstIndex: number | null;
  secondIndex: number | null;
  moves: number;
  matchedPairs: number;
  completed: boolean;
}

export type MemoryConstellationRejectReason =
  | 'invalid-state'
  | 'invalid-index'
  | 'awaiting-resolution'
  | 'already-visible'
  | 'completed'
  | 'no-mismatch';

export type MemoryConstellationEvent =
  | 'first-reveal'
  | 'match'
  | 'mismatch'
  | 'completed'
  | 'mismatch-resolved';

export type MemoryConstellationActionResult =
  | {
      accepted: true;
      event: MemoryConstellationEvent;
      state: MemoryConstellationState;
    }
  | {
      accepted: false;
      reason: MemoryConstellationRejectReason;
      /** Null means the supplied state failed structural validation. */
      state: MemoryConstellationState | null;
    };

function safeSeed(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return value >>> 0;
}

function nextRandom(state: number): [number, number] {
  const next = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
  return [next, next / 0x1_0000_0000];
}

function cloneMemoryCard(card: MemoryConstellationCard): MemoryConstellationCard {
  return { ...card };
}

export function cloneMemoryConstellationState(
  state: MemoryConstellationState,
): MemoryConstellationState {
  return {
    ...state,
    cards: state.cards.map(cloneMemoryCard),
  };
}

/**
 * Creates a deterministic 4x4 deck. The seed is normalized to uint32 so native
 * and web callers share the same shuffled slot order.
 */
export function createMemoryConstellationState(seed: number): MemoryConstellationState {
  const normalizedSeed = safeSeed(seed);
  if (normalizedSeed === null) throw new RangeError('Memory seed must be a safe integer.');

  const cards: MemoryConstellationCard[] = [];
  for (let pairIndex = 0; pairIndex < MEMORY_CONSTELLATION_PAIR_COUNT; pairIndex += 1) {
    const identity = MEMORY_CONSTELLATION_IDENTITIES[pairIndex];
    for (let copy = 0; copy < 2; copy += 1) {
      cards.push({
        id: pairIndex * 2 + copy,
        pairIndex,
        symbolIndex: identity.symbolIndex,
        colorIndex: identity.colorIndex,
        state: 'hidden',
      });
    }
  }

  let randomState = (normalizedSeed ^ 0xa17c_9e3d) >>> 0;
  for (let index = cards.length - 1; index > 0; index -= 1) {
    let random: number;
    [randomState, random] = nextRandom(randomState);
    const swapIndex = Math.floor(random * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }

  return {
    version: 1,
    seed: normalizedSeed,
    phase: 'ready',
    cards,
    firstIndex: null,
    secondIndex: null,
    moves: 0,
    matchedPairs: 0,
    completed: false,
  };
}

function isIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function validSlot(value: unknown): value is number {
  return isIntegerBetween(value, 0, MEMORY_CONSTELLATION_CARD_COUNT - 1);
}

/**
 * Full invariant validation intentionally rejects partial or contradictory
 * state. Gameplay actions never attempt to repair corrupted state.
 */
export function validateMemoryConstellationState(
  value: unknown,
): value is MemoryConstellationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Partial<MemoryConstellationState>;
  const normalizedSeed = safeSeed(state.seed);
  if (state.version !== 1
    || normalizedSeed === null
    || normalizedSeed !== state.seed
    || !['ready', 'one-revealed', 'mismatch', 'completed'].includes(String(state.phase))
    || !Array.isArray(state.cards)
    || state.cards.length !== MEMORY_CONSTELLATION_CARD_COUNT
    || !isIntegerBetween(state.moves, 0, 1_000_000)
    || !isIntegerBetween(state.matchedPairs, 0, MEMORY_CONSTELLATION_PAIR_COUNT)
    || typeof state.completed !== 'boolean') {
    return false;
  }

  const ids = new Set<number>();
  const pairCounts = Array.from({ length: MEMORY_CONSTELLATION_PAIR_COUNT }, () => 0);
  const pairMatchedCounts = Array.from({ length: MEMORY_CONSTELLATION_PAIR_COUNT }, () => 0);
  const revealedIndices: number[] = [];
  let matchedCards = 0;

  for (let index = 0; index < state.cards.length; index += 1) {
    const card = state.cards[index] as Partial<MemoryConstellationCard> | null;
    if (!card
      || !isIntegerBetween(card.id, 0, MEMORY_CONSTELLATION_CARD_COUNT - 1)
      || ids.has(card.id)
      || !isIntegerBetween(card.pairIndex, 0, MEMORY_CONSTELLATION_PAIR_COUNT - 1)
      || card.symbolIndex !== card.pairIndex
      || card.colorIndex !== card.pairIndex
      || !['hidden', 'revealed', 'matched'].includes(String(card.state))) {
      return false;
    }
    ids.add(card.id);
    pairCounts[card.pairIndex] += 1;
    if (card.state === 'matched') {
      pairMatchedCounts[card.pairIndex] += 1;
      matchedCards += 1;
    } else if (card.state === 'revealed') {
      revealedIndices.push(index);
    }
  }

  if (pairCounts.some((count) => count !== 2)
    || pairMatchedCounts.some((count) => count !== 0 && count !== 2)
    || matchedCards / 2 !== state.matchedPairs
    || state.moves < state.matchedPairs) {
    return false;
  }

  const phase = state.phase as MemoryConstellationPhase;
  if (phase === 'ready') {
    return !state.completed
      && state.matchedPairs < MEMORY_CONSTELLATION_PAIR_COUNT
      && state.firstIndex === null
      && state.secondIndex === null
      && revealedIndices.length === 0;
  }
  if (phase === 'one-revealed') {
    return !state.completed
      && validSlot(state.firstIndex)
      && state.secondIndex === null
      && revealedIndices.length === 1
      && revealedIndices[0] === state.firstIndex;
  }
  if (phase === 'mismatch') {
    return !state.completed
      && validSlot(state.firstIndex)
      && validSlot(state.secondIndex)
      && state.firstIndex !== state.secondIndex
      && revealedIndices.length === 2
      && revealedIndices.includes(state.firstIndex)
      && revealedIndices.includes(state.secondIndex)
      && state.cards[state.firstIndex].pairIndex !== state.cards[state.secondIndex].pairIndex;
  }
  return state.completed
    && state.matchedPairs === MEMORY_CONSTELLATION_PAIR_COUNT
    && state.firstIndex === null
    && state.secondIndex === null
    && revealedIndices.length === 0
    && matchedCards === MEMORY_CONSTELLATION_CARD_COUNT;
}

function rejected(
  value: unknown,
  reason: MemoryConstellationRejectReason,
): MemoryConstellationActionResult {
  return {
    accepted: false,
    reason,
    state: validateMemoryConstellationState(value)
      ? cloneMemoryConstellationState(value)
      : null,
  };
}

export function revealMemoryConstellationCard(
  value: unknown,
  index: unknown,
): MemoryConstellationActionResult {
  if (!validateMemoryConstellationState(value)) return rejected(value, 'invalid-state');
  if (!validSlot(index)) return rejected(value, 'invalid-index');
  if (value.completed) return rejected(value, 'completed');
  if (value.phase === 'mismatch') return rejected(value, 'awaiting-resolution');
  if (value.cards[index].state !== 'hidden') return rejected(value, 'already-visible');

  const state = cloneMemoryConstellationState(value);
  state.cards[index].state = 'revealed';
  if (state.phase === 'ready') {
    state.phase = 'one-revealed';
    state.firstIndex = index;
    return { accepted: true, event: 'first-reveal', state };
  }

  const firstIndex = state.firstIndex;
  if (!validSlot(firstIndex)) return rejected(value, 'invalid-state');
  state.secondIndex = index;
  state.moves += 1;

  if (state.cards[firstIndex].pairIndex !== state.cards[index].pairIndex) {
    state.phase = 'mismatch';
    return { accepted: true, event: 'mismatch', state };
  }

  state.cards[firstIndex].state = 'matched';
  state.cards[index].state = 'matched';
  state.matchedPairs += 1;
  state.firstIndex = null;
  state.secondIndex = null;
  if (state.matchedPairs === MEMORY_CONSTELLATION_PAIR_COUNT) {
    state.phase = 'completed';
    state.completed = true;
    return { accepted: true, event: 'completed', state };
  }
  state.phase = 'ready';
  return { accepted: true, event: 'match', state };
}

export function resolveMemoryConstellationMismatch(
  value: unknown,
): MemoryConstellationActionResult {
  if (!validateMemoryConstellationState(value)) return rejected(value, 'invalid-state');
  if (value.completed) return rejected(value, 'completed');
  if (value.phase !== 'mismatch'
    || !validSlot(value.firstIndex)
    || !validSlot(value.secondIndex)) {
    return rejected(value, 'no-mismatch');
  }

  const state = cloneMemoryConstellationState(value);
  state.cards[state.firstIndex!].state = 'hidden';
  state.cards[state.secondIndex!].state = 'hidden';
  state.firstIndex = null;
  state.secondIndex = null;
  state.phase = 'ready';
  return { accepted: true, event: 'mismatch-resolved', state };
}

export function memoryConstellationFingerprint(state: MemoryConstellationState): string {
  if (!validateMemoryConstellationState(state)) throw new TypeError('Invalid memory state.');
  return state.cards.map((card) => `${card.id}:${card.pairIndex}:${card.state}`).join('|');
}
