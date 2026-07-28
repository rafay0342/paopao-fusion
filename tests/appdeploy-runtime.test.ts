import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const builderSource = readFileSync(
  fileURLToPath(new URL('../tools/build-appdeploy-runtime.mjs', import.meta.url)),
  'utf8',
);
const packagedRuntime = readFileSync(
  fileURLToPath(new URL('../public/appdeploy/v1/main-appdeploy.js', import.meta.url)),
  'utf8',
);
const assetConsumerSources = [
  '../src/scenes/BootScene.ts',
  '../src/scenes/IntroScene.ts',
  '../src/scenes/MenuScene.ts',
  '../src/scenes/StoryScene.ts',
  '../src/scenes/ChronicleScene.ts',
  '../src/scenes/RewardsScene.ts',
  '../src/game/music.ts',
  '../src/game/handtracking.ts',
].map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

describe('AppDeploy portable runtime builder', () => {
  it('derives an immutable repository asset root instead of pinning a stale commit', () => {
    expect(builderSource).toContain("gitValue(['rev-parse', 'HEAD'])");
    expect(builderSource).toContain("gitValue(['remote', 'get-url', 'origin'])");
    expect(builderSource).toContain('PAOPAO_APPDEPLOY_ASSET_BASE');
    expect(builderSource).not.toMatch(/paopao-fusion@[a-f0-9]{40}\/public/i);
  });

  it('configures the shared resolver without rewriting minified asset strings', () => {
    expect(builderSource).toContain('globalThis.__PAOPAO_ASSET_BASE__=');
    expect(builderSource).toContain('shipped asset consumer resolves through hostedAssetUrl in source');
    expect(builderSource).not.toContain('rewriteLegacyAssetRoots');
    expect(builderSource).not.toContain('legacyAssetRootsRewritten');
    expect(builderSource).not.toContain('assets\\/(?!v14\\/)');
    for (const source of assetConsumerSources) {
      expect(source).toMatch(/from ['"](?:\.\.\/game\/|\.\/)hostedAsset['"]/);
      expect(source).toContain('hostedAssetUrl(');
    }
  });

  it('fails closed when retired fighting paths or unsafe frontend-only endpoints survive packaging', () => {
    expect(builderSource).toContain('PAOPAO_APPDEPLOY_ASSET_BASE is not a safe public asset URL');
    expect(builderSource).toContain('(?:fight|fighting)');
    expect(builderSource).toContain('Unsafe AppDeploy runtime path remains');
  });

  it('ships the generated runtime with the resolver configured before game startup', () => {
    expect(packagedRuntime).toMatch(/^globalThis\.__PAOPAO_ASSET_BASE__="https:\/\/[^"]+";\nimport/);
    expect(packagedRuntime).not.toMatch(/["'`]\/?(?:assets|mediapipe)\/(?:fight|fighting)(?:\/|["'`?#])/i);
  });
});
