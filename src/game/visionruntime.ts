export type VisionTaskAttempt = 'hand-gpu' | 'hand-cpu' | 'face-gpu' | 'face-cpu';

/**
 * Returns a fileset whose small Emscripten loader module has a unique URL.
 * The WASM binary and every other fileset field remain unchanged, so browsers
 * can still reuse the large immutable binary across hand and face tasks.
 */
export function isolateVisionLoader<
  Fileset extends { wasmLoaderPath: string },
>(
  fileset: Fileset,
  task: VisionTaskAttempt,
  generation: number,
  baseUrl: string,
): Fileset {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('Vision runtime generation must be a positive safe integer.');
  }
  const loaderUrl = new URL(fileset.wasmLoaderPath, baseUrl);
  loaderUrl.searchParams.set('paopao-runtime', `${task}-${generation}`);
  return {
    ...fileset,
    wasmLoaderPath: loaderUrl.toString(),
  };
}
