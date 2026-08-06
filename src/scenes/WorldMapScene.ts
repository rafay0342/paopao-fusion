import Phaser from 'phaser';
import {
  LEVELS,
  campaignStageNumber,
  mapNodeForLevel,
  mapRewardLabel,
  VIEW,
  WORLD_THEMES,
  type MapNodeKind,
} from '../config';
import { getProgress, isLevelCleared, isLevelUnlocked, totalStars } from '../game/progression';
import { hasPlatformAccountBinding } from '../game/platform';
import { startMusic } from '../game/music';
import { SFX } from '../game/sfx';
import { getArtifact, getMeta, getQualityProfile, MODE_DEFS } from '../game/meta';
import { PHASER_RELEASE_FEATURES } from '../game/release-profile';
import { queueArtBundle } from '../game/art-v14';
import { resolveWorldPresentation } from '../game/world-presentation';
import { accessibilityRuntimeForCanvas } from '../gfx/accessibility';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addUiScrim,
  applyLiveSceneQuality,
  addWorldBackground,
  clampFloatingCenterX,
  DISPLAY_FONT,
  fitText,
  prefersReducedMotion,
  setArtButtonHitArea,
  sharpenSceneText,
  TYPE,
  UI_COLORS,
  UI_FONT,
  updateArtButtonAccessibility,
  wrapText,
} from '../gfx/ui';
import { UI_V16, UI_V16_FRAME } from '../gfx/ui-art-v16';

interface RoutePosition {
  x: number;
  y: number;
  side: -1 | 1;
}

const NODE_KIND_LABEL: Readonly<Record<MapNodeKind, string>> = {
  standard: 'STANDARD',
  mystery: 'MYSTERY',
  challenge: 'CHALLENGE',
  elite: 'ELITE',
  boss: 'BOSS',
};

function nodeKindColor(kind: MapNodeKind, realmAccent: number): number {
  if (kind === 'mystery') return 0x86eaff;
  if (kind === 'challenge') return 0xe8e2ff;
  if (kind === 'elite') return 0xffd27a;
  if (kind === 'boss') return 0xff9abb;
  return realmAccent;
}

function polygonPoints(sides: number, radius: number, rotation = -Math.PI / 2): Phaser.Types.Math.Vector2Like[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + index * Math.PI * 2 / sides;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function addNodeKindFrame(
  scene: Phaser.Scene,
  kind: MapNodeKind,
  color: number,
  unlocked: boolean,
): Phaser.GameObjects.Graphics {
  const frame = scene.add.graphics();
  const alpha = unlocked ? 0.82 : 0.28;
  const fillAlpha = unlocked ? 0.085 : 0.035;
  frame.fillStyle(color, fillAlpha);
  frame.lineStyle(kind === 'boss' ? 5 : 3, color, alpha);

  if (kind === 'standard') {
    frame.fillCircle(0, 0, 72);
    frame.strokeCircle(0, 0, 72);
  } else if (kind === 'mystery') {
    const diamond = polygonPoints(4, 82);
    frame.fillPoints(diamond, true);
    frame.strokePoints(diamond, true);
    frame.lineStyle(2, UI_COLORS.cyan, unlocked ? 0.62 : 0.2);
    frame.strokeCircle(0, 0, 67);
  } else if (kind === 'challenge') {
    const octagon = polygonPoints(8, 76, -Math.PI / 8);
    frame.fillPoints(octagon, true);
    frame.strokePoints(octagon, true);
    frame.lineStyle(2, color, unlocked ? 0.62 : 0.2);
    frame.lineBetween(-82, 0, -64, 0);
    frame.lineBetween(64, 0, 82, 0);
    frame.lineBetween(0, -82, 0, -64);
    frame.lineBetween(0, 64, 0, 82);
  } else if (kind === 'elite') {
    const outer = polygonPoints(6, 79);
    const inner = polygonPoints(6, 70);
    frame.fillPoints(outer, true);
    frame.strokePoints(outer, true);
    frame.lineStyle(2, UI_COLORS.gold, unlocked ? 0.68 : 0.2);
    frame.strokePoints(inner, true);
  } else {
    const crown = polygonPoints(6, 80);
    frame.fillPoints(crown, true);
    frame.strokePoints(crown, true);
    frame.fillStyle(UI_COLORS.gold, unlocked ? 0.66 : 0.18);
    frame.fillTriangle(-30, -66, -14, -91, 0, -65);
    frame.fillTriangle(-4, -68, 12, -96, 27, -65);
  }
  return frame;
}

function drawDashedSegment(
  graphics: Phaser.GameObjects.Graphics,
  start: RoutePosition,
  end: RoutePosition,
  color: number,
  alpha: number,
): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const dash = 18;
  const gap = 11;
  for (let offset = 0; offset < distance; offset += dash + gap) {
    const from = offset / distance;
    const to = Math.min(distance, offset + dash) / distance;
    graphics.lineStyle(4, color, alpha);
    graphics.lineBetween(
      start.x + dx * from,
      start.y + dy * from,
      start.x + dx * to,
      start.y + dy * to,
    );
  }
}

export class WorldMapScene extends Phaser.Scene {
  private world = 0;
  private act: 'crown' | 'echoes' = 'crown';
  private readonly handleQualityChange = (): void => {
    applyLiveSceneQuality(this, getQualityProfile());
  };

  constructor() {
    super('WorldMap');
  }

  init(data: { world?: number; act?: 'crown' | 'echoes' }): void {
    this.world = PHASER_RELEASE_FEATURES.completeGameplay
      ? Phaser.Math.Clamp(data.world ?? this.world, 0, WORLD_THEMES.length - 1)
      : 0;
    const echoesUnlocked = isLevelCleared(17, getProgress());
    this.act = data.act === 'echoes' && echoesUnlocked ? 'echoes' : 'crown';
  }

  preload(): void {
    const theme = WORLD_THEMES[this.world] ?? WORLD_THEMES[0];
    queueArtBundle(this, `realm-${theme.id}`);
  }

  create(): void {
    const { width, height } = VIEW;
    startMusic('story');
    const theme = WORLD_THEMES[this.world];
    const progress = getProgress();
    const echoesUnlocked = isLevelCleared(17, progress);
    const activeLevels = this.act === 'echoes' ? theme.echoLevels : theme.levels;
    const accountBound = hasPlatformAccountBinding();
    const meta = getMeta();
    const mode = MODE_DEFS[meta.mode];
    const artifact = getArtifact(meta.equippedArtifact);
    const reducedMotion = prefersReducedMotion();
    const presentation = resolveWorldPresentation({
      worldId: theme.id,
      worldIndex: this.world,
      finalLevel: activeLevels[activeLevels.length - 1],
      clearedLevels: progress.cleared,
      mode: 'bubble-shooter',
      backgroundKey: theme.background,
    });
    const a11y = accessibilityRuntimeForCanvas(this.game.canvas).mountScene({
      id: `world-map-${this.world + 1}`,
      heading: `${theme.name} ${this.act === 'echoes' ? 'Ascended Path' : 'adventure map'}`,
      description: `${theme.subtitle}. ${presentation.label}. ${presentation.guidance}. Choose an unlocked stage, switch path or realm, open the Chronicle, or return to the menu.`,
      status: `${presentation.label}. ${progress.unlocked} of ${LEVELS.length} stages unlocked. ${totalStars(progress)} stars earned.`,
      lifecycle: this.events,
    });
    window.addEventListener('paopao:quality-adapted', this.handleQualityChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('paopao:quality-adapted', this.handleQualityChange);
    });
    this.cameras.main.fadeIn(reducedMotion ? 0 : 180, 0, 0, 0);
    addWorldBackground(this, theme.background, 0.23, presentation);
    addAmbientMotes(this, theme.accent, theme.id === 'ember' ? 24 : 18, 2);
    addUiScrim(this, 0.4, 3);

    addArtPanel(this, width / 2, 119, 620, 188, 8, 0.96);
    this.add.text(width / 2, 76, 'ADVENTURE MAP', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe6a6', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 2, '#000000', 6);
    this.add.text(width / 2, 119, theme.name, {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: theme.accentCss, fontStyle: 'bold',
      stroke: '#101225', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 10);
    const detailsButton = this.add.container(104, 171).setDepth(16);
    const detailsSurface = this.add.graphics();
    const detailsLabel = this.add.text(0, 0, 'DETAILS  +', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#f4f1ff',
      fontStyle: 'bold',
      letterSpacing: 0.5,
    }).setOrigin(0.5);
    detailsButton.add([detailsSurface, detailsLabel]);
    detailsButton.setSize(154, 100).setInteractive({ useHandCursor: true });
    const detailsSummary = this.add.text(194, 171, '', {
      fontFamily: UI_FONT,
      fontSize: TYPE.caption,
      color: '#f4f7ff',
      fontStyle: 'bold',
      letterSpacing: 0.25,
      stroke: '#050814',
      strokeThickness: 2,
    }).setOrigin(0, 0.5).setDepth(13);
    let detailsExpanded = false;
    const drawDetailsToggle = (focused = false): void => {
      detailsSurface.clear();
      detailsSurface.fillStyle(focused ? 0x4d3877 : 0x171029, 0.94);
      detailsSurface.fillRoundedRect(-72, -25, 144, 50, 15);
      detailsSurface.lineStyle(2, focused ? UI_COLORS.gold : theme.accent, focused ? 0.9 : 0.66);
      detailsSurface.strokeRoundedRect(-72, -25, 144, 50, 15);
    };
    const collapsedSummary = presentation.guidance;
    const expandedSummary = `${theme.subtitle}  ·  ${mode.name}  ·  OPEN ${progress.unlocked}/${LEVELS.length}  ·  STARS ${totalStars(progress)}/${LEVELS.length * 3}\n${artifact.name}  ·  ${meta.coins.toLocaleString()} COINS  ·  ${meta.mysteryKeys} ${meta.mysteryKeys === 1 ? 'KEY' : 'KEYS'}${accountBound ? '  ·  REWARDS VERIFIED' : ''}`;
    const renderDetails = (): void => {
      detailsLabel.setText(detailsExpanded ? 'DETAILS  −' : 'DETAILS  +');
      detailsSummary.setText(detailsExpanded ? expandedSummary : collapsedSummary);
      wrapText(detailsSummary, 458, 2);
    };
    const toggleDetails = (): void => {
      detailsExpanded = !detailsExpanded;
      SFX.click();
      renderDetails();
      detailsRegistration.update({
        label: detailsExpanded ? 'Hide map details' : 'Show map details',
        pressed: detailsExpanded,
      });
    };
    drawDetailsToggle();
    renderDetails();
    detailsButton.on('pointerover', () => drawDetailsToggle(true));
    detailsButton.on('pointerout', () => drawDetailsToggle(false));
    detailsButton.on('pointerup', toggleDetails);
    const detailsRegistration = a11y.registerButton({
      id: `world-${this.world + 1}-details`,
      label: 'Show map details',
      description: 'Shows equipped artifact, coins and keys.',
      pressed: false,
      onActivate: toggleDetails,
      onFocusChange: drawDetailsToggle,
    });
    detailsButton.once(Phaser.GameObjects.Events.DESTROY, () => detailsRegistration.unregister());

    setArtButtonHitArea(addArtButton(this, 92, 54, '‹  MENU', () => {
      SFX.click();
      const duration = prefersReducedMotion() ? 0 : 160;
      this.cameras.main.fadeOut(duration, 0, 0, 0);
      this.time.delayedCall(duration > 0 ? 170 : 0, () => this.scene.start('Menu'));
    }, 150, 52, 16), 160, 100);
    if (PHASER_RELEASE_FEATURES.completeGameplay) {
      setArtButtonHitArea(addArtButton(this, width - 92, 54, 'CHRONICLE', () => {
        SFX.click();
        this.scene.start('Chronicle', { returnScene: 'WorldMap', world: this.world, page: 0 });
      }, 156, 52, 16), 166, 100);
    }

    const switchAct = (act: 'crown' | 'echoes'): void => {
      if (act === 'echoes' && !echoesUnlocked) {
        this.showLockedMessage(31, 'RESTORE THE CROWN FIRST');
        a11y.announce('Ascended Path is locked. Restore the Crown first.');
        return;
      }
      if (act === this.act) return;
      SFX.click();
      this.scene.restart({ world: this.world, act });
    };
    addArtButton(this, width / 2 - 112, 251, 'CROWN PATH', () => switchAct('crown'), 196, 54, 16);
    addArtButton(this, width / 2 + 112, 251, echoesUnlocked ? 'ASCENDED PATH' : 'ASCENDED  🔒', () => switchAct('echoes'), 196, 54, 16);

    const previous = (this.world + WORLD_THEMES.length - 1) % WORLD_THEMES.length;
    const next = (this.world + 1) % WORLD_THEMES.length;
    if (PHASER_RELEASE_FEATURES.completeGameplay) {
      const previousButton = setArtButtonHitArea(
        addArtButton(this, 84, 326, '‹', () => this.switchWorld(previous), 100, 100, 16),
        112,
        104,
      );
      updateArtButtonAccessibility(previousButton, {
        label: `Previous realm: ${WORLD_THEMES[previous].name}`,
      });
      const nextButton = setArtButtonHitArea(
        addArtButton(this, width - 84, 326, '›', () => this.switchWorld(next), 100, 100, 16),
        112,
        104,
      );
      updateArtButtonAccessibility(nextButton, {
        label: `Next realm: ${WORLD_THEMES[next].name}`,
      });
    }
    const realmStages = activeLevels.map(campaignStageNumber);
    const routeHeading = this.act === 'echoes' ? 'ASCENDED' : 'WORLD';
    fitText(this.add.text(
      width / 2,
      326,
      `${routeHeading} ${this.world + 1}/${WORLD_THEMES.length}  ·  STAGES ${realmStages[0]}–${realmStages[realmStages.length - 1]}`,
      {
        fontFamily: UI_FONT,
        fontSize: TYPE.section,
        color: '#f4f7ff',
        fontStyle: 'bold',
        letterSpacing: 0.75,
        stroke: '#050814',
        strokeThickness: 2,
      },
    ).setOrigin(0.5).setDepth(12), 430, 0.9);

    const crownPositions: readonly RoutePosition[] = [
      { x: 220, y: 468, side: 1 },
      { x: 500, y: 638, side: -1 },
      { x: 224, y: 808, side: 1 },
      { x: 496, y: 978, side: -1 },
      { x: 232, y: 1_138, side: 1 },
    ];
    const echoPositions: readonly RoutePosition[] = [
      { x: 224, y: 600, side: 1 },
      { x: 496, y: 930, side: -1 },
    ];
    const positions = this.act === 'echoes' ? echoPositions : crownPositions;
    const currentLevel = activeLevels.find(
      (level) => isLevelUnlocked(level, progress) && !isLevelCleared(level, progress),
    ) ?? [...activeLevels].reverse().find((level) => isLevelUnlocked(level, progress))
      ?? activeLevels[0];
    // The route is subordinate navigation: a quiet dashed rail behind nodes
    // and labels, never a competing foreground illustration.
    const path = this.add.graphics().setDepth(5);
    const route = [...positions];
    route.slice(1).forEach((point, index) => {
      const start = route[index];
      const kind = mapNodeForLevel(activeLevels[index + 1]).kind;
      const color = nodeKindColor(kind, theme.accent);
      const unlocked = isLevelUnlocked(activeLevels[index + 1], progress);
      drawDashedSegment(path, start, point, color, unlocked ? 0.28 : 0.12);
    });

    activeLevels.forEach((level, index) => {
      const pos = positions[index];
      const releaseAvailable = PHASER_RELEASE_FEATURES.completeGameplay || level === 0;
      const unlocked = releaseAvailable && isLevelUnlocked(level, progress);
      const cleared = isLevelCleared(level, progress);
      const def = LEVELS[level];
      const mapNode = mapNodeForLevel(level);
      const displayStage = campaignStageNumber(level);
      const kindColor = nodeKindColor(mapNode.kind, theme.accent);
      const current = level === currentLevel;
      const restingAlpha = current ? 1 : unlocked ? 0.82 : 0.46;
      const node = this.add.container(pos.x, reducedMotion ? pos.y : pos.y + 26)
        .setDepth(13)
        .setAlpha(reducedMotion ? restingAlpha : 0)
        .setScale(reducedMotion ? (current ? 1.08 : 1) : 0.74);
      const currentHalo = this.add.circle(0, 0, 84, current ? UI_COLORS.gold : kindColor, current ? 0.12 : 0)
        .setStrokeStyle(current ? 5 : 0, current ? UI_COLORS.gold : kindColor, current ? 0.94 : 0);
      const kindFrame = addNodeKindFrame(this, mapNode.kind, kindColor, unlocked);
      const nodeFrame = !unlocked
        ? UI_V16_FRAME.map.locked
        : current
          ? UI_V16_FRAME.map.current
          : cleared
            ? UI_V16_FRAME.map.completed
            : UI_V16_FRAME.map[mapNode.kind];
      const medallion = this.textures.exists(UI_V16.mapModes)
        ? this.add.image(0, 0, UI_V16.mapModes, nodeFrame).setDisplaySize(164, 164)
        : this.add.image(0, 0, 'level_medallion').setDisplaySize(132, 132);
      if (!unlocked) medallion.setTint(0x5b6070).setAlpha(0.72);
      const number = this.add.text(0, -10, String(displayStage), {
        fontFamily: UI_FONT,
        fontSize: TYPE.title,
        color: unlocked ? '#ffffff' : '#c8d0dd',
        fontStyle: 'bold', stroke: '#15142c', strokeThickness: 6,
      }).setOrigin(0.5).setShadow(0, 4, '#000000', 8);
      const stars = progress.stars[level] ?? 0;
      const starText = this.add.text(0, 45, `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, {
        fontFamily: UI_FONT, fontSize: TYPE.section, color: unlocked ? '#ffe277' : '#8792a4', fontStyle: 'bold',
      }).setOrigin(0.5);
      const rewardAvailability = progress.claimedFirstClears.includes(level)
        ? 'claimed'
        : !unlocked
          ? 'locked'
          : !accountBound
            ? 'account-required'
            : cleared
              ? 'verification-pending'
              : 'available';
      const rewardText = mapRewardLabel(mapNode.reward, rewardAvailability);
      node.add([currentHalo, kindFrame, medallion, number, starText]);
      node.setSize(180, 180).setInteractive({ useHandCursor: true });
      if (current && !reducedMotion) {
        this.tweens.add({
          targets: currentHalo,
          scale: 1.08,
          alpha: 0.66,
          duration: 840,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      if (!reducedMotion) {
        this.tweens.add({
          targets: node,
          y: pos.y,
          alpha: restingAlpha,
          scale: current ? 1.08 : 1,
          delay: 120 + index * 150,
          duration: 470,
          ease: 'Cubic.easeOut',
        });
      }
      node.on('pointerover', () => {
        if (!unlocked) return;
        if (reducedMotion) node.setScale(current ? 1.12 : 1.06).setAlpha(1);
        else this.tweens.add({ targets: node, scale: current ? 1.12 : 1.06, alpha: 1, duration: 100 });
      });
      node.on('pointerout', () => {
        if (reducedMotion) node.setScale(current ? 1.08 : 1).setAlpha(restingAlpha);
        else this.tweens.add({ targets: node, scale: current ? 1.08 : 1, alpha: restingAlpha, duration: 120 });
      });
      const activateLevel = (): void => {
        if (!releaseAvailable) {
          this.showLockedMessage(displayStage, 'AVAILABLE IN RELEASE 2');
          a11y.announce(`Stage ${displayStage} is not available in this release.`);
          return;
        }
        if (!unlocked) {
          this.showLockedMessage(displayStage);
          a11y.announce(`Stage ${displayStage} is locked. Complete the previous path.`);
          return;
        }
        SFX.click();
        const duration = reducedMotion ? 0 : 180;
        this.cameras.main.fadeOut(duration, 0, 0, 0);
        this.time.delayedCall(duration > 0 ? 190 : 0, () => this.scene.start('Story', { level, score: 0, mode: meta.mode }));
      };
      node.on('pointerup', activateLevel);
      a11y.registerButton({
        id: `world-${this.world + 1}-level-${level + 1}`,
        label: unlocked
          ? `${current ? 'Current stage. ' : ''}Play stage ${displayStage}: ${def.title}. ${def.objective}`
          : `Stage ${displayStage}: ${def.title}. Locked`,
        description: unlocked
          ? `Realm step ${index + 1} of ${activeLevels.length}. ${NODE_KIND_LABEL[mapNode.kind]} route. ${stars} of 3 stars earned.${progress.bestScores[level] ? ` Best score ${progress.bestScores[level].toLocaleString()}.` : ''} First-clear reward status: ${rewardText}.`
          : `Realm step ${index + 1} of ${activeLevels.length}. ${NODE_KIND_LABEL[mapNode.kind]} route. Complete the previous path to unlock. Reward: ${rewardText}.`,
        onActivate: activateLevel,
        onFocusChange: (focused) => {
          if (!unlocked) return;
          const targetScale = focused ? (current ? 1.12 : 1.06) : current ? 1.08 : 1;
          const targetAlpha = focused ? 1 : restingAlpha;
          if (reducedMotion) node.setScale(targetScale).setAlpha(targetAlpha);
          else this.tweens.add({ targets: node, scale: targetScale, alpha: targetAlpha, duration: 100 });
        },
      });

      const chipWidth = 214;
      const preferredChipCenterX = pos.x + pos.side * (106 + chipWidth / 2);
      const chipCenterX = clampFloatingCenterX(preferredChipCenterX, chipWidth + 20);
      const labelX = pos.side > 0 ? chipCenterX - chipWidth / 2 : chipCenterX + chipWidth / 2;
      const originX = pos.side > 0 ? 0 : 1;
      const labelRail = this.add.graphics().setDepth(12);
      const labelAlpha = unlocked ? 1 : 0.62;
      const railStart = pos.x + pos.side * 70;
      const railEnd = labelX - pos.side * 8;
      labelRail.lineStyle(6, 0x020611, 0.7);
      labelRail.lineBetween(railStart, pos.y - 10, railEnd, pos.y - 43);
      labelRail.lineStyle(2, kindColor, unlocked ? 0.72 : 0.28);
      labelRail.lineBetween(railStart, pos.y - 10, railEnd, pos.y - 43);
      labelRail.fillStyle(0x0b0818, 0.88);
      labelRail.fillRoundedRect(chipCenterX - chipWidth / 2, pos.y - 62, chipWidth, 34, 10);
      const labelBoxLeft = pos.side > 0 ? labelX - 12 : labelX - chipWidth - 8;
      labelRail.fillStyle(0x050711, current ? 0.94 : 0.82);
      labelRail.fillRoundedRect(labelBoxLeft, pos.y - 20, chipWidth + 20, 78, 12);
      labelRail.lineStyle(2, kindColor, unlocked ? 0.76 : 0.3);
      labelRail.strokeRoundedRect(chipCenterX - chipWidth / 2, pos.y - 62, chipWidth, 34, 10);
      labelRail.fillStyle(unlocked ? kindColor : 0x697586, unlocked ? 0.8 : 0.46);
      labelRail.fillPoints([
        { x: railEnd, y: pos.y - 49 },
        { x: railEnd + pos.side * 6, y: pos.y - 43 },
        { x: railEnd, y: pos.y - 37 },
        { x: railEnd - pos.side * 6, y: pos.y - 43 },
      ], true);
      labelRail.setAlpha(labelAlpha);
      const routeLabel = current
        ? `NEXT STAGE  ·  ${NODE_KIND_LABEL[mapNode.kind]}`
        : `${NODE_KIND_LABEL[mapNode.kind]}  ·  ${index + 1}/${activeLevels.length}`;
      fitText(this.add.text(chipCenterX, pos.y - 45, routeLabel, {
        fontFamily: UI_FONT,
        fontSize: TYPE.section,
        color: unlocked ? '#f4f1ff' : '#bac4d4',
        fontStyle: 'bold',
        letterSpacing: 0.45,
      }).setOrigin(0.5).setDepth(13).setAlpha(labelAlpha), chipWidth - 24, 0.88);
      this.add.text(labelX, pos.y, def.title, {
        fontFamily: UI_FONT,
        fontSize: TYPE.section,
        color: unlocked ? '#f4f1ff' : '#bac4d4',
        fontStyle: 'bold',
        stroke: '#060914',
        strokeThickness: 2,
        align: pos.side > 0 ? 'left' : 'right',
        lineSpacing: -2,
        maxLines: 2,
        wordWrap: { width: chipWidth, useAdvancedWrap: true },
      }).setOrigin(originX, 0.5).setDepth(13).setAlpha(labelAlpha);
      const routeState = !unlocked
        ? 'LOCKED'
        : cleared
          ? 'REPLAY'
          : 'PLAY';
      const actionCopy = rewardAvailability === 'claimed'
        ? `${routeState}  ·  CLAIMED`
        : rewardAvailability === 'verification-pending'
          ? `VERIFY  ·  ${mapNode.reward.amount} COINS`
          : `${routeState}  ·  ${mapNode.reward.amount} COINS`;
      fitText(this.add.text(labelX, pos.y + 36, actionCopy, {
        fontFamily: UI_FONT,
        fontSize: TYPE.section,
        color: unlocked ? '#d7e0ec' : '#bac4d4',
        fontStyle: 'bold',
        align: pos.side > 0 ? 'left' : 'right',
        letterSpacing: 0.2,
        stroke: '#060914',
        strokeThickness: 2,
      }).setOrigin(originX, 0.5).setDepth(13).setAlpha(labelAlpha), chipWidth, 0.88);
    });

    addArtPanel(this, width / 2, height - 35, 620, 40, 13, 0.94);
    const footerCopy = accountBound
      ? 'ONE VERIFIED FIRST-CLEAR CLAIM PER STAGE'
      : 'LOCAL PLAY REMAINS AVAILABLE';
    fitText(this.add.text(width / 2, height - 35, footerCopy, {
      fontFamily: UI_FONT,
      fontSize: TYPE.section,
      color: '#f4f7ff',
      fontStyle: 'bold',
      letterSpacing: 0.55,
      align: 'center',
      stroke: '#030611',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(14).setShadow(0, 2, '#000000', 5), 560, 0.92);
    sharpenSceneText(this);
  }

  private switchWorld(world: number): void {
    SFX.click();
    const duration = prefersReducedMotion() ? 0 : 120;
    this.cameras.main.fadeOut(duration, 0, 0, 0);
    this.time.delayedCall(duration > 0 ? 130 : 0, () => this.scene.restart({ world, act: this.act }));
  }

  private showLockedMessage(stage: number, reason = 'COMPLETE THE PREVIOUS PATH'): void {
    const message = this.add.text(VIEW.width / 2, VIEW.height - 150, `STAGE ${stage} IS LOCKED  ·  ${reason}`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#fff2d2', backgroundColor: 'rgba(8,10,22,0.92)',
      padding: { x: 20, y: 12 }, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(30);
    message.setResolution(Phaser.Math.Clamp(window.devicePixelRatio || 1, 1, 2));
    if (prefersReducedMotion()) {
      this.time.delayedCall(1800, () => message.destroy());
    } else {
      this.tweens.add({ targets: message, alpha: 0, delay: 1800, duration: 450, onComplete: () => message.destroy() });
    }
  }
}
