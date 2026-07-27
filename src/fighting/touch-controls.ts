import Phaser from 'phaser';
import { type FightButtonName, FightInput } from './input';

interface TouchButtonSpec {
  x: number;
  y: number;
  radius: number;
  label: string;
  button: FightButtonName;
  color?: number;
}

export class TouchControls {
  readonly container: Phaser.GameObjects.Container;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly input: FightInput,
  ) {
    this.container = scene.add.container(0, 0).setDepth(2000).setScrollFactor(0);
    const specs: TouchButtonSpec[] = [
      { x: 74, y: 636, radius: 35, label: '◀', button: 'left' },
      { x: 150, y: 636, radius: 35, label: '▼', button: 'down' },
      { x: 226, y: 636, radius: 35, label: '▶', button: 'right' },
      { x: 150, y: 558, radius: 35, label: '▲', button: 'up' },
      { x: 965, y: 566, radius: 31, label: 'BLK', button: 'block', color: 0xc8d3df },
      { x: 1033, y: 635, radius: 36, label: 'L', button: 'light', color: 0x64ddff },
      { x: 1117, y: 607, radius: 39, label: 'H', button: 'heavy', color: 0xff765e },
      { x: 1200, y: 558, radius: 42, label: 'RIFT', button: 'special', color: 0xd4b06c },
    ];
    specs.forEach((spec) => this.addButton(spec));
    this.container.setVisible(false);
  }

  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    if (!visible) this.input.clearTouch();
    return this;
  }

  destroy(): void {
    this.input.clearTouch();
    this.container.destroy(true);
  }

  private addButton(spec: TouchButtonSpec): void {
    const color = spec.color ?? 0xb8c9d8;
    const ring = this.scene.add.circle(spec.x, spec.y, spec.radius, 0x05080c, 0.52)
      .setStrokeStyle(2, color, 0.62);
    const inner = this.scene.add.circle(spec.x, spec.y, spec.radius - 7, color, 0.1);
    const label = this.scene.add.text(spec.x, spec.y, spec.label, {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: spec.label.length > 2 ? '10px' : '19px',
      color: '#eff7ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const zone = this.scene.add.zone(spec.x, spec.y, spec.radius * 2.35, spec.radius * 2.35)
      .setInteractive();
    const press = (): void => {
      this.input.setTouch(0, spec.button, true);
      ring.setFillStyle(color, 0.32).setScale(0.94);
      inner.setAlpha(0.8);
    };
    const release = (): void => {
      this.input.setTouch(0, spec.button, false);
      ring.setFillStyle(0x05080c, 0.52).setScale(1);
      inner.setAlpha(1);
    };
    zone.on('pointerdown', press);
    zone.on('pointerup', release);
    zone.on('pointerout', release);
    zone.on('pointerupoutside', release);
    this.container.add([ring, inner, label, zone]);
  }
}
