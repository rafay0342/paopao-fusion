import { ORB_SKINS, type OrbSkinId } from '../config';
import { ARTIFACTS, getMeta, type ArtifactId, type MetaState } from './meta';
import { notifyLocalSaveChanged } from './save-events';

export type InventoryItemId = 'bomb' | 'rainbow' | 'storyShard';
export type InventoryReason = 'starter' | 'store' | 'gameplay' | 'story' | 'reward' | 'artifact-purchase';

export interface InventoryTransaction {
  id: string;
  item?: InventoryItemId;
  delta: number;
  coinDelta: number;
  reason: InventoryReason;
  createdAt: string;
}

export interface InventoryStateV1 {
  version: 1;
  revision: number;
  transactions: InventoryTransaction[];
  updatedAt: string;
  lastSyncedAt: string;
}

export interface InventoryBalances {
  bomb: number;
  rainbow: number;
  storyShard: number;
}

export interface InventorySnapshot extends InventoryStateV1 {
  balances: InventoryBalances;
  coins: number;
  mysteryKeys: number;
  ownedArtifacts: ArtifactId[];
  equippedArtifact: ArtifactId;
  ownedSkins: OrbSkinId[];
  equippedSkin: OrbSkinId;
}

export interface StoreOffer {
  id: 'bomb-pack' | 'rainbow-pack';
  item: Exclude<InventoryItemId, 'storyShard'>;
  title: string;
  detail: string;
  quantity: number;
  price: number;
  accent: number;
  accentCss: string;
}

export const STORE_OFFERS: readonly StoreOffer[] = [
  {
    id: 'bomb-pack', item: 'bomb', title: 'PRISM BOMBS', detail: '3 GRID-BREAKING CHARGES',
    quantity: 3, price: 180, accent: 0x65efff, accentCss: '#65efff',
  },
  {
    id: 'rainbow-pack', item: 'rainbow', title: 'RAINBOW ORBS', detail: '2 COLOUR-CLEARING CHARGES',
    quantity: 2, price: 260, accent: 0xd6a5ff, accentCss: '#d6a5ff',
  },
] as const;

export const INVENTORY_STORAGE_KEY = 'paopao-fusion-inventory-v1';
const META_STORAGE_KEY = 'paopao-fusion-meta-v1';
const VALID_ITEMS = new Set<InventoryItemId>(['bomb', 'rainbow', 'storyShard']);
const VALID_REASONS = new Set<InventoryReason>(['starter', 'store', 'gameplay', 'story', 'reward', 'artifact-purchase']);
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const STARTER_TRANSACTIONS: readonly InventoryTransaction[] = [
  { id: 'starter-bombs-v1', item: 'bomb', delta: 3, coinDelta: 0, reason: 'starter', createdAt: '2026-07-20T00:00:00.000Z' },
  { id: 'starter-rainbows-v1', item: 'rainbow', delta: 2, coinDelta: 0, reason: 'starter', createdAt: '2026-07-20T00:00:00.000Z' },
] as const;

function transactionId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  return `${prefix}-${random}`;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function cleanTransaction(value: unknown): InventoryTransaction | null {
  const raw = record(value) as Partial<InventoryTransaction>;
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 96) : '';
  if (!id) return null;
  const item = VALID_ITEMS.has(raw.item as InventoryItemId) ? raw.item as InventoryItemId : undefined;
  const delta = item ? safeInteger(raw.delta, -999, 999) : 0;
  const coinDelta = safeInteger(raw.coinDelta, -1_000_000, 0);
  if (!item && coinDelta === 0) return null;
  return {
    id,
    ...(item ? { item } : {}),
    delta,
    coinDelta,
    reason: VALID_REASONS.has(raw.reason as InventoryReason) ? raw.reason as InventoryReason : 'reward',
    createdAt: typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt
      : new Date().toISOString(),
  };
}

export function normalizeInventory(value: unknown = {}): InventoryStateV1 {
  const raw = record(value) as Partial<InventoryStateV1>;
  const byId = new Map<string, InventoryTransaction>();
  for (const starter of STARTER_TRANSACTIONS) byId.set(starter.id, { ...starter });
  if (Array.isArray(raw.transactions)) {
    for (const candidate of raw.transactions) {
      const cleaned = cleanTransaction(candidate);
      if (cleaned && !byId.has(cleaned.id)) byId.set(cleaned.id, cleaned);
    }
  }
  const transactions = Array.from(byId.values())
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id));
  const updatedAt = typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
    ? raw.updatedAt
    : transactions[transactions.length - 1]?.createdAt ?? new Date().toISOString();
  return {
    version: 1,
    revision: Math.max(safeInteger(raw.revision, 0, Number.MAX_SAFE_INTEGER), transactions.length),
    transactions,
    updatedAt,
    lastSyncedAt: typeof raw.lastSyncedAt === 'string' && !Number.isNaN(Date.parse(raw.lastSyncedAt))
      ? raw.lastSyncedAt.slice(0, 40)
      : '',
  };
}

function persistInventory(state: InventoryStateV1, notify = true): InventoryStateV1 {
  try { localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(state)); } catch { /* offline play remains available */ }
  if (notify) notifyLocalSaveChanged();
  return state;
}

export function getInventoryState(): InventoryStateV1 {
  try {
    const raw = JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY) ?? '{}') as Partial<InventoryStateV1>;
    return persistInventory(normalizeInventory(raw), false);
  } catch {
    return normalizeInventory();
  }
}

export function inventoryBalances(state = getInventoryState()): InventoryBalances {
  const balances: InventoryBalances = { bomb: 0, rainbow: 0, storyShard: 0 };
  for (const entry of state.transactions) {
    if (entry.item) balances[entry.item] += entry.delta;
  }
  balances.bomb = Math.max(0, balances.bomb);
  balances.rainbow = Math.max(0, balances.rainbow);
  balances.storyShard = Math.max(0, balances.storyShard);
  return balances;
}

export function getInventory(meta = getMeta()): InventorySnapshot {
  const state = getInventoryState();
  return {
    ...state,
    balances: inventoryBalances(state),
    coins: meta.coins,
    mysteryKeys: meta.mysteryKeys,
    ownedArtifacts: meta.ownedArtifacts.filter((id) => ARTIFACTS.some((artifact) => artifact.id === id)),
    equippedArtifact: meta.equippedArtifact,
    ownedSkins: meta.ownedSkins.filter((id) => ORB_SKINS.some((skin) => skin.id === id)),
    equippedSkin: meta.equippedSkin,
  };
}

function appendTransaction(entry: InventoryTransaction): { state: InventoryStateV1; duplicate: boolean } {
  const state = getInventoryState();
  if (state.transactions.some((existing) => existing.id === entry.id)) return { state, duplicate: true };
  const next = normalizeInventory({
    ...state,
    revision: state.revision + 1,
    transactions: [...state.transactions, entry],
    updatedAt: entry.createdAt,
  });
  return { state: persistInventory(next), duplicate: false };
}

export function grantInventoryItem(
  item: InventoryItemId,
  amount: number,
  reason: Extract<InventoryReason, 'story' | 'reward'> = 'reward',
  id = transactionId(`grant-${item}`),
): { ok: boolean; duplicate: boolean; inventory: InventorySnapshot } {
  const delta = safeInteger(amount, 1, 999);
  if (!VALID_ITEMS.has(item) || delta < 1) return { ok: false, duplicate: false, inventory: getInventory() };
  const result = appendTransaction({ id, item, delta, coinDelta: 0, reason, createdAt: new Date().toISOString() });
  return { ok: true, duplicate: result.duplicate, inventory: getInventory() };
}

export function applyServerInventoryGrant(item: InventoryItemId, amount: number, receiptId: string): InventorySnapshot {
  const delta = safeInteger(amount, 1, 999);
  if (!VALID_ITEMS.has(item) || delta < 1) return getInventory();
  appendTransaction({ id: `server-${receiptId}`, item, delta, coinDelta: 0, reason: 'store', createdAt: new Date().toISOString() });
  return getInventory();
}

/**
 * Reconcile consumables to the server ledger without deleting offline story
 * rewards or local history. The two fixed adjustment records are replaced on
 * every refresh, so repeated account hydration can never duplicate a grant.
 */
export function applyServerInventorySnapshot(
  items: readonly { itemId: string; quantity: number }[],
  revision = 0,
  syncedAt = new Date().toISOString(),
): InventorySnapshot {
  const authoritative = new Map<Exclude<InventoryItemId, 'storyShard'>, number>();
  for (const entry of items) {
    if (entry?.itemId !== 'bomb' && entry?.itemId !== 'rainbow') continue;
    authoritative.set(entry.itemId, safeInteger(entry.quantity, 0, 1_000_000));
  }
  const current = getInventoryState();
  const transactions = current.transactions.filter((entry) => !entry.id.startsWith('server-authority-v2-'));
  const base = normalizeInventory({ ...current, transactions });
  const balances = inventoryBalances(base);
  for (const item of ['bomb', 'rainbow'] as const) {
    const delta = (authoritative.get(item) ?? 0) - balances[item];
    if (delta !== 0) transactions.push({
      id: `server-authority-v2-${item}`,
      item,
      delta,
      coinDelta: 0,
      reason: 'reward',
      createdAt: syncedAt,
    });
  }
  const next = normalizeInventory({
    ...current,
    revision: Math.max(current.revision, safeInteger(revision, 0, Number.MAX_SAFE_INTEGER)),
    transactions,
    updatedAt: syncedAt,
    lastSyncedAt: syncedAt,
  });
  persistInventory(next);
  return getInventory();
}

export function consumeInventoryItem(
  item: InventoryItemId,
  amount = 1,
  id = transactionId(`consume-${item}`),
): { ok: boolean; duplicate: boolean; inventory: InventorySnapshot } {
  const state = getInventoryState();
  if (state.transactions.some((entry) => entry.id === id)) return { ok: true, duplicate: true, inventory: getInventory() };
  const quantity = safeInteger(amount, 1, 999);
  if (!VALID_ITEMS.has(item) || quantity < 1 || inventoryBalances(state)[item] < quantity) {
    return { ok: false, duplicate: false, inventory: getInventory() };
  }
  appendTransaction({ id, item, delta: -quantity, coinDelta: 0, reason: 'gameplay', createdAt: new Date().toISOString() });
  return { ok: true, duplicate: false, inventory: getInventory() };
}

function saveMeta(meta: MetaState): void {
  try { localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta)); } catch { /* keep the current local session playable */ }
  notifyLocalSaveChanged();
}

export function purchaseConsumable(
  offerId: StoreOffer['id'],
  id = transactionId(`purchase-${offerId}`),
): { ok: boolean; duplicate: boolean; reason?: 'missing' | 'insufficient'; inventory: InventorySnapshot } {
  const state = getInventoryState();
  if (state.transactions.some((entry) => entry.id === id)) return { ok: true, duplicate: true, inventory: getInventory() };
  const offer = STORE_OFFERS.find((candidate) => candidate.id === offerId);
  if (!offer) return { ok: false, duplicate: false, reason: 'missing', inventory: getInventory() };
  const meta = getMeta();
  if (meta.coins < offer.price) return { ok: false, duplicate: false, reason: 'insufficient', inventory: getInventory(meta) };
  meta.coins -= offer.price;
  saveMeta(meta);
  appendTransaction({
    id,
    item: offer.item,
    delta: offer.quantity,
    coinDelta: -offer.price,
    reason: 'store',
    createdAt: new Date().toISOString(),
  });
  return { ok: true, duplicate: false, inventory: getInventory(meta) };
}

/** Record a coin debit already performed by the legacy artifact/skin store. */
export function recordCurrencySpend(
  amount: number,
  reason: Extract<InventoryReason, 'artifact-purchase'> = 'artifact-purchase',
  id = transactionId('currency-spend'),
): { duplicate: boolean; state: InventoryStateV1 } {
  const cost = safeInteger(amount, 1, 1_000_000);
  if (cost < 1) return { duplicate: false, state: getInventoryState() };
  return appendTransaction({ id, delta: 0, coinDelta: -cost, reason, createdAt: new Date().toISOString() });
}

export function inventoryCurrencySpent(state = getInventoryState()): number {
  return state.transactions.reduce((sum, entry) => sum + Math.max(0, -entry.coinDelta), 0);
}

export function mergeInventoryState(
  local: Partial<InventoryStateV1>,
  cloud: Partial<InventoryStateV1>,
  syncedAt = '',
): InventoryStateV1 {
  const left = normalizeInventory(local);
  const right = normalizeInventory(cloud);
  const byId = new Map<string, InventoryTransaction>();
  for (const entry of [...right.transactions, ...left.transactions]) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return normalizeInventory({
    version: 1,
    revision: Math.max(left.revision, right.revision, byId.size),
    transactions: Array.from(byId.values()),
    updatedAt: left.updatedAt > right.updatedAt ? left.updatedAt : right.updatedAt,
    lastSyncedAt: syncedAt || left.lastSyncedAt || right.lastSyncedAt,
  });
}

export function importCloudInventory(cloud: Partial<InventoryStateV1>, syncedAt = new Date().toISOString()): InventoryStateV1 {
  return persistInventory(mergeInventoryState(getInventoryState(), cloud, syncedAt));
}
