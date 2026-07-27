import Phaser from 'phaser';
import { orbTexture, VIEW } from '../config';
import { furthestUnlockedWorld, getProgress } from '../game/progression';
import { cycleQuality, getMeta, MODE_DEFS, setMode, type GameMode } from '../game/meta';
import { getHandTracker } from '../game/handtracking';
import { SFX } from '../game/sfx';
import { PHASER_RELEASE_FEATURES } from '../game/release-profile';
import { accessibilityRuntimeForCanvas } from '../gfx/accessibility';
import { addAmbientMotes, addArtButton, addArtPanel, addIconFrame, addWorldBackground, DISPLAY_FONT, sharpenSceneText, TYPE, UI_COLORS, UI_FONT } from '../gfx/ui';

const MODE_ORDER: GameMode[] = ['classic', 'rush', 'precision'];
function addModeCrystalIdentity(
  scene: Phaser.Scene,
  y: number,
  accent: number,
  index: number,
  selected: boolean,
): void {
  const art = scene.add.graphics().setDepth(9);
  const alpha = selected ? 0.17 : 0.085;

  // Each challenge grows from a differently cut left crystal plane so the
  // repeated card layout still reads as three distinct game modes.
  const leftShard = index === 0
    ? [{ x: 68, y: y - 96 }, { x: 126, y: y - 116 }, { x: 181, y: y - 76 }, { x: 158, y: y + 96 }, { x: 82, y: y + 112 }]
    : index === 1
      ? [{ x: 68, y: y - 108 }, { x: 164, y: y - 92 }, { x: 180, y: y - 8 }, { x: 148, y: y + 106 }, { x: 78, y: y + 78 }]
      : [{ x: 78, y: y - 112 }, { x: 172, y: y - 72 }, { x: 152, y: y + 108 }, { x: 68, y: y + 76 }, { x: 92, y: y - 8 }];
  art.fillStyle(accent, alpha);
  art.fillPoints(leftShard, true);
  art.lineStyle(selected ? 2 : 1, accent, selected ? 0.7 : 0.32);
  art.strokePoints(leftShard, true);

  // A broken connector carries the mode colour into its title without adding
  // another label or occupying any of the established text region.
  art.lineStyle(2, accent, selected ? 0.64 : 0.3);
  art.lineBetween(169, y - 76, 184, y - 76);
  art.lineStyle(1, UI_COLORS.gold, selected ? 0.58 : 0.26);
  art.lineBetween(184, y - 76, 222, y - 76);
  art.fillStyle(selected ? UI_COLORS.gold : accent, selected ? 0.78 : 0.42);
  art.fillPoints([
    { x: 184, y: y - 81 }, { x: 189, y: y - 76 },
    { x: 184, y: y - 71 }, { x: 179, y: y - 76 },
  ], true);

  // The quiet right-edge rune changes silhouette per mode: crown crystal,
  // time chevrons, then a nested precision reticle.
  const runeX = 634;
  const runeY = y - 76;
  art.lineStyle(selected ? 2 : 1, selected ? UI_COLORS.gold : accent, selected ? 0.72 : 0.34);
  if (index === 0) {
    art.strokePoints([
      { x: runeX, y: runeY - 14 }, { x: runeX + 12, y: runeY },
      { x: runeX, y: runeY + 14 }, { x: runeX - 12, y: runeY },
    ], true);
    art.lineBetween(runeX - 8, runeY, runeX + 8, runeY);
  } else if (index === 1) {
    art.lineBetween(runeX - 13, runeY - 13, runeX, runeY);
    art.lineBetween(runeX, runeY, runeX - 13, runeY + 13);
    art.lineBetween(runeX, runeY - 13, runeX + 13, runeY);
    art.lineBetween(runeX + 13, runeY, runeX, runeY + 13);
  } else {
    art.strokePoints([
      { x: runeX, y: runeY - 15 }, { x: runeX + 15, y: runeY },
      { x: runeX, y: runeY + 15 }, { x: runeX - 15, y: runeY },
    ], true);
    art.strokePoints([
      { x: runeX, y: runeY - 7 }, { x: runeX + 7, y: runeY },
      { x: runeX, y: runeY + 7 }, { x: runeX - 7, y: runeY },
    ], true);
  }
}

export class ModeSelectScene extends Phaser.Scene {
  constructor() {
    super('ModeSelect');
  }

  create(): void {
    const { width, height } = VIEW;
    const meta = getMeta();
    accessibilityRuntimeForCanvas(this.game.canvas).mountScene({
      id: 'mode-select',
      heading: 'Choose your PaoPao Fusion challenge',
      description: 'Classic Adventure, timed Rush, Precision, Prism Cascade match-three, and live modes each preserve the same campaign progress.',
      status: `${MODE_DEFS[meta.mode].name} is currently selected.`,
      lifecycle: this.events,
    });
    void getHandTracker().prepare().catch(() => undefined);
    this.cameras.main.fadeIn(180, 0, 0, 0);
    addWorldBackground(this, 'world_celestial', 0.25);
    addAmbientMotes(this, 0x82dcff, 22, 2);

    addArtPanel(this, width / 2, 118, 620, 215, 8, 0.97);
    this.add.text(width / 2, 58, 'CHOOSE YOUR CHALLENGE', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe5a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    this.add.text(width / 2, 105, 'SPECIAL MODES', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold', stroke: '#34215f', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 10);
    this.add.text(width / 2, 151, 'Every mode has its own timer, hit rules and coin multiplier.', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#d5deed', fontStyle: 'bold',
      align: 'center', wordWrap: { width: 540 },
    }).setOrigin(0.5).setDepth(12);

    addArtButton(this, 88, 48, '‹  MENU', () => {
      SFX.click();
      this.scene.start('Menu');
    }, 145, 50, 18);

    const cardY = [365, 660, 955];
    const availableModes = PHASER_RELEASE_FEATURES.completeGameplay ? MODE_ORDER : MODE_ORDER.slice(0, 1);
    availableModes.forEach((mode, index) => {
      const def = MODE_DEFS[mode];
      const selected = meta.mode === mode;
      const y = cardY[index];
      addArtPanel(this, width / 2, y, 600, 270, 8, selected ? 1 : 0.91);
      addModeCrystalIdentity(this, y, def.accent, index, selected);
      addIconFrame(this, 115, y, 116, def.accent, 10, selected);
      if (mode === 'classic') {
        // The core match-three fantasy is represented by the player's real
        // equipped orb skin, not a platform-dependent emoji glyph.
        this.add.image(92, y + 13, orbTexture(meta.equippedSkin, 'green')).setDisplaySize(46, 46).setDepth(12);
        this.add.image(138, y + 13, orbTexture(meta.equippedSkin, 'purple')).setDisplaySize(46, 46).setDepth(12);
        this.add.image(115, y - 12, orbTexture(meta.equippedSkin, 'blue')).setDisplaySize(68, 68).setDepth(13);
      } else {
        this.add.image(115, y - 1, mode === 'rush' ? 'artifact_chrono' : 'mechanic_crystal_seal')
          .setDisplaySize(mode === 'rush' ? 82 : 78, mode === 'rush' ? 82 : 78)
          .setDepth(12);
      }
      this.add.text(195, y - 78, def.name, {
        fontFamily: UI_FONT, fontSize: TYPE.title, color: def.accentCss, fontStyle: 'bold', stroke: '#101225', strokeThickness: 4,
      }).setDepth(12);
      this.add.text(195, y - 42, def.tagline, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe5a0', fontStyle: 'bold', letterSpacing: 2,
      }).setDepth(12);
      this.add.text(195, y - 10, def.description, {
        fontFamily: UI_FONT, fontSize: TYPE.control, color: '#d4dfef', lineSpacing: 2, wordWrap: { width: 420 },
      }).setDepth(12);
      const timer = def.timerSeconds == null ? 'NO TIMER' : `${def.timerSeconds} SEC`;
      this.add.text(195, y + 54, `${timer}   •   ◆ ×${def.coinMultiplier}`, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#b9c8df', fontStyle: 'bold', letterSpacing: 1,
      }).setDepth(12);
      if (mode === 'classic') {
        addArtButton(this, 348, y + 108, 'LEARN CONTROLS', () => {
          setMode('classic');
          SFX.click();
          this.scene.start('Game', {
            level: 0,
            score: 0,
            mode: 'classic',
            tutorialReplay: true,
          });
        }, 190, 52, 14);
      }
      addArtButton(this, 548, y + 108, selected ? 'SELECTED' : 'PLAY MODE', () => {
        setMode(mode);
        SFX.click();
        const progress = getProgress();
        this.cameras.main.fadeOut(160, 0, 0, 0);
        this.time.delayedCall(170, () => this.scene.start('WorldMap', { world: furthestUnlockedWorld(progress) }));
      }, 180, 52, 14);
    });

    if (PHASER_RELEASE_FEATURES.completeGameplay && PHASER_RELEASE_FEATURES.endlessLiveOperations) {
      addArtButton(this, 202, 1_126, 'PRISM CASCADE  •  MATCH-3', () => {
        SFX.click();
        this.scene.start('Match3Map');
      }, 304, 56, 18);
      addArtButton(this, 518, 1_126, 'ENDLESS NEXUS  •  LIVE', () => {
        SFX.click();
        this.scene.start('Endless', { event: false });
      }, 304, 56, 18);
    } else if (PHASER_RELEASE_FEATURES.completeGameplay) {
      addArtButton(this, width / 2, 1_126, 'PRISM CASCADE  •  MATCH-3 ADVENTURE', () => {
        SFX.click();
        this.scene.start('Match3Map');
      }, 600, 56, 18);
    } else {
      this.add.text(width / 2, 1_126, 'FOUNDATION BUILD  •  FIRST BOARD ACTIVE', {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#9fb5d0', fontStyle: 'bold', letterSpacing: 1,
      }).setOrigin(0.5).setDepth(12);
    }

    addArtButton(this, 214, height - 66, 'HAND SETUP', () => {
      SFX.click(); this.scene.start('HandSetup');
    }, 280, 58, 18);
    addArtButton(this, 520, height - 66, `QUALITY  •  ${meta.quality.toUpperCase()}`, () => {
      SFX.click();
      cycleQuality();
      this.scene.restart();
    }, 280, 58, 18);
    sharpenSceneText(this);
  }
}
