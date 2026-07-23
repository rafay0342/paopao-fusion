export const GAMEPLAY_TELEMETRY_CONSENT = 'product-telemetry-v1';
export const GAMEPLAY_TELEMETRY_STORAGE_KEY = 'paopao.gameplay-telemetry.v1';
export const GAMEPLAY_TELEMETRY_BATCH_SIZE = 25;
export const GAMEPLAY_TELEMETRY_MAX_EVENTS = 100;

export const GAMEPLAY_EVENT_TYPES = [
  'tutorial-step',
  'level-start',
  'level-end',
  'level-exit',
  'shot-result',
  'boss-phase',
  'reward-claim',
  'hand-state',
  'session-exit',
  'next-action',
] as const;

export type GameplayEventType = typeof GAMEPLAY_EVENT_TYPES[number];
export type GameplayInputMode = 'touch' | 'mouse' | 'keyboard' | 'gamepad' | 'hand' | 'unknown';
export type GameplayMode = 'classic' | 'rush' | 'precision' | 'endless' | 'arena' | 'tutorial';
export type GameplayTelemetryOutcome =
  | 'started'
  | 'completed'
  | 'failed'
  | 'quit'
  | 'won'
  | 'lost'
  | 'hit'
  | 'miss'
  | 'claimed'
  | 'denied'
  | 'ready'
  | 'uncertain'
  | 'recovered'
  | 'selected';
export type GameplayTelemetryReason =
  | 'completed'
  | 'danger-line'
  | 'shot-limit'
  | 'timer'
  | 'player-exit'
  | 'tracking-loss'
  | 'camera-loss'
  | 'renderer-loss'
  | 'offline'
  | 'authority-denied'
  | 'unknown';
export type GameplayTutorialStep =
  | 'aim'
  | 'fire'
  | 'match-three'
  | 'drop-cluster'
  | 'next-orb'
  | 'swap'
  | 'danger-line'
  | 'objective'
  | 'hand-touch-one'
  | 'hand-touch-two';

export interface GameplayTelemetryInput {
  type: GameplayEventType;
  level?: number;
  mode?: GameplayMode;
  inputMode?: GameplayInputMode;
  step?: GameplayTutorialStep;
  outcome?: GameplayTelemetryOutcome;
  reason?: GameplayTelemetryReason;
  bossPhase?: number;
  shots?: number;
  hits?: number;
  won?: boolean;
  bankShot?: boolean;
}

export interface GameplayTelemetryEvent extends GameplayTelemetryInput {
  eventId: string;
  sessionId: string;
  occurredAtMs: number;
}

export interface GameplayTelemetryBatch {
  batchId: string;
  events: GameplayTelemetryEvent[];
}

interface StoredGameplayTelemetry {
  version: 1;
  consent: boolean;
  batches: GameplayTelemetryBatch[];
}

export interface TelemetryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type GameplayTelemetrySender = (batch: GameplayTelemetryBatch) => Promise<boolean>;

export interface GameplayTelemetryQueueOptions {
  storage?: TelemetryStorage;
  sender?: GameplayTelemetrySender;
  now?: () => number;
  createId?: (prefix: 'evt' | 'ses' | 'bat') => string;
}

const EVENT_TYPES = new Set<string>(GAMEPLAY_EVENT_TYPES);
const INPUT_MODES = new Set<string>(['touch', 'mouse', 'keyboard', 'gamepad', 'hand', 'unknown']);
const MODES = new Set<string>(['classic', 'rush', 'precision', 'endless', 'arena', 'tutorial']);
const OUTCOMES = new Set<string>([
  'started', 'completed', 'failed', 'quit', 'won', 'lost', 'hit', 'miss',
  'claimed', 'denied', 'ready', 'uncertain', 'recovered', 'selected',
]);
const REASONS = new Set<string>([
  'completed', 'danger-line', 'shot-limit', 'timer', 'player-exit', 'tracking-loss',
  'camera-loss', 'renderer-loss', 'offline', 'authority-denied', 'unknown',
]);
const TUTORIAL_STEPS = new Set<string>([
  'aim', 'fire', 'match-three', 'drop-cluster', 'next-orb', 'swap', 'danger-line',
  'objective', 'hand-touch-one', 'hand-touch-two',
]);
const INPUT_KEYS = new Set([
  'type', 'level', 'mode', 'inputMode', 'step', 'outcome', 'reason',
  'bossPhase', 'shots', 'hits', 'won', 'bankShot',
]);

let fallbackIdCounter = 0;

const createSecureId = (prefix: 'evt' | 'ses' | 'bat'): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return `${prefix}_${cryptoApi.randomUUID()}`;
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return `${prefix}_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  fallbackIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${fallbackIdCounter.toString(36)}`;
};

const finiteInteger = (value: unknown, minimum: number, maximum: number): number | undefined => {
  if (!Number.isInteger(value)) return undefined;
  const numeric = Number(value);
  return numeric >= minimum && numeric <= maximum ? numeric : undefined;
};

const enumValue = <T extends string>(value: unknown, values: ReadonlySet<string>): T | undefined => (
  typeof value === 'string' && values.has(value) ? value as T : undefined
);

/**
 * Runtime validation intentionally accepts only bounded enums and counters.
 * Free-form strings, coordinates, camera data, landmarks and PII cannot enter
 * the product telemetry queue.
 */
export function normalizeGameplayTelemetryInput(value: unknown): GameplayTelemetryInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !INPUT_KEYS.has(key))) return null;
  const type = enumValue<GameplayEventType>(input.type, EVENT_TYPES);
  if (!type) return null;

  const level = input.level === undefined ? undefined : finiteInteger(input.level, 0, 999);
  const bossPhase = input.bossPhase === undefined ? undefined : finiteInteger(input.bossPhase, 0, 20);
  const shots = input.shots === undefined ? undefined : finiteInteger(input.shots, 0, 10_000);
  const hits = input.hits === undefined ? undefined : finiteInteger(input.hits, 0, 10_000);
  if ((input.level !== undefined && level === undefined)
    || (input.bossPhase !== undefined && bossPhase === undefined)
    || (input.shots !== undefined && shots === undefined)
    || (input.hits !== undefined && hits === undefined)) return null;
  if ((input.won !== undefined && typeof input.won !== 'boolean')
    || (input.bankShot !== undefined && typeof input.bankShot !== 'boolean')) return null;

  const mode = input.mode === undefined ? undefined : enumValue<GameplayMode>(input.mode, MODES);
  const inputMode = input.inputMode === undefined
    ? undefined
    : enumValue<GameplayInputMode>(input.inputMode, INPUT_MODES);
  const step = input.step === undefined
    ? undefined
    : enumValue<GameplayTutorialStep>(input.step, TUTORIAL_STEPS);
  const outcome = input.outcome === undefined
    ? undefined
    : enumValue<GameplayTelemetryOutcome>(input.outcome, OUTCOMES);
  const reason = input.reason === undefined
    ? undefined
    : enumValue<GameplayTelemetryReason>(input.reason, REASONS);
  if ((input.mode !== undefined && mode === undefined)
    || (input.inputMode !== undefined && inputMode === undefined)
    || (input.step !== undefined && step === undefined)
    || (input.outcome !== undefined && outcome === undefined)
    || (input.reason !== undefined && reason === undefined)) return null;

  return {
    type,
    ...(level === undefined ? {} : { level }),
    ...(mode === undefined ? {} : { mode }),
    ...(inputMode === undefined ? {} : { inputMode }),
    ...(step === undefined ? {} : { step }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(reason === undefined ? {} : { reason }),
    ...(bossPhase === undefined ? {} : { bossPhase }),
    ...(shots === undefined ? {} : { shots }),
    ...(hits === undefined ? {} : { hits }),
    ...(input.won === undefined ? {} : { won: input.won }),
    ...(input.bankShot === undefined ? {} : { bankShot: input.bankShot }),
  };
}

const defaultSender: GameplayTelemetrySender = async (batch) => {
  if (typeof fetch !== 'function') return false;
  const response = await fetch('/api/v3/telemetry/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      client: 'classic',
      anonymous: true,
      consentVersion: GAMEPLAY_TELEMETRY_CONSENT,
      batchId: batch.batchId,
      events: batch.events,
    }),
  });
  if (!response.ok) return false;
  const result = await response.json() as { accepted?: number; duplicate?: boolean };
  return result.duplicate === true || result.accepted === batch.events.length;
};

const safeStorage = (): TelemetryStorage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export class GameplayTelemetryQueue {
  private readonly storage?: TelemetryStorage;
  private readonly sender: GameplayTelemetrySender;
  private readonly now: () => number;
  private readonly createId: (prefix: 'evt' | 'ses' | 'bat') => string;
  private readonly sessionId: string;
  private state: StoredGameplayTelemetry;
  private flushing: Promise<void> | null = null;
  private sealedBatchId = '';

  constructor(options: GameplayTelemetryQueueOptions = {}) {
    this.storage = options.storage;
    this.sender = options.sender ?? defaultSender;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? createSecureId;
    this.sessionId = this.createId('ses');
    this.state = this.readState();
  }

  hasConsent(): boolean { return this.state.consent; }

  setConsent(consent: boolean): void {
    this.state.consent = consent;
    if (!consent) this.state.batches = [];
    this.persist();
  }

  pendingCount(): number {
    return this.state.batches.reduce((total, batch) => total + batch.events.length, 0);
  }

  track(value: unknown): boolean {
    if (!this.state.consent || this.pendingCount() >= GAMEPLAY_TELEMETRY_MAX_EVENTS) return false;
    const input = normalizeGameplayTelemetryInput(value);
    if (!input) return false;
    const event: GameplayTelemetryEvent = {
      ...input,
      eventId: this.createId('evt'),
      sessionId: this.sessionId,
      occurredAtMs: Math.max(0, Math.floor(this.now())),
    };
    let batch = this.state.batches[this.state.batches.length - 1];
    if (!batch || batch.events.length >= GAMEPLAY_TELEMETRY_BATCH_SIZE || batch.batchId === this.sealedBatchId) {
      batch = { batchId: this.createId('bat'), events: [] };
      this.state.batches.push(batch);
    }
    batch.events.push(event);
    this.persist();
    return true;
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushPending().finally(() => {
      this.sealedBatchId = '';
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushPending(): Promise<void> {
    while (this.state.consent && this.state.batches.length > 0) {
      const batch = this.state.batches[0];
      this.sealedBatchId = batch.batchId;
      let accepted = false;
      try {
        accepted = await this.sender({
          batchId: batch.batchId,
          events: batch.events.map((event) => ({ ...event })),
        });
      } catch {
        accepted = false;
      }
      if (!accepted) return;
      if (this.state.batches[0]?.batchId === batch.batchId) this.state.batches.shift();
      this.sealedBatchId = '';
      this.persist();
    }
  }

  private readState(): StoredGameplayTelemetry {
    try {
      const parsed = JSON.parse(this.storage?.getItem(GAMEPLAY_TELEMETRY_STORAGE_KEY) ?? '') as Partial<StoredGameplayTelemetry>;
      if (parsed.version !== 1 || parsed.consent !== true || !Array.isArray(parsed.batches)) {
        return { version: 1, consent: false, batches: [] };
      }
      const batches = parsed.batches
        .filter((batch): batch is GameplayTelemetryBatch => (
          Boolean(batch)
          && typeof batch.batchId === 'string'
          && Array.isArray(batch.events)
          && batch.events.length > 0
          && batch.events.length <= GAMEPLAY_TELEMETRY_BATCH_SIZE
        ))
        .slice(0, Math.ceil(GAMEPLAY_TELEMETRY_MAX_EVENTS / GAMEPLAY_TELEMETRY_BATCH_SIZE));
      return { version: 1, consent: true, batches };
    } catch {
      return { version: 1, consent: false, batches: [] };
    }
  }

  private persist(): void {
    try {
      if (!this.storage) return;
      if (!this.state.consent && this.state.batches.length === 0) {
        this.storage.removeItem(GAMEPLAY_TELEMETRY_STORAGE_KEY);
        return;
      }
      this.storage.setItem(GAMEPLAY_TELEMETRY_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Telemetry must never interrupt gameplay when storage is unavailable.
    }
  }
}

let defaultQueue: GameplayTelemetryQueue | null = null;

const queue = (): GameplayTelemetryQueue => {
  defaultQueue ??= new GameplayTelemetryQueue({ storage: safeStorage() });
  return defaultQueue;
};

export const setGameplayTelemetryConsent = (consent: boolean): void => queue().setConsent(consent);
export const hasGameplayTelemetryConsent = (): boolean => queue().hasConsent();
export const trackGameplayEvent = (event: GameplayTelemetryInput): boolean => queue().track(event);
export const flushGameplayTelemetry = (): Promise<void> => queue().flush();
