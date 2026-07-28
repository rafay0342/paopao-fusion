import { afterEach, describe, expect, it } from 'vitest';
import {
  assetBaseUrl,
  hostedAssetUrl,
  isBlockedAssetPath,
} from '../src/game/hostedAsset';

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('portable hosted asset resolution', () => {
  it('keeps canonical same-origin paths in the normal runtime', () => {
    expect(hostedAssetUrl('/assets/worlds/world-crystal.jpg')).toBe('/assets/worlds/world-crystal.jpg');
  });

  it('uses an explicit public asset base without changing manifest paths', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __PAOPAO_ASSET_BASE__: 'https://cdn.example/game/public/' },
    });
    expect(assetBaseUrl()).toBe('https://cdn.example/game/public/');
    expect(hostedAssetUrl('/assets/worlds/world-crystal.jpg'))
      .toBe('https://cdn.example/game/public/assets/worlds/world-crystal.jpg');
  });

  it('resolves relative and content-hashed V14 paths through the same base', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __PAOPAO_ASSET_BASE__: 'https://cdn.example/game/public' },
    });
    expect(hostedAssetUrl('assets/v14/art-manifest.json'))
      .toBe('https://cdn.example/game/public/assets/v14/art-manifest.json');
    expect(hostedAssetUrl('/assets/v14/bundles/core/lumi.0123456789ab.webp?quality=balanced#frame'))
      .toBe('https://cdn.example/game/public/assets/v14/bundles/core/lumi.0123456789ab.webp?quality=balanced#frame');
    expect(hostedAssetUrl('https://media.example/lumi.0123456789ab.webp'))
      .toBe('https://media.example/lumi.0123456789ab.webp');
  });

  it('rejects unsafe deployment bases instead of routing assets ambiguously', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __PAOPAO_ASSET_BASE__: 'javascript:alert(1)' },
    });
    expect(() => hostedAssetUrl('/assets/v14/art-manifest.json')).toThrow('safe public HTTP URL');
  });

  it('hard-blocks retired fight and fighting path segments, including encoded paths', () => {
    for (const path of [
      '/assets/fight/arena.png',
      '/assets/fighting/fighter.png',
      '/assets/%66ighting/fighter.png',
      'https://cdn.example/assets/fighting/fighter.png',
    ]) {
      expect(isBlockedAssetPath(path)).toBe(true);
      expect(() => hostedAssetUrl(path)).toThrow('Retired fighting assets');
    }
    expect(isBlockedAssetPath('/assets/story/fighting-the-rift.webp')).toBe(false);
  });
});
