import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_MASTER_MANIFEST,
  productionMasterTestFullName,
  validateProductionMasterManifest,
} from '../tools/production-master-evidence-lib.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = join(projectRoot, ...PRODUCTION_MASTER_MANIFEST.split('/'));
const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs', 'production', 'upgrade-ledger.json'), 'utf8'));

describe('production master evidence', () => {
  if (!existsSync(manifestPath)) {
    it('keeps asset ledger credit at zero while the production-master manifest is absent', () => {
      expect(ledger.items.filter((item: any) => item.category === 'asset' && item.evidence.status === 'verified')).toHaveLength(0);
    });
  } else {
    const audit = validateProductionMasterManifest({ ledger, projectRoot, requireComplete: true });
    for (const entry of audit.manifest.entries) {
      it(productionMasterTestFullName(entry.id).replace('production master evidence ', ''), () => {
        expect(audit.entryById.get(entry.id)).toEqual(entry);
        expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      });
    }
  }
});
