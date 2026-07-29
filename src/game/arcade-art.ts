import type { RenderQuality } from './meta';

export type ArcadeWorldId = 'rainway' | 'memory';

const WORLD_SLUGS: Record<ArcadeWorldId, string> = {
  rainway: 'aurora-rainway',
  memory: 'pearl-memory',
};

export function arcadeWorldTextureKey(
  world: ArcadeWorldId,
  quality: RenderQuality,
): string {
  return `world_arcade_${world}_${quality}`;
}

export const ARCADE_WORLD_IMAGES = (Object.entries(WORLD_SLUGS) as Array<[ArcadeWorldId, string]>)
  .flatMap(([world, slug]) => (
    (['performance', 'balanced', 'ultra'] as const).map((quality) => ({
      key: arcadeWorldTextureKey(world, quality),
      url: `assets/worlds/v15/arcade/${slug}-${quality}.webp`,
      fallbackUrl: `assets/worlds/v15/arcade/${slug}-${quality}.jpg`,
    }))
  ));
