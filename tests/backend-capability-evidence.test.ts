import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertBackendCapabilityProbe,
  backendCapabilityTestFullName,
  runBackendCapabilityProbe,
} from '../shared/runtime/backend-capabilities.mjs';
import { SqliteBackendCapabilityRepository } from '../server/backend-capabilities.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs', 'production', 'upgrade-ledger.json'), 'utf8'));
const items = ledger.items.filter((item: { category: string }) => item.category === 'backend');

if (items.length !== 250) throw new Error(`backend ledger must contain exactly 250 items, observed ${items.length}`);

describe('backend capability evidence', () => {
  for (const item of items) {
    const fullName = backendCapabilityTestFullName(item);
    it(fullName.replace('backend capability evidence ', ''), () => {
      if (item.ordinal % 10 !== 6) {
        const outcome = runBackendCapabilityProbe(item);
        expect(assertBackendCapabilityProbe(item, outcome)).toBe(true);
        return;
      }
      const directory = mkdtempSync(join(tmpdir(), 'paopao-backend-persistence-'));
      const databasePath = join(directory, 'capabilities.sqlite');
      let repository = new SqliteBackendCapabilityRepository(databasePath);
      try {
        const outcome = runBackendCapabilityProbe(item, {
          repository,
          restartRepository: () => {
            repository.close();
            repository = new SqliteBackendCapabilityRepository(databasePath);
            return repository;
          },
        });
        expect(assertBackendCapabilityProbe(item, outcome)).toBe(true);
      } finally {
        repository.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
