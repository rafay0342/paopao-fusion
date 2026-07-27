import Phaser from 'phaser';
import { FighterSelectScene } from './FighterSelectScene';
import { FightScene } from './FightScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'fight-game',
  backgroundColor: '#02050a',
  transparent: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  render: {
    antialias: true,
    antialiasGL: true,
    roundPixels: false,
    powerPreference: 'high-performance',
  },
  fps: {
    target: 60,
    min: 30,
    smoothStep: true,
    deltaHistory: 120,
  },
  input: {
    gamepad: true,
    activePointers: 10,
  },
  audio: {
    disableWebAudio: false,
  },
  scene: [FighterSelectScene, FightScene],
});

game.canvas.tabIndex = 0;
game.canvas.setAttribute('role', 'application');
game.canvas.setAttribute('aria-label', 'Shattered Tribunal interactive fight canvas');
game.canvas.setAttribute('aria-describedby', 'fight-instructions');

window.addEventListener('pagehide', () => game.destroy(true), { once: true });
