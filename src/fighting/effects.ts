import Phaser from 'phaser';

export class FightEffects {
  private readonly layer: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = scene.add.container(0, 0).setDepth(900);
  }

  impact(x: number, y: number, color: number, weight: 'light' | 'heavy' | 'special'): void {
    const count = weight === 'light' ? 7 : weight === 'heavy' ? 13 : 22;
    const radius = weight === 'light' ? 32 : weight === 'heavy' ? 54 : 86;
    const ring = this.scene.add.circle(x, y, 8, color, 0)
      .setStrokeStyle(weight === 'special' ? 6 : 4, color, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    const core = this.scene.add.circle(x, y, weight === 'special' ? 22 : 13, 0xffffff, 0.92)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.layer.add([ring, core]);
    this.scene.tweens.add({
      targets: ring,
      scale: weight === 'special' ? 8.5 : 5,
      alpha: 0,
      duration: weight === 'light' ? 170 : 260,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });
    this.scene.tweens.add({
      targets: core,
      scale: 0.2,
      alpha: 0,
      duration: 110,
      onComplete: () => core.destroy(),
    });

    for (let index = 0; index < count; index += 1) {
      const angle = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
      const distance = Phaser.Math.FloatBetween(radius * 0.4, radius);
      const shard = this.scene.add.rectangle(
        x,
        y,
        Phaser.Math.Between(3, weight === 'special' ? 11 : 8),
        Phaser.Math.Between(2, 4),
        index % 4 === 0 ? 0xffffff : color,
        Phaser.Math.FloatBetween(0.55, 1),
      )
        .setRotation(angle)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.layer.add(shard);
      this.scene.tweens.add({
        targets: shard,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.25,
        duration: Phaser.Math.Between(150, weight === 'special' ? 360 : 250),
        ease: 'Cubic.Out',
        onComplete: () => shard.destroy(),
      });
    }
  }

  guard(x: number, y: number, color: number): void {
    const shield = this.scene.add.arc(x, y, 46, -72, 72, false, color, 0.12)
      .setStrokeStyle(4, color, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAngle(-90);
    this.layer.add(shield);
    this.scene.tweens.add({
      targets: shield,
      scale: 1.55,
      alpha: 0,
      duration: 210,
      ease: 'Quad.Out',
      onComplete: () => shield.destroy(),
    });
  }

  specialTrail(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: number,
  ): void {
    const graphics = this.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    graphics.lineStyle(18, color, 0.16);
    graphics.lineBetween(startX, startY, endX, endY);
    graphics.lineStyle(7, color, 0.72);
    graphics.lineBetween(startX, startY, endX, endY);
    graphics.lineStyle(2, 0xffffff, 0.92);
    graphics.lineBetween(startX, startY, endX, endY);
    this.layer.add(graphics);
    this.scene.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: 250,
      ease: 'Quad.In',
      onComplete: () => graphics.destroy(),
    });
  }

  groundBurst(x: number, color: number): void {
    for (let index = 0; index < 10; index += 1) {
      const dust = this.scene.add.ellipse(
        x + Phaser.Math.Between(-22, 22),
        606,
        Phaser.Math.Between(12, 28),
        Phaser.Math.Between(4, 9),
        color,
        Phaser.Math.FloatBetween(0.1, 0.35),
      );
      this.layer.add(dust);
      this.scene.tweens.add({
        targets: dust,
        x: dust.x + Phaser.Math.Between(-55, 55),
        y: dust.y - Phaser.Math.Between(14, 42),
        scale: Phaser.Math.FloatBetween(1.4, 2.2),
        alpha: 0,
        duration: Phaser.Math.Between(260, 520),
        onComplete: () => dust.destroy(),
      });
    }
  }

  destroy(): void {
    this.layer.destroy(true);
  }
}
