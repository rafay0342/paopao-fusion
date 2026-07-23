import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  productionRuntimeTestFullName,
  validateProductionRuntime,
} from '../tools/production-runtime-lib.mjs';
import {
  productionRuntimeUrl,
  validateProductionRuntimeEntry,
} from '../src/game/production-assets';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs', 'production', 'upgrade-ledger.json'), 'utf8'));
const audit = validateProductionRuntime({ ledger, projectRoot, requireComplete: true });

describe('production runtime evidence', () => {
  for (const entry of audit.manifest.entries) {
    it(productionRuntimeTestFullName(entry.id).replace('production runtime evidence ', ''), () => {
      const validated = validateProductionRuntimeEntry(entry);
      expect(audit.entryById.get(entry.id)).toEqual(entry);
      expect(productionRuntimeUrl(validated)).toBe(entry.runtime.path);
      expect(entry.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.runtime.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.runtime.bytes).toBeLessThanOrEqual(entry.runtime.byteBudget);
    });
  }
});
