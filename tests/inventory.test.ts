import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyServerInventorySnapshot,
  consumeInventoryItem,
  getInventory,
  grantInventoryItem,
  inventoryBalances,
  inventoryCurrencySpent,
  mergeInventoryState,
  normalizeInventory,
  purchaseConsumable,
  type InventoryTransaction,
  type InventoryStateV1,
} from '../src/game/inventory';
import {
  applyServerEntitlements,
  equipArtifact,
  equipSkin,
  getMeta,
  grantArtifactOwnership,
  grantSkinOwnership,
} from '../src/game/meta';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
});

describe('persistent inventory ledger', () => {
  it('creates the starter inventory without changing the existing meta collection', () => {
    const inventory = getInventory();
    expect(inventory.balances).toEqual({ bomb: 3, rainbow: 2, storyShard: 0 });
    expect(inventory.coins).toBe(600);
    expect(inventory.ownedArtifacts).toContain('chrono');
    expect(inventory.ownedSkins).toContain('nova');
  });

  it('grants and consumes items exactly once for an idempotency key', () => {
    expect(grantInventoryItem('storyShard', 2, 'story', 'chapter-one-shards').ok).toBe(true);
    expect(grantInventoryItem('storyShard', 2, 'story', 'chapter-one-shards').duplicate).toBe(true);
    expect(consumeInventoryItem('bomb', 1, 'level-1-bomb').ok).toBe(true);
    expect(consumeInventoryItem('bomb', 1, 'level-1-bomb').duplicate).toBe(true);
    expect(getInventory().balances).toEqual({ bomb: 2, rainbow: 2, storyShard: 2 });
  });

  it('makes a real store purchase and never double-debits a repeated transaction', () => {
    const first = purchaseConsumable('bomb-pack', 'checkout-001');
    const duplicate = purchaseConsumable('bomb-pack', 'checkout-001');
    expect(first.ok).toBe(true);
    expect(duplicate).toMatchObject({ ok: true, duplicate: true });
    expect(getMeta().coins).toBe(420);
    expect(getInventory().balances.bomb).toBe(6);
    expect(inventoryCurrencySpent()).toBe(180);
  });

  it('reconciles repeated server snapshots without duplicating grants and preserves story rewards', () => {
    grantInventoryItem('storyShard', 2, 'story', 'server-snapshot-story');
    expect(applyServerInventorySnapshot([
      { itemId: 'bomb', quantity: 8 },
      { itemId: 'rainbow', quantity: 1 },
    ], 7, '2026-07-22T10:00:00.000Z').balances).toEqual({ bomb: 8, rainbow: 1, storyShard: 2 });
    expect(applyServerInventorySnapshot([
      { itemId: 'bomb', quantity: 8 },
      { itemId: 'rainbow', quantity: 1 },
    ], 7, '2026-07-22T10:00:01.000Z').balances).toEqual({ bomb: 8, rainbow: 1, storyShard: 2 });
    expect(applyServerInventorySnapshot([
      { itemId: 'bomb', quantity: 7 },
      { itemId: 'rainbow', quantity: 1 },
    ], 8, '2026-07-22T10:00:02.000Z').balances).toEqual({ bomb: 7, rainbow: 1, storyShard: 2 });
    expect(getInventory().transactions.filter(({ id }) => id.startsWith('server-authority-v2-'))).toHaveLength(2);
  });

  it('replaces purchased ownership on authenticated hydration without cross-account leakage', () => {
    grantArtifactOwnership('phoenix');
    grantSkinOwnership('aurora');
    equipArtifact('phoenix');
    equipSkin('aurora');

    const firstAccount = applyServerEntitlements(['artifact:void', 'skin:voidforge']);
    expect(firstAccount.ownedArtifacts).toEqual(['chrono', 'void']);
    expect(firstAccount.ownedSkins).toEqual(['nova', 'nova_optical', 'voidforge']);
    expect(firstAccount.equippedArtifact).toBe('chrono');
    expect(firstAccount.equippedSkin).toBe('nova');

    const secondAccount = applyServerEntitlements([]);
    expect(secondAccount.ownedArtifacts).toEqual(['chrono']);
    expect(secondAccount.ownedSkins).toEqual(['nova', 'nova_optical']);
    expect(secondAccount.ownedArtifacts).not.toContain('void');
    expect(secondAccount.ownedSkins).not.toContain('voidforge');
  });

  it('merges offline and cloud transaction branches by transaction id', () => {
    const base: InventoryStateV1 = {
      version: 1, revision: 1, updatedAt: '2026-07-20T01:00:00.000Z', lastSyncedAt: '',
      transactions: [{
        id: 'offline-bomb', item: 'bomb', delta: -1, coinDelta: 0, reason: 'gameplay', createdAt: '2026-07-20T01:00:00.000Z',
      }],
    };
    const cloud: InventoryStateV1 = {
      version: 1, revision: 1, updatedAt: '2026-07-20T02:00:00.000Z', lastSyncedAt: '',
      transactions: [{
        id: 'cloud-rainbow-pack', item: 'rainbow', delta: 2, coinDelta: -260, reason: 'store', createdAt: '2026-07-20T02:00:00.000Z',
      }],
    };
    const merged = mergeInventoryState(base, cloud, '2026-07-20T03:00:00.000Z');
    expect(inventoryBalances(merged)).toEqual({ bomb: 2, rainbow: 4, storyShard: 0 });
    expect(inventoryCurrencySpent(merged)).toBe(260);
    expect(merged.transactions.filter((entry) => entry.id === 'cloud-rainbow-pack')).toHaveLength(1);
    expect(merged.lastSyncedAt).toBe('2026-07-20T03:00:00.000Z');
  });

  it('retains the complete ledger when merged history grows beyond 500 transactions', () => {
    const transactions = (prefix: string, count: number, startMs: number): InventoryTransaction[] => (
      Array.from({ length: count }, (_, index) => ({
        id: `${prefix}-${String(index).padStart(3, '0')}`,
        item: 'storyShard',
        delta: 1,
        coinDelta: 0,
        reason: 'reward',
        createdAt: new Date(startMs + index).toISOString(),
      }))
    );
    const localTransactions = transactions('local', 320, Date.parse('2026-07-20T04:00:00.000Z'));
    const cloudTransactions = transactions('cloud', 320, Date.parse('2026-07-20T05:00:00.000Z'));
    const local: InventoryStateV1 = {
      version: 1,
      revision: localTransactions.length,
      transactions: localTransactions,
      updatedAt: localTransactions.at(-1)?.createdAt ?? '',
      lastSyncedAt: '',
    };
    const cloud: InventoryStateV1 = {
      version: 1,
      revision: cloudTransactions.length,
      transactions: cloudTransactions,
      updatedAt: cloudTransactions.at(-1)?.createdAt ?? '',
      lastSyncedAt: '',
    };

    const merged = mergeInventoryState(local, cloud, '2026-07-20T06:00:00.000Z');

    expect(merged.transactions).toHaveLength(642);
    expect(merged.transactions.some(({ id }) => id === 'local-000')).toBe(true);
    expect(merged.transactions.some(({ id }) => id === 'cloud-319')).toBe(true);
    expect(inventoryBalances(merged).storyShard).toBe(640);
  });

  it('ignores malformed ledger entries and null cloud payloads safely', () => {
    const malformed = normalizeInventory({
      transactions: [null, false, { id: '', item: 'bomb', delta: 9 }, {
        id: 'valid-safe-entry', item: 'storyShard', delta: 2, coinDelta: 0,
        reason: 'reward', createdAt: '2026-07-20T06:00:00.000Z',
      }],
      lastSyncedAt: { length: 1_000_000_000 },
    });
    const merged = mergeInventoryState(malformed, null as unknown as never);

    expect(inventoryBalances(merged).storyShard).toBe(2);
    expect(merged.transactions.some(({ id }) => id === 'valid-safe-entry')).toBe(true);
    expect(merged.lastSyncedAt).toBe('');
  });
});
