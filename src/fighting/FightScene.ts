import Phaser from 'phaser';
import {
  createMatch,
  EMPTY_FIGHTER_INPUT,
  getAttackPhase,
  isAttackActive,
  stepMatch,
  type AttackKind,
  type CombatEvent,
  type FighterId as CombatFighterId,
  type FighterInput,
  type FighterState,
  type MatchInputs,
  type MatchState,
} from './combat';
import { FightAudio } from './audio';
import { FightEffects } from './effects';
import { FightHud, type FighterHudState } from './hud';
import { FightInput, isCoarsePointer } from './input';
import { FIGHTERS, type FighterDefinition, type FighterId } from './roster';
import { TouchControls } from './touch-controls';
import type { FightLaunchData } from './FighterSelectScene';

const W = 1280;
const H = 720;
const FIXED_STEP_MS = 1000 / 60;

interface FighterVisual {
  definition: FighterDefinition;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  baseScaleX: number;
  baseScaleY: number;
  baseFacing: -1 | 1;
}

function profileFor(fighter: FighterId): {
  maxHealth: number;
  speedScale: number;
  damageScale: number;
  defenseScale: number;
} {
  return fighter === 'kael'
    ? { maxHealth: 96, speedScale: 1.09, damageScale: 0.98, defenseScale: 0.98 }
    : { maxHealth: 108, speedScale: 0.94, damageScale: 1.08, defenseScale: 1.06 };
}

export class FightScene extends Phaser.Scene {
  private launchData: FightLaunchData = {
    playerOne: 'kael',
    playerTwo: 'nyra',
    mode: 'cpu',
  };
  private match!: MatchState;
  private controls!: FightInput;
  private touchControls!: TouchControls;
  private effects!: FightEffects;
  private fightAudio!: FightAudio;
  private hud!: FightHud;
  private visuals!: Record<CombatFighterId, FighterVisual>;
  private pauseOverlay!: Phaser.GameObjects.Container;
  private resultOverlay: Phaser.GameObjects.Container | null = null;
  private music: Phaser.Sound.BaseSound | null = null;
  private accumulator = 0;
  private paused = false;
  private hitStopFrames = 0;
  private cpuDecisionFrames = 0;
  private cpuAttack: AttackKind | null = null;
  private touchVisible = false;

  constructor() {
    super('FightScene');
  }

  init(data: Partial<FightLaunchData>): void {
    this.launchData = {
      playerOne: data.playerOne ?? 'kael',
      playerTwo: data.playerTwo ?? 'nyra',
      mode: data.mode ?? 'cpu',
    };
  }

  create(): void {
    const p1Definition = FIGHTERS[this.launchData.playerOne];
    const p2Definition = FIGHTERS[this.launchData.playerTwo];
    const p2Profile = profileFor(this.launchData.playerTwo);
    if (this.launchData.mode === 'cpu') {
      p2Profile.speedScale *= 0.95;
      p2Profile.damageScale *= 0.82;
    }
    this.match = createMatch({
      p1Profile: profileFor(this.launchData.playerOne),
      p2Profile,
    });
    this.controls = new FightInput(this);
    this.fightAudio = new FightAudio();
    this.effects = new FightEffects(this);
    this.createStage();
    this.visuals = {
      p1: this.createFighterVisual('p1', p1Definition),
      p2: this.createFighterVisual('p2', p2Definition),
    };
    this.hud = new FightHud(this, p1Definition, p2Definition);
    this.touchControls = new TouchControls(this, this.controls);
    this.touchVisible = isCoarsePointer() && this.launchData.mode === 'cpu';
    this.touchControls.setVisible(this.touchVisible);
    this.createControlLegend();
    this.pauseOverlay = this.createPauseOverlay();
    this.installInputEvents();
    this.playMusic();
    this.syncVisuals();
    this.updateHud();
    this.hud.announce('ROUND 1', 'THE SHATTERED TRIBUNAL', '#e7d09b', 720);
    this.announceAccessible(`Round 1. ${p1Definition.name} versus ${p2Definition.name}.`);
    this.cameras.main.fadeIn(360, 0, 0, 0);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.music?.stop();
      this.music = null;
      this.fightAudio.destroy();
      this.touchControls.destroy();
      this.effects.destroy();
    });
  }

  update(_time: number, delta: number): void {
    this.pollGamepadPause();
    if (this.paused || this.match.phase === 'match-over') {
      this.syncVisuals();
      return;
    }

    if (this.hitStopFrames > 0) {
      this.hitStopFrames -= 1;
      this.syncVisuals();
      this.updateHud();
      return;
    }

    this.accumulator = Math.min(this.accumulator + delta, FIXED_STEP_MS * 5);
    while (this.accumulator >= FIXED_STEP_MS) {
      this.accumulator -= FIXED_STEP_MS;
      const matchInputs: MatchInputs = {
        p1: this.toCombatInput(this.controls.read(0)),
        p2: this.launchData.mode === 'cpu'
          ? this.getCpuInput()
          : this.toCombatInput(this.controls.read(1)),
      };
      stepMatch(this.match, matchInputs);
      this.processEvents(this.match.events);
    }
    this.syncVisuals();
    this.updateHud();
  }

  private createStage(): void {
    const background = this.add.image(W / 2, H / 2, 'fight-stage')
      .setDisplaySize(W, H)
      .setDepth(-20);
    this.tweens.add({
      targets: background,
      scaleX: background.scaleX * 1.018,
      scaleY: background.scaleY * 1.018,
      duration: 9000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    this.add.rectangle(W / 2, H / 2, W, H, 0x02050a, 0.2).setDepth(-19);
    this.add.ellipse(W / 2, 621, 900, 58, 0x000000, 0.42).setDepth(-2);
    const floorGlint = this.add.rectangle(W / 2, 607, 1040, 2, 0xb8d5df, 0.18).setDepth(-1);
    this.tweens.add({
      targets: floorGlint,
      alpha: { from: 0.08, to: 0.25 },
      duration: 2100,
      yoyo: true,
      repeat: -1,
    });

    for (let index = 0; index < 55; index += 1) {
      const rain = this.add.rectangle(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(-H, H),
        1,
        Phaser.Math.Between(10, 28),
        0xb8d8e8,
        Phaser.Math.FloatBetween(0.08, 0.25),
      ).setRotation(-0.13).setDepth(-4);
      this.tweens.add({
        targets: rain,
        y: H + 40,
        x: rain.x - Phaser.Math.Between(38, 70),
        duration: Phaser.Math.Between(850, 1550),
        delay: Phaser.Math.Between(0, 1300),
        repeat: -1,
      });
    }

    this.time.addEvent({
      delay: 7000,
      loop: true,
      callback: () => {
        if (this.paused || Phaser.Math.Between(0, 2) !== 0) return;
        this.cameras.main.flash(90, 110, 155, 190, true);
      },
    });
  }

  private createFighterVisual(id: CombatFighterId, definition: FighterDefinition): FighterVisual {
    const state = this.match.fighters[id];
    const shadow = this.add.ellipse(state.x, state.y + 5, 154, 26, 0x000000, 0.56).setDepth(2);
    const sprite = this.add.image(state.x, state.y, definition.assetKey)
      .setOrigin(0.5, 1)
      .setDepth(10);
    const targetHeight = definition.id === 'kael' ? 506 : 498;
    sprite.setScale(targetHeight / sprite.height);
    const visual: FighterVisual = {
      definition,
      sprite,
      shadow,
      baseScaleX: sprite.scaleX,
      baseScaleY: sprite.scaleY,
      baseFacing: definition.id === 'kael' ? 1 : -1,
    };
    sprite.setFlipX(state.facing !== visual.baseFacing);
    return visual;
  }

  private createControlLegend(): void {
    const text = this.launchData.mode === 'cpu'
      ? 'P1  A/D MOVE · W JUMP · S CROUCH · SHIFT BLOCK · J LIGHT · K HEAVY · L RIFT'
      : 'P1  A/D/W/S · SHIFT + J/K/L     //     P2  ARROWS · NUM 0 + NUM 1/2/3';
    this.add.text(W / 2, H - 14, `${text}     •     ESC PAUSE · T TOUCH UI`, {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '8px',
      color: '#b8c5d2',
      letterSpacing: 1,
      fontStyle: 'bold',
      backgroundColor: 'rgba(2,5,9,.58)',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5, 1).setDepth(1500);
  }

  private installInputEvents(): void {
    this.input.once('pointerdown', () => this.fightAudio.unlock());
    this.input.keyboard?.once('keydown', () => this.fightAudio.unlock());
    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
    this.input.keyboard?.on('keydown-T', () => {
      if (this.launchData.mode !== 'cpu') return;
      this.touchVisible = !this.touchVisible;
      this.touchControls.setVisible(this.touchVisible);
    });
  }

  private playMusic(): void {
    if (!this.cache.audio.exists('fight-music')) return;
    this.sound.setVolume(1);
    this.music = this.sound.add('fight-music', { loop: true, volume: 0.16 });
    this.music.play();
  }

  private toCombatInput(buttons: ReturnType<FightInput['read']>): FighterInput {
    const moveValue = Number(buttons.right) - Number(buttons.left);
    const move = (moveValue < 0 ? -1 : moveValue > 0 ? 1 : 0) as -1 | 0 | 1;
    const attack: AttackKind | null = buttons.special
      ? 'special'
      : buttons.heavy
        ? 'heavy'
        : buttons.light
          ? 'light'
          : null;
    return {
      move,
      jump: buttons.up,
      crouch: buttons.down,
      block: buttons.block,
      attack,
    };
  }

  private getCpuInput(): FighterInput {
    if (this.match.phase !== 'fighting') {
      this.cpuAttack = null;
      return { ...EMPTY_FIGHTER_INPUT };
    }
    const cpu = this.match.fighters.p2;
    const opponent = this.match.fighters.p1;
    const distance = Math.abs(cpu.x - opponent.x);
    const toward = (opponent.x > cpu.x ? 1 : -1) as -1 | 1;
    const opponentThreat = isAttackActive(opponent)
      || (opponent.currentAttack !== null && distance < 175);
    this.cpuDecisionFrames -= 1;
    let attack = this.cpuAttack;
    this.cpuAttack = null;

    if (cpu.hitstunFrames > 0 || cpu.blockstunFrames > 0 || cpu.currentAttack) {
      return { ...EMPTY_FIGHTER_INPUT };
    }
    if (opponentThreat && distance < 245 && this.deterministicChance(0.74, 17)) {
      return { ...EMPTY_FIGHTER_INPUT, block: true, crouch: this.deterministicChance(0.28, 19) };
    }
    if (this.cpuDecisionFrames <= 0) {
      this.cpuDecisionFrames = 15 + (this.match.frame % 17);
      if (distance <= 290) {
        if (cpu.meter >= 30 && this.deterministicChance(0.28, 23)) attack = 'special';
        else if (distance < 255 && this.deterministicChance(0.38, 29)) attack = 'heavy';
        else if (distance < 235) attack = 'light';
      }
      this.cpuAttack = attack;
    }
    if (attack) {
      return { ...EMPTY_FIGHTER_INPUT, attack };
    }
    if (distance > 225) {
      return { ...EMPTY_FIGHTER_INPUT, move: toward };
    }
    if (distance < 190) {
      return { ...EMPTY_FIGHTER_INPUT, move: (toward * -1) as -1 | 1 };
    }
    return {
      ...EMPTY_FIGHTER_INPUT,
      block: this.deterministicChance(0.12, 31),
      jump: distance > 250 && this.deterministicChance(0.025, 37),
    };
  }

  private deterministicChance(chance: number, salt: number): boolean {
    const value = Math.abs(Math.sin((this.match.frame + salt) * 12.9898) * 43758.5453) % 1;
    return value < chance;
  }

  private processEvents(events: CombatEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'round-started':
          this.hud.announce(`ROUND ${event.round}`, 'THE SHATTERED TRIBUNAL', '#e7d09b', 680);
          this.announceAccessible(`Round ${event.round}.`);
          this.fightAudio.roundCall();
          break;
        case 'fight-called':
          this.hud.announce('FIGHT', '', '#ffffff', 360);
          this.announceAccessible('Fight.');
          this.fightAudio.roundCall();
          break;
        case 'attack-started':
          if (event.attack === 'special') this.onSpecialStarted(event);
          break;
        case 'hit':
          this.onHit(event);
          break;
        case 'blocked':
          this.onBlocked(event);
          break;
        case 'guard-broken': {
          const visual = this.visuals[event.fighter];
          this.effects.impact(visual.sprite.x, visual.sprite.y - 260, 0xf6d27a, 'heavy');
          this.hud.announce('GUARD BREAK', '', '#f6d27a', 300);
          this.announceAccessible(`${this.visuals[event.fighter].definition.name} guard broken.`);
          this.cameras.main.shake(125, 0.008);
          break;
        }
        case 'landed': {
          const visual = this.visuals[event.fighter];
          this.effects.groundBurst(visual.sprite.x, visual.definition.accent);
          break;
        }
        case 'round-ended':
          this.onRoundEnded(event);
          break;
        case 'match-ended':
          this.showMatchResult(event.winner);
          break;
        default:
          break;
      }
    }
  }

  private onSpecialStarted(
    event: Extract<CombatEvent, { type: 'attack-started' }>,
  ): void {
    const source = this.visuals[event.fighter];
    const targetId: CombatFighterId = event.fighter === 'p1' ? 'p2' : 'p1';
    const target = this.visuals[targetId];
    this.fightAudio.special(source.definition.id === 'kael' ? 'cyan' : 'ember');
    this.effects.specialTrail(
      source.sprite.x + this.match.fighters[event.fighter].facing * 40,
      source.sprite.y - 245,
      target.sprite.x,
      target.sprite.y - 235,
      source.definition.accent,
    );
    if (event.enhanced) {
      this.hud.announce(source.definition.superName, 'RIFT MOVE', source.definition.accentCss, 430);
      this.cameras.main.flash(135, 150, 210, 255, true);
    }
  }

  private onHit(event: Extract<CombatEvent, { type: 'hit' }>): void {
    const source = this.visuals[event.source];
    const target = this.visuals[event.target];
    const weight = event.enhanced ? 'special' : event.attack;
    this.effects.impact(
      target.sprite.x,
      target.sprite.y - (this.match.fighters[event.target].crouching ? 175 : 250),
      source.definition.accent,
      weight,
    );
    this.fightAudio.hit(weight);
    this.hitStopFrames = event.attack === 'light' ? 3 : event.enhanced ? 9 : event.attack === 'heavy' ? 6 : 7;
    this.cameras.main.shake(
      event.enhanced ? 180 : event.attack === 'light' ? 70 : 125,
      event.enhanced ? 0.015 : event.attack === 'light' ? 0.004 : 0.009,
    );
    target.sprite.setTintFill(0xffffff);
    this.time.delayedCall(event.attack === 'light' ? 55 : 85, () => target.sprite.clearTint());
  }

  private onBlocked(event: Extract<CombatEvent, { type: 'blocked' }>): void {
    const source = this.visuals[event.source];
    const target = this.visuals[event.target];
    this.effects.guard(target.sprite.x, target.sprite.y - 235, target.definition.accent);
    this.fightAudio.blocked();
    this.hitStopFrames = event.attack === 'light' ? 2 : 4;
    this.cameras.main.shake(55, 0.003);
    source.sprite.setAlpha(0.88);
    this.time.delayedCall(50, () => source.sprite.setAlpha(1));
  }

  private onRoundEnded(event: Extract<CombatEvent, { type: 'round-ended' }>): void {
    if (event.reason === 'knockout') {
      this.hud.announce('KNOCKOUT', '', '#f3d07b', 980);
      this.announceAccessible('Knockout.');
      this.fightAudio.knockout();
      this.cameras.main.shake(360, 0.012);
    } else if (event.reason === 'timeout') {
      this.hud.announce('TIME', event.winner ? 'JUDGEMENT RENDERED' : 'DRAW', '#f3d07b', 850);
      this.announceAccessible(event.winner ? 'Time. Judgement rendered.' : 'Time. Draw.');
    } else {
      this.hud.announce('DRAW', 'THE OATH REMAINS', '#f3d07b', 850);
      this.announceAccessible('Round draw.');
    }
  }

  private syncVisuals(): void {
    this.syncFighter('p1');
    this.syncFighter('p2');
  }

  private syncFighter(id: CombatFighterId): void {
    const state = this.match.fighters[id];
    const visual = this.visuals[id];
    const sprite = visual.sprite;
    const time = this.match.frame / 60;
    let offsetX = 0;
    let offsetY = 0;
    let rotation = 0;
    let scaleX = visual.baseScaleX;
    let scaleY = visual.baseScaleY;

    if (!state.airborne && !state.crouching && !state.currentAttack && state.hitstunFrames === 0) {
      offsetY = Math.sin(time * 4.6 + (id === 'p1' ? 0 : Math.PI)) * 2.2;
    }
    if (Math.abs(state.velocityX) > 0.8 && !state.currentAttack) {
      rotation = state.facing * 0.025;
      offsetX += state.facing * 4;
    }
    if (state.crouching) {
      scaleY *= 0.83;
      scaleX *= 1.04;
      offsetY += 6;
    }
    if (state.blocking || state.blockstunFrames > 0) {
      rotation = -state.facing * 0.065;
      scaleX *= 0.96;
      offsetX -= state.facing * 8;
    }
    if (state.hitstunFrames > 0) {
      rotation = -state.facing * Math.min(0.13, 0.045 + state.hitstunFrames * 0.002);
      offsetX -= state.facing * 10;
    }
    if (state.defeated) {
      rotation = -state.facing * 1.23;
      offsetY += 28;
      offsetX -= state.facing * 42;
    } else if (state.currentAttack) {
      const phase = getAttackPhase(state.currentAttack);
      const definition = state.currentAttack.kind;
      const drive = phase === 'startup' ? 0.28 : phase === 'active' ? 1 : 0.38;
      const reach = definition === 'light' ? 26 : definition === 'heavy' ? 54 : 78;
      offsetX += state.facing * reach * drive;
      rotation = state.facing * (definition === 'heavy' ? 0.09 : definition === 'special' ? 0.14 : 0.045) * drive;
      scaleX *= 1 + 0.07 * drive;
      scaleY *= 1 - 0.025 * drive;
    }
    if (state.airborne) {
      rotation += state.facing * Phaser.Math.Clamp(state.velocityY * 0.007, -0.06, 0.08);
    }

    sprite
      .setPosition(state.x + offsetX, state.y + offsetY)
      .setScale(scaleX, scaleY)
      .setRotation(rotation)
      .setFlipX(state.facing !== visual.baseFacing);
    visual.shadow
      .setPosition(state.x, this.match.config.groundY + 7)
      .setScale(
        Phaser.Math.Clamp(1 - (this.match.config.groundY - state.y) / 420, 0.42, 1),
        Phaser.Math.Clamp(1 - (this.match.config.groundY - state.y) / 550, 0.5, 1),
      )
      .setAlpha(state.defeated ? 0.34 : 0.56);
    sprite.setDepth(state.x < this.match.fighters[id === 'p1' ? 'p2' : 'p1'].x ? 11 : 10);
  }

  private updateHud(): void {
    this.hud.update(
      this.toHudState(this.match.fighters.p1, this.match.wins.p1),
      this.toHudState(this.match.fighters.p2, this.match.wins.p2),
      this.match.timerFrames / 60,
    );
  }

  private toHudState(fighter: FighterState, wins: number): FighterHudState {
    return {
      health: fighter.health,
      maxHealth: fighter.maxHealth,
      guard: fighter.guard,
      maxGuard: fighter.maxGuard,
      meter: fighter.meter,
      maxMeter: fighter.maxMeter,
      wins,
      combo: fighter.combo,
    };
  }

  private createPauseOverlay(): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0).setDepth(3000).setVisible(false);
    const veil = this.add.rectangle(W / 2, H / 2, W, H, 0x020409, 0.84).setInteractive();
    const panel = this.add.rectangle(W / 2, H / 2, 510, 390, 0x080d15, 0.98)
      .setStrokeStyle(2, 0xd0ad68, 0.72);
    const title = this.add.text(W / 2, 222, 'COMBAT PAUSED', {
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '36px',
      color: '#f4eedf',
    }).setOrigin(0.5);
    const controls = this.add.text(W / 2, 278, 'MOVE  A / D     JUMP  W     CROUCH  S     BLOCK  SHIFT\nLIGHT  J     HEAVY  K     RIFT  L', {
      align: 'center',
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '11px',
      color: '#aebdcc',
      lineSpacing: 10,
    }).setOrigin(0.5);
    container.add([veil, panel, title, controls]);
    container.add(this.createOverlayButton(640, 369, 'RESUME FIGHT', () => this.togglePause(), 0x52d9ff));
    container.add(this.createOverlayButton(640, 430, 'RESTART MATCH', () => {
      this.scene.restart(this.launchData);
    }, 0xe0b769));
    container.add(this.createOverlayButton(640, 491, 'FIGHTER SELECT', () => {
      this.scene.start('FighterSelectScene');
    }, 0xff755e));
    return container;
  }

  private createOverlayButton(
    x: number,
    y: number,
    label: string,
    callback: () => void,
    color: number,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const plate = this.add.rectangle(0, 0, 300, 44, 0x101925, 0.98)
      .setStrokeStyle(1, color, 0.78)
      .setInteractive({ useHandCursor: true });
    const text = this.add.text(0, 0, label, {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '11px',
      color: '#edf4fa',
      letterSpacing: 2,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    plate.on('pointerover', () => plate.setFillStyle(color, 0.24));
    plate.on('pointerout', () => plate.setFillStyle(0x101925, 0.98));
    plate.on('pointerdown', callback);
    container.add([plate, text]);
    return container;
  }

  private togglePause(): void {
    if (this.match.phase === 'match-over') return;
    this.paused = !this.paused;
    this.pauseOverlay.setVisible(this.paused);
    if (this.paused) {
      this.music?.pause();
      this.touchControls.setVisible(false);
    } else {
      this.music?.resume();
      this.touchControls.setVisible(this.touchVisible);
      this.accumulator = 0;
    }
  }

  private pollGamepadPause(): void {
    const pad = this.input.gamepad?.getPad(0);
    const pressed = Boolean(pad?.buttons[9]?.pressed);
    const registryKey = 'fight-start-held';
    const held = this.registry.get(registryKey) === true;
    if (pressed && !held) this.togglePause();
    this.registry.set(registryKey, pressed);
  }

  private showMatchResult(winner: CombatFighterId): void {
    if (this.resultOverlay) return;
    const winnerDefinition = winner === 'p1'
      ? FIGHTERS[this.launchData.playerOne]
      : FIGHTERS[this.launchData.playerTwo];
    this.announceAccessible(`${winnerDefinition.name} wins the match.`);
    const container = this.add.container(0, 0).setDepth(3500);
    const veil = this.add.rectangle(W / 2, H / 2, W, H, 0x010308, 0.74).setInteractive();
    const panel = this.add.rectangle(W / 2, H / 2, 650, 410, 0x070c13, 0.98)
      .setStrokeStyle(2, winnerDefinition.accent, 0.82);
    const eyebrow = this.add.text(W / 2, 180, 'THE OATH IS DECIDED', {
      fontFamily: '"Fusion Sans", Arial, sans-serif',
      fontSize: '10px',
      color: winnerDefinition.accentCss,
      letterSpacing: 4,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const title = this.add.text(W / 2, 260, `${winnerDefinition.name}\nVICTORIOUS`, {
      align: 'center',
      fontFamily: '"PaoPao Display", Georgia, serif',
      fontSize: '43px',
      color: '#f4eedf',
      stroke: '#020409',
      strokeThickness: 6,
      lineSpacing: 3,
    }).setOrigin(0.5);
    const score = this.add.text(
      W / 2,
      345,
      `${this.match.wins.p1}  —  ${this.match.wins.p2}`,
      {
        fontFamily: '"PaoPao Display", Georgia, serif',
        fontSize: '26px',
        color: '#d8c69e',
      },
    ).setOrigin(0.5);
    container.add([veil, panel, eyebrow, title, score]);
    container.add(this.createOverlayButton(540, 445, 'REMATCH', () => {
      this.scene.restart(this.launchData);
    }, winnerDefinition.accent));
    container.add(this.createOverlayButton(740, 445, 'SELECT FIGHTER', () => {
      this.scene.start('FighterSelectScene');
    }, 0xd7b56d));
    container.getAt<Phaser.GameObjects.Container>(container.length - 2).setScale(0.88);
    container.getAt<Phaser.GameObjects.Container>(container.length - 1).setScale(0.88);
    container.setAlpha(0).setScale(1.08);
    this.tweens.add({
      targets: container,
      alpha: 1,
      scale: 1,
      duration: 330,
      ease: 'Back.Out',
    });
    this.resultOverlay = container;
    this.sound.setVolume(0.5);
    this.input.keyboard?.once('keydown-ENTER', () => this.scene.restart(this.launchData));
    this.input.keyboard?.once('keydown-BACKSPACE', () => this.scene.start('FighterSelectScene'));
  }

  private announceAccessible(message: string): void {
    const live = document.getElementById('fight-live');
    if (live) live.textContent = message;
  }
}
