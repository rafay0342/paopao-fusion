import {
  buildClassicProgressUpdateV3,
  classicProgressUpdateMatchesEnvelopeV3,
  parseProgressEnvelopeV3,
  type PlayerSaveV4,
  type BootstrapV3,
  type ProgressEnvelopeV3,
  type RunReceiptV3,
  type RunSubmissionV3,
} from './contracts';
import {
  initializeClassicPlayerSaveV4,
  mergeProgressEnvelopeIntoClassicSaveV4,
} from './save-v4';
import { applyServerInventorySnapshot, type InventoryItemId, type InventorySnapshot } from './inventory';
import { applyServerEntitlements, applyServerWallet } from './meta';
import { verifySignedPayloadV3 } from './endless';

export interface PlatformWallet { coins: number; diamonds: number; revision: number; updatedAt: string }
export interface PlatformAccount { userId: string; displayName: string; updatedAt: string; wallet: PlatformWallet; csrfToken?: string }
export interface CatalogOffer { offerId: string; title: string; currency: 'coins' | 'diamonds'; price: number; grantKind: 'inventory' | 'entitlement'; grantId: string; quantity: number }
export interface PurchaseReceipt { receiptId: string; orderId: string; offerId: string; status: 'settled'; currency: 'coins' | 'diamonds'; amount: number; balance: number; grant: { kind: string; id: string; quantity: number }; createdAt: string }
export interface PlatformInventoryV2 {
  revision: number;
  items: Array<{ itemId: string; quantity: number }>;
  entitlements: Array<{ entitlementId: string; source: string; createdAt: string }>;
}
export interface PlatformInventoryConsumption {
  duplicate: boolean;
  entryId: string;
  inventory: PlatformInventoryV2;
  local: InventorySnapshot;
}

export interface ClassicRunSettlementResult {
  settled: number;
  remaining: number;
  receipts: RunReceiptV3[];
  lastError?: string;
}

export interface ClassicAuthorityTargetV3 {
  sequence: number;
  lane: number;
  angleMilliDegrees: number;
  toleranceLanes: number;
}

export interface ClassicAuthorityTicketV3 {
  duplicate: boolean;
  ticketId: string;
  ticketToken: string;
  runId: string;
  level: number;
  mode: 'classic' | 'rush' | 'precision';
  startedAt: string;
  expiresAt: string;
  rulesVersion: number;
  requiredShots: number;
  requiredProofHits: number;
  minimumDurationMs: number;
  target: ClassicAuthorityTargetV3;
}

export interface ClassicAuthorityShotReceiptV3 {
  accepted: boolean;
  duplicate: boolean;
  sequence: number;
  ack: string;
  proofHit: boolean;
  proofHits: number;
  requiredProofHits: number;
  requiredShots: number;
  completed: boolean;
  terminalChallenge?: string;
  nextTarget: ClassicAuthorityTargetV3 | null;
}

const CSRF_KEY = 'paopao-fusion-csrf-v11';
const ACCOUNT_HINT_KEY = 'paopao-fusion-platform-account-v1';
export const CLASSIC_RUN_QUEUE_KEY = 'paopao-fusion-classic-run-queue-v1';
const CLASSIC_RUN_QUEUE_LIMIT = 64;
export const PLATFORM_REQUEST_TIMEOUT_MS = 12_000;
export const ARENA_HEARTBEAT_MS = 5_000;
export const ARENA_LIVENESS_TIMEOUT_MS = 16_000;
export const ARENA_MAX_OUTBOUND_QUEUE = 64;
const ARENA_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;
let cachedAccount: PlatformAccount | null | undefined;
let platformApiAvailable = false;
let volatileCsrfToken = '';
let classicProgressSyncInFlight: Promise<PlayerSaveV4> | undefined;
let volatileClassicRunQueue: PendingClassicRunV3[] = [];
let classicRunFlushInFlight: Promise<ClassicRunSettlementResult> | undefined;
let classicRunFlushOwner = '';
let classicAuthorityStartSerial: Promise<void> = Promise.resolve();

/**
 * Static exports deliberately ship without the Fastify platform API. Runtime
 * telemetry and other optional background traffic must remain off until the
 * account-status contract proves that the API is actually mounted.
 */
export function isPlatformApiAvailable(): boolean {
  return platformApiAvailable;
}

interface PendingClassicRunV3 {
  ownerUserId: string;
  submission: RunSubmissionV3;
  queuedAt: string;
}

class PlatformApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown, message: string) {
    super(message);
  }
}

interface PlatformRequestDeadline {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
}

/** Compose platform calls with caller cancellation and a finite hard deadline. */
export function createPlatformRequestDeadline(
  parent?: AbortSignal | null,
  timeoutMs = PLATFORM_REQUEST_TIMEOUT_MS,
): PlatformRequestDeadline {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = (): void => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('request-timeout'));
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timer);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

function browserSessionStorage(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; }
  catch { return null; }
}

function browserLocalStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

function saveAccountHint(account: PlatformAccount): void {
  try { browserLocalStorage()?.setItem(ACCOUNT_HINT_KEY, JSON.stringify({ userId: account.userId, boundAt: new Date().toISOString() })); }
  catch { /* the authenticated HTTP-only cookie remains the authority */ }
}

function clearAccountHint(): void {
  try { browserLocalStorage()?.removeItem(ACCOUNT_HINT_KEY); } catch { /* cookie revocation already succeeded */ }
}

export function hasPlatformAccountBinding(): boolean {
  try {
    const raw = JSON.parse(browserLocalStorage()?.getItem(ACCOUNT_HINT_KEY) ?? 'null') as { userId?: unknown } | null;
    return typeof raw?.userId === 'string' && /^usr_[A-Za-z0-9_-]{16,}$/.test(raw.userId);
  } catch { return false; }
}

function boundPlatformUserId(): string {
  try {
    const raw = JSON.parse(browserLocalStorage()?.getItem(ACCOUNT_HINT_KEY) ?? 'null') as { userId?: unknown } | null;
    return typeof raw?.userId === 'string' && /^usr_[A-Za-z0-9_-]{16,}$/.test(raw.userId) ? raw.userId : '';
  } catch { return ''; }
}

/** True when local currency must never be treated as spendable server wallet. */
export function usesAuthoritativePlatformEconomy(): boolean {
  return Boolean(cachedAccount?.userId || boundPlatformUserId());
}

function readCsrfToken(): string {
  const storage = browserSessionStorage();
  if (!storage) return volatileCsrfToken;
  try {
    const token = storage.getItem(CSRF_KEY);
    if (token) volatileCsrfToken = token;
  } catch {
    // The last in-memory token keeps the authenticated tab usable.
  }
  return volatileCsrfToken;
}

function saveCsrfToken(token: string): void {
  volatileCsrfToken = token.trim().slice(0, 4096);
  const storage = browserSessionStorage();
  if (!storage) return;
  try { storage.setItem(CSRF_KEY, volatileCsrfToken); } catch { /* retain memory fallback */ }
}

function clearCsrfToken(): void {
  volatileCsrfToken = '';
  const storage = browserSessionStorage();
  if (!storage) return;
  try { storage.removeItem(CSRF_KEY); } catch { /* memory is already cleared */ }
}

function idempotencyKey(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Timestamp and entropy fallback below is adequate for a per-device key.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : minimum;
}

function normalizeClassicRunSubmission(value: unknown): RunSubmissionV3 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<RunSubmissionV3>;
  if (typeof raw.runId !== 'string' || !/^[A-Za-z0-9._:-]{8,96}$/.test(raw.runId)
    || !['classic', 'rush', 'precision'].includes(String(raw.mode))
    || typeof raw.won !== 'boolean') return null;
  const shots = boundedInteger(raw.shots, 0, 5_000);
  const hits = Math.min(shots, boundedInteger(raw.hits, 0, 5_000));
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
    ? raw.createdAt
    : new Date().toISOString();
  const shotTrace = Array.isArray(raw.shotTrace) && raw.shotTrace.length <= 250
    ? raw.shotTrace.map((shot, sequence) => ({
      sequence,
      atMs: boundedInteger(shot?.atMs, 0, 14_400_000),
      angleMilliDegrees: boundedInteger(shot?.angleMilliDegrees, -30_000, 30_000),
    }))
    : undefined;
  const classicAuthority = typeof raw.classicTicketId === 'string'
    && /^ctk_[A-Za-z0-9_-]{8,92}$/.test(raw.classicTicketId)
    && typeof raw.classicTicketToken === 'string'
    && raw.classicTicketToken.length >= 32
    && raw.classicTicketToken.length <= 1_024
    && typeof raw.classicTerminalChallenge === 'string'
    && raw.classicTerminalChallenge.length >= 32
    && raw.classicTerminalChallenge.length <= 1_024
    ? {
      classicTicketId: raw.classicTicketId,
      classicTicketToken: raw.classicTicketToken,
      classicTerminalChallenge: raw.classicTerminalChallenge,
    }
    : undefined;
  return {
    runId: raw.runId,
    client: 'classic',
    level: boundedInteger(raw.level, 0, 29),
    mode: raw.mode as 'classic' | 'rush' | 'precision',
    score: boundedInteger(raw.score, 0, 10_000_000),
    durationMs: boundedInteger(raw.durationMs, 500, 14_400_000),
    won: raw.won,
    shots,
    hits,
    ...(shotTrace ? { replayVersion: 1 as const, shotTrace } : {}),
    ...(classicAuthority ?? {}),
    createdAt,
  };
}

export function createClassicRunSubmissionV3(input: {
  runId?: string;
  level: number;
  mode: 'classic' | 'rush' | 'precision';
  score: number;
  durationMs: number;
  won: boolean;
  shots: number;
  hits: number;
  shotTrace?: Array<{ atMs: number; angleMilliDegrees: number }>;
  classicTicketId?: string;
  classicTicketToken?: string;
  classicTerminalChallenge?: string;
  createdAt?: string;
}): RunSubmissionV3 {
  const submission = normalizeClassicRunSubmission({
    ...input,
    runId: input.runId ?? `classic-${idempotencyKey('run')}`,
    client: 'classic',
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  if (!submission) throw new Error('classic-run-invalid');
  return submission;
}

function normalizePendingClassicRun(value: unknown): PendingClassicRunV3 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<PendingClassicRunV3>;
  const ownerUserId = typeof raw.ownerUserId === 'string' && /^usr_[A-Za-z0-9_-]{16,}$/.test(raw.ownerUserId)
    ? raw.ownerUserId
    : '';
  const submission = normalizeClassicRunSubmission(raw.submission);
  if (!ownerUserId || !submission) return null;
  return {
    ownerUserId,
    submission,
    queuedAt: typeof raw.queuedAt === 'string' && !Number.isNaN(Date.parse(raw.queuedAt))
      ? raw.queuedAt
      : new Date().toISOString(),
  };
}

function readClassicRunQueue(): PendingClassicRunV3[] {
  let stored: unknown[] = [];
  try {
    const parsed = JSON.parse(browserLocalStorage()?.getItem(CLASSIC_RUN_QUEUE_KEY) ?? '[]') as unknown;
    if (Array.isArray(parsed)) stored = parsed;
  } catch { /* retain the bounded in-memory queue */ }
  const byRunId = new Map<string, PendingClassicRunV3>();
  for (const candidate of [...stored, ...volatileClassicRunQueue]) {
    const pending = normalizePendingClassicRun(candidate);
    if (pending) byRunId.set(`${pending.ownerUserId}\0${pending.submission.runId}`, pending);
  }
  volatileClassicRunQueue = [...byRunId.values()].slice(-CLASSIC_RUN_QUEUE_LIMIT);
  return volatileClassicRunQueue;
}

function writeClassicRunQueue(queue: readonly PendingClassicRunV3[]): void {
  volatileClassicRunQueue = queue.slice(-CLASSIC_RUN_QUEUE_LIMIT);
  try { browserLocalStorage()?.setItem(CLASSIC_RUN_QUEUE_KEY, JSON.stringify(volatileClassicRunQueue)); }
  catch { /* current-tab retry remains available */ }
}

function enqueueClassicRun(ownerUserId: string, submission: RunSubmissionV3): void {
  const queue = readClassicRunQueue();
  const key = `${ownerUserId}\0${submission.runId}`;
  if (queue.some((entry) => `${entry.ownerUserId}\0${entry.submission.runId}` === key)) return;
  writeClassicRunQueue([...queue, { ownerUserId, submission, queuedAt: new Date().toISOString() }]);
}

function removeClassicRun(ownerUserId: string, runId: string): void {
  writeClassicRunQueue(readClassicRunQueue()
    .filter((entry) => entry.ownerUserId !== ownerUserId || entry.submission.runId !== runId));
}

export function pendingClassicRunCount(ownerUserId = boundPlatformUserId()): number {
  return readClassicRunQueue().filter((entry) => !ownerUserId || entry.ownerUserId === ownerUserId).length;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = readCsrfToken();
  const deadline = createPlatformRequestDeadline(init.signal);
  try {
    const response = await fetch(path, {
      ...init,
      signal: deadline.signal,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) {
      const error = body !== null && typeof body === 'object' && !Array.isArray(body)
        && typeof (body as Record<string, unknown>).error === 'string'
        ? String((body as Record<string, unknown>).error)
        : `request-${response.status}`;
      throw new PlatformApiError(response.status, body, error);
    }
    return body as T;
  } catch (error) {
    if (deadline.didTimeout()) throw new Error('request-timeout');
    if (init.signal?.aborted) throw new Error('request-aborted');
    throw error;
  } finally {
    deadline.cleanup();
  }
}

function requireProgressEnvelope(value: unknown): ProgressEnvelopeV3 {
  const envelope = parseProgressEnvelopeV3(value);
  if (!envelope) throw new Error('progress-envelope-invalid');
  return envelope;
}

async function performClassicProgressSync(): Promise<PlayerSaveV4> {
  initializeClassicPlayerSaveV4();
  let remote = requireProgressEnvelope(await api<unknown>('/api/v3/progress'));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const local = mergeProgressEnvelopeIntoClassicSaveV4(remote);
    const update = buildClassicProgressUpdateV3(local);
    if (!update) throw new Error('classic-progress-update-invalid');
    if (classicProgressUpdateMatchesEnvelopeV3(update, remote)) return local;
    try {
      const accepted = requireProgressEnvelope(await api<unknown>('/api/v3/progress', {
        method: 'PUT', body: JSON.stringify(update),
      }));
      return mergeProgressEnvelopeIntoClassicSaveV4(accepted);
    } catch (error) {
      const conflict = error instanceof PlatformApiError && error.status === 409
        ? parseProgressEnvelopeV3(error.body)
        : null;
      if (attempt === 0 && conflict) {
        remote = conflict;
        continue;
      }
      throw error;
    }
  }
  throw new Error('progress-revision-conflict');
}

/** Coalesce concurrent account/UI refreshes into one revision-aware V4 sync. */
export function syncClassicProgressV4(): Promise<PlayerSaveV4> {
  if (classicProgressSyncInFlight) return classicProgressSyncInFlight;
  const pending = performClassicProgressSync();
  classicProgressSyncInFlight = pending;
  void pending.finally(() => {
    if (classicProgressSyncInFlight === pending) classicProgressSyncInFlight = undefined;
  }).catch(() => { /* callers receive the original rejection */ });
  return pending;
}

function applyPlatformInventory(inventory: PlatformInventoryV2): InventorySnapshot {
  applyServerEntitlements(inventory.entitlements.map(({ entitlementId }) => entitlementId));
  return applyServerInventorySnapshot(inventory.items, inventory.revision);
}

export async function refreshPlatformAuthority(account: PlatformAccount): Promise<PlatformInventoryV2> {
  applyServerWallet(account.wallet.coins);
  const inventory = await api<PlatformInventoryV2>('/api/inventory/v2');
  applyPlatformInventory(inventory);
  return inventory;
}

export async function requestEmailOtp(email: string): Promise<{ challengeId: string; expiresAt: string; developmentCode?: string }> {
  return api('/api/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function verifyEmailOtp(challengeId: string, code: string, displayName: string): Promise<PlatformAccount> {
  const account = await api<PlatformAccount>('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify({ challengeId, code, displayName }) });
  platformApiAvailable = true;
  if (account.csrfToken) saveCsrfToken(account.csrfToken);
  cachedAccount = account;
  saveAccountHint(account);
  const [progress, authority] = await Promise.allSettled([syncClassicProgressV4(), refreshPlatformAuthority(account)]);
  if (progress.status === 'rejected') console.warn('Classic V4 progress sync will retry on account refresh.', progress.reason);
  if (authority.status === 'rejected') console.warn('Authoritative wallet/inventory hydration will retry on account refresh.', authority.reason);
  void flushPendingClassicRunsV3(account.userId);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('paopao:platform-account', { detail: cachedAccount }));
  return cachedAccount;
}

export async function getPlatformAccount(force = false): Promise<PlatformAccount | null> {
  if (!force && cachedAccount !== undefined) return cachedAccount;
  try {
    const response = await api<(PlatformAccount & { authenticated: true }) | { authenticated: false }>('/api/account/status');
    if (response.authenticated !== true && response.authenticated !== false) {
      platformApiAvailable = false;
      cachedAccount = null;
      return null;
    }
    platformApiAvailable = true;
    if (!response.authenticated) { cachedAccount = null; return null; }
    const account = response;
    if (account.csrfToken) saveCsrfToken(account.csrfToken);
    cachedAccount = account;
    saveAccountHint(account);
    const [progress, authority] = await Promise.allSettled([syncClassicProgressV4(), refreshPlatformAuthority(account)]);
    if (progress.status === 'rejected') console.warn('Classic V4 progress sync will retry on account refresh.', progress.reason);
    if (authority.status === 'rejected') console.warn('Authoritative wallet/inventory hydration will retry on account refresh.', authority.reason);
    void flushPendingClassicRunsV3(account.userId);
  } catch {
    platformApiAvailable = false;
    cachedAccount = null;
  }
  return cachedAccount;
}

export async function logoutPlatform(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  clearCsrfToken(); clearAccountHint(); cachedAccount = null;
}

export async function getCatalog(): Promise<CatalogOffer[]> {
  return (await api<{ offers: CatalogOffer[] }>('/api/catalog')).offers;
}

export async function purchaseOffer(offerId: string): Promise<PurchaseReceipt> {
  const requestKey = idempotencyKey('purchase');
  const receipt = await api<PurchaseReceipt>('/api/purchases', { method: 'POST', headers: { 'Idempotency-Key': requestKey }, body: JSON.stringify({ offerId }) });
  cachedAccount = undefined;
  return receipt;
}

export async function consumeInventoryV2(
  itemId: Exclude<InventoryItemId, 'storyShard'>,
  quantity = 1,
): Promise<PlatformInventoryConsumption> {
  const result = await api<Omit<PlatformInventoryConsumption, 'local'>>('/api/inventory/v2/consume', {
    method: 'POST',
    body: JSON.stringify({ itemId, quantity, idempotencyKey: idempotencyKey(`consume-${itemId}`) }),
  });
  return { ...result, local: applyPlatformInventory(result.inventory) };
}

export async function exchangeCoinsForDiamonds(packs: 1 | 2): Promise<PlatformWallet & { exchangedThisWeek?: number; weeklyCap?: number }> {
  const wallet = await api<PlatformWallet & { exchangedThisWeek?: number; weeklyCap?: number }>('/api/wallet/exchange', {
    method: 'POST', body: JSON.stringify({ packs, idempotencyKey: idempotencyKey('exchange') }),
  });
  cachedAccount = undefined; return wallet;
}

/** Begin a level-bound, one-time classic settlement proof before the first shot. */
export async function beginClassicRunAuthorityV3(input: {
  level: number;
  mode: 'classic' | 'rush' | 'precision';
  idempotencyKey?: string;
}): Promise<ClassicAuthorityTicketV3> {
  // The server permits one active ticket per player. Preserve request order so
  // a slow, stale scene start cannot arrive after and abandon the newer ticket.
  const request = classicAuthorityStartSerial.then(() => (
    api<ClassicAuthorityTicketV3>('/api/v3/classic/runs/start', {
      method: 'POST',
      body: JSON.stringify({
        level: boundedInteger(input.level, 0, 29),
        mode: input.mode,
        idempotencyKey: input.idempotencyKey ?? idempotencyKey('classic-authority'),
      }),
    })
  ));
  classicAuthorityStartSerial = request.then(() => undefined, () => undefined);
  return request;
}

/** Persist one chronological aim receipt on the server; claims are not inputs. */
export async function recordClassicAuthorityShotV3(
  ticket: Pick<ClassicAuthorityTicketV3, 'ticketId' | 'ticketToken'>,
  shot: { sequence: number; atMs: number; angleMilliDegrees: number },
  previousAck = '',
): Promise<ClassicAuthorityShotReceiptV3> {
  return api<ClassicAuthorityShotReceiptV3>(`/api/v3/classic/runs/${encodeURIComponent(ticket.ticketId)}/shots`, {
    method: 'POST',
    body: JSON.stringify({
      ticketToken: ticket.ticketToken,
      ...(previousAck ? { previousAck } : {}),
      sequence: boundedInteger(shot.sequence, 0, 249),
      atMs: boundedInteger(shot.atMs, 0, 14_400_000),
      angleMilliDegrees: boundedInteger(shot.angleMilliDegrees, -30_000, 30_000),
    }),
  });
}

/** Fetch the signed V3 content/live envelope and retain its CSRF bridge token. */
export async function getBootstrapV3(): Promise<BootstrapV3> {
  const bootstrap = await api<BootstrapV3>('/api/v3/bootstrap');
  const [contentVerified, liveVerified] = await Promise.all([
    verifySignedPayloadV3(bootstrap.content),
    verifySignedPayloadV3(bootstrap.live),
  ]);
  if (!contentVerified || !liveVerified) throw new Error('signed-bootstrap-verification-failed');
  platformApiAvailable = true;
  const csrfToken = typeof bootstrap.account?.csrfToken === 'string' ? bootstrap.account.csrfToken : '';
  if (csrfToken) saveCsrfToken(csrfToken);
  return bootstrap;
}

/** Submit a V3 run receipt through the authenticated, CSRF-protected bridge. */
export async function submitRunV3(submission: RunSubmissionV3): Promise<RunReceiptV3> {
  const receipt = await api<RunReceiptV3>('/api/v3/runs', {
    method: 'POST', body: JSON.stringify(submission),
  });
  if (receipt.reward?.granted && receipt.reward.source !== 'classic-first-clear') cachedAccount = undefined;
  return receipt;
}

function applyClassicRunReceipt(receipt: RunReceiptV3): void {
  const reward = receipt.reward;
  if (!reward || reward.source !== 'classic-first-clear' || !Number.isFinite(reward.balance)) return;
  applyServerWallet(reward.balance);
  if (cachedAccount) {
    cachedAccount = {
      ...cachedAccount,
      wallet: {
        ...cachedAccount.wallet,
        coins: reward.balance,
        // A recovered receipt describes the original commit. Replaying it
        // repairs the balance but must never advance the cached revision again.
        revision: cachedAccount.wallet.revision + (reward.granted && !receipt.duplicate ? 1 : 0),
        updatedAt: receipt.serverAcceptedAt ?? cachedAccount.wallet.updatedAt,
      },
    };
  }
}

async function flushClassicRunQueue(ownerUserId: string): Promise<ClassicRunSettlementResult> {
  const receipts: RunReceiptV3[] = [];
  let lastError = '';
  while (true) {
    const pending = readClassicRunQueue().find((entry) => entry.ownerUserId === ownerUserId);
    if (!pending) break;
    try {
      const receipt = await submitRunV3(pending.submission);
      applyClassicRunReceipt(receipt);
      removeClassicRun(ownerUserId, pending.submission.runId);
      receipts.push(receipt);
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'classic-run-submit-failed';
      // Invalid client data can never become valid by retrying and must not
      // block every later settlement. Authentication/network/conflict errors
      // remain queued for the same account.
      const permanentConflict = error instanceof PlatformApiError
        && error.status === 409
        && error.message === 'run-id-conflict';
      if (error instanceof PlatformApiError && ([400, 422].includes(error.status) || permanentConflict)) {
        removeClassicRun(ownerUserId, pending.submission.runId);
        continue;
      }
      break;
    }
  }
  return {
    settled: receipts.length,
    remaining: pendingClassicRunCount(ownerUserId),
    receipts,
    ...(lastError ? { lastError } : {}),
  };
}

/** Retry only records owned by the currently authenticated account. */
export function flushPendingClassicRunsV3(ownerUserId = cachedAccount?.userId ?? ''): Promise<ClassicRunSettlementResult> {
  if (!/^usr_[A-Za-z0-9_-]{16,}$/.test(ownerUserId) || cachedAccount?.userId !== ownerUserId) {
    return Promise.resolve({ settled: 0, remaining: pendingClassicRunCount(ownerUserId), receipts: [], lastError: 'platform-account-required' });
  }
  if (classicRunFlushInFlight) {
    return classicRunFlushOwner === ownerUserId
      ? classicRunFlushInFlight
      : Promise.resolve({ settled: 0, remaining: pendingClassicRunCount(ownerUserId), receipts: [], lastError: 'platform-account-mismatch' });
  }
  const pending = flushClassicRunQueue(ownerUserId);
  classicRunFlushInFlight = pending;
  classicRunFlushOwner = ownerUserId;
  void pending.finally(() => {
    if (classicRunFlushInFlight === pending) {
      classicRunFlushInFlight = undefined;
      classicRunFlushOwner = '';
    }
  }).catch(() => { /* result is returned to the initiating caller */ });
  return pending;
}

/**
 * Persist before sending so a tab close after server commit can replay the
 * same runId and recover its receipt without minting a second reward.
 */
export async function settleClassicRunV3(submissionValue: RunSubmissionV3): Promise<RunReceiptV3> {
  const submission = normalizeClassicRunSubmission(submissionValue);
  if (!submission) throw new Error('classic-run-invalid');
  const account = await getPlatformAccount();
  const ownerUserId = account?.userId ?? boundPlatformUserId();
  if (!ownerUserId) throw new Error('platform-account-required');
  enqueueClassicRun(ownerUserId, submission);
  if (!account || account.userId !== ownerUserId) throw new Error('classic-reward-queued');
  const result = await flushPendingClassicRunsV3(ownerUserId);
  let receipt = result.receipts.find((candidate) => candidate.runId === submission.runId);
  if (!receipt && pendingClassicRunCount(ownerUserId) > 0 && !result.lastError) {
    const retried = await flushPendingClassicRunsV3(ownerUserId);
    receipt = retried.receipts.find((candidate) => candidate.runId === submission.runId);
  }
  if (!receipt) throw new Error(result.lastError || 'classic-reward-queued');
  return receipt;
}

export type ArenaMessage = Record<string, unknown> & { type: string };
export class ArenaConnection {
  private socket?: WebSocket;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private reconnectAttempt = 0;
  private lastServerMessageAt = 0;
  private manuallyClosed = true;
  private outbound: string[] = [];
  private onMessage?: (message: ArenaMessage) => void;
  private onState?: (state: 'connecting' | 'open' | 'closed') => void;

  connect(onMessage: (message: ArenaMessage) => void, onState: (state: 'connecting' | 'open' | 'closed') => void): void {
    this.shutdownSocket();
    this.generation += 1;
    this.manuallyClosed = false;
    this.reconnectAttempt = 0;
    this.outbound = [];
    this.onMessage = onMessage;
    this.onState = onState;
    this.openSocket(this.generation);
  }

  private openSocket(generation: number): void {
    if (this.manuallyClosed || generation !== this.generation) return;
    this.clearReconnectTimer();
    this.onState?.('connecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${protocol}//${location.host}/api/arena`);
    } catch {
      this.onState?.('closed');
      this.scheduleReconnect(generation);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (!this.isCurrent(socket, generation)) return;
      this.reconnectAttempt = 0;
      this.lastServerMessageAt = Date.now();
      this.onState?.('open');
      this.startHeartbeat(socket, generation);
      this.flushOutbound(socket, generation);
    };
    socket.onmessage = (event) => {
      if (!this.isCurrent(socket, generation)) return;
      this.lastServerMessageAt = Date.now();
      try {
        const message = JSON.parse(String(event.data)) as ArenaMessage;
        if (message && typeof message.type === 'string') this.onMessage?.(message);
      } catch {
        // Ignore malformed server frames without destabilizing the live match.
      }
    };
    socket.onerror = () => {
      if (!this.isCurrent(socket, generation)) return;
      try { socket.close(); } catch { this.handleSocketClosed(socket, generation); }
    };
    socket.onclose = () => this.handleSocketClosed(socket, generation);
  }

  private isCurrent(socket: WebSocket, generation: number): boolean {
    return !this.manuallyClosed && generation === this.generation && this.socket === socket;
  }

  private startHeartbeat(socket: WebSocket, generation: number): void {
    this.clearHeartbeat();
    this.heartbeat = globalThis.setInterval(() => {
      if (!this.isCurrent(socket, generation)) return;
      if (Date.now() - this.lastServerMessageAt > ARENA_LIVENESS_TIMEOUT_MS) {
        try { socket.close(); } catch { this.handleSocketClosed(socket, generation); }
        return;
      }
      try {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'heartbeat' }));
      } catch {
        try { socket.close(); } catch { this.handleSocketClosed(socket, generation); }
      }
    }, ARENA_HEARTBEAT_MS);
  }

  private handleSocketClosed(socket: WebSocket, generation: number): void {
    if (!this.isCurrent(socket, generation)) return;
    this.clearHeartbeat();
    this.socket = undefined;
    this.onState?.('closed');
    this.scheduleReconnect(generation);
  }

  private scheduleReconnect(generation: number): void {
    if (this.manuallyClosed || generation !== this.generation || this.reconnectTimer) return;
    const index = Math.min(this.reconnectAttempt, ARENA_RECONNECT_DELAYS_MS.length - 1);
    const delay = ARENA_RECONNECT_DELAYS_MS[index];
    this.reconnectAttempt += 1;
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket(generation);
    }, delay);
  }

  private enqueue(serialized: string): void {
    if (this.outbound.length >= ARENA_MAX_OUTBOUND_QUEUE) this.outbound.shift();
    this.outbound.push(serialized);
  }

  private flushOutbound(socket: WebSocket, generation: number): void {
    while (this.outbound.length && this.isCurrent(socket, generation) && socket.readyState === 1) {
      const message = this.outbound[0];
      try {
        socket.send(message);
        this.outbound.shift();
      } catch {
        try { socket.close(); } catch { this.handleSocketClosed(socket, generation); }
        return;
      }
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeat !== undefined) globalThis.clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) globalThis.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private shutdownSocket(): void {
    this.clearHeartbeat();
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try { socket.close(); } catch { /* socket is already unusable */ }
  }

  send(message: ArenaMessage): void {
    let serialized: string;
    try { serialized = JSON.stringify(message); } catch { return; }
    const socket = this.socket;
    if (socket?.readyState === 1) {
      try { socket.send(serialized); return; }
      catch {
        this.enqueue(serialized);
        try { socket.close(); } catch { this.handleSocketClosed(socket, this.generation); }
        return;
      }
    }
    this.enqueue(serialized);
  }

  close(): void {
    this.manuallyClosed = true;
    this.generation += 1;
    this.outbound = [];
    this.shutdownSocket();
    this.onMessage = undefined;
    this.onState = undefined;
  }
}
