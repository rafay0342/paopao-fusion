import {
  flushPendingClassicRunsV3,
  getPlatformAccount,
  syncClassicProgressV4,
  type PlatformAccount,
} from './platform';
import { getDailyChallenge, getPlayerSave, type ChallengeDef, type RunSummary } from './retention';

/**
 * Browser online facade.
 *
 * Authentication intentionally lives only in platform.ts: the browser sends
 * the V3 HttpOnly session cookie and an in-memory/sessionStorage CSRF token.
 * This module never creates, reads, persists, or transmits bearer credentials.
 * The legacy bearer endpoints remain server-side compatibility adapters only.
 */

export type AccountMode = 'online' | 'guest';
export type AccountConnection = 'online' | 'offline' | 'connecting' | 'guest';

export interface AccountSnapshot {
  mode: AccountMode;
  connection: AccountConnection;
  playerId: string;
  displayName: string;
  recoveryCode: string;
  lastSyncedAt: string;
  error: string;
}

export interface OnlineLeaderboardEntry {
  runId: string;
  playerId: string;
  displayName: string;
  score: number;
  level: number;
  mode: 'classic' | 'rush' | 'precision';
  durationMs: number;
  createdAt: string;
}

const ACCOUNT_MODE_KEY = 'paopao-fusion-account-mode-v2';
export const ONLINE_REQUEST_TIMEOUT_MS = 12_000;
export const ONLINE_SYNC_TIMEOUT_MS = 45_000;
let accountMode: AccountMode = 'online';
let connection: AccountConnection = 'offline';
let connectionError = '';
let currentPlatformAccount: PlatformAccount | null = null;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncInFlight: Promise<{ online: boolean; submitted: number }> | undefined;
let syncGeneration = 0;
let activeSyncController: AbortController | undefined;
let onlineLifecycleInstalled = false;

interface RequestDeadline {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
}

export function createOnlineRequestDeadline(
  parent?: AbortSignal | null,
  timeoutMs = ONLINE_REQUEST_TIMEOUT_MS,
): RequestDeadline {
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

function localStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

function readAccountMode(): AccountMode {
  try {
    const value = localStore()?.getItem(ACCOUNT_MODE_KEY);
    if (value === 'guest' || value === 'online') accountMode = value;
  } catch { /* memory state remains authoritative for this tab */ }
  return accountMode;
}

function writeAccountMode(mode: AccountMode): void {
  accountMode = mode;
  try { localStore()?.setItem(ACCOUNT_MODE_KEY, mode); } catch { /* memory fallback */ }
}

function notifyAccountChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('paopao:account-changed', { detail: getAccountSnapshot() }));
}

function setConnection(next: AccountConnection, error = ''): void {
  connection = next;
  connectionError = error;
  notifyAccountChanged();
}

async function publicJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const deadline = createOnlineRequestDeadline(signal);
  try {
    const response = await fetch(path, { signal: deadline.signal, credentials: 'include' });
    if (!response.ok) throw new Error(`online-${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (deadline.didTimeout()) throw new Error('request-timeout');
    if (signal?.aborted) throw new Error('request-aborted');
    throw error;
  } finally {
    deadline.cleanup();
  }
}

export function getAccountMode(): AccountMode { return readAccountMode(); }

export function getAccountSnapshot(): AccountSnapshot {
  const save = getPlayerSave();
  const mode = readAccountMode();
  return {
    mode,
    connection: mode === 'guest' ? 'guest' : connection,
    playerId: currentPlatformAccount?.userId ?? save.playerId,
    displayName: currentPlatformAccount?.displayName ?? save.displayName,
    recoveryCode: '',
    lastSyncedAt: save.lastSyncedAt,
    error: connectionError,
  };
}

export function useGuestAccount(): AccountSnapshot {
  writeAccountMode('guest');
  syncGeneration += 1;
  activeSyncController?.abort(new Error('guest-mode'));
  activeSyncController = undefined;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = undefined;
  setConnection('guest');
  return getAccountSnapshot();
}

export async function useOnlineAccount(): Promise<{ account: AccountSnapshot; online: boolean }> {
  writeAccountMode('online');
  syncGeneration += 1;
  activeSyncController?.abort(new Error('account-mode-changed'));
  activeSyncController = undefined;
  const result = await syncOnline();
  return { account: getAccountSnapshot(), online: result.online };
}

async function performSync(generation: number): Promise<{ online: boolean; submitted: number }> {
  if (readAccountMode() === 'guest') {
    setConnection('guest');
    return { online: false, submitted: 0 };
  }
  const controller = new AbortController();
  const syncTimeout = globalThis.setTimeout(() => controller.abort(new Error('sync-timeout')), ONLINE_SYNC_TIMEOUT_MS);
  activeSyncController?.abort(new Error('sync-superseded'));
  activeSyncController = controller;
  const isCurrentOnlineSync = (): boolean => generation === syncGeneration && readAccountMode() === 'online';
  setConnection('connecting');
  try {
    const account = await getPlatformAccount(true);
    if (!isCurrentOnlineSync()) return { online: false, submitted: 0 };
    if (!account) {
      currentPlatformAccount = null;
      setConnection('offline', 'email-account-required');
      return { online: false, submitted: 0 };
    }
    currentPlatformAccount = account;
    await syncClassicProgressV4();
    if (!isCurrentOnlineSync()) return { online: false, submitted: 0 };
    const settlement = await flushPendingClassicRunsV3(account.userId);
    if (!isCurrentOnlineSync()) return { online: false, submitted: 0 };
    setConnection('online');
    return { online: true, submitted: settlement.settled };
  } catch (error) {
    if (!isCurrentOnlineSync()) return { online: false, submitted: 0 };
    setConnection('offline', error instanceof Error ? error.message : 'network-unavailable');
    return { online: false, submitted: 0 };
  } finally {
    globalThis.clearTimeout(syncTimeout);
    if (activeSyncController === controller) activeSyncController = undefined;
  }
}

export function syncOnline(): Promise<{ online: boolean; submitted: number }> {
  if (!syncInFlight) {
    const generation = syncGeneration;
    const pending = performSync(generation);
    syncInFlight = pending;
    void pending.finally(() => {
      if (syncInFlight === pending) syncInFlight = undefined;
    }).catch(() => { /* initiating caller receives its result */ });
  }
  return syncInFlight;
}

export function scheduleOnlineSync(delayMs = 700): void {
  if (readAccountMode() === 'guest') return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    void syncOnline();
  }, Math.max(0, delayMs));
}

export function installOnlineReconnection(): void {
  if (onlineLifecycleInstalled || typeof window === 'undefined') return;
  onlineLifecycleInstalled = true;
  window.addEventListener('online', () => {
    if (readAccountMode() === 'online') scheduleOnlineSync(180);
  });
  window.addEventListener('offline', () => {
    activeSyncController?.abort(new Error('network-offline'));
    if (readAccountMode() === 'online') setConnection('offline', 'network-unavailable');
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible'
        && (typeof navigator === 'undefined' || navigator.onLine !== false)
        && readAccountMode() === 'online') scheduleOnlineSync(350);
    });
  }
}

export async function getOnlineChallenge(): Promise<ChallengeDef> {
  try { return await publicJson<ChallengeDef>('/api/challenges/current'); }
  catch { return getDailyChallenge(); }
}

export async function getOnlineWeeklyChallenge(): Promise<ChallengeDef | null> {
  try { return await publicJson<ChallengeDef>('/api/challenges/weekly'); }
  catch { return null; }
}

export async function getOnlineLeaderboard(challengeId = getDailyChallenge().id): Promise<OnlineLeaderboardEntry[]> {
  try {
    const result = await publicJson<{ entries: OnlineLeaderboardEntry[] }>(`/api/leaderboards/${encodeURIComponent(challengeId)}`);
    return result.entries;
  } catch { return []; }
}

export async function getOnlineGhost(runId: string): Promise<Pick<RunSummary, 'id' | 'ghost' | 'score' | 'durationMs'> | null> {
  try { return await publicJson(`/api/ghosts/${encodeURIComponent(runId)}`); }
  catch { return null; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('paopao:platform-account', (event) => {
    currentPlatformAccount = (event as CustomEvent<PlatformAccount>).detail;
    writeAccountMode('online');
    setConnection('online');
  });
}

installOnlineReconnection();
