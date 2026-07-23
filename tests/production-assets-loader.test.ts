import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  PRODUCTION_RUNTIME_MANIFEST_URL,
  ProductionAssetLoader,
  productionRuntimeUrl,
  validateProductionRuntimeEntry,
  validateProductionRuntimeManifest,
} from '../src/game/production-assets';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const rawManifest = JSON.parse(readFileSync(
  join(projectRoot, 'public', 'assets', 'production', 'runtime-manifest.json'),
  'utf8',
));
const manifest = validateProductionRuntimeManifest(rawManifest);
const semanticEntry = manifest.entries.find(({ runtime }) => runtime.kind === 'semantic-json')!;
const imageEntry = manifest.entries.find(({ runtime }) => runtime.kind === 'image')!;

function runtimeBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(projectRoot, 'public', ...path.slice(1).split('/'))));
}

function responseFor(entry: typeof semanticEntry, bytes = runtimeBytes(entry.runtime.path)): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': entry.runtime.mimeType,
      'content-length': String(bytes.byteLength),
    },
  });
}

describe('production asset lazy loader', () => {
  it('performs no network work until the archive explicitly asks for data', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === PRODUCTION_RUNTIME_MANIFEST_URL) {
        return new Response(JSON.stringify(rawManifest), { headers: { 'content-type': 'application/json' } });
      }
      if (path === semanticEntry.runtime.path) return responseFor(semanticEntry);
      throw new Error(`unexpected fetch ${path}`);
    });
    const loader = new ProductionAssetLoader(fetcher);
    expect(fetcher).not.toHaveBeenCalled();

    const asset = await loader.load(semanticEntry.id);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      PRODUCTION_RUNTIME_MANIFEST_URL,
      semanticEntry.runtime.path,
    ]);
    expect(asset.kind).toBe('semantic-json');
    if (asset.kind === 'semantic-json') {
      expect(asset.value.id).toBe(semanticEntry.id);
      expect(asset.summary.authoredValues).toBeGreaterThan(10);
      expect(asset.summary.subject).not.toBe('');
    }

    await loader.load(semanticEntry.id);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses Web Crypto for a verified bounded image without eager archive loading', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === PRODUCTION_RUNTIME_MANIFEST_URL) return new Response(JSON.stringify(rawManifest));
      if (path === imageEntry.runtime.path) return responseFor(imageEntry);
      throw new Error(`unexpected fetch ${path}`);
    });
    const loader = new ProductionAssetLoader(fetcher);
    const asset = await loader.load(imageEntry.id);
    expect(asset.kind).toBe('image');
    if (asset.kind === 'image') {
      expect(asset.bytes.byteLength).toBe(imageEntry.runtime.bytes);
      expect(asset.blob.type).toBe('image/png');
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed when fetched bytes do not match the manifest SHA-256', async () => {
    const altered = runtimeBytes(semanticEntry.runtime.path);
    altered[Math.floor(altered.length / 2)] ^= 1;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === PRODUCTION_RUNTIME_MANIFEST_URL) return new Response(JSON.stringify(rawManifest));
      if (path === semanticEntry.runtime.path) return responseFor(semanticEntry, altered);
      throw new Error(`unexpected fetch ${path}`);
    });
    await expect(new ProductionAssetLoader(fetcher).load(semanticEntry.id)).rejects.toThrow('SHA-256');
  });

  it('rejects external, traversal and mismatched loader paths', () => {
    const external = structuredClone(semanticEntry) as any;
    external.runtime.path = 'https://example.test/asset.json';
    expect(() => validateProductionRuntimeEntry(external)).toThrow();
    const traversal = structuredClone(semanticEntry) as any;
    traversal.runtime.path = '/assets/production/items/../secret.json';
    expect(() => validateProductionRuntimeEntry(traversal)).toThrow();
    const mismatched = structuredClone(semanticEntry) as any;
    mismatched.runtime.path = imageEntry.runtime.path;
    expect(() => productionRuntimeUrl(mismatched)).toThrow();
  });

  it('keeps the Phaser archive paginated and free of startup bulk asset queues', () => {
    const archiveSource = readFileSync(join(projectRoot, 'src', 'scenes', 'ProductionArchiveScene.ts'), 'utf8');
    const mainSource = readFileSync(join(projectRoot, 'src', 'main.ts'), 'utf8');
    expect(archiveSource).toContain('PRODUCTION_ARCHIVE_PAGE_SIZE');
    expect(archiveSource).toContain('productionAssetLoader.load(entry.id');
    expect(archiveSource).not.toMatch(/\bpreload\s*\(/);
    expect(mainSource).toContain('ProductionArchiveScene');
    expect(mainSource).not.toContain('productionAssetLoader.manifest(');
  });
});
