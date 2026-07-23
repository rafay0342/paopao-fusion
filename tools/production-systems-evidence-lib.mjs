import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const PRODUCTION_SYSTEMS_FIXTURE = 'shared/fixtures/production-systems-v1.json';
export const PRODUCTION_SYSTEMS_SHARED_RUNTIME = 'shared/runtime/production-systems.mjs';
export const PRODUCTION_SYSTEMS_PHASER_RUNTIME = 'src/game/production-systems.ts';
export const PRODUCTION_SYSTEMS_SCENE = 'src/scenes/ProductionSystemsScene.ts';
export const PRODUCTION_SYSTEMS_SHARED_TEST = 'tests/production-systems-shared-evidence.test.ts';
export const PRODUCTION_SYSTEMS_PHASER_TEST = 'tests/production-systems-phaser-evidence.test.ts';
export const PRODUCTION_SYSTEM_CATEGORIES = Object.freeze({
  upgrade: 100,
  improvement: 100,
  ui: 100,
  frontend: 150,
  flow: 200,
  rendering: 100,
  control: 100,
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function productionSystemSharedTestFullName(entry) {
  return `production systems shared evidence [${entry.acceptanceId}][shared] executes ${entry.subject} ${entry.facet}`;
}

export function productionSystemPhaserTestFullName(entry) {
  return `production systems Phaser evidence [${entry.acceptanceId}][phaser] renders ${entry.subject} ${entry.facet}`;
}

export function validateProductionSystemsFixture({ projectRoot = resolve('.'), ledger = null } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, PRODUCTION_SYSTEMS_FIXTURE), 'utf8'));
  if (manifest?.schemaVersion !== 1 || manifest.title !== 'PaoPao Fusion Phaser Production Systems' || manifest.total !== 850 || !Array.isArray(manifest.entries)) {
    throw new Error('production systems fixture has invalid header');
  }
  const manifestBase = { ...manifest };
  delete manifestBase.manifestSha256;
  if (!/^[a-f0-9]{64}$/.test(manifest.manifestSha256) || manifest.manifestSha256 !== sha256(manifestBase)) {
    throw new Error('production systems manifest SHA-256 is stale');
  }
  if (manifest.entries.length !== 850 || new Set(manifest.entries.map(({ id }) => id)).size !== 850) {
    throw new Error('production systems fixture must contain exactly 850 unique systems');
  }
  const entryById = new Map();
  for (const entry of manifest.entries) {
    const base = { ...entry };
    delete base.contractSha256;
    if (!/^[a-f0-9]{64}$/.test(entry.contractSha256) || entry.contractSha256 !== sha256(base)) throw new Error(`production system ${entry.id} contract hash is stale`);
    if (entryById.has(entry.id)) throw new Error(`duplicate production system ${entry.id}`);
    entryById.set(entry.id, entry);
  }
  for (const [category, total] of Object.entries(PRODUCTION_SYSTEM_CATEGORIES)) {
    if (manifest.byCategory?.[category] !== total || manifest.entries.filter((entry) => entry.category === category).length !== total) {
      throw new Error(`production systems ${category} count is not ${total}`);
    }
  }
  for (let release = 1; release <= 5; release += 1) {
    if (manifest.byRelease?.[release] !== 170 || manifest.entries.filter((entry) => entry.release === release).length !== 170) {
      throw new Error(`production systems release ${release} count is not 170`);
    }
  }
  if (ledger) {
    const selected = ledger.items.filter((item) => item.category in PRODUCTION_SYSTEM_CATEGORIES);
    if (selected.length !== 850) throw new Error(`ledger contains ${selected.length}/850 production system items`);
    for (const item of selected) {
      const entry = entryById.get(item.id);
      if (!entry || entry.acceptanceId !== item.acceptanceTest.id || entry.release !== item.release || `${entry.subject} — ${entry.facet}` !== item.title) {
        throw new Error(`production system ${item.id} does not match its ledger contract`);
      }
    }
  }
  return Object.freeze({ manifest, entryById, total: 850, manifestSha256: manifest.manifestSha256 });
}

