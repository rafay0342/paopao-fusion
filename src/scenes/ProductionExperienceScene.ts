import Phaser from 'phaser';
import { VIEW } from '../config';
import {
  applyPhaserExperienceTransform,
  createPhaserExperienceFrame,
  productionExperienceCardLines,
  productionExperienceLoader,
  PRODUCTION_EXPERIENCE_CARD_HEIGHT,
  PRODUCTION_EXPERIENCE_CARD_TEXT_WIDTH,
  PRODUCTION_EXPERIENCE_CARD_WIDTH,
  type PhaserExperienceFrame,
  type ProductionExperiencePage,
} from '../game/production-experience';
import { SFX } from '../game/sfx';
import type { ProductionExperienceCategory, ProductionExperienceEntry } from '../../shared/runtime/production-experience.mjs';
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

const CATEGORY_LABELS: Record<ProductionExperienceCategory, string> = {
  'ux-element': 'ACCESSIBLE UX',
  'animated-element': 'MOTION ACTORS',
  animation: 'ANIMATION CLIPS',
};

export class ProductionExperienceScene extends Phaser.Scene {
  private category: ProductionExperienceCategory = 'ux-element';
  private release: 1 | 2 | 3 | 4 | 5 = 1;
  private page = 1;
  private selectedIndex = 0;
  private pageAbort?: AbortController;
  private pageDocument?: ProductionExperiencePage;
  private pageLayer?: Phaser.GameObjects.Container;
  private previewGraphic?: Phaser.GameObjects.Graphics;
  private previewTitle?: Phaser.GameObjects.Text;
  private previewDetail?: Phaser.GameObjects.Text;
  private previewState?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  private pageText?: Phaser.GameObjects.Text;
  private categoryButtons: Phaser.GameObjects.Container[] = [];
  private releaseButtons: Phaser.GameObjects.Container[] = [];
  private selectedAt = 0;
  private requestedAction = 'idle';
  private accessibleRoot?: HTMLElement;
  private accessibleDescription?: HTMLElement;
  private accessibleAction?: HTMLButtonElement;

  constructor() {
    super('ProductionExperience');
  }

  create(): void {
    const { width, height } = VIEW;
    this.cameras.main.fadeIn(180, 0, 0, 0);
    addWorldBackground(this, 'world_celestial', 0.4);
    addAmbientMotes(this, 0xb58aff, 18, 2);
    this.add.rectangle(0, 0, width, height, 0x02040c, 0.34).setOrigin(0).setDepth(3);

    addArtPanel(this, width / 2, 88, 660, 142, 7, 0.98);
    addArtButton(this, 76, 42, '‹  GALLERY', () => this.leave(), 132, 44, 18);
    fitText(this.add.text(width / 2, 38, '✦  EXECUTABLE PRODUCTION SYSTEMS  ✦', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe2a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12), 380, 0.72);
    fitText(this.add.text(width / 2, 78, 'EXPERIENCE LAB', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#c5a0ff', fontStyle: 'bold',
      stroke: '#29205a', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 4, '#000000', 9), 430, 0.72);
    this.statusText = this.add.text(width / 2, 116, 'OPENING LEDGER-LOCKED CATALOG…', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b8c8dd', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);
    fitText(this.statusText, 600, 0.68);

    this.categoryButtons = (Object.keys(CATEGORY_LABELS) as ProductionExperienceCategory[]).map((category, index) => addArtButton(
      this, 135 + index * 225, 166, CATEGORY_LABELS[category], () => this.selectCategory(category), 205, 44, 13,
    ));
    this.releaseButtons = Array.from({ length: 5 }, (_, index) => addArtButton(
      this, 120 + index * 120, 220, `RELEASE ${index + 1}`, () => this.selectRelease((index + 1) as 1 | 2 | 3 | 4 | 5), 108, 42, 12,
    ));

    addArtPanel(this, width / 2, 399, 660, 300, 7, 0.96);
    this.previewGraphic = this.add.graphics().setDepth(13);
    this.previewTitle = this.add.text(width / 2, 302, 'SELECTING EXPERIENCE…', {
      fontFamily: DISPLAY_FONT, fontSize: '24px', color: '#f1eaff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(14);
    this.previewDetail = this.add.text(width / 2, 468, '', {
      fontFamily: UI_FONT, fontSize: '13px', color: '#becce0', align: 'center',
      wordWrap: { width: 570, useAdvancedWrap: true },
    }).setOrigin(0.5, 0).setDepth(14);
    this.previewState = this.add.text(width / 2, 532, '', {
      fontFamily: UI_FONT, fontSize: '12px', color: '#ffe3a0', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(14);

    addArtPanel(this, width / 2, 865, 660, 590, 7, 0.94);
    this.pageText = this.add.text(width / 2, 586, 'PAGE -- / 10', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#c9d5e7', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(14);
    addArtButton(this, 88, height - 44, '‹ PAGE', () => this.changePage(-1), 126, 52, 16);
    addArtButton(this, width - 88, height - 44, 'PAGE ›', () => this.changePage(1), 126, 52, 16);
    addArtButton(this, width / 2, height - 44, 'ACTIVATE SELECTED', () => this.activateSelected(), 330, 52, 16);

    this.input.keyboard?.on('keydown-LEFT', () => this.changePage(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.changePage(1));
    this.input.keyboard?.on('keydown-UP', () => this.moveSelection(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.moveSelection(1));
    this.input.keyboard?.on('keydown-ENTER', () => this.activateSelected());
    this.input.keyboard?.on('keydown-SPACE', () => this.activateSelected());
    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.createAccessibilityMirror();
    this.updateFilters();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    sharpenSceneText(this);
    void this.loadPage();
  }

  update(time: number): void {
    const entry = this.selectedEntry();
    if (!entry || !this.previewGraphic) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const action = this.requestedAction === 'idle' && entry.specification.kind === 'ux'
      ? entry.specification.interaction.event as string
      : this.requestedAction;
    const frame = createPhaserExperienceFrame(entry, {
      timeMs: Math.max(0, time - this.selectedAt), action, reducedMotion,
    });
    this.drawPreview(frame);
  }

  private async loadPage(): Promise<void> {
    this.pageAbort?.abort();
    this.pageAbort = new AbortController();
    const request = { category: this.category, release: this.release, page: this.page };
    this.setStatus(`VERIFYING ${CATEGORY_LABELS[this.category]}  •  R${this.release}  •  PAGE ${this.page}`, '#b8c8dd');
    try {
      const document = await productionExperienceLoader.page(
        request.category, request.release, request.page, this.pageAbort.signal,
      );
      if (!this.scene.isActive() || request.category !== this.category || request.release !== this.release || request.page !== this.page) return;
      this.pageDocument = document;
      this.selectedIndex = 0;
      this.selectedAt = this.time.now;
      this.requestedAction = 'idle';
      this.setStatus('1,500 VERIFIED SYSTEMS  •  ONLY THIS 10-ENTRY PAGE IS RESIDENT', '#9fe8b0');
      this.renderPage();
    } catch (error) {
      if (!this.scene.isActive() || (error instanceof DOMException && error.name === 'AbortError')) return;
      this.pageDocument = undefined;
      this.setStatus('CATALOG LOCKED  •  PAGE INTEGRITY FAILED', '#ff9b9b');
      this.pageLayer?.destroy(true);
      this.pageLayer = this.add.container(0, 0).setDepth(14);
      this.pageLayer.add(this.add.text(VIEW.width / 2, 820, error instanceof Error ? error.message : 'Catalog validation failed.', {
        fontFamily: UI_FONT, fontSize: '15px', color: '#ffb5b5', align: 'center',
        wordWrap: { width: 560, useAdvancedWrap: true },
      }).setOrigin(0.5));
    }
  }

  private setStatus(message: string, color: string): void {
    if (!this.statusText) return;
    fitText(this.statusText.setText(message).setColor(color), 600, 0.68);
  }

  private renderPage(): void {
    const document = this.pageDocument;
    if (!document) return;
    this.pageLayer?.destroy(true);
    this.pageLayer = this.add.container(0, 0).setDepth(14);
    if (this.pageText) {
      fitText(this.pageText.setText(`${CATEGORY_LABELS[this.category]}  •  R${this.release}  •  PAGE ${this.page} / 10`), 600, 0.7);
    }
    document.entries.forEach((entry, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 202 + column * 316;
      const y = 644 + row * 104;
      const button = addArtButton(this, x, y, '', () => {
        SFX.click();
        this.selectEntry(index);
      }, PRODUCTION_EXPERIENCE_CARD_WIDTH, PRODUCTION_EXPERIENCE_CARD_HEIGHT, 12);
      const cardLines = productionExperienceCardLines(entry).map((line) => fitText(this.add.text(0, line.y, line.text, {
        fontFamily: UI_FONT,
        fontSize: `${line.fontSize}px`,
        color: line.color,
        fontStyle: line.fontStyle,
        align: 'center',
        stroke: '#020611',
        strokeThickness: 1,
        letterSpacing: 0.3,
      }).setOrigin(0.5), PRODUCTION_EXPERIENCE_CARD_TEXT_WIDTH, line.minScale));
      button.add(cardLines);
      button.setDepth(15);
      this.pageLayer?.add(button);
    });
    this.updateSelectionVisuals();
    this.showSelectedEntry();
    sharpenSceneText(this);
  }

  private selectEntry(index: number): void {
    if (!this.pageDocument || index < 0 || index >= this.pageDocument.entries.length) return;
    this.selectedIndex = index;
    this.selectedAt = this.time.now;
    this.requestedAction = 'idle';
    this.updateSelectionVisuals();
    this.showSelectedEntry();
  }

  private moveSelection(delta: number): void {
    if (!this.pageDocument) return;
    this.selectEntry(Phaser.Math.Wrap(this.selectedIndex + delta, 0, this.pageDocument.entries.length));
  }

  private updateSelectionVisuals(): void {
    this.pageLayer?.each((child: Phaser.GameObjects.Container, index: number) => {
      child.setAlpha(index === this.selectedIndex ? 1 : 0.62).setScale(index === this.selectedIndex ? 1.025 : 1);
    });
  }

  private showSelectedEntry(): void {
    const entry = this.selectedEntry();
    if (!entry) return;
    this.previewTitle?.setText(entry.title.toUpperCase()).setColor(entry.category === 'ux-element' ? '#9fe8ff' : entry.category === 'animated-element' ? '#c7a6ff' : '#ffd38e');
    fitText(this.previewTitle!, 570, 0.7);
    const semantics = entry.specification.kind === 'ux'
      ? `${entry.specification.component.role.toUpperCase()}  •  ${entry.specification.interaction.event.toUpperCase()}  •  ${entry.specification.component.liveRegion.toUpperCase()} LIVE REGION`
      : entry.specification.kind === 'motion'
        ? `${entry.specification.timeline.durationMs} MS  •  ${entry.specification.timeline.ease}  •  ${entry.specification.reducedMotion.substitute.toUpperCase()}`
        : `${entry.specification.clip.durationMs} MS CLIP  •  ${entry.specification.clip.keyframes.length} KEYFRAMES  •  ${entry.specification.reducedMotion.substitute.toUpperCase()}`;
    this.previewDetail?.setText(`${entry.id}  •  ${entry.acceptanceId}\n${semantics}\n${entry.behaviorFingerprint}`);
    this.updateAccessibilityMirror(entry);
  }

  private activateSelected(): void {
    const entry = this.selectedEntry();
    if (!entry) return;
    SFX.click();
    this.requestedAction = entry.specification.kind === 'ux' ? entry.specification.interaction.event as string : 'reset';
    this.selectedAt = this.time.now;
    this.time.delayedCall(180, () => {
      if (!this.scene.isActive()) return;
      this.requestedAction = entry.specification.kind === 'ux' ? entry.specification.interaction.event as string : 'idle';
      this.selectedAt = this.time.now;
    });
  }

  private drawPreview(frame: PhaserExperienceFrame): void {
    const graphic = this.previewGraphic;
    if (!graphic) return;
    graphic.clear();
    graphic.fillStyle(frame.geometry.color, 0.25);
    graphic.lineStyle(3, frame.geometry.color, 0.95);
    const width = Math.min(250, frame.geometry.width);
    const height = Math.min(112, frame.geometry.height);
    if (frame.geometry.primitive === 'circle') {
      graphic.fillCircle(0, 0, height / 2);
      graphic.strokeCircle(0, 0, height / 2);
    } else if (frame.geometry.primitive === 'diamond') {
      const points = [{ x: 0, y: -height / 2 }, { x: width / 2, y: 0 }, { x: 0, y: height / 2 }, { x: -width / 2, y: 0 }];
      graphic.fillPoints(points, true);
      graphic.strokePoints(points, true);
    } else if (frame.geometry.primitive === 'hex') {
      const points = Array.from({ length: 6 }, (_, index) => {
        const angle = Math.PI / 3 * index;
        return { x: Math.cos(angle) * height / 2, y: Math.sin(angle) * height / 2 };
      });
      graphic.fillPoints(points, true);
      graphic.strokePoints(points, true);
    } else {
      graphic.fillRoundedRect(-width / 2, -height / 2, width, height, Math.min(frame.geometry.radius, height / 2));
      graphic.strokeRoundedRect(-width / 2, -height / 2, width, height, Math.min(frame.geometry.radius, height / 2));
      if (frame.geometry.primitive === 'meter') {
        graphic.fillStyle(frame.geometry.color, 0.75);
        graphic.fillRoundedRect(-width / 2 + 4, height / 2 - 10, (width - 8) * frame.progress, 6, 3);
      }
    }
    applyPhaserExperienceTransform(graphic, frame, VIEW.width / 2, 398);
    if (this.previewState) {
      fitText(this.previewState.setText(`${frame.state.toUpperCase()}  •  ${frame.feedback.visual.toUpperCase()}  •  PROGRESS ${Math.round(frame.progress * 100)}%`), 570, 0.65);
    }
  }

  private selectCategory(category: ProductionExperienceCategory): void {
    if (category === this.category) return;
    SFX.click();
    this.category = category;
    this.page = 1;
    this.updateFilters();
    void this.loadPage();
  }

  private selectRelease(release: 1 | 2 | 3 | 4 | 5): void {
    if (release === this.release) return;
    SFX.click();
    this.release = release;
    this.page = 1;
    this.updateFilters();
    void this.loadPage();
  }

  private changePage(delta: number): void {
    const page = Phaser.Math.Clamp(this.page + delta, 1, 10);
    if (page === this.page) return;
    SFX.click();
    this.page = page;
    void this.loadPage();
  }

  private updateFilters(): void {
    this.categoryButtons.forEach((button, index) => {
      const active = (Object.keys(CATEGORY_LABELS) as ProductionExperienceCategory[])[index] === this.category;
      button.setAlpha(active ? 1 : 0.55).setScale(active ? 1.025 : 1);
    });
    this.releaseButtons.forEach((button, index) => {
      const active = index + 1 === this.release;
      button.setAlpha(active ? 1 : 0.55).setScale(active ? 1.025 : 1);
    });
  }

  private selectedEntry(): ProductionExperienceEntry | undefined {
    return this.pageDocument?.entries[this.selectedIndex];
  }

  private createAccessibilityMirror(): void {
    const parent = this.game.canvas.parentElement;
    if (!parent) return;
    const root = document.createElement('section');
    root.id = 'paopao-production-experience-a11y';
    root.setAttribute('aria-label', 'PaoPao production experience catalog');
    Object.assign(root.style, {
      position: 'absolute', width: '1px', height: '1px', padding: '0', margin: '-1px',
      overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: '0',
    });
    const heading = document.createElement('h2');
    heading.textContent = 'Production Experience Lab';
    const description = document.createElement('p');
    description.id = 'paopao-production-experience-description';
    description.setAttribute('aria-live', 'polite');
    const action = document.createElement('button');
    action.type = 'button';
    action.addEventListener('click', () => this.activateSelected());
    root.append(heading, description, action);
    parent.append(root);
    this.game.canvas.setAttribute('aria-describedby', description.id);
    this.accessibleRoot = root;
    this.accessibleDescription = description;
    this.accessibleAction = action;
  }

  private updateAccessibilityMirror(entry: ProductionExperienceEntry): void {
    const frame = createPhaserExperienceFrame(entry, { timeMs: 0 });
    if (this.accessibleDescription) {
      this.accessibleDescription.setAttribute('aria-live', frame.accessibility.liveRegion);
      this.accessibleDescription.textContent = `${frame.label}. ${frame.description}. ${entry.acceptanceId}.`;
    }
    if (this.accessibleAction) {
      this.accessibleAction.textContent = `Activate ${frame.label}`;
      this.accessibleAction.setAttribute('aria-label', `Activate preview: ${frame.label}`);
    }
  }

  private leave(): void {
    SFX.click();
    this.scene.start('Gallery');
  }

  private dispose(): void {
    this.pageAbort?.abort();
    this.pageAbort = undefined;
    this.pageLayer?.destroy(true);
    this.pageLayer = undefined;
    this.accessibleRoot?.remove();
    this.accessibleRoot = undefined;
    this.accessibleDescription = undefined;
    this.accessibleAction = undefined;
    this.game.canvas.removeAttribute('aria-describedby');
    productionExperienceLoader.clear();
  }
}
