import Phaser from 'phaser';
import type { FighterDefinition } from './roster';

export interface FighterHudState {
  health: number;
  maxHealth: number;
  guard: number;
  maxGuard: number;
  meter: number;
  maxMeter: number;
  wins: number;
  combo: number;
}

export class FightHud {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly timer: Phaser.GameObjects.Text;
  private readonly p1Combo: Phaser.GameObjects.Text;
  private readonly p2Combo: Phaser.GameObjects.Text;
  private readonly message: Phaser.GameObjects.Text;
  private lastP1Combo = 0;
  private lastP2Combo = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly p1: FighterDefinition,
    private readonly p2: FighterDefinition,
  ) {
    this.graphics = scene.add.graphics().setDepth(1200);
    this.timer = scene.add.text(640, 58, '90', {
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '41px',
      color: '#f5efe1',
      stroke: '#020409',
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(1201);
    scene.add.text(58, 34, p1.name, {
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '20px',
      color: '#f5efe1',
      stroke: '#020409',
      strokeThickness: 4,
    }).setDepth(1201);
    scene.add.text(1222, 34, p2.name, {
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '20px',
      color: '#f5efe1',
      stroke: '#020409',
      strokeThickness: 4,
    }).setOrigin(1, 0).setDepth(1201);
    scene.add.text(58, 61, p1.epithet, {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '8px',
      color: p1.accentCss,
      letterSpacing: 2,
      fontStyle: 'bold',
    }).setDepth(1201);
    scene.add.text(1222, 61, p2.epithet, {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '8px',
      color: p2.accentCss,
      letterSpacing: 2,
      fontStyle: 'bold',
    }).setOrigin(1, 0).setDepth(1201);
    this.p1Combo = this.createCombo(74, 174, p1.accentCss).setOrigin(0, 0.5);
    this.p2Combo = this.createCombo(1206, 174, p2.accentCss).setOrigin(1, 0.5);
    this.message = scene.add.text(640, 250, '', {
      align: 'center',
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '48px',
      color: '#f5efe1',
      stroke: '#020308',
      strokeThickness: 9,
      letterSpacing: 4,
    }).setOrigin(0.5).setDepth(1400).setAlpha(0);
  }

  update(p1: FighterHudState, p2: FighterHudState, timerSeconds: number): void {
    this.timer.setText(String(Math.max(0, Math.ceil(timerSeconds))).padStart(2, '0'));
    this.graphics.clear();
    this.drawSide(54, 88, 520, p1, this.p1.accent, false);
    this.drawSide(1226, 88, 520, p2, this.p2.accent, true);
    this.drawRoundPips(522, p1.wins, this.p1.accent, false);
    this.drawRoundPips(758, p2.wins, this.p2.accent, true);
    this.updateCombo(this.p1Combo, p1.combo, this.lastP1Combo);
    this.updateCombo(this.p2Combo, p2.combo, this.lastP2Combo);
    this.lastP1Combo = p1.combo;
    this.lastP2Combo = p2.combo;
  }

  announce(text: string, subtext = '', color = '#f5efe1', holdMs = 760): void {
    this.scene.tweens.killTweensOf(this.message);
    this.message
      .setText(subtext ? `${text}\n${subtext}` : text)
      .setColor(color)
      .setFontSize(subtext ? 45 : 58)
      .setScale(1.35)
      .setAlpha(0);
    this.scene.tweens.add({
      targets: this.message,
      alpha: 1,
      scale: 1,
      duration: 180,
      ease: 'Back.Out',
      hold: holdMs,
      yoyo: true,
      onComplete: () => this.message.setAlpha(0),
    });
  }

  private createCombo(x: number, y: number, color: string): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, '', {
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '30px',
      color,
      stroke: '#020308',
      strokeThickness: 6,
      lineSpacing: -5,
    }).setDepth(1201);
  }

  private updateCombo(text: Phaser.GameObjects.Text, combo: number, previous: number): void {
    if (combo < 2) {
      text.setAlpha(0);
      return;
    }
    text.setText(`${combo} HIT\nCOMBO`).setAlpha(1);
    if (combo > previous) {
      text.setScale(1.34);
      this.scene.tweens.add({
        targets: text,
        scale: 1,
        duration: 140,
        ease: 'Back.Out',
      });
    }
  }

  private drawSide(
    anchorX: number,
    y: number,
    width: number,
    state: FighterHudState,
    accent: number,
    mirrored: boolean,
  ): void {
    const healthRatio = Phaser.Math.Clamp(state.health / Math.max(1, state.maxHealth), 0, 1);
    const guardRatio = Phaser.Math.Clamp(state.guard / Math.max(1, state.maxGuard), 0, 1);
    const meterRatio = Phaser.Math.Clamp(state.meter / Math.max(1, state.maxMeter), 0, 1);
    const startX = mirrored ? anchorX - width : anchorX;
    this.graphics.fillStyle(0x020409, 0.82);
    this.graphics.fillRoundedRect(startX - 5, y - 5, width + 10, 29, 3);
    this.graphics.lineStyle(1, 0xdfe9f2, 0.28);
    this.graphics.strokeRoundedRect(startX - 5, y - 5, width + 10, 29, 3);
    this.graphics.fillStyle(0x2b3037, 0.94);
    this.graphics.fillRect(startX, y, width, 19);
    this.graphics.fillStyle(accent, 1);
    const healthWidth = width * healthRatio;
    this.graphics.fillRect(mirrored ? anchorX - healthWidth : anchorX, y, healthWidth, 19);
    this.graphics.fillStyle(0xffffff, 0.2);
    this.graphics.fillRect(mirrored ? anchorX - healthWidth : anchorX, y, healthWidth, 4);

    const smallY = y + 31;
    this.graphics.fillStyle(0x070b10, 0.84);
    this.graphics.fillRoundedRect(startX, smallY, width, 6, 3);
    this.graphics.fillStyle(0xe6eef7, 0.75);
    const guardWidth = width * guardRatio;
    this.graphics.fillRoundedRect(mirrored ? anchorX - guardWidth : anchorX, smallY, guardWidth, 6, 3);

    const meterY = y + 45;
    this.graphics.fillStyle(0x070b10, 0.9);
    this.graphics.fillRoundedRect(startX, meterY, width, 8, 4);
    const meterColor = meterRatio >= 0.99 ? 0xf5d37d : accent;
    this.graphics.fillStyle(meterColor, meterRatio >= 0.99 ? 1 : 0.7);
    const meterWidth = width * meterRatio;
    this.graphics.fillRoundedRect(mirrored ? anchorX - meterWidth : anchorX, meterY, meterWidth, 8, 4);
  }

  private drawRoundPips(x: number, wins: number, color: number, mirrored: boolean): void {
    for (let index = 0; index < 2; index += 1) {
      const pipX = x + (mirrored ? index * 18 : -index * 18);
      this.graphics.fillStyle(index < wins ? color : 0x1a222c, index < wins ? 1 : 0.92);
      this.graphics.fillCircle(pipX, 59, 6);
      this.graphics.lineStyle(1, color, 0.56);
      this.graphics.strokeCircle(pipX, 59, 6);
    }
  }
}
