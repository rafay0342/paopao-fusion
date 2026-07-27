import { afterEach, describe, expect, it } from 'vitest';
import { hostedAssetUrl } from '../src/game/hostedAsset';

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
    expect(hostedAssetUrl('/assets/worlds/world-crystal.jpg'))
      .toBe('https://cdn.example/game/public/assets/worlds/world-crystal.jpg');
  });
});
