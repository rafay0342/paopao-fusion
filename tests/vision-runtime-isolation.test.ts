import { describe, expect, it } from 'vitest';
import {
  isolateVisionLoader,
  type VisionTaskAttempt,
} from '../src/game/visionruntime';

describe('MediaPipe module-worker runtime isolation', () => {
  const baseFileset = {
    wasmLoaderPath: 'https://cdn.example/vision_wasm_module_internal.js',
    wasmBinaryPath: 'https://cdn.example/vision_wasm_module_internal.wasm',
    assetLoaderPath: 'https://cdn.example/vision_assets.js',
    assetBinaryPath: 'https://cdn.example/vision_assets.data',
  };

  it('uses a distinct loader module while preserving every cacheable binary and asset path', () => {
    const tasks: VisionTaskAttempt[] = [
      'hand-gpu',
      'hand-cpu',
      'face-gpu',
      'face-cpu',
    ];
    const isolated = tasks.map((task, index) => (
      isolateVisionLoader(baseFileset, task, index + 1, 'https://game.example/worker.js')
    ));

    expect(new Set(isolated.map((fileset) => fileset.wasmLoaderPath)).size).toBe(4);
    expect(isolated.map((fileset) => (
      new URL(fileset.wasmLoaderPath).searchParams.get('paopao-runtime')
    ))).toEqual([
      'hand-gpu-1',
      'hand-cpu-2',
      'face-gpu-3',
      'face-cpu-4',
    ]);
    for (const fileset of isolated) {
      expect(new URL(fileset.wasmLoaderPath).pathname)
        .toBe('/vision_wasm_module_internal.js');
      expect(fileset.wasmBinaryPath).toBe(baseFileset.wasmBinaryPath);
      expect(fileset.assetLoaderPath).toBe(baseFileset.assetLoaderPath);
      expect(fileset.assetBinaryPath).toBe(baseFileset.assetBinaryPath);
    }
    expect(baseFileset.wasmLoaderPath)
      .toBe('https://cdn.example/vision_wasm_module_internal.js');
  });

  it('rejects generations that could collide with an already-consumed module URL', () => {
    expect(() => isolateVisionLoader(baseFileset, 'face-gpu', 0, 'https://game.example/'))
      .toThrow('positive safe integer');
    expect(() => isolateVisionLoader(
      baseFileset,
      'face-gpu',
      Number.MAX_SAFE_INTEGER + 1,
      'https://game.example/',
    )).toThrow('positive safe integer');
  });
});
