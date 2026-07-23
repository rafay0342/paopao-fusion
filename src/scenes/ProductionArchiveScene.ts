import Phaser from 'phaser';
import { VIEW } from '../config';
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

interface DecodedImage {
  source: CanvasImageSource;
  close: () => void;
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

  private filteredEntries(): ProductionRuntimeEntry[] {
    if (!this.manifest) return [];
    return this.releaseFilter === 0
      ? this.manifest.entries
      : this.manifest.entries.filter(({ release }) => release === this.releaseFilter);
  }

  private selectRelease(release: ReleaseFilter): void {
    if (!this.manifest || this.releaseFilter === release) return;
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
    if (!entries.length) return;
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

  private renderPendingCard(entry: ProductionRuntimeEntry, index: number, generation: number): void {
    const position = CARD_POSITIONS[index];
    const card = this.add.container(position.x, position.y);
    const panel = addArtPanel(this, 0, 0, 306, 254, 0, 0.97);
    const releaseColor = RELEASE_ACCENTS[entry.release];
    const id = this.add.text(-132, -105, `${entry.id}  •  R${entry.release}`, {
      fontFamily: UI_FONT, fontSize: '12px', color: releaseColor, fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0, 0.5);
    const title = fitText(this.add.text(0, 101, entry.title.toUpperCase(), {
      fontFamily: UI_FONT, fontSize: '13px', color: '#eef6ff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5), 262, 0.78);
    const loading = this.add.text(0, -2, 'VERIFYING SHA-256…', {
      fontFamily: UI_FONT, fontSize: '12px', color: '#9daec4', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5);
    card.add([panel, id, title, loading]);
    this.pageLayer?.add(card);
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

    const decoded = await decodeVerifiedImage(asset.blob);
    try {
      if (!this.isCurrent(generation)) return;
      const textureKey = `production-runtime-${asset.entry.id}-${generation}`;
      const canvas = this.textures.createCanvas(
        textureKey,
        asset.entry.runtime.width ?? 512,
        asset.entry.runtime.height ?? 512,
      );
      if (!canvas) throw new Error(`${asset.entry.id} could not allocate its bounded texture.`);
      canvas.context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      canvas.refresh();
      this.pageTextureKeys.add(textureKey);
      const image = this.add.image(0, -1, textureKey).setDisplaySize(202, 178);
      const frame = this.add.rectangle(0, -1, 210, 186, 0x07111e, 0.04)
        .setStrokeStyle(2, 0x78def9, 0.48);
      const hash = this.add.text(0, 80, `SHA ${asset.entry.runtime.sha256.slice(0, 12).toUpperCase()}`, {
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
    const policy = this.add.text(VIEW.width / 2, 735, 'No unverified image or semantic master was displayed.', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe1a0', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(13);
    this.pageLayer.add([panel, title, detail, policy]);
  }

  private disposePage(): void {
    this.generation += 1;
    this.pageAbort?.abort();
    this.pageAbort = undefined;
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
