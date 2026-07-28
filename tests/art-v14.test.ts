import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class File {
    load(): void {}
  }
  class ImageFile extends File {
    useImageElementLoad = false;
    xhrLoader?: XMLHttpRequest;

    constructor(..._args: unknown[]) {
      super();
    }

    onProcess(): void {}
    onProcessError(): void {}
  }
  return {
    default: {
      Loader: {
        File,
        FileTypes: { ImageFile },
      },
    },
  };
});

import {
  GAMEPLAY_ART_MASTER_TOTAL,
  GameplayArtManifestError,
  GameplayArtIntegrityError,
  GameplayArtRegistry,
  clearGameplayArtManifest,
  getArtBundleLoadPlan,
  getArtBundleEntries,
  getArtBundleKeys,
  getArtBundles,
  installGameplayArtManifest,
  resolveArtAsset,
  validateGameplayArtManifest,
  verifyGameplayArtFileBytes,
  type GameplayArtFile,
  type GameplayArtManifestEntryV1,
  type GameplayArtManifestV1,
  type PFAssetId,
} from '../src/game/art-v14';

function sha(index: number, salt = 0): string {
  return (index * 1000 + salt).toString(16).padStart(64, '0');
}

function entry(index: number, overrides: Partial<GameplayArtManifestEntryV1> = {}): GameplayArtManifestEntryV1 {
  const pfId = `PF-asset-${String(index).padStart(3, '0')}` as PFAssetId;
  const sourceSha256 = sha(index);
  const stableKey = `v14_asset_${String(index).padStart(3, '0')}`;
  const makeVariant = (quality: 'performance' | 'balanced' | 'ultra', salt: number) => {
    const sha256 = sha(index, salt);
    return {
      format: 'webp' as const,
      dimensions: { width: quality === 'performance' ? 512 : quality === 'balanced' ? 1024 : 2048, height: 1024 },
      bytes: 1000 + salt,
      sha256,
      url: `/assets/v14/core/${stableKey}.${sha256.slice(0, 12)}.webp`,
    };
  };
  return {
    stableKey,
    pfId,
    bundle: index <= 100 ? 'core' : `realm-gate-${Math.ceil(index / 100)}`,
    mediaKind: 'image',
    variants: {
      performance: makeVariant('performance', 1),
      balanced: makeVariant('balanced', 2),
      ultra: makeVariant('ultra', 3),
    },
    pivot: { x: 0.5, y: 1 },
    provenance: {
      manifest: 'art-source/v14/manifest.json',
      recordId: pfId,
      sourceSha256,
      approved: true,
    },
    ...overrides,
  };
}

function manifest(entries: GameplayArtManifestEntryV1[]): GameplayArtManifestV1 {
  return {
    schemaVersion: 1,
    releaseId: 'r6-art-v14',
    generatedAt: '2026-07-28T00:00:00.000Z',
    entries,
  };
}

afterEach(() => clearGameplayArtManifest());

describe('GameplayArtManifestV1', () => {
  it('accepts exactly 500 unique approved PF masters and keeps stable gameplay keys unchanged', () => {
    const entries = Array.from({ length: GAMEPLAY_ART_MASTER_TOTAL }, (_, index) => entry(index + 1));
    const validated = validateGameplayArtManifest(manifest(entries));

    expect(validated.entries).toHaveLength(500);
    expect(validated.entries[0].stableKey).toBe('v14_asset_001');
    expect(validated.entries[499].pfId).toBe('PF-asset-500');
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.entries)).toBe(true);
  });

  it('supports strict 100-item private approval gates only through explicit partial validation', () => {
    const gate = manifest(Array.from({ length: 100 }, (_, index) => entry(index + 1)));
    expect(() => validateGameplayArtManifest(gate)).toThrow('exactly 500');
    expect(validateGameplayArtManifest(gate, { requireComplete: false }).entries).toHaveLength(100);
  });

  it('allows derived runtime keys to share one approved PF master without inflating master coverage', () => {
    const source = entry(411, { stableKey: 'bubble_nova_red', bundle: 'skin-nova' });
    const derived = entry(411, { stableKey: 'bubble_nova_blue', bundle: 'skin-nova' });
    const validated = validateGameplayArtManifest(manifest([source, derived]), { requireComplete: false });

    expect(validated.entries).toHaveLength(2);
    expect(new Set(validated.entries.map(({ pfId }) => pfId))).toEqual(new Set(['PF-asset-411']));
  });

  it('validates ordered format fallbacks and resolves hosted candidate URLs', () => {
    const withFallback = entry(1);
    const fallbackHash = sha(1, 91);
    withFallback.variants.performance.fallbacks = [{
      format: 'png',
      dimensions: { width: 512, height: 1024 },
      bytes: 2048,
      sha256: fallbackHash,
      url: `/assets/v14/core/v14-asset-001-fallback.${fallbackHash.slice(0, 12)}.png`,
    }];
    installGameplayArtManifest(manifest([withFallback]), { requireComplete: false });

    const resolved = resolveArtAsset('v14_asset_001', 'performance');
    expect(resolved?.candidates.map(({ format }) => format)).toEqual(['webp', 'png']);
    expect(resolved?.candidates[1].url).toContain('/assets/v14/core/');
  });

  it('resolves quality-tier URLs and queries bundles without renaming texture identities', () => {
    const gate = manifest([
      entry(1, {
        stableKey: 'bubble_nova_red',
        dependencies: ['lumi_guide'],
        fallbackKey: 'bubble_nova_fallback',
      }),
      entry(2, { stableKey: 'lumi_guide', bundle: 'characters' }),
      entry(3, { stableKey: 'bubble_nova_fallback' }),
    ]);
    installGameplayArtManifest(gate, { requireComplete: false });

    const resolved = resolveArtAsset('bubble_nova_red', 'balanced');
    expect(resolved?.stableKey).toBe('bubble_nova_red');
    expect(resolved?.quality).toBe('balanced');
    expect(resolved?.url).toBe(resolved?.variant.url);
    expect(resolved?.dependencies).toEqual(['lumi_guide']);
    expect(resolved?.fallbackKey).toBe('bubble_nova_fallback');
    expect(getArtBundleKeys('core')).toEqual(['bubble_nova_red', 'bubble_nova_fallback']);
    expect(getArtBundleEntries('characters').map(({ stableKey }) => stableKey)).toEqual(['lumi_guide']);
    expect(getArtBundles()).toEqual(['core', 'characters']);
  });

  it('loads dependencies first and folds declared fallback files into one bounded recovery plan', () => {
    const primary = entry(1, {
      stableKey: 'bubble_nova_red',
      dependencies: ['lumi_guide'],
      fallbackKey: 'bubble_recovery_red',
    });
    const dependency = entry(2, { stableKey: 'lumi_guide', bundle: 'characters' });
    const fallback = entry(3, {
      stableKey: 'bubble_recovery_red',
      bundle: 'characters',
      dependencies: ['lumi_guide'],
    });
    installGameplayArtManifest(manifest([primary, dependency, fallback]), { requireComplete: false });

    const plan = getArtBundleLoadPlan('core', 'performance');
    expect(plan.map(({ stableKey }) => stableKey)).toEqual(['lumi_guide', 'bubble_nova_red']);
    expect(plan[1].candidates.map(({ url }) => url)).toEqual([
      primary.variants.performance.url,
      fallback.variants.performance.url,
    ]);
  });

  it('accepts an integrity-bound video poster and rejects missing or non-image poster references', () => {
    const video = entry(1, {
      stableKey: 'opening_cinematic',
      bundle: 'cinematics',
      mediaKind: 'video',
      posterKey: 'opening_poster',
    });
    video.variants = Object.fromEntries(
      (['performance', 'balanced', 'ultra'] as const).map((quality, index) => {
        const hash = sha(1, 200 + index);
        return [quality, {
          format: 'mp4' as const,
          dimensions: { width: 1280 + index * 320, height: 720 + index * 180 },
          bytes: 10_000 + index,
          sha256: hash,
          url: `/assets/v14/cinematics/opening.${hash.slice(0, 12)}.mp4`,
        }];
      }),
    ) as GameplayArtManifestEntryV1['variants'];
    const poster = entry(2, { stableKey: 'opening_poster', bundle: 'cinematics' });
    const validated = validateGameplayArtManifest(manifest([video, poster]), { requireComplete: false });
    expect(validated.entries[0].posterKey).toBe('opening_poster');

    expect(() => validateGameplayArtManifest(manifest([video]), { requireComplete: false }))
      .toThrow('poster "opening_poster" is missing');
    const audioPoster = entry(3, {
      stableKey: 'opening_poster',
      bundle: 'cinematics',
      mediaKind: 'audio',
    });
    audioPoster.variants = Object.fromEntries(
      (['performance', 'balanced', 'ultra'] as const).map((quality, index) => {
        const hash = sha(3, 300 + index);
        return [quality, {
          format: 'ogg' as const,
          dimensions: null,
          bytes: 5_000 + index,
          sha256: hash,
          url: `/assets/v14/cinematics/poster-audio.${hash.slice(0, 12)}.ogg`,
        }];
      }),
    ) as GameplayArtManifestEntryV1['variants'];
    expect(() => validateGameplayArtManifest(manifest([video, audioPoster]), { requireComplete: false }))
      .toThrow('poster must reference an image entry');
  });

  it('admits bytes only when both declared length and SHA-256 match', async () => {
    const bytes = new TextEncoder().encode('PaoPao V14 verified runtime art');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const file: GameplayArtFile = {
      format: 'webp',
      dimensions: { width: 32, height: 32 },
      bytes: bytes.byteLength,
      sha256,
      url: `/assets/v14/core/test.${sha256.slice(0, 12)}.webp`,
    };

    await expect(verifyGameplayArtFileBytes(file, bytes)).resolves.toBeUndefined();
    await expect(verifyGameplayArtFileBytes({ ...file, bytes: file.bytes + 1 }, bytes))
      .rejects.toBeInstanceOf(GameplayArtIntegrityError);
    await expect(verifyGameplayArtFileBytes(file, new TextEncoder().encode('wrong payload of equal-ish size')))
      .rejects.toBeInstanceOf(GameplayArtIntegrityError);
  });

  it('fails closed before configuration and for unknown keys or runtime quality values', () => {
    expect(resolveArtAsset('bubble_nova_red', 'balanced')).toBeNull();
    expect(getArtBundleKeys('core')).toEqual([]);

    const registry = new GameplayArtRegistry(manifest([entry(1)]), { requireComplete: false });
    expect(registry.resolve('missing_texture', 'ultra')).toBeNull();
    expect(registry.resolve('v14_asset_001', 'cinematic' as never)).toBeNull();
  });

  it('rejects external, traversal, fighting and non-content-addressed URLs', () => {
    for (const url of [
      'https://cdn.example/v14.webp',
      '/assets/v14/../secret.webp',
      '/assets/v14/fighting/fighter.000000000000.webp',
      '/assets/v14/core/no-content-hash.webp',
    ]) {
      const invalid = entry(1);
      invalid.variants.performance.url = url;
      expect(() => validateGameplayArtManifest(manifest([invalid]), { requireComplete: false }))
        .toThrow(GameplayArtManifestError);
    }
  });

  it('rejects duplicate primary hashes, missing references and cyclic fallback chains', () => {
    const duplicateHash = entry(2);
    duplicateHash.provenance.sourceSha256 = entry(1).provenance.sourceSha256;
    expect(() => validateGameplayArtManifest(manifest([entry(1), duplicateHash]), { requireComplete: false }))
      .toThrow('primary source hash');

    expect(() => validateGameplayArtManifest(manifest([
      entry(1, { dependencies: ['missing_key'] }),
    ]), { requireComplete: false })).toThrow('depends on missing key');

    expect(() => validateGameplayArtManifest(manifest([
      entry(1, { fallbackKey: 'v14_asset_002' }),
      entry(2, { fallbackKey: 'v14_asset_001' }),
    ]), { requireComplete: false })).toThrow('cycle');

    const tooDeep = Array.from({ length: 10 }, (_, index) => entry(
      index + 1,
      index < 9 ? { fallbackKey: `v14_asset_${String(index + 2).padStart(3, '0')}` } : {},
    ));
    expect(() => validateGameplayArtManifest(manifest(tooDeep), { requireComplete: false }))
      .toThrow('exceeds 8');
  });

  it('keeps the last known-good registry active when a replacement manifest fails validation', () => {
    installGameplayArtManifest(manifest([entry(1)]), { requireComplete: false });
    const invalid = manifest([entry(2)]);
    invalid.entries[0].provenance.approved = false as true;

    expect(() => installGameplayArtManifest(invalid, { requireComplete: false })).toThrow();
    expect(resolveArtAsset('v14_asset_001', 'performance')?.stableKey).toBe('v14_asset_001');
    expect(resolveArtAsset('v14_asset_002', 'performance')).toBeNull();
  });

  it('accepts the generated V14 preview with Nexus corruption art bound to eight approved masters', () => {
    const projectRoot = resolve(import.meta.dirname, '..');
    const generated = JSON.parse(readFileSync(
      resolve(projectRoot, 'public/assets/v14/art-manifest.json'),
      'utf8',
    ));
    const validated = validateGameplayArtManifest(generated, { requireComplete: false });

    expect(validated.entries).toHaveLength(89);
    expect(new Set(validated.entries.map(({ pfId }) => pfId)).size).toBe(8);
    expect(validated.entries.filter(({ stableKey }) => stableKey.startsWith('bubble_'))).toHaveLength(72);
    expect(validated.entries.filter(({ stableKey }) => stableKey.startsWith('archive.'))).toHaveLength(8);
    expect(validated.entries.some(({ stableKey }) => stableKey === 'world_nexus')).toBe(true);
    expect(validated.entries.some(({ stableKey }) => stableKey === 'world_nexus_atmosphere')).toBe(true);
    expect(validated.entries.every(({ variants }) => (
      variants.performance.fallbacks?.length === 1
      && variants.balanced.fallbacks?.length === 1
      && variants.ultra.fallbacks?.length === 1
    ))).toBe(true);
  });
});
