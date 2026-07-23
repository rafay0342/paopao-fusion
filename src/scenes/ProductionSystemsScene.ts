import Phaser from 'phaser';
import { VIEW } from '../config';
import {
  PRODUCTION_SYSTEM_CATEGORIES,
  ProductionSystemRuntime,
  productionSystemsFor,
  type ProductionSystemCategory,
  type ProductionSystemPresentation,
} from '../game/production-systems';
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

const PAGE_SIZE = 5;
const CATEGORY_NAMES: Record<ProductionSystemCategory, string> = {
  upgrade: 'PLATFORM UPGRADES',
  improvement: 'VERIFIED IMPROVEMENTS',
  ui: 'UI SYSTEMS',
  frontend: 'FRONTEND CAPABILITIES',
  flow: 'FUNCTIONAL FLOWS',
  rendering: 'RENDERING SYSTEMS',
  control: 'GAMEPLAY CONTROLS',
};

export class ProductionSystemsScene extends Phaser.Scene {
  private categoryIndex = 0;
  private release = 0;
  private page = 0;
  private runtime = new ProductionSystemRuntime(18);
  private listLayer?: Phaser.GameObjects.Container;
  private titleText?: Phaser.GameObjects.Text;
  private pageText?: Phaser.GameObjects.Text;
  private releaseText?: Phaser.GameObjects.Text;
  private detailTitle?: Phaser.GameObjects.Text;
  private detailStatus?: Phaser.GameObjects.Text;
  private detailBody?: Phaser.GameObjects.Text;
  private transitionText?: Phaser.GameObjects.Text;
  private preview?: Phaser.GameObjects.Graphics;
  private previewTween?: Phaser.Tweens.Tween;
  private accessibleRoot?: HTMLElement;

  constructor() {
    super('ProductionSystems');
  }

  create(): void {
    addWorldBackground(this, 'world_nexus', 0.3);
    addAmbientMotes(this, 0x6fe8ff, 16, 2);
    this.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x02050c, 0.35).setOrigin(0).setDepth(3);
    this.cameras.main.fadeIn(180, 0, 0, 0);

    addArtPanel(this, VIEW.width / 2, 92, 660, 150, 8, 0.98);
    addArtButton(this, 77, 42, '‹  GALLERY', () => this.leave(), 134, 44, 18);
    this.add.text(VIEW.width / 2, 40, '✦  850 EXECUTABLE CLIENT SYSTEMS  ✦', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe5a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(13);
    this.add.text(VIEW.width / 2, 82, 'SYSTEMS LAB', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#8feaff', fontStyle: 'bold',
      stroke: '#172756', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(13).setShadow(0, 4, '#000000', 8);
    this.titleText = this.add.text(VIEW.width / 2, 126, '', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#c8d9ea', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(13);

    addArtButton(this, 82, 184, '‹ TYPE', () => this.changeCategory(-1), 142, 50, 15);
    addArtButton(this, VIEW.width - 82, 184, 'TYPE ›', () => this.changeCategory(1), 142, 50, 15);
    addArtButton(this, VIEW.width / 2, 184, 'RELEASE FILTER', () => this.changeRelease(), 300, 50, 15);
    this.releaseText = this.add.text(VIEW.width / 2, 224, '', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe3a0', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(13);

    addArtPanel(this, VIEW.width / 2, 438, 660, 370, 8, 0.96);
    this.preview = this.add.graphics().setDepth(14);
    this.detailTitle = this.add.text(VIEW.width / 2, 302, 'SELECT A SYSTEM', {
      fontFamily: DISPLAY_FONT, fontSize: '25px', color: '#ffffff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(15);
    this.detailStatus = this.add.text(VIEW.width / 2, 342, '', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#9fe8b0', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(15);
    this.detailBody = this.add.text(230, 374, '', {
      fontFamily: UI_FONT, fontSize: '13px', color: '#c9d7e8', lineSpacing: 5,
      wordWrap: { width: 430, useAdvancedWrap: true },
    }).setDepth(15);
    this.transitionText = this.add.text(VIEW.width / 2, 565, '', {
      fontFamily: UI_FONT, fontSize: '12px', color: '#ffe2a0', fontStyle: 'bold', align: 'center',
      wordWrap: { width: 590, useAdvancedWrap: true },
    }).setOrigin(0.5).setDepth(15);

    addArtPanel(this, VIEW.width / 2, 896, 660, 515, 8, 0.94);
    this.pageText = this.add.text(VIEW.width / 2, 662, '', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b9c9dd', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(14);
    addArtButton(this, 98, VIEW.height - 45, '‹ PAGE', () => this.changePage(-1), 148, 52, 17);
    addArtButton(this, VIEW.width - 98, VIEW.height - 45, 'PAGE ›', () => this.changePage(1), 148, 52, 17);
    addArtButton(this, VIEW.width / 2, VIEW.height - 45, 'REPLAY CONTRACT', () => this.replaySelected(), 300, 52, 17);

    this.input.keyboard?.on('keydown-LEFT', () => this.changePage(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.changePage(1));
    this.input.keyboard?.on('keydown-Q', () => this.changeCategory(-1));
    this.input.keyboard?.on('keydown-E', () => this.changeCategory(1));
    this.input.keyboard?.on('keydown-R', () => this.replaySelected());
    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.createAccessibleMirror();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    this.renderPage();
    sharpenSceneText(this);
  }

  private currentCategory(): ProductionSystemCategory {
    return PRODUCTION_SYSTEM_CATEGORIES[this.categoryIndex];
  }

  private filteredEntries() {
    return productionSystemsFor(this.currentCategory(), this.release || undefined);
  }

  private changeCategory(direction: number): void {
    SFX.click();
    this.categoryIndex = Phaser.Math.Wrap(this.categoryIndex + direction, 0, PRODUCTION_SYSTEM_CATEGORIES.length);
    this.page = 0;
    this.renderPage();
  }

  private changeRelease(): void {
    SFX.click();
    this.release = (this.release + 1) % 6;
    this.page = 0;
    this.renderPage();
  }

  private changePage(direction: number): void {
    const entries = this.filteredEntries();
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    SFX.click();
    this.page = Phaser.Math.Wrap(this.page + direction, 0, pages);
    this.renderPage();
  }

  private renderPage(): void {
    this.listLayer?.destroy(true);
    this.listLayer = this.add.container(0, 0).setDepth(15);
    const category = this.currentCategory();
    const entries = this.filteredEntries();
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    this.page = Math.min(this.page, pages - 1);
    const visible = entries.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    this.titleText?.setText(`${CATEGORY_NAMES[category]}  •  ${entries.length} CONTRACTS`);
    this.releaseText?.setText(this.release === 0 ? 'ALL FIVE RELEASES' : `RELEASE ${this.release} ONLY`);
    this.pageText?.setText(`PAGE ${this.page + 1} / ${pages}  •  ${PAGE_SIZE} MAX RESIDENT`);

    visible.forEach((entry, index) => {
      const y = 724 + index * 86;
      const button = addArtButton(this, VIEW.width / 2, y, `${entry.id}  •  ${entry.subject.toUpperCase()}\n${entry.facet.toUpperCase()}`, () => {
        SFX.click();
        this.showSystem(entry.id, false);
      }, 600, 72, 16);
      this.listLayer?.add(button);
    });
    if (visible[0]) this.showSystem(visible[0].id, false);
  }

  private replaySelected(): void {
    const id = this.accessibleRoot?.dataset.selectedId;
    if (!id) return;
    SFX.click();
    this.showSystem(id, true);
  }

  private showSystem(id: string, repeated: boolean): void {
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const result = this.runtime.exercise(id, { repeated, reducedMotion });
    const presentation = result.presentation;
    this.drawPreview(presentation);
    fitText(this.detailTitle?.setText(presentation.title) as Phaser.GameObjects.Text, 570);
    this.detailStatus?.setText(`${presentation.categoryLabel}  •  ${presentation.releaseLabel}  •  ${presentation.statusLabel}`)
      .setColor(presentation.accentCss);
    this.detailBody?.setText(presentation.detailLines.join('\n'));
    this.transitionText?.setText(`${presentation.transitionLabels.join('  →  ')}\n${presentation.feedbackPurpose}`);
    if (this.accessibleRoot) {
      this.accessibleRoot.dataset.selectedId = id;
      this.accessibleRoot.textContent = `${presentation.title}. ${presentation.statusLabel}. ${presentation.detailLines.join('. ')}. ${presentation.feedbackPurpose}`;
    }
  }

  private drawPreview(presentation: ProductionSystemPresentation): void {
    this.previewTween?.stop();
    this.preview?.clear();
    const x = 125;
    const y = 444;
    this.preview?.fillStyle(presentation.accentNumber, 0.14).fillCircle(x, y, 72);
    this.preview?.lineStyle(3, presentation.accentNumber, 0.85).strokeCircle(x, y, 56);
    this.preview?.lineStyle(1, 0xffffff, 0.42).strokeCircle(x, y, 38);
    this.preview?.fillStyle(presentation.accentNumber, 0.94).fillCircle(x, y, 13);
    if (!presentation.reducedMotion && presentation.durationMs > 0 && this.preview) {
      this.preview.setScale(0.94).setAlpha(0.72);
      this.previewTween = this.tweens.add({
        targets: this.preview,
        scale: 1.05,
        alpha: 1,
        duration: presentation.durationMs,
        yoyo: true,
        repeat: 1,
        ease: 'Sine.easeInOut',
        onComplete: () => this.preview?.setScale(1).setAlpha(1),
      });
    } else this.preview?.setScale(1).setAlpha(1);
  }

  private createAccessibleMirror(): void {
    if (typeof document === 'undefined') return;
    const region = document.createElement('section');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-label', 'PaoPao production systems catalog');
    region.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    document.body.append(region);
    this.accessibleRoot = region;
  }

  private leave(): void {
    SFX.click();
    this.scene.start('Gallery');
  }

  private dispose(): void {
    this.previewTween?.stop();
    this.previewTween = undefined;
    this.runtime.clear();
    this.accessibleRoot?.remove();
    this.accessibleRoot = undefined;
  }
}

