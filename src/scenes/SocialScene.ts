import Phaser from 'phaser';
import { VIEW } from '../config';
import {
  beginOAuth,
  claimSocialGift,
  connectFriendCode,
  getAuthProviders,
  getPlatformAccount,
  getSocialGifts,
  getSocialSnapshot,
  sendSocialGift,
  SocialConnection,
  type SocialFriend,
  type SocialGift,
  type SocialSnapshot,
} from '../game/platform';
import { SFX } from '../game/sfx';
import { requestTextInput } from '../gfx/dom';
import {
  addAmbientMotes,
  addArtButton,
  addArtPanel,
  addWorldBackground,
  DISPLAY_FONT,
  fitText,
  sharpenSceneText,
  TYPE,
  UI_FONT,
} from '../gfx/ui';

export class SocialScene extends Phaser.Scene {
  private social?: SocialSnapshot;
  private gifts: SocialGift[] = [];
  private socket?: SocialConnection;
  private status?: Phaser.GameObjects.Text;
  private content?: Phaser.GameObjects.Container;
  private loading = false;

  constructor() { super('Social'); }

  create(): void {
    addWorldBackground(this, 'world_nexus', 0.2);
    addAmbientMotes(this, 0x7deeff, 14, 2);
    this.add.text(34, 38, '‹  MENU', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#e9edfa', fontStyle: 'bold',
    }).setDepth(20).setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.start('Menu'));
    this.add.text(VIEW.width / 2, 68, 'REALM CONNECTIONS', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold', stroke: '#211743', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(10);
    this.status = this.add.text(VIEW.width / 2, 116, 'CONNECTING TO THE SOCIAL REALM…', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe7a6', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5).setDepth(10);
    this.content = this.add.container(0, 0).setDepth(10);
    void this.loadSocial();
    sharpenSceneText(this);
  }

  private async loadSocial(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const account = await getPlatformAccount(true);
    if (!this.scene.isActive()) return;
    if (!account) {
      this.status?.setText('SIGN IN TO CONNECT FRIENDS, GIFTS AND LIVE PRESENCE').setColor('#ffc879');
      await this.drawSignIn();
      this.loading = false;
      return;
    }
    try {
      const [social, gifts] = await Promise.all([getSocialSnapshot(), getSocialGifts()]);
      if (!this.scene.isActive()) return;
      this.social = social;
      this.gifts = gifts;
      this.status?.setText('●  REALTIME SOCIAL REALM ONLINE').setColor('#7ff1d0');
      this.drawConnected();
      this.connectRealtime();
    } catch (error) {
      if (this.scene.isActive()) {
        this.status?.setText('SOCIAL BACKEND OFFLINE — LOCAL GAME REMAINS PLAYABLE').setColor('#ffc879');
        this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'SOCIAL CONNECTION FAILED', 0xffc879);
      }
    } finally { this.loading = false; }
  }

  private async drawSignIn(): Promise<void> {
    this.content?.removeAll(true);
    addArtPanel(this, VIEW.width / 2, 370, 640, 400, 5, 0.98);
    this.add.text(VIEW.width / 2, 302, 'ONE ACCOUNT · EVERY REALM', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
    this.add.text(VIEW.width / 2, 356, 'Cloud inventory, live 1v1, friend presence and gift hampers\nuse the same secure account. Guest play stays available.', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#cfdaea', align: 'center', lineSpacing: 7,
    }).setOrigin(0.5).setDepth(12);
    const providers = await getAuthProviders().catch(() => []);
    if (!this.scene.isActive()) return;
    const google = providers.find(({ provider }) => provider === 'google');
    const facebook = providers.find(({ provider }) => provider === 'facebook');
    addArtButton(this, 210, 432, google?.configured ? 'CONTINUE WITH GOOGLE' : 'GOOGLE · SETUP REQUIRED', () => {
      if (google?.configured) beginOAuth('google'); else this.toast('GOOGLE OAUTH CREDENTIALS ARE NOT CONNECTED YET', 0xffc879);
    }, 300, 62, 12);
    addArtButton(this, 510, 432, facebook?.configured ? 'CONTINUE WITH FACEBOOK' : 'FACEBOOK · SETUP REQUIRED', () => {
      if (facebook?.configured) beginOAuth('facebook'); else this.toast('FACEBOOK APP CREDENTIALS ARE NOT CONNECTED YET', 0xffc879);
    }, 300, 62, 12);
    addArtButton(this, VIEW.width / 2, 506, 'EMAIL ACCOUNT', () => this.scene.start('Account'), 360, 58, 12);
  }

  private drawConnected(): void {
    if (!this.social) return;
    this.content?.removeAll(true);
    addArtPanel(this, VIEW.width / 2, 232, 640, 170, 5, 0.98);
    this.add.text(62, 182, 'YOUR FRIEND CODE', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#a9bad0', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(12);
    this.add.text(62, 222, this.social.friendCode, {
      fontFamily: 'monospace', fontSize: '30px', color: '#7ff1d0', fontStyle: 'bold', letterSpacing: 4,
    }).setDepth(12);
    addArtButton(this, 535, 226, 'ADD FRIEND', () => void this.addFriend(), 250, 58, 12);

    this.add.text(48, 346, `CONNECTED KEEPERS  ·  ${this.social.friends.length}`, {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(12);
    addArtPanel(this, VIEW.width / 2, 514, 640, 270, 5, 0.96);
    this.drawFriends(this.social.friends);

    const pending = this.gifts.filter(({ status }) => status === 'pending');
    this.add.text(48, 690, `GIFT INBOX  ·  ${pending.length} READY`, {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(12);
    addArtPanel(this, VIEW.width / 2, 888, 640, 340, 5, 0.96);
    this.drawGifts(pending);
    addArtButton(this, 190, 1120, 'SEND FRIENDSHIP HAMPER', () => void this.chooseGift('friendship_hamper'), 300, 58, 12);
    addArtButton(this, 530, 1120, 'SEND ROYAL HAMPER', () => void this.chooseGift('royal_hamper'), 300, 58, 12);
    this.add.text(VIEW.width / 2, 1180, '◆ 420 COINS  ·  FRIENDSHIP     ◈ 75 DIAMONDS  ·  ROYAL', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b8c8dc', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12);
  }

  private drawFriends(friends: SocialFriend[]): void {
    if (!friends.length) {
      this.add.text(VIEW.width / 2, 514, 'Share your friend code or enter another Keeper’s code.\nConnections unlock live presence and gift hampers.', {
        fontFamily: UI_FONT, fontSize: TYPE.body, color: '#cbd6e5', align: 'center', lineSpacing: 8,
      }).setOrigin(0.5).setDepth(12);
      return;
    }
    friends.slice(0, 4).forEach((friend, index) => {
      const y = 420 + index * 58;
      this.add.circle(74, y, 7, friend.online ? 0x7ff1d0 : 0x73859d, 1).setDepth(12);
      fitText(this.add.text(96, y, friend.displayName, {
        fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0, 0.5).setDepth(12), 300, 0.68);
      this.add.text(626, y, friend.online ? 'ONLINE' : 'AWAY', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: friend.online ? '#7ff1d0' : '#8da0b8', fontStyle: 'bold',
      }).setOrigin(1, 0.5).setDepth(12);
    });
  }

  private drawGifts(gifts: SocialGift[]): void {
    if (!gifts.length) {
      this.add.text(VIEW.width / 2, 888, 'No unopened gifts.\nConnect with friends and send supplies across the realms.', {
        fontFamily: UI_FONT, fontSize: TYPE.body, color: '#cbd6e5', align: 'center', lineSpacing: 8,
      }).setOrigin(0.5).setDepth(12);
      return;
    }
    gifts.slice(0, 3).forEach((gift, index) => {
      const y = 790 + index * 94;
      fitText(this.add.text(72, y - 16, `${gift.title}  ·  ${gift.senderName}`, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe7a6', fontStyle: 'bold',
      }).setDepth(12), 410, 0.68);
      this.add.text(72, y + 18, gift.message || 'A Keeper sent supplies for your next stage.', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b9c8dc',
      }).setDepth(12);
      addArtButton(this, 590, y, 'CLAIM', () => void this.claimGift(gift.giftId), 130, 48, 12);
    });
  }

  private async addFriend(): Promise<void> {
    const code = await requestTextInput({ title: 'ENTER FRIEND CODE', placeholder: 'ABC12345', type: 'text', maxLength: 12 });
    if (!code || !this.scene.isActive()) return;
    try {
      this.social = await connectFriendCode(code);
      if (!this.scene.isActive()) return;
      SFX.win(); this.scene.restart();
    } catch (error) { this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'CONNECTION FAILED', 0xff756f); }
  }

  private async chooseGift(offerId: SocialGift['offerId']): Promise<void> {
    const friends = this.social?.friends ?? [];
    if (!friends.length) { this.toast('ADD A FRIEND BEFORE SENDING A HAMPER', 0xffc879); return; }
    const code = await requestTextInput({ title: 'RECIPIENT FRIEND CODE', placeholder: friends[0].friendCode, type: 'text', maxLength: 12 });
    if (!code || !this.scene.isActive()) return;
    const friend = friends.find((candidate) => candidate.friendCode.toUpperCase() === code.trim().toUpperCase());
    if (!friend) { this.toast('THAT CODE IS NOT IN YOUR FRIEND LIST', 0xff756f); return; }
    const message = await requestTextInput({ title: 'GIFT MESSAGE', placeholder: 'For your next realm!', type: 'text', maxLength: 80 });
    if (!this.scene.isActive()) return;
    try {
      await sendSocialGift(friend.userId, offerId, message ?? '');
      if (!this.scene.isActive()) return;
      SFX.win(); this.toast(`HAMPER SENT TO ${friend.displayName.toUpperCase()}`, 0x7ff1d0);
    } catch (error) { this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'GIFT FAILED', 0xff756f); }
  }

  private async claimGift(giftId: string): Promise<void> {
    try {
      await claimSocialGift(giftId);
      this.gifts = await getSocialGifts();
      if (!this.scene.isActive()) return;
      SFX.win(); this.scene.restart();
    } catch (error) { this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'CLAIM FAILED', 0xff756f); }
  }

  private connectRealtime(): void {
    this.socket?.close();
    this.socket = new SocialConnection();
    this.socket.connect((message) => {
      if (!this.scene.isActive()) return;
      if (message.type === 'social-gift-received' || message.type === 'social-friend-connected') this.scene.restart();
    }, (state) => this.status?.setText(state === 'open' ? '●  REALTIME SOCIAL REALM ONLINE' : state === 'connecting' ? 'CONNECTING TO REALTIME SOCIAL REALM…' : 'SOCIAL REALM RECONNECTING…')
      .setColor(state === 'open' ? '#7ff1d0' : '#ffc879'));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.socket?.close());
  }

  private toast(message: string, color: number): void {
    const text = this.add.text(VIEW.width / 2, VIEW.height - 34, message, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#fff7e8', backgroundColor: 'rgba(8,10,24,0.96)',
      padding: { x: 18, y: 10 }, fontStyle: 'bold', stroke: Phaser.Display.Color.IntegerToColor(color).rgba, strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(60);
    fitText(text, 650, 0.68);
    this.tweens.add({ targets: text, y: text.y - 16, alpha: 0, delay: 1800, duration: 360, onComplete: () => text.destroy() });
  }
}
