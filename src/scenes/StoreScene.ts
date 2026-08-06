import Phaser from 'phaser';
import { VIEW } from '../config';
import { applyServerInventoryGrant, getInventory, STORE_OFFERS, type StoreOffer } from '../game/inventory';
import { applyServerWallet, ARTIFACTS, equipArtifact, getMeta, grantArtifactOwnership, type ArtifactDef } from '../game/meta';
import { scheduleOnlineSync } from '../game/online';
import { exchangeCoinsForDiamonds, getPlatformAccount, purchaseOffer } from '../game/platform';
import { SFX } from '../game/sfx';
import { addAmbientMotes, addArtButton, addArtPanel, addIconFrame, addWorldBackground, DISPLAY_FONT, fitText, sharpenSceneText, TYPE, UI_COLORS, UI_FONT } from '../gfx/ui';

export class StoreScene extends Phaser.Scene {
  private checkoutLocked = false;
  private walletText?: Phaser.GameObjects.Text;

  constructor() {
    super('Store');
  }

  create(): void {
    this.checkoutLocked = false;
    const { width, height } = VIEW;
    const meta = getMeta();
    const inventory = getInventory(meta);
    this.cameras.main.fadeIn(180, 0, 0, 0);
    addWorldBackground(this, 'world_emerald', 0.29);
    addAmbientMotes(this, 0x70ef98, 22, 2);

    addArtPanel(this, width / 2, 115, 620, 210, 8, 0.97);
    this.add.text(width / 2, 92, 'ARTIFACT VAULT', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#73f4a1', fontStyle: 'bold', stroke: '#113a31', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 10);
    this.add.text(width / 2, 142, `${meta.ownedArtifacts.length} / ${ARTIFACTS.length} RELICS OWNED   •   ONE ACTIVE SUPER EQUIPPED`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#d9e4ef', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);

    addArtButton(this, 86, 47, '‹  MENU', () => {
      SFX.click();
      this.scene.start('Menu');
    }, 140, 50, 18);
    this.walletText = this.add.text(width / 2, 187, `◆ ${meta.coins.toLocaleString()} COINS  •  ◈ --`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffdc63', fontStyle: 'bold', stroke: '#151224', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(18);
    void this.refreshWallet();
    const positions = [
      { x: 190, y: 430 }, { x: 530, y: 430 },
      { x: 190, y: 850 }, { x: 530, y: 850 },
    ];
    ARTIFACTS.forEach((artifact, index) => this.addArtifactCard(artifact, positions[index].x, positions[index].y));

    STORE_OFFERS.forEach((offer, index) => {
      const balance = inventory.balances[offer.item];
      addArtButton(this, index === 0 ? 190 : 530, 1102, `${offer.title} ×${balance}  •  +${offer.quantity} ◆${offer.price}`, () => {
        void this.handleConsumable(offer);
      }, 300, 54, 18);
    });

    addArtButton(this, 190, height - 68, 'PRIZE VAULT', () => {
      SFX.click();
      this.scene.start('Rewards');
    }, 280, 56, 18);
    addArtButton(this, 530, height - 68, 'MY INVENTORY', () => {
      SFX.click();
      this.scene.start('Inventory');
    }, 280, 56, 18);
    addArtButton(this, width / 2, height - 132, 'EXCHANGE  ◆1,000  →  ◈50', () => void this.exchangeCurrency(), 360, 52, 18);
    sharpenSceneText(this);
  }

  private addArtifactCard(artifact: ArtifactDef, x: number, y: number): void {
    const meta = getMeta();
    const owned = meta.ownedArtifacts.includes(artifact.id);
    const equipped = meta.equippedArtifact === artifact.id;
    addArtPanel(this, x, y, 310, 414, 8, owned ? 0.98 : 0.88);
    this.addArtifactCrystalDetails(artifact, x, y, owned, equipped);
    addIconFrame(this, x, y - 140, 132, artifact.accent, 10, equipped);
    const icon = this.add.image(x, y - 140, artifact.texture).setDisplaySize(102, 102).setDepth(11);
    // Locked relics stay desirable and recognisable; ownership and price are
    // communicated by the footer instead of crushing the artwork to black.
    if (!owned) icon.setAlpha(0.82);
    fitText(this.add.text(x, y - 58, artifact.name, {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: owned ? artifact.accentCss : '#a7afbe', fontStyle: 'bold',
      stroke: '#101225', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(12), 260);
    this.add.text(x, y - 25, artifact.subtitle, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe5a0', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);
    this.add.text(x, y + 5, artifact.description, {
      fontFamily: UI_FONT, fontSize: TYPE.control, color: '#d7e1ef', align: 'center', wordWrap: { width: 250 }, lineSpacing: 2,
    }).setOrigin(0.5, 0).setDepth(12);
    this.add.text(x, y + 55, `SUPER  •  ${artifact.superName}`, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: artifact.accentCss, fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5, 0).setDepth(12);
    this.add.text(x, y + 82, artifact.superDescription, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b9c7d9', align: 'center', wordWrap: { width: 276 }, lineSpacing: 1,
    }).setOrigin(0.5, 0).setDepth(12);

    const diamondPrice: Partial<Record<ArtifactDef['id'], number>> = { phoenix: 90, fortune: 100, void: 130 };
    const label = equipped ? 'EQUIPPED' : owned ? 'EQUIP' : artifact.price === 0 ? 'OWNED' : `BUY  ◈ ${diamondPrice[artifact.id]}`;
    addArtButton(this, x, y + 181, label, () => void this.handleArtifact(artifact), 230, 52, 14);
  }

  private addArtifactCrystalDetails(artifact: ArtifactDef, x: number, y: number, owned: boolean, equipped: boolean): void {
    const art = this.add.graphics().setDepth(9);
    const accentAlpha = owned ? 0.13 : 0.05;

    // Artifact-coloured edge planes break the two-column cards into individual
    // relic cases while leaving every content and hit coordinate untouched.
    const leftPlane = [
      { x: x - 145, y: y - 176 }, { x: x - 126, y: y - 196 },
      { x: x - 116, y: y - 84 }, { x: x - 145, y: y - 48 },
    ];
    const rightPlane = [
      { x: x + 145, y: y - 180 }, { x: x + 145, y: y - 72 },
      { x: x + 126, y: y - 98 }, { x: x + 118, y: y - 198 },
    ];
    art.fillStyle(artifact.accent, accentAlpha);
    art.fillPoints(leftPlane, true);
    art.fillStyle(UI_COLORS.gold, owned ? 0.07 : 0.025);
    art.fillPoints(rightPlane, true);
    art.lineStyle(equipped ? 2 : 1, artifact.accent, equipped ? 0.74 : owned ? 0.34 : 0.16);
    art.strokePoints(leftPlane, true);

    art.lineStyle(1, artifact.accent, owned ? 0.34 : 0.14);
    art.lineBetween(x - 116, y + 43, x - 42, y + 43);
    art.lineBetween(x + 42, y + 43, x + 116, y + 43);
    art.fillStyle(equipped ? UI_COLORS.gold : artifact.accent, equipped ? 0.72 : owned ? 0.42 : 0.18);
    art.fillPoints([
      { x, y: y + 38 }, { x: x + 6, y: y + 43 },
      { x, y: y + 48 }, { x: x - 6, y: y + 43 },
    ], true);

    // A small static relic rune gives Chrono, Phoenix, Void and Fortune their
    // own geometry instead of relying on colour alone.
    const runeX = x + 118;
    const runeY = y + 124;
    art.lineStyle(equipped ? 2 : 1, equipped ? UI_COLORS.gold : artifact.accent, equipped ? 0.72 : owned ? 0.38 : 0.16);
    if (artifact.id === 'chrono') {
      art.strokePoints([
        { x: runeX - 9, y: runeY - 11 }, { x: runeX + 9, y: runeY - 11 },
        { x: runeX, y: runeY }, { x: runeX + 9, y: runeY + 11 },
        { x: runeX - 9, y: runeY + 11 }, { x: runeX, y: runeY },
      ], false);
    } else if (artifact.id === 'phoenix') {
      art.strokePoints([
        { x: runeX - 12, y: runeY + 9 }, { x: runeX, y: runeY - 12 },
        { x: runeX + 12, y: runeY + 9 }, { x: runeX, y: runeY + 3 },
      ], false);
    } else if (artifact.id === 'void') {
      art.strokePoints([
        { x: runeX, y: runeY - 13 }, { x: runeX + 11, y: runeY },
        { x: runeX, y: runeY + 13 }, { x: runeX - 11, y: runeY },
      ], true);
      art.lineBetween(runeX - 7, runeY, runeX + 7, runeY);
    } else {
      art.strokePoints([
        { x: runeX, y: runeY - 12 }, { x: runeX + 12, y: runeY },
        { x: runeX, y: runeY + 12 }, { x: runeX - 12, y: runeY },
      ], true);
      art.strokePoints([
        { x: runeX, y: runeY - 6 }, { x: runeX + 6, y: runeY },
        { x: runeX, y: runeY + 6 }, { x: runeX - 6, y: runeY },
      ], true);
    }
  }

  private async handleArtifact(artifact: ArtifactDef): Promise<void> {
    const meta = getMeta();
    if (meta.equippedArtifact === artifact.id) {
      this.toast(`${artifact.name} IS ALREADY EQUIPPED`, artifact.accent);
      return;
    }
    if (meta.ownedArtifacts.includes(artifact.id)) {
      equipArtifact(artifact.id);
      scheduleOnlineSync();
      SFX.click();
      this.scene.restart();
      return;
    }
    if (this.checkoutLocked) return;
    this.checkoutLocked = true;
    const offerId: Partial<Record<ArtifactDef['id'], string>> = { phoenix: 'phoenix_relic', fortune: 'fortune_relic', void: 'void_relic' };
    if (!offerId[artifact.id] || !(await getPlatformAccount())) {
      this.checkoutLocked = false;
      if (this.scene.isActive()) this.toast('ONLINE EMAIL ACCOUNT REQUIRED FOR PURCHASES', 0xffc879);
      return;
    }
    try {
      const receipt = await purchaseOffer(offerId[artifact.id]!);
      grantArtifactOwnership(artifact.id); applyServerWallet(receipt.currency === 'coins' ? receipt.balance : getMeta().coins); equipArtifact(artifact.id);
      scheduleOnlineSync();
      if (!this.scene.isActive()) return;
      SFX.win(); this.scene.restart();
    } catch (error) {
      this.checkoutLocked = false;
      if (this.scene.isActive()) this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'PURCHASE FAILED', 0xff756f);
    }
  }

  private async handleConsumable(offer: StoreOffer): Promise<void> {
    if (this.checkoutLocked) return;
    this.checkoutLocked = true;
    if (!(await getPlatformAccount())) {
      this.checkoutLocked = false;
      if (this.scene.isActive()) this.toast('ONLINE EMAIL ACCOUNT REQUIRED FOR PURCHASES', 0xffc879);
      return;
    }
    try {
      const receipt = await purchaseOffer(offer.id === 'bomb-pack' ? 'bomb_pack_3' : 'rainbow_pack_2');
      applyServerInventoryGrant(offer.item, offer.quantity, receipt.receiptId); applyServerWallet(receipt.balance);
      scheduleOnlineSync();
      if (!this.scene.isActive()) return;
      SFX.win(); this.scene.restart();
    } catch (error) {
      this.checkoutLocked = false;
      if (this.scene.isActive()) this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'PURCHASE FAILED', 0xff756f);
    }
  }

  private async refreshWallet(): Promise<void> {
    const account = await getPlatformAccount(true);
    if (!this.scene.isActive()) return;
    this.walletText?.setText(account ? `◆ ${account.wallet.coins.toLocaleString()} COINS  •  ◈ ${account.wallet.diamonds.toLocaleString()} DIAMONDS` : `◆ ${getMeta().coins.toLocaleString()} COINS  •  PURCHASES OFFLINE`);
    if (this.walletText) fitText(this.walletText, 560, 0.72);
  }

  private async exchangeCurrency(): Promise<void> {
    if (this.checkoutLocked) return;
    this.checkoutLocked = true;
    try {
      if (!(await getPlatformAccount())) throw new Error('online-account-required');
      const wallet = await exchangeCoinsForDiamonds(1); applyServerWallet(wallet.coins);
      if (!this.scene.isActive()) return;
      SFX.win(); this.toast(`EXCHANGE COMPLETE  •  ◈ ${wallet.diamonds}`, 0x7ff1d0); this.time.delayedCall(900, () => this.scene.restart());
    } catch (error) {
      this.checkoutLocked = false;
      if (this.scene.isActive()) this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'EXCHANGE FAILED', 0xff756f);
    }
  }

  private toast(message: string, color: number): void {
    const text = this.add.text(VIEW.width / 2, VIEW.height - 118, message, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#fff7e8', backgroundColor: 'rgba(8,10,24,0.94)',
      padding: { x: 20, y: 12 }, fontStyle: 'bold', stroke: Phaser.Display.Color.IntegerToColor(color).rgba, strokeThickness: 2,
    }).setOrigin(0.5).setDepth(40);
    this.tweens.add({ targets: text, y: text.y - 18, alpha: 0, delay: 1500, duration: 420, onComplete: () => text.destroy() });
    text.setResolution(Phaser.Math.Clamp(window.devicePixelRatio || 1, 1, 2));
  }
}
