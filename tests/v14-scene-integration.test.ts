import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

describe('V14 scene art integration', () => {
  it('installs the manifest before selecting only core, current realm and equipped skin at boot', () => {
    const boot = readText('src/scenes/BootScene.ts');

    expect(boot).toContain('GAMEPLAY_ART_MANIFEST_URL');
    expect(boot).toContain('clearGameplayArtManifest()');
    expect(boot).toContain('installGameplayArtManifest(manifest, { requireComplete })');
    expect(boot).toContain("get('art-preview') === 'v14-a1'");
    expect(boot).toContain("releaseId === 'r6-art-v14-a1-preview'");
    expect(boot).toContain("releaseId !== 'r6-art-v14' && !isA1Preview");
    expect(boot).toMatch(/if \(isA1Preview && !previewOptIn\) \{[\s\S]*?this\.queueLegacyBootImages\(\);[\s\S]*?return;/);
    expect(boot).not.toContain('A1 art preview requires explicit local or private QA opt-in');
    expect(boot).toContain('const requireComplete = !isA1Preview');
    expect(boot).toContain('const bundles: readonly GameplayArtBundle[] = [...new Set<GameplayArtBundle>([');
    expect(boot).toContain("'core',");
    expect(boot).not.toContain("'characters',");
    expect(boot).not.toContain("'realm-crystal',");
    expect(boot).toContain('`realm-${world.id}`');
    expect(boot).toContain("`skin-${meta.equippedSkin.replace(/_/g, '-')}`");
    expect(boot).toContain('furthestUnlockedWorld(getProgress())');
    expect(boot).toContain('resolveArtAsset(stableKey, meta.quality)');
    expect(boot).toContain("['image', 'layered', 'atlas'].includes(asset.mediaKind)");
    expect(boot).toContain('requestEquippedOfflineArt(COLOR_KEYS.map((color) => ({');
    expect(boot).toContain('fallbackPath: `assets/sprites/${activeSkinDef.assetFolder}/${activeSkinDef.assetSlug}-${color}.png`');
  });

  it('loads the character bundle at the scene boundaries that actually render it', () => {
    for (const path of [
      'src/scenes/MenuScene.ts',
      'src/scenes/StoryScene.ts',
      'src/scenes/ChronicleScene.ts',
    ]) {
      const scene = readText(path);
      expect(scene).toContain("queueArtBundle(this, 'characters')");
      expect(scene).toContain("getArtBundleKeys('characters')");
    }
  });

  it('keeps V14 retries bounded to declared candidates and one legacy recovery URL', () => {
    const boot = readText('src/scenes/BootScene.ts');

    expect(boot).toContain('nextCandidate: 1');
    expect(boot).toContain('queueVerifiedArtCandidate(this, retry.asset, retry.nextCandidate)');
    expect(boot).toContain('retry.legacyUrl && !retry.legacyQueued');
    expect(boot).toContain('this.queueLegacyBootImages(v14Keys)');
    expect(boot).not.toContain('/fighting/');
  });

  it('streams the visible reward page plus one page and releases stale scene-owned skins', () => {
    const rewards = readText('src/scenes/RewardsScene.ts');

    expect(rewards).toContain('const visiblePage = SKIN_PAGES[this.skinPage]');
    expect(rewards).toContain('const prefetchedPage = SKIN_PAGES[(this.skinPage + 1) % SKIN_PAGES.length]');
    expect(rewards).toContain('const streamedSkins = [...visiblePage.skins, ...prefetchedPage.skins]');
    expect(rewards).toContain('resolveArtAsset(key, quality)');
    expect(rewards).toContain('queueVerifiedArtCandidate(this, resolved)');
    expect(rewards).toContain('queueVerifiedArtCandidate(this, retry.asset, retry.nextCandidate)');
    expect(rewards).toContain('rewardsManagedOrbKeys.delete(key)');
    expect(rewards).toContain('pinnedEquippedKeys.has(key)');
    expect(rewards).not.toContain('for (const skin of ORB_SKINS)');
  });

  it('replaces procedural archive cards with integrity-verified previews from the active V14 manifest', () => {
    const archive = readText('src/scenes/ProductionArchiveScene.ts');

    expect(archive).toContain('getGameplayArtManifest()');
    expect(archive).toContain("stableKey.startsWith('archive.')");
    expect(archive).toContain('resolveArtAsset(entry.stableKey, getMeta().quality)');
    expect(archive).toContain('await verifyGameplayArtFileBytes(candidate, bytes)');
    expect(archive).toContain('has no approved V14 image, audio or video preview');
    expect(archive).toContain('NO APPROVED V14 MASTERS');
    expect(archive).toMatch(/if \(v14Manifest && v14Entries\.length > 0\) \{[\s\S]*?this\.renderPage\(\);[\s\S]*?return;/);
  });

  it('plays only integrity-verified V14 audio/video blobs with a verified poster and bounded cleanup', () => {
    const archive = readText('src/scenes/ProductionArchiveScene.ts');

    expect(archive).toContain("resolved.mediaKind === 'audio'");
    expect(archive).toContain("resolved.mediaKind === 'video'");
    expect(archive).toContain('resolveArtAsset(resolved.posterKey, resolved.quality)');
    expect(archive).toContain('video preview is missing its approved poster fallback');
    expect(archive).toContain("kind: 'audio'");
    expect(archive).toContain("kind: 'video'");
    expect(archive).toContain("document.createElement(resolved.mediaKind === 'video' ? 'video' : 'audio')");
    expect(archive).toContain('URL.createObjectURL(asset.blob)');
    expect(archive).toContain("'PLAY AUDIO'");
    expect(archive).toContain("'PAUSE AUDIO'");
    expect(archive).toContain("'PLAY VIDEO'");
    expect(archive).toContain("'PAUSE VIDEO'");
    expect(archive).toContain('VIDEO LOCKED • VERIFIED POSTER SAFE');
    expect(archive).toContain("audio.removeAttribute('src')");
    expect(archive).toContain('video.removeVideoElement()');
    expect(archive).toContain('URL.revokeObjectURL(objectUrl)');
    expect(archive).toMatch(/private disposePage\(\): void \{[\s\S]*?this\.releasePageMedia\(\);[\s\S]*?this\.pageLayer\?\.destroy\(true\);/);
  });
});
