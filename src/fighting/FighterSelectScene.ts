import Phaser from 'phaser';
import { FIGHTERS, FIGHTER_ORDER, rivalOf, type FighterDefinition, type FighterId } from './roster';

export type FightMode = 'cpu' | 'local';

export interface FightLaunchData {
  playerOne: FighterId;
  playerTwo: FighterId;
  mode: FightMode;
}

const W = 1280;
const H = 720;

export class FighterSelectScene extends Phaser.Scene {
  private selection: FighterId = 'kael';
  private mode: FightMode = 'cpu';
  private cards = new Map<FighterId, Phaser.GameObjects.Container>();
  private detail!: Phaser.GameObjects.Container;
  private modeText!: Phaser.GameObjects.Text;
  private confirmHint!: Phaser.GameObjects.Text;
  private locked = false;
  private lastPadHorizontal = 0;
  private lastPadConfirm = false;
  private lastPadMode = false;

  constructor() {
    super('FighterSelectScene');
  }

  preload(): void {
    this.load.image('fight-stage', '/assets/fighting/stages/shattered-tribunal.png');
    for (const fighter of Object.values(FIGHTERS)) {
      this.load.image(fighter.assetKey, fighter.assetPath);
    }
    this.load.audio('fight-music', [
      '/assets/audio/nexus-awakens-boss.ogg',
      '/assets/audio/nexus-awakens-boss.mp3',
    ]);
  }

  create(): void {
    this.locked = false;
    this.cards.clear();
    this.lastPadHorizontal = 0;
    this.lastPadConfirm = false;
    this.lastPadMode = false;
    this.cameras.main.fadeIn(500, 0, 0, 0);
    this.input.setDefaultCursor('default');
    this.createBackdrop();
    this.createHeader();
    this.createRoster();
    this.createDetails();
    this.createFooter();
    this.refresh();

    const keyboard = this.input.keyboard;
    const cameFromNativeAction = (event?: Event): boolean => (
      event?.target instanceof Element
      && Boolean(event.target.closest('#fight-select-actions'))
    );
    const previous = (event?: KeyboardEvent): void => {
      if (!cameFromNativeAction(event)) this.changeSelection(-1);
    };
    const next = (event?: KeyboardEvent): void => {
      if (!cameFromNativeAction(event)) this.changeSelection(1);
    };
    const toggleMode = (event?: KeyboardEvent): void => {
      if (!cameFromNativeAction(event)) this.toggleMode();
    };
    const confirm = (event?: KeyboardEvent): void => {
      if (!cameFromNativeAction(event)) this.confirm();
    };
    const accessibleAction = (event: Event): void => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === 'previous') this.changeSelection(-1);
      else if (action === 'next') this.changeSelection(1);
      else if (action === 'mode') this.toggleMode();
      else if (action === 'confirm') this.confirm();
    };
    keyboard?.on('keydown-LEFT', previous);
    keyboard?.on('keydown-A', previous);
    keyboard?.on('keydown-RIGHT', next);
    keyboard?.on('keydown-D', next);
    keyboard?.on('keydown-UP', toggleMode);
    keyboard?.on('keydown-DOWN', toggleMode);
    keyboard?.on('keydown-M', toggleMode);
    keyboard?.on('keydown-ENTER', confirm);
    keyboard?.on('keydown-SPACE', confirm);
    window.addEventListener('paopao:fighter-select-action', accessibleAction);
    const accessibleActions = document.getElementById('fight-select-actions');
    if (accessibleActions) accessibleActions.hidden = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard?.off('keydown-LEFT', previous);
      keyboard?.off('keydown-A', previous);
      keyboard?.off('keydown-RIGHT', next);
      keyboard?.off('keydown-D', next);
      keyboard?.off('keydown-UP', toggleMode);
      keyboard?.off('keydown-DOWN', toggleMode);
      keyboard?.off('keydown-M', toggleMode);
      keyboard?.off('keydown-ENTER', confirm);
      keyboard?.off('keydown-SPACE', confirm);
      window.removeEventListener('paopao:fighter-select-action', accessibleAction);
      if (accessibleActions) accessibleActions.hidden = true;
    });
  }

  update(): void {
    const pad = this.input.gamepad?.getPad(0);
    if (!pad || this.locked) return;
    const horizontal = pad.axes[0]?.getValue() ?? 0;
    if (horizontal > 0.55 && this.lastPadHorizontal <= 0.55) this.changeSelection(1);
    if (horizontal < -0.55 && this.lastPadHorizontal >= -0.55) this.changeSelection(-1);
    this.lastPadHorizontal = horizontal;
    const modePressed = Boolean(pad.up || pad.down || pad.Y);
    if (modePressed && !this.lastPadMode) this.toggleMode();
    this.lastPadMode = modePressed;
    const confirmPressed = Boolean(pad.A);
    if (confirmPressed && !this.lastPadConfirm) this.confirm();
    this.lastPadConfirm = confirmPressed;
  }

  private createBackdrop(): void {
    const background = this.add.image(W / 2, H / 2, 'fight-stage')
      .setDisplaySize(W, H)
      .setTint(0x52606f)
      .setAlpha(0.66);
    this.tweens.add({
      targets: background,
      scaleX: background.scaleX * 1.035,
      scaleY: background.scaleY * 1.035,
      duration: 12000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    this.add.rectangle(W / 2, H / 2, W, H, 0x02040a, 0.3);
    this.add.rectangle(W / 2, 360, W, 720, 0x05070d, 0.25)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    for (let index = 0; index < 30; index += 1) {
      const mote = this.add.circle(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(80, H),
        Phaser.Math.FloatBetween(0.7, 2.2),
        index % 2 === 0 ? 0x65dcff : 0xff715b,
        Phaser.Math.FloatBetween(0.12, 0.34),
      );
      this.tweens.add({
        targets: mote,
        y: mote.y - Phaser.Math.Between(50, 150),
        x: mote.x + Phaser.Math.Between(-24, 24),
        alpha: 0,
        duration: Phaser.Math.Between(3000, 7200),
        delay: Phaser.Math.Between(0, 2600),
        repeat: -1,
      });
    }
  }

  private createHeader(): void {
    this.add.text(52, 34, 'RIFTBOUND', {
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '42px',
      color: '#f4efe2',
      letterSpacing: 7,
      stroke: '#03050a',
      strokeThickness: 5,
    });
    this.add.text(55, 80, 'SHATTERED OATH', {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '11px',
      color: '#cda85d',
      letterSpacing: 6,
      fontStyle: 'bold',
    });
    this.add.text(W - 52, 43, 'CHOOSE YOUR CHAMPION', {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '15px',
      color: '#dce5ee',
      letterSpacing: 3,
      fontStyle: 'bold',
    }).setOrigin(1, 0);
    this.add.rectangle(W / 2, 111, W - 104, 1, 0xb9c9d9, 0.28);
  }

  private createRoster(): void {
    const positions = [224, 520];
    FIGHTER_ORDER.forEach((fighterId, index) => {
      const fighter = FIGHTERS[fighterId];
      const card = this.add.container(positions[index], 375);
      const glow = this.add.rectangle(0, 0, 252, 440, fighter.accent, 0.15)
        .setStrokeStyle(2, fighter.accent, 0.8);
      const shade = this.add.rectangle(0, 0, 238, 426, 0x06080d, 0.76);
      const portrait = this.add.image(0, 14, fighter.assetKey)
        .setOrigin(0.5)
        .setDisplaySize(fighter.id === 'kael' ? 238 : 252, fighter.id === 'kael' ? 436 : 378);
      const lower = this.add.rectangle(0, 162, 238, 102, 0x04060a, 0.9);
      const name = this.add.text(0, 140, fighter.name, {
        fontFamily: '"PaoPao Display", Georgia, serif',
        fontSize: '24px',
        color: '#f7f0df',
        stroke: '#030409',
        strokeThickness: 4,
      }).setOrigin(0.5);
      const epithet = this.add.text(0, 174, fighter.epithet, {
        fontFamily: '"Fusion Sans", Arial, sans-serif',
        fontSize: '10px',
        color: fighter.accentCss,
        letterSpacing: 2,
        fontStyle: 'bold',
      }).setOrigin(0.5);
      const hit = this.add.zone(0, 0, 264, 454).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => {
        if (!this.locked) this.setSelection(fighterId);
      });
      hit.on('pointerdown', () => {
        if (this.selection === fighterId) this.confirm();
        else this.setSelection(fighterId);
      });
      card.add([glow, shade, portrait, lower, name, epithet, hit]);
      this.cards.set(fighterId, card);
    });
  }

  private createDetails(): void {
    this.detail = this.add.container(790, 348);
  }

  private createFooter(): void {
    const modePlate = this.add.rectangle(W - 209, 606, 322, 62, 0x080c13, 0.92)
      .setStrokeStyle(1, 0xcda85d, 0.7)
      .setInteractive({ useHandCursor: true });
    modePlate.on('pointerdown', () => this.toggleMode());
    this.add.text(W - 350, 588, 'MATCH TYPE', {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '9px',
      color: '#8e9bad',
      letterSpacing: 2,
      fontStyle: 'bold',
    });
    this.modeText = this.add.text(W - 350, 607, '', {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '18px',
      color: '#f4efe2',
      fontStyle: 'bold',
    });
    this.add.text(W - 64, 607, '↕ / M', {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '10px',
      color: '#cda85d',
      fontStyle: 'bold',
    }).setOrigin(1, 0);

    const confirm = this.add.rectangle(254, 636, 408, 58, 0x0c1720, 0.96)
      .setStrokeStyle(2, 0x5cdfff, 0.8)
      .setInteractive({ useHandCursor: true });
    confirm.on('pointerdown', () => this.confirm());
    this.confirmHint = this.add.text(254, 636, 'ENTER / TAP  •  LOCK FIGHTER', {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '13px',
      color: '#e7f8ff',
      letterSpacing: 2,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.tweens.add({
      targets: [confirm, this.confirmHint],
      alpha: { from: 0.7, to: 1 },
      duration: 950,
      yoyo: true,
      repeat: -1,
    });
  }

  private refresh(): void {
    for (const [fighterId, card] of this.cards) {
      const selected = fighterId === this.selection;
      this.tweens.killTweensOf(card);
      this.tweens.add({
        targets: card,
        scaleX: selected ? 1.045 : 0.92,
        scaleY: selected ? 1.045 : 0.92,
        alpha: selected ? 1 : 0.58,
        y: selected ? 363 : 382,
        duration: 180,
        ease: 'Quad.Out',
      });
    }
    this.renderDetails(FIGHTERS[this.selection]);
    this.modeText.setText(this.mode === 'cpu' ? 'VERSUS CPU · WARDEN' : 'LOCAL VERSUS · 2P');
    const live = document.getElementById('fight-live');
    if (live) {
      live.textContent = `${FIGHTERS[this.selection].name} selected. ${this.mode === 'cpu' ? 'Versus CPU Warden' : 'Local two player versus'}.`;
    }
  }

  private renderDetails(fighter: FighterDefinition): void {
    this.detail.removeAll(true);
    const eyebrow = this.add.text(0, -183, 'COMBAT DOSSIER', {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '9px',
      color: fighter.accentCss,
      letterSpacing: 3,
      fontStyle: 'bold',
    });
    const name = this.add.text(0, -153, fighter.name, {
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '46px',
      color: '#f6f0e3',
      stroke: '#03050a',
      strokeThickness: 5,
    });
    const origin = this.add.text(2, -96, `${fighter.origin}  //  ${fighter.style}`, {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '11px',
      color: '#aab5c4',
      letterSpacing: 2,
      fontStyle: 'bold',
    });
    const line = this.add.rectangle(0, -66, 410, 1, fighter.accent, 0.54).setOrigin(0, 0.5);
    this.detail.add([eyebrow, name, origin, line]);

    const labels: Array<[string, number]> = [
      ['POWER', fighter.stats.power],
      ['SPEED', fighter.stats.speed],
      ['DEFENSE', fighter.stats.defense],
      ['REACH', fighter.stats.reach],
    ];
    labels.forEach(([label, value], index) => {
      const y = -35 + index * 42;
      const text = this.add.text(0, y, label, {
        fontFamily: '"Fusion Sans", Arial, sans-serif',
        fontSize: '10px',
        color: '#98a6b7',
        letterSpacing: 2,
        fontStyle: 'bold',
      });
      const back = this.add.rectangle(112, y + 5, 268, 7, 0x28303a, 0.82).setOrigin(0, 0.5);
      const fill = this.add.rectangle(112, y + 5, 26.8 * value, 7, fighter.accent, 0.86)
        .setOrigin(0, 0.5);
      this.detail.add([text, back, fill]);
    });

    const special = this.add.text(0, 150, `SPECIAL  ${fighter.specialName}`, {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '11px',
      color: '#d9e1ea',
      letterSpacing: 1,
      fontStyle: 'bold',
    });
    const superMove = this.add.text(0, 180, `RIFT MOVE  ${fighter.superName}`, {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '11px',
      color: fighter.accentCss,
      letterSpacing: 1,
      fontStyle: 'bold',
    });
    this.detail.add([special, superMove]);
  }

  private changeSelection(direction: number): void {
    if (this.locked) return;
    const index = FIGHTER_ORDER.indexOf(this.selection);
    this.setSelection(FIGHTER_ORDER[Phaser.Math.Wrap(index + direction, 0, FIGHTER_ORDER.length)]);
  }

  private setSelection(fighterId: FighterId): void {
    if (this.locked || fighterId === this.selection) return;
    this.selection = fighterId;
    this.soundClick(FIGHTERS[fighterId].accentCss);
    this.refresh();
  }

  private toggleMode(): void {
    if (this.locked) return;
    this.mode = this.mode === 'cpu' ? 'local' : 'cpu';
    this.refresh();
    this.soundClick('#d1ad61');
  }

  private confirm(): void {
    if (this.locked) return;
    this.locked = true;
    const live = document.getElementById('fight-live');
    if (live) live.textContent = `${FIGHTERS[this.selection].name} locked. Entering the Shattered Tribunal.`;
    const selectedCard = this.cards.get(this.selection);
    if (selectedCard) {
      this.cameras.main.flash(180, 210, 240, 255, false);
      this.tweens.add({
        targets: selectedCard,
        scaleX: 1.12,
        scaleY: 1.12,
        duration: 180,
        yoyo: true,
      });
    }
    this.confirmHint.setText(`${FIGHTERS[this.selection].name}  //  LOCKED`);
    this.time.delayedCall(520, () => {
      const playerTwo = rivalOf(this.selection);
      this.cameras.main.fadeOut(320, 0, 0, 0);
      this.time.delayedCall(330, () => {
        this.scene.start('FightScene', {
          playerOne: this.selection,
          playerTwo,
          mode: this.mode,
        } satisfies FightLaunchData);
      });
    });
  }

  private soundClick(color: string): void {
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = color.includes('ff') ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(240, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(540, context.currentTime + 0.06);
    gain.gain.setValueAtTime(0.04, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.085);
    oscillator.addEventListener('ended', () => void context.close(), { once: true });
  }
}
