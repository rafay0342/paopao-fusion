import Phaser from 'phaser';

export interface FightButtons {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  block: boolean;
  light: boolean;
  heavy: boolean;
  special: boolean;
}

export type FightButtonName = keyof FightButtons;

const EMPTY_INPUT: FightButtons = {
  left: false,
  right: false,
  up: false,
  down: false,
  block: false,
  light: false,
  heavy: false,
  special: false,
};

interface PlayerKeys {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  block: Phaser.Input.Keyboard.Key;
  light: Phaser.Input.Keyboard.Key;
  heavy: Phaser.Input.Keyboard.Key;
  special: Phaser.Input.Keyboard.Key;
}

export class FightInput {
  private readonly keys: [PlayerKeys, PlayerKeys];
  private readonly touchState: [FightButtons, FightButtons] = [
    { ...EMPTY_INPUT },
    { ...EMPTY_INPUT },
  ];

  constructor(private readonly scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard input is unavailable.');
    }
    this.keys = [
      {
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        block: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
        light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
        heavy: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
        special: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L),
      },
      {
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        block: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ZERO),
        light: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE),
        heavy: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO),
        special: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE),
      },
    ];
  }

  setTouch(player: 0 | 1, button: FightButtonName, pressed: boolean): void {
    this.touchState[player][button] = pressed;
  }

  clearTouch(): void {
    this.touchState[0] = { ...EMPTY_INPUT };
    this.touchState[1] = { ...EMPTY_INPUT };
  }

  read(player: 0 | 1): FightButtons {
    const keyboard = this.keys[player];
    const touch = this.touchState[player];
    const pad = this.scene.input.gamepad?.getPad(player) ?? null;
    const axisX = pad?.axes[0]?.getValue() ?? 0;
    const axisY = pad?.axes[1]?.getValue() ?? 0;

    return {
      left: keyboard.left.isDown || touch.left || axisX < -0.35 || Boolean(pad?.left),
      right: keyboard.right.isDown || touch.right || axisX > 0.35 || Boolean(pad?.right),
      up: keyboard.up.isDown || touch.up || axisY < -0.5 || Boolean(pad?.up),
      down: keyboard.down.isDown || touch.down || axisY > 0.5 || Boolean(pad?.down),
      block: keyboard.block.isDown || touch.block || Boolean(pad?.L2 || pad?.R2),
      light: keyboard.light.isDown || touch.light || Boolean(pad?.A),
      heavy: keyboard.heavy.isDown || touch.heavy || Boolean(pad?.X),
      special: keyboard.special.isDown || touch.special || Boolean(pad?.Y),
    };
  }
}

export function isCoarsePointer(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches === true
    || navigator.maxTouchPoints > 0;
}
