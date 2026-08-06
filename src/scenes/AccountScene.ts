import Phaser from 'phaser';
import { VIEW } from '../config';
import {
  getAccountSnapshot,
  useGuestAccount,
  useOnlineAccount,
  type AccountSnapshot,
} from '../game/online';
import { getPlayerSave } from '../game/retention';
import { beginOAuth, getAuthProviders, getPlatformAccount, logoutPlatform, requestEmailOtp, verifyEmailOtp, type AuthProviderStatus, type PlatformAccount } from '../game/platform';
import { requestTextInput } from '../gfx/dom';
import { SFX } from '../game/sfx';
import {
  hasGameplayTelemetryConsent,
  setGameplayTelemetryConsent,
} from '../game/gameplay-telemetry';
import { PHASER_RELEASE_FEATURES } from '../game/release-profile';
import { addAmbientMotes, addArtButton, addArtPanel, addWorldBackground, DISPLAY_FONT, fitText, sharpenSceneText, TYPE, UI_FONT } from '../gfx/ui';

export class AccountScene extends Phaser.Scene {
  private statusText?: Phaser.GameObjects.Text;
  private nameText?: Phaser.GameObjects.Text;
  private recoveryText?: Phaser.GameObjects.Text;
  private detailText?: Phaser.GameObjects.Text;

  constructor() { super('Account'); }

  create(): void {
    const { width } = VIEW;
    addWorldBackground(this, 'world_nexus', 0.2);
    addAmbientMotes(this, 0x9e8cff, 14, 2);
    this.add.text(34, 38, '‹  MENU', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#e9edfa', fontStyle: 'bold',
    }).setDepth(14).setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.start('Menu'));

    this.add.text(width / 2, 72, 'PLAYER ACCOUNT', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold', stroke: '#211743', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(10);
    this.add.text(width / 2, 118, 'ONLINE-PRIMARY  •  GUEST-SAFE  •  CLOUD PERSISTENT', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#cbbdff', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(10);

    addArtPanel(this, width / 2, 300, 640, 290, 5, 0.98);
    this.statusText = this.add.text(width / 2, 246, '', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(10);
    this.nameText = this.add.text(width / 2, 290, '', {
      fontFamily: UI_FONT, fontSize: TYPE.title, color: '#ffffff', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(10);
    this.detailText = this.add.text(width / 2, 342, '', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#b9c7dc', fontStyle: 'bold', align: 'center', lineSpacing: 6,
    }).setOrigin(0.5).setDepth(10);
    this.recoveryText = this.add.text(width / 2, 382, '', {
      fontFamily: 'monospace', fontSize: TYPE.body, color: '#7ff1d0', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(10);

    addArtPanel(this, width / 2, 600, 640, 300, 5, 0.96);
    addArtButton(this, 190, 548, 'EMAIL LOGIN / UPGRADE', () => void this.emailLogin(), 290, 58, 12);
    addArtButton(this, 530, 548, 'PLAY AS GUEST', () => this.goGuest(), 290, 58, 12);
    addArtButton(this, 190, 620, 'SECURE CLOUD SYNC', () => void this.goOnline(), 290, 58, 12);
    addArtButton(this, 530, 620, 'SIGN OUT', () => void this.signOut(), 290, 58, 12);
    addArtButton(this, 190, 692, 'CONTINUE WITH GOOGLE', () => void this.socialLogin('google'), 290, 58, 12);
    addArtButton(this, 530, 692, 'CONTINUE WITH FACEBOOK', () => void this.socialLogin('facebook'), 290, 58, 12);

    addArtPanel(this, width / 2, 900, 640, 300, 5, 0.96);
    this.add.text(width / 2, 866, 'Sign in with your verified email on every device.\nThe browser keeps authentication inside a secure HttpOnly cookie.', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#c4d0e1', align: 'center', lineSpacing: 5,
      wordWrap: { width: 520 },
    }).setOrigin(0.5).setDepth(10);
    addArtButton(this, width / 2, 940, 'EMAIL SIGN-IN', () => void this.emailLogin(), 390, 62, 12);
    const analyticsEnabled = hasGameplayTelemetryConsent();
    addArtButton(this, width / 2, 1004, `ANONYMOUS GAMEPLAY DATA  ${analyticsEnabled ? 'ON' : 'OFF'}`, () => {
      SFX.click();
      setGameplayTelemetryConsent(!hasGameplayTelemetryConsent());
      this.scene.restart();
    }, 430, 54, 12);
    this.add.text(width / 2, 1068, 'Optional and anonymous • never camera frames, landmarks, aim coordinates or email', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#9facc0', fontStyle: 'bold', align: 'center',
      wordWrap: { width: 610 },
    }).setOrigin(0.5).setDepth(10);

    if (PHASER_RELEASE_FEATURES.completeGameplay) {
      addArtButton(this, 190, 1150, 'MY INVENTORY', () => {
        SFX.click();
        this.scene.start('Inventory');
      }, 290, 62, 12);
      addArtButton(this, 530, 1150, 'RELIC STORE', () => {
        SFX.click();
        this.scene.start('Store');
      }, 290, 62, 12);
    }
    this.add.text(width / 2, 1188, 'Guest progress stays on this device. Online accounts sync whenever the connection returns.', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#aebdd0', fontStyle: 'bold', align: 'center', wordWrap: { width: 610 },
    }).setOrigin(0.5).setDepth(10);

    this.renderAccount(getAccountSnapshot());
    void this.refreshPlatform();
    sharpenSceneText(this);
  }

  private renderPlatform(account: PlatformAccount): void {
    this.statusText?.setText('●  VERIFIED EMAIL ACCOUNT').setColor('#7ff1d0');
    this.nameText?.setText(account.displayName);
    this.detailText?.setText(`ACCOUNT  ${account.userId}\n◆ ${account.wallet.coins.toLocaleString()} COINS   •   ◈ ${account.wallet.diamonds.toLocaleString()} DIAMONDS\nSERVER WALLET REVISION ${account.wallet.revision}`);
    this.recoveryText?.setText('HTTPONLY SESSION  •  CSRF PROTECTED');
  }

  private async refreshPlatform(): Promise<void> {
    const account = await getPlatformAccount(true);
    if (account && this.scene.isActive()) this.renderPlatform(account);
  }

  private async emailLogin(): Promise<void> {
    SFX.click();
    const email = await requestTextInput({ title: 'EMAIL SIGN-IN', placeholder: 'you@example.com', type: 'email', maxLength: 254 });
    if (!email || !this.scene.isActive()) return;
    this.statusText?.setText('◌  SENDING SECURE CODE…').setColor('#ffe7a6');
    try {
      const challenge = await requestEmailOtp(email);
      const code = challenge.developmentCode ?? await requestTextInput({ title: 'ENTER 6-DIGIT CODE', placeholder: '000000', type: 'text', maxLength: 6 });
      if (!code || !this.scene.isActive()) return;
      const account = await verifyEmailOtp(challenge.challengeId, code, getPlayerSave().displayName);
      if (!this.scene.isActive()) return;
      this.renderPlatform(account);
      this.toast('EMAIL VERIFIED — PROGRESS AND WALLET ARE CLOUD-PERSISTENT', 0x7ff1d0);
    } catch (error) {
      if (!this.scene.isActive()) return;
      this.renderAccount(getAccountSnapshot());
      this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'EMAIL LOGIN FAILED', 0xff756f);
    }
  }

  private async socialLogin(provider: AuthProviderStatus['provider']): Promise<void> {
    SFX.click();
    try {
      const configured = (await getAuthProviders()).find((candidate) => candidate.provider === provider)?.configured;
      if (!configured) throw new Error(`${provider}-oauth-setup-required`);
      beginOAuth(provider);
    } catch (error) {
      if (this.scene.isActive()) this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'SOCIAL LOGIN FAILED', 0xffc879);
    }
  }

  private renderAccount(account: AccountSnapshot): void {
    const colors: Record<AccountSnapshot['connection'], string> = {
      online: '#7ff1d0', offline: '#ffc879', connecting: '#ffe7a6', guest: '#b9c7dc',
    };
    const labels: Record<AccountSnapshot['connection'], string> = {
      online: '●  ONLINE ACCOUNT', offline: '○  OFFLINE — LOCAL SAVE ACTIVE', connecting: '◌  CONNECTING SECURELY…', guest: '◇  GUEST MODE',
    };
    this.statusText?.setText(labels[account.connection]).setColor(colors[account.connection]);
    this.nameText?.setText(account.displayName);
    const player = account.playerId.length > 22 ? `${account.playerId.slice(0, 11)}…${account.playerId.slice(-8)}` : account.playerId;
    const sync = account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString() : 'NOT YET SYNCED';
    this.detailText?.setText(`PLAYER ID  ${player}\nLAST CLOUD SYNC  ${sync}`);
    const protection = account.mode === 'guest'
      ? 'GUEST MODE — LOCAL SAVE ONLY'
      : 'HTTPONLY SESSION  •  NO TOKEN STORED IN BROWSER DATA';
    fitText(this.recoveryText?.setText(protection) as Phaser.GameObjects.Text, 560, 0.62);
  }

  private async goOnline(sound = true): Promise<void> {
    if (sound) SFX.click();
    const pending = getAccountSnapshot();
    this.renderAccount({ ...pending, mode: 'online', connection: 'connecting' });
    const result = await useOnlineAccount();
    if (!this.scene.isActive()) return;
    this.renderAccount(result.account);
    this.toast(result.online ? 'CLOUD ACCOUNT IS UP TO DATE' : 'OFFLINE — PROGRESS REMAINS SAFE ON THIS DEVICE', result.online ? 0x7ff1d0 : 0xffc879);
  }

  private goGuest(): void {
    SFX.click();
    this.renderAccount(useGuestAccount());
    this.toast('GUEST MODE ACTIVE — FULL OFFLINE PLAY AVAILABLE', 0xb9c7dc);
  }

  private async signOut(): Promise<void> {
    SFX.click();
    try { await logoutPlatform(); } catch { /* an expired session is already signed out */ }
    if (!this.scene.isActive()) return;
    this.renderAccount(useGuestAccount());
    this.toast('SIGNED OUT — LOCAL GUEST SAVE REMAINS AVAILABLE', 0xb9c7dc);
  }

  private toast(message: string, color: number): void {
    const text = this.add.text(VIEW.width / 2, VIEW.height - 36, message, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#fff7e8', backgroundColor: 'rgba(8,10,24,0.96)',
      padding: { x: 18, y: 10 }, fontStyle: 'bold', stroke: Phaser.Display.Color.IntegerToColor(color).rgba, strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(50);
    fitText(text, 650, 0.72);
    this.tweens.add({ targets: text, y: text.y - 16, alpha: 0, delay: 1800, duration: 360, onComplete: () => text.destroy() });
  }
}
