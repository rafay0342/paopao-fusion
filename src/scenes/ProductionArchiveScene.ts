import Phaser from 'phaser';
import { VIEW } from '../config';
import {
  getGameplayArtManifest,
  resolveArtAsset,
  verifyGameplayArtFileBytes,
  type GameplayArtFile,
  type GameplayArtFormat,
  type GameplayArtManifestEntryV1,
  type ResolvedGameplayArtAsset,
} from '../game/art-v14';
import { getMeta } from '../game/meta';
import {
  PRODUCTION_ARCHIVE_PAGE_SIZE,
  productionAssetLoader,
  type LoadedProductionAsset,
  type ProductionRuntimeEntry,
  type ProductionRuntimeManifest,
} from '../game/production-assets';
import { SFX } from '../game/sfx';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addWorldBackground,
  DISPLAY_FONT,
  fitText,
  sharpenSceneText,
  TYPE,
  UI_FONT,
} from '../gfx/ui';

type ReleaseFilter = 0 | 1 | 2 | 3 | 4 | 5;

const CARD_POSITIONS = [
  { x: 190, y: 380 }, { x: 530, y: 380 },
  { x: 190, y: 665 }, { x: 530, y: 665 },
  { x: 190, y: 950 }, { x: 530, y: 950 },
] as const;

const RELEASE_ACCENTS = ['#84e8ff', '#76e4ff', '#8de6ad', '#ffc77d', '#d6a0ff', '#ff97bd'] as const;

const V14_ARCHIVE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  'PF-asset-002': 'Lumi guide — hero illustration master',
  'PF-asset-012': 'Aurora Crown — hero illustration master',
  'PF-asset-021': 'Crystal realm — hero environment master',
  'PF-asset-031': 'Emerald realm — hero environment master',
  'PF-asset-102': 'Prism Warden — hero illustration master',
  'PF-asset-402': 'Keeper and launcher — hero illustration master',
  'PF-asset-411': 'Fusion Pao family — design turnaround',
});

type ArchiveEntry = ProductionRuntimeEntry | GameplayArtManifestEntryV1;

interface DecodedImage {
  source: CanvasImageSource;
  close: () => void;
}

interface VerifiedArchiveImage {
  id: string;
  sha256: string;
  width: number;
  height: number;
  blob: Blob;
}

interface VerifiedArchiveMedia {
  id: string;
  sha256: string;
  format: GameplayArtFormat;
  blob: Blob;
}

type VerifiedV14ArchivePreview =
  | { kind: 'image'; image: VerifiedArchiveImage }
  | { kind: 'audio'; media: VerifiedArchiveMedia }
  | {
    kind: 'video';
    media: VerifiedArchiveMedia | null;
    poster: VerifiedArchiveImage;
    unavailableReason?: string;
  };

interface ArchiveMediaHandle {
  pause: () => void;
  release: () => void;
}

const MEDIA_MIME_TYPES: Readonly<Partial<Record<GameplayArtFormat, string>>> = Object.freeze({
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
});

function isV14ArchiveEntry(entry: ArchiveEntry): entry is GameplayArtManifestEntryV1 {
  return 'stableKey' in entry;
}

function archiveEntryId(entry: ArchiveEntry): string {
  return isV14ArchiveEntry(entry) ? entry.pfId : entry.id;
}

function archiveEntryRelease(entry: ArchiveEntry): 1 | 2 | 3 | 4 | 5 {
  if (!isV14ArchiveEntry(entry)) return entry.release;
  const ordinal = Number.parseInt(entry.pfId.slice(-3), 10);
  return Math.min(5, Math.max(1, Math.ceil(ordinal / 100))) as 1 | 2 | 3 | 4 | 5;
}

function archiveEntryTitle(entry: ArchiveEntry): string {
  if (!isV14ArchiveEntry(entry)) return entry.title;
  return V14_ARCHIVE_TITLES[entry.pfId]
    ?? entry.stableKey.replace(/^archive\./, '').replace(/[._-]+/g, ' ');
}

async function decodeVerifiedImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, close: () => bitmap.close() };
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Verified production image could not be decoded.'));
      image.src = objectUrl;
    });
    return { source: image, close: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export class ProductionArchiveScene extends Phaser.Scene {
  private manifest?: ProductionRuntimeManifest;
  private v14Entries?: readonly GameplayArtManifestEntryV1[];
  private releaseFilter: ReleaseFilter = 0;
  private page = 0;
  private generation = 0;
  private pageAbort?: AbortController;
  private pageLayer?: Phaser.GameObjects.Container;
  private statusText?: Phaser.GameObjects.Text;
  private pageText?: Phaser.GameObjects.Text;
  private previousButton?: Phaser.GameObjects.Container;
  private nextButton?: Phaser.GameObjects.Container;
  private releaseButtons: Phaser.GameObjects.Container[] = [];
  private pageTextureKeys = new Set<string>();
  private pageMediaHandles = new Set<ArchiveMediaHandle>();

  constructor() {
    super('ProductionArchive');
  }

  create(): void {
    const { width, height } = VIEW;
    this.cameras.main.fadeIn(180, 0, 0, 0);
    addWorldBackground(this, 'world_celestial', 0.44);
    addAmbientMotes(this, 0x7eeaff, 18, 2);
    this.add.rectangle(0, 0, width, height, 0x02050d, 0.28).setOrigin(0).setDepth(3);

    addArtPanel(this, width / 2, 92, 640, 156, 7, 0.98);
    addArtButton(this, 76, 45, '‹  GALLERY', () => this.leave(), 132, 46, 20);
    this.add.text(width / 2, 42, '✦  VERIFIED PHASER COLLECTION  ✦', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe2a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    fitText(this.add.text(width / 2, 83, 'PRODUCTION ARCHIVE', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#90e8ff', fontStyle: 'bold',
      stroke: '#182653', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 4, '#000000', 9), 500);
    this.statusText = this.add.text(width / 2, 123, 'READING SIGNED RUNTIME INDEX…', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b8c8dd', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);

    this.releaseButtons = Array.from({ length: 6 }, (_, index) => addArtButton(
      this,
      75 + index * 114,
      190,
      index === 0 ? 'ALL' : `R${index}`,
      () => this.selectRelease(index as ReleaseFilter),
      98,
      46,
      14,
    ));

    addArtPanel(this, width / 2, 662, 680, 902, 6, 0.93);
    this.pageText = this.add.text(width / 2, height - 79, 'PAGE -- / --', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b9c8dd', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(16);
    this.previousButton = addArtButton(this, 104, height - 44, '‹', () => this.changePage(-1), 100, 54, 18);
    this.nextButton = addArtButton(this, width - 104, height - 44, '›', () => this.changePage(1), 100, 54, 18);
    addArtButton(this, width / 2, height - 42, 'RETURN TO GALLERY', () => this.leave(), 300, 56, 18);

    this.input.keyboard?.on('keydown-LEFT', () => this.changePage(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.changePage(1));
    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.disposePage());
    this.updateReleaseButtons();
    sharpenSceneText(this);
    void this.openManifest();
  }

  private async openManifest(): Promise<void> {
    try {
      const v14Manifest = getGameplayArtManifest();
      const v14Entries = v14Manifest?.entries.filter(({ stableKey }) => stableKey.startsWith('archive.')) ?? [];
      if (v14Manifest && v14Entries.length > 0) {
        // This fast path runs synchronously inside create(), before Phaser
        // necessarily reports the scene as active. Unlike the legacy network
        // path below, it must not discard the already-validated registry.
        this.v14Entries = Object.freeze(v14Entries);
        this.statusText?.setText(
          `${v14Entries.length} / 500 APPROVED V14 MASTERS  •  ${v14Manifest.releaseId.toUpperCase()}`,
        );
        this.renderPage();
        return;
      }
      const manifest = await productionAssetLoader.manifest();
      if (!this.scene.isActive()) return;
      this.manifest = manifest;
      this.statusText?.setText(`${manifest.total} ORIGINAL MASTERS  •  ${(manifest.runtimeBytes / 1_048_576).toFixed(1)} MB BOUNDED RUNTIME`);
      this.renderPage();
    } catch (error) {
      if (!this.scene.isActive()) return;
      this.statusText?.setText('ARCHIVE LOCKED  •  RUNTIME INDEX FAILED VALIDATION').setColor('#ff9c9c');
      this.showFatal(error);
    }
  }

  private filteredEntries(): ArchiveEntry[] {
    const entries: readonly ArchiveEntry[] = this.v14Entries ?? this.manifest?.entries ?? [];
    return this.releaseFilter === 0
      ? [...entries]
      : entries.filter((entry) => archiveEntryRelease(entry) === this.releaseFilter);
  }

  private selectRelease(release: ReleaseFilter): void {
    if ((!this.manifest && !this.v14Entries) || this.releaseFilter === release) return;
    SFX.click();
    this.releaseFilter = release;
    this.page = 0;
    this.updateReleaseButtons();
    this.renderPage();
  }

  private updateReleaseButtons(): void {
    this.releaseButtons.forEach((button, release) => {
      button.setAlpha(release === this.releaseFilter ? 1 : 0.58);
      button.setScale(release === this.releaseFilter ? 1.035 : 1);
    });
  }

  private changePage(delta: number): void {
    const entries = this.filteredEntries();
    if (!entries.length) return;
    const pageCount = Math.ceil(entries.length / PRODUCTION_ARCHIVE_PAGE_SIZE);
    const next = Phaser.Math.Clamp(this.page + delta, 0, pageCount - 1);
    if (next === this.page) return;
    SFX.click();
    this.page = next;
    this.renderPage();
  }

  private renderPage(): void {
    const entries = this.filteredEntries();
    if (!entries.length) {
      this.disposePage();
      this.pageText?.setText(`${this.releaseFilter === 0 ? 'ALL RELEASES' : `RELEASE ${this.releaseFilter}`}  •  NO APPROVED V14 MASTERS`);
      this.previousButton?.setAlpha(0.35);
      this.nextButton?.setAlpha(0.35);
      this.pageLayer = this.add.container(0, 0).setDepth(10);
      const empty = this.add.text(VIEW.width / 2, 620, 'THIS V14 RELEASE GATE IS STILL IN SOURCE REVIEW', {
        fontFamily: UI_FONT, fontSize: TYPE.body, color: '#c4d2e7', fontStyle: 'bold', align: 'center',
        wordWrap: { width: 520, useAdvancedWrap: true },
      }).setOrigin(0.5);
      this.pageLayer.add(empty);
      return;
    }
    this.disposePage();
    this.generation += 1;
    const generation = this.generation;
    this.pageAbort = new AbortController();
    const pageCount = Math.ceil(entries.length / PRODUCTION_ARCHIVE_PAGE_SIZE);
    this.page = Phaser.Math.Clamp(this.page, 0, pageCount - 1);
    const pageEntries = entries.slice(
      this.page * PRODUCTION_ARCHIVE_PAGE_SIZE,
      (this.page + 1) * PRODUCTION_ARCHIVE_PAGE_SIZE,
    );
    this.pageText?.setText(
      `${this.releaseFilter === 0 ? 'ALL RELEASES' : `RELEASE ${this.releaseFilter}`}  •  PAGE ${this.page + 1} / ${pageCount}`,
    );
    this.previousButton?.setAlpha(this.page === 0 ? 0.35 : 1);
    this.nextButton?.setAlpha(this.page === pageCount - 1 ? 0.35 : 1);
    this.pageLayer = this.add.container(0, 0).setDepth(10).setAlpha(0);
    pageEntries.forEach((entry, index) => this.renderPendingCard(entry, index, generation));
    this.tweens.add({ targets: this.pageLayer, alpha: 1, duration: 180, ease: 'Cubic.easeOut' });
    sharpenSceneText(this);
  }

  private renderPendingCard(entry: ArchiveEntry, index: number, generation: number): void {
    const position = CARD_POSITIONS[index];
    const card = this.add.container(position.x, position.y);
    const panel = addArtPanel(this, 0, 0, 306, 254, 0, 0.97);
    const release = archiveEntryRelease(entry);
    const entryId = archiveEntryId(entry);
    const releaseColor = RELEASE_ACCENTS[release];
    const id = this.add.text(-132, -105, `${entryId}  •  R${release}`, {
      fontFamily: UI_FONT, fontSize: '12px', color: releaseColor, fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0, 0.5);
    const title = fitText(this.add.text(0, 101, archiveEntryTitle(entry).toUpperCase(), {
      fontFamily: UI_FONT, fontSize: '13px', color: '#eef6ff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5), 262, 0.78);
    const loading = this.add.text(0, -2, 'VERIFYING SHA-256…', {
      fontFamily: UI_FONT, fontSize: '12px', color: '#9daec4', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);
    card.add([panel, id, title, loading]);
    this.pageLayer?.add(card);
    if (isV14ArchiveEntry(entry)) {
      void this.loadV14ArchivePreview(entry, this.pageAbort?.signal).then((preview) => {
        if (!this.isCurrent(generation)) return;
        return this.populateV14Preview(card, preview, generation).then(() => {
          if (this.isCurrent(generation)) loading.destroy();
        });
      }).catch((error: unknown) => {
        if (!this.isCurrent(generation) || (error instanceof DOMException && error.name === 'AbortError')) return;
        loading.setText('INTEGRITY LOCKED').setColor('#ff9a9a');
        const reason = this.add.text(0, 30, error instanceof Error ? error.message : 'V14 preview validation failed.', {
          fontFamily: UI_FONT, fontSize: '10px', color: '#d5a3aa', align: 'center',
          wordWrap: { width: 248, useAdvancedWrap: true },
        }).setOrigin(0.5, 0);
        card.add(reason);
      });
      return;
    }
    void productionAssetLoader.load(entry.id, this.pageAbort?.signal).then((asset) => {
      if (!this.isCurrent(generation)) return;
      return this.populateCard(card, asset, generation).then(() => {
        if (this.isCurrent(generation)) loading.destroy();
      });
    }).catch((error: unknown) => {
      if (!this.isCurrent(generation) || (error instanceof DOMException && error.name === 'AbortError')) return;
      loading.setText('INTEGRITY LOCKED').setColor('#ff9a9a');
      const reason = this.add.text(0, 30, error instanceof Error ? error.message : 'Asset validation failed.', {
        fontFamily: UI_FONT, fontSize: '10px', color: '#d5a3aa', align: 'center',
        wordWrap: { width: 248, useAdvancedWrap: true },
      }).setOrigin(0.5, 0);
      card.add(reason);
    });
  }

  private async loadV14ArchivePreview(
    entry: GameplayArtManifestEntryV1,
    signal?: AbortSignal,
  ): Promise<VerifiedV14ArchivePreview> {
    const resolved = resolveArtAsset(entry.stableKey, getMeta().quality);
    if (!resolved) throw new Error(`${entry.pfId} is missing from the active V14 registry.`);

    if (resolved.mediaKind === 'image') {
      return {
        kind: 'image',
        image: await this.loadV14ArchiveImage(entry.pfId, resolved, signal),
      };
    }
    if (resolved.mediaKind === 'audio') {
      return {
        kind: 'audio',
        media: await this.loadV14ArchiveMedia(entry.pfId, resolved, signal),
      };
    }
    if (resolved.mediaKind === 'video') {
      if (!resolved.posterKey) {
        throw new Error(`${entry.pfId} video preview is missing its approved poster fallback.`);
      }
      const poster = resolveArtAsset(resolved.posterKey, resolved.quality);
      if (!poster || poster.mediaKind !== 'image') {
        throw new Error(`${entry.pfId} video poster is not an approved V14 image.`);
      }
      const verifiedPoster = await this.loadV14ArchiveImage(`${entry.pfId}-poster`, poster, signal);
      try {
        const media = await this.loadV14ArchiveMedia(entry.pfId, resolved, signal);
        return { kind: 'video', media, poster: verifiedPoster };
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        return {
          kind: 'video',
          media: null,
          poster: verifiedPoster,
          unavailableReason: error instanceof Error ? error.message : 'Video verification failed.',
        };
      }
    }
    throw new Error(`${entry.pfId} has no approved V14 image, audio or video preview.`);
  }

  private async loadV14ArchiveImage(
    id: string,
    resolved: ResolvedGameplayArtAsset,
    signal?: AbortSignal,
  ): Promise<VerifiedArchiveImage> {
    let finalError: unknown;
    for (const candidate of resolved.candidates) {
      try {
        if (!candidate.dimensions) throw new Error(`${id} preview dimensions are missing.`);
        const media = await this.readV14ArchiveCandidate(id, candidate, signal);
        const image: VerifiedArchiveImage = {
          id,
          sha256: media.sha256,
          width: candidate.dimensions.width,
          height: candidate.dimensions.height,
          blob: media.blob,
        };
        const decoded = await decodeVerifiedImage(image.blob);
        decoded.close();
        return image;
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        finalError = error;
      }
    }
    throw finalError instanceof Error
      ? finalError
      : new Error(`${id} has no decodable integrity-verified preview.`);
  }

  private async loadV14ArchiveMedia(
    id: string,
    resolved: ResolvedGameplayArtAsset,
    signal?: AbortSignal,
  ): Promise<VerifiedArchiveMedia> {
    const probe = document.createElement(resolved.mediaKind === 'video' ? 'video' : 'audio');
    const browserCandidates = resolved.candidates.filter((candidate) => {
      const mimeType = MEDIA_MIME_TYPES[candidate.format];
      return Boolean(mimeType && probe.canPlayType(mimeType));
    });
    if (browserCandidates.length === 0) {
      throw new Error(`${id} has no browser-supported ${resolved.mediaKind} variant.`);
    }
    let finalError: unknown;
    for (const candidate of browserCandidates) {
      try {
        return await this.readV14ArchiveCandidate(id, candidate, signal);
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        finalError = error;
      }
    }
    throw finalError instanceof Error
      ? finalError
      : new Error(`${id} has no integrity-verified ${resolved.mediaKind} preview.`);
  }

  private async readV14ArchiveCandidate(
    id: string,
    candidate: GameplayArtFile,
    signal?: AbortSignal,
  ): Promise<VerifiedArchiveMedia> {
    const mimeType = MEDIA_MIME_TYPES[candidate.format];
    if (!mimeType) throw new Error(`${id} preview format is not playable in the archive.`);
    const response = await fetch(candidate.url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'force-cache',
      redirect: 'error',
      signal,
      headers: { Accept: mimeType },
    });
    if (!response.ok || response.redirected) throw new Error(`${id} V14 preview request was rejected.`);
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && Number(declaredLength) !== candidate.bytes) {
      throw new Error(`${id} V14 preview length differs from its manifest.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verifyGameplayArtFileBytes(candidate, bytes);
    return {
      id,
      sha256: candidate.sha256,
      format: candidate.format,
      blob: new Blob([bytes], { type: mimeType }),
    };
  }

  private async populateV14Preview(
    card: Phaser.GameObjects.Container,
    preview: VerifiedV14ArchivePreview,
    generation: number,
  ): Promise<void> {
    if (preview.kind === 'image') {
      await this.populateVerifiedImage(card, preview.image, generation);
    } else if (preview.kind === 'audio') {
      this.populateVerifiedAudio(card, preview.media, generation);
    } else if (!preview.media) {
      await this.populateVerifiedVideoFallback(
        card,
        preview.poster,
        preview.unavailableReason ?? 'Video verification failed.',
        generation,
      );
    } else {
      await this.populateVerifiedVideo(card, preview.media, preview.poster, generation);
    }
  }

  private async populateVerifiedVideoFallback(
    card: Phaser.GameObjects.Container,
    poster: VerifiedArchiveImage,
    reason: string,
    generation: number,
  ): Promise<void> {
    await this.populateVerifiedImage(card, poster, generation, poster.sha256, 'POSTER SHA');
    if (!this.isCurrent(generation)) return;
    const status = this.add.text(0, 45, 'VIDEO LOCKED • VERIFIED POSTER SAFE', {
      fontFamily: UI_FONT, fontSize: '10px', color: '#ffb0a7', fontStyle: 'bold', letterSpacing: 0.4,
      backgroundColor: '#07111edc',
      padding: { x: 7, y: 4 },
    }).setOrigin(0.5);
    const detail = this.add.text(0, 64, reason, {
      fontFamily: UI_FONT, fontSize: '8px', color: '#d2bdc2', align: 'center',
      wordWrap: { width: 230, useAdvancedWrap: true },
    }).setOrigin(0.5, 0);
    card.add([status, detail]);
  }

  private populateVerifiedAudio(
    card: Phaser.GameObjects.Container,
    asset: VerifiedArchiveMedia,
    generation: number,
  ): void {
    if (!this.isCurrent(generation)) return;
    const objectUrl = URL.createObjectURL(asset.blob);
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = objectUrl;
    audio.volume = 0.82;

    const icon = this.add.text(0, -48, '♪  VERIFIED AUDIO MASTER  ♪', {
      fontFamily: UI_FONT, fontSize: '13px', color: '#96e9ff', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);
    const format = this.add.text(0, -18, asset.format.toUpperCase(), {
      fontFamily: UI_FONT, fontSize: '11px', color: '#d7e3f1', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);
    const status = this.add.text(0, 8, 'READY • TAP PLAY', {
      fontFamily: UI_FONT, fontSize: '9px', color: '#b9c9dc', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);
    const hash = this.add.text(0, -82, `AUDIO SHA ${asset.sha256.slice(0, 12).toUpperCase()}`, {
      fontFamily: UI_FONT, fontSize: '9px', color: '#9eb3c8', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);

    let released = false;
    const onPlay = (): void => {
      if (status.active) status.setText('PLAYING • VERIFIED');
    };
    const onEnded = (): void => {
      if (status.active) status.setText('COMPLETE • TAP PLAY');
    };
    const onError = (): void => {
      if (status.active) status.setText('PLAYBACK UNAVAILABLE • VERIFIED').setColor('#ffaaaa');
    };
    const handle: ArchiveMediaHandle = {
      pause: () => {
        if (released) return;
        audio.pause();
        if (status.active && !audio.ended) status.setText('PAUSED • VERIFIED');
      },
      release: () => {
        if (released) return;
        released = true;
        audio.pause();
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(objectUrl);
      },
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    const play = addArtButton(this, -68, 53, 'PLAY AUDIO', () => {
      if (released || !this.isCurrent(generation)) return;
      this.pausePageMedia(handle);
      if (audio.ended) audio.currentTime = 0;
      status.setText('STARTING…').setColor('#b9c9dc');
      void audio.play().catch(onError);
    }, 122, 46, 19);
    const pause = addArtButton(this, 68, 53, 'PAUSE AUDIO', () => handle.pause(), 122, 46, 19);
    card.add([icon, format, status, hash, play, pause]);
    this.pageMediaHandles.add(handle);
  }

  private async populateVerifiedVideo(
    card: Phaser.GameObjects.Container,
    asset: VerifiedArchiveMedia,
    poster: VerifiedArchiveImage,
    generation: number,
  ): Promise<void> {
    await this.populateVerifiedImage(card, poster, generation, asset.sha256, 'VIDEO SHA');
    if (!this.isCurrent(generation)) return;

    const objectUrl = URL.createObjectURL(asset.blob);
    const video = this.add.video(0, -1).setDisplaySize(202, 178).setAlpha(0);
    const status = this.add.text(0, -81, 'POSTER FALLBACK • TAP PLAY', {
      fontFamily: UI_FONT, fontSize: '9px', color: '#f7df9c', fontStyle: 'bold', letterSpacing: 0.6,
      backgroundColor: '#07111ecc',
      padding: { x: 5, y: 3 },
    }).setOrigin(0.5);

    let released = false;
    const onPlaying = (): void => {
      if (!this.isCurrent(generation) || released) return;
      video.setAlpha(1);
      status.setText('PLAYING • VERIFIED').setColor('#dff7ff');
    };
    const onComplete = (): void => {
      if (!this.isCurrent(generation) || released) return;
      video.setAlpha(0);
      status.setText('COMPLETE • POSTER RESTORED').setColor('#f7df9c');
    };
    const onError = (): void => {
      if (!this.isCurrent(generation) || released) return;
      video.setAlpha(0);
      status.setText('VIDEO UNAVAILABLE • POSTER SAFE').setColor('#ffaaaa');
    };
    const onLocked = (): void => {
      if (status.active) status.setText('TAP PLAY TO UNLOCK').setColor('#f7df9c');
    };
    const handle: ArchiveMediaHandle = {
      pause: () => {
        if (released) return;
        video.pause();
        if (status.active) status.setText('PAUSED • VERIFIED');
      },
      release: () => {
        if (released) return;
        released = true;
        video.off(Phaser.GameObjects.Events.VIDEO_PLAYING, onPlaying);
        video.off(Phaser.GameObjects.Events.VIDEO_COMPLETE, onComplete);
        video.off(Phaser.GameObjects.Events.VIDEO_ERROR, onError);
        video.off(Phaser.GameObjects.Events.VIDEO_LOCKED, onLocked);
        video.stop(false);
        video.removeVideoElement();
        URL.revokeObjectURL(objectUrl);
      },
    };
    video.on(Phaser.GameObjects.Events.VIDEO_PLAYING, onPlaying);
    video.on(Phaser.GameObjects.Events.VIDEO_COMPLETE, onComplete);
    video.on(Phaser.GameObjects.Events.VIDEO_ERROR, onError);
    video.on(Phaser.GameObjects.Events.VIDEO_LOCKED, onLocked);
    this.pageMediaHandles.add(handle);
    try {
      video.loadURL(objectUrl, false);
    } catch (error) {
      this.pageMediaHandles.delete(handle);
      handle.release();
      video.destroy();
      throw error;
    }

    const play = addArtButton(this, -68, 56, 'PLAY VIDEO', () => {
      if (released || !this.isCurrent(generation)) return;
      this.pausePageMedia(handle);
      if (video.video?.ended) video.setCurrentTime(0);
      status.setText('STARTING…').setColor('#dff7ff');
      video.play(false);
    }, 122, 46, 19);
    const pause = addArtButton(this, 68, 56, 'PAUSE VIDEO', () => handle.pause(), 122, 46, 19);
    card.addAt(video, 3);
    card.add([status, play, pause]);
  }

  private async populateCard(
    card: Phaser.GameObjects.Container,
    asset: LoadedProductionAsset,
    generation: number,
  ): Promise<void> {
    if (asset.kind === 'semantic-json') {
      const icon = this.add.text(0, -53, '◇  SEMANTIC MASTER  ◇', {
        fontFamily: UI_FONT, fontSize: '12px', color: '#ffe09a', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0.5);
      const subject = fitText(this.add.text(0, -19, asset.summary.subject.toUpperCase(), {
        fontFamily: DISPLAY_FONT, fontSize: '19px', color: '#96e9ff', fontStyle: 'bold', align: 'center',
      }).setOrigin(0.5), 258, 0.78);
      const facet = fitText(this.add.text(0, 12, asset.summary.facet.toUpperCase(), {
        fontFamily: UI_FONT, fontSize: '12px', color: '#e4ecf7', fontStyle: 'bold', align: 'center',
      }).setOrigin(0.5), 260, 0.8);
      const details = this.add.text(0, 41,
        `${asset.summary.masterType.toUpperCase()}\n${asset.summary.sections.map((section) => section.toUpperCase()).join('  •  ')}\n${asset.summary.authoredValues} AUTHORED VALUES`, {
          fontFamily: UI_FONT, fontSize: '10px', color: '#aebdd1', align: 'center', lineSpacing: 5,
          wordWrap: { width: 264, useAdvancedWrap: true },
        }).setOrigin(0.5, 0);
      card.add([icon, subject, facet, details]);
      return;
    }

    await this.populateVerifiedImage(card, {
      id: asset.entry.id,
      sha256: asset.entry.runtime.sha256,
      width: asset.entry.runtime.width ?? 512,
      height: asset.entry.runtime.height ?? 512,
      blob: asset.blob,
    }, generation);
  }

  private async populateVerifiedImage(
    card: Phaser.GameObjects.Container,
    asset: VerifiedArchiveImage,
    generation: number,
    displayedSha256 = asset.sha256,
    hashLabel = 'SHA',
  ): Promise<void> {
    const decoded = await decodeVerifiedImage(asset.blob);
    try {
      if (!this.isCurrent(generation)) return;
      const textureKey = `production-runtime-${asset.id}-${generation}`;
      const canvas = this.textures.createCanvas(
        textureKey,
        asset.width,
        asset.height,
      );
      if (!canvas) throw new Error(`${asset.id} could not allocate its bounded texture.`);
      canvas.context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      canvas.refresh();
      this.pageTextureKeys.add(textureKey);
      const image = this.add.image(0, -1, textureKey).setDisplaySize(202, 178);
      const frame = this.add.rectangle(0, -1, 210, 186, 0x07111e, 0.04)
        .setStrokeStyle(2, 0x78def9, 0.48);
      const hash = this.add.text(0, 80, `${hashLabel} ${displayedSha256.slice(0, 12).toUpperCase()}`, {
        fontFamily: UI_FONT, fontSize: '9px', color: '#9eb3c8', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0.5);
      card.addAt(image, 2);
      card.add([frame, hash]);
    } finally {
      decoded.close();
    }
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && this.scene.isActive() && !this.pageAbort?.signal.aborted;
  }

  private showFatal(error: unknown): void {
    this.disposePage();
    this.pageLayer = this.add.container(0, 0).setDepth(12);
    const panel = addArtPanel(this, VIEW.width / 2, 650, 600, 370, 11, 0.99);
    const title = this.add.text(VIEW.width / 2, 570, 'ARCHIVE VALIDATION FAILED', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.title, color: '#ffaaaa', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(13);
    const detail = this.add.text(VIEW.width / 2, 625, error instanceof Error ? error.message : 'Unknown archive error.', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#d9c0c6', align: 'center',
      wordWrap: { width: 500, useAdvancedWrap: true }, lineSpacing: 7,
    }).setOrigin(0.5, 0).setDepth(13);
    const policy = this.add.text(VIEW.width / 2, 735, 'No unverified image, audio, video or semantic master was displayed.', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe1a0', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(13);
    this.pageLayer.add([panel, title, detail, policy]);
  }

  private pausePageMedia(except?: ArchiveMediaHandle): void {
    for (const handle of this.pageMediaHandles) {
      if (handle !== except) handle.pause();
    }
  }

  private releasePageMedia(): void {
    for (const handle of this.pageMediaHandles) handle.release();
    this.pageMediaHandles.clear();
  }

  private disposePage(): void {
    this.generation += 1;
    this.pageAbort?.abort();
    this.pageAbort = undefined;
    this.releasePageMedia();
    this.pageLayer?.destroy(true);
    this.pageLayer = undefined;
    for (const key of this.pageTextureKeys) {
      if (this.textures.exists(key)) this.textures.remove(key);
    }
    this.pageTextureKeys.clear();
  }

  private leave(): void {
    SFX.click();
    this.disposePage();
    this.scene.start('Gallery');
  }
}
