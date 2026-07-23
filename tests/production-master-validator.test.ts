import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProductionMasterManifest } from '../tools/production-master-evidence-lib.mjs';

const roots: string[] = [];
const svgChecks = [
  'exact-byte-count',
  'sha256-match',
  'unique-content-sha256',
  'non-placeholder-content',
  'svg-authored-drawing',
  'svg-document',
  'svg-measurable-canvas',
];

function write(root: string, path: string, contents: string): void {
  const absolute = join(root, ...path.split('/'));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'paopao-production-master-test-'));
  roots.push(root);
  const items = [1, 2].map((ordinal) => ({
    id: `PF-asset-${String(ordinal).padStart(3, '0')}`,
    category: 'asset',
    ordinal,
    release: 1,
    clientFacing: true,
    assetAllocation: 'characters-orbs-bosses-rigs',
  }));
  return { root, ledger: { items } };
}

function entry(id: string, contents: string) {
  const path = `art-source/production-masters/${id}-authored.svg`;
  return {
    id,
    allocation: 'characters-orbs-bosses-rigs',
    release: 1,
    path,
    format: 'svg',
    bytes: Buffer.byteLength(contents),
    sha256: createHash('sha256').update(contents).digest('hex'),
    validation: svgChecks,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('production master evidence validator', () => {
  it('accepts an exact ledger-mapped source with verified SVG structure and digest', () => {
    const { root, ledger } = setup();
    const source = '<svg width="8192" height="8192" viewBox="0 0 2048 2048" xmlns="http://www.w3.org/2000/svg"><metadata>Original PaoPao source</metadata><title>Prism guide</title><desc>Authored production geometry</desc><path d="M2 2 L62 32 L2 62 Z" fill="#54ddff"/><circle cx="32" cy="32" r="12"/><rect x="8" y="8" width="16" height="16"/></svg>\n';
    const record = entry('PF-asset-001', source);
    write(root, record.path, source);
    write(root, 'art-source/production-masters/manifest.json', `${JSON.stringify({ schemaVersion: 1, total: 1, entries: [record] })}\n`);
    const result = validateProductionMasterManifest({ ledger, projectRoot: root, requireComplete: false });
    expect(result.total).toBe(1);
    expect(result.entryById.get(record.id)).toEqual(record);
  });

  it('rejects two nominal masters with identical source bytes', () => {
    const { root, ledger } = setup();
    const source = '<svg width="8192" height="8192" viewBox="0 0 2048 2048" xmlns="http://www.w3.org/2000/svg"><metadata>Original PaoPao source</metadata><title>Aurora orb</title><desc>Authored production geometry</desc><circle cx="32" cy="32" r="28" fill="#ab65ff"/><path d="M2 2 L62 32 L2 62 Z"/><rect x="8" y="8" width="16" height="16"/></svg>\n';
    const records = [entry('PF-asset-001', source), entry('PF-asset-002', source)];
    for (const record of records) write(root, record.path, source);
    write(root, 'art-source/production-masters/manifest.json', `${JSON.stringify({ schemaVersion: 1, total: 2, entries: records })}\n`);
    expect(() => validateProductionMasterManifest({ ledger, projectRoot: root, requireComplete: false }))
      .toThrow('duplicate production master content hash');
  });

  it('rejects declared validation labels that were not produced by the media validator', () => {
    const { root, ledger } = setup();
    const source = '<svg width="8192" height="8192" viewBox="0 0 2048 2048" xmlns="http://www.w3.org/2000/svg"><metadata>Original PaoPao source</metadata><title>Ember frame</title><desc>Authored production geometry</desc><rect width="64" height="64" fill="#ffbf52"/><circle cx="32" cy="32" r="12"/><path d="M2 2 L62 32 L2 62 Z"/></svg>\n';
    const record = entry('PF-asset-001', source);
    record.validation = ['looks-good', ...svgChecks];
    write(root, record.path, source);
    write(root, 'art-source/production-masters/manifest.json', `${JSON.stringify({ schemaVersion: 1, total: 1, entries: [record] })}\n`);
    expect(() => validateProductionMasterManifest({ ledger, projectRoot: root, requireComplete: false }))
      .toThrow('validation checks do not match the svg validator');
  });
});
