import Phaser from 'phaser';
import { ORB_SKINS, VIEW } from '../config';
import { getInventory, type InventorySnapshot } from '../game/inventory';
import { ARTIFACTS } from '../game/meta';
import { getAccountSnapshot, syncOnline } from '../game/online';
import { getPlatformAccount } from '../game/platform';
import { SFX } from '../game/sfx';
import { addAmbientMotes, addArtButton, addArtPanel, addIconFrame, addWorldBackground, DISPLAY_FONT, fitText, sharpenSceneText, TYPE, UI_FONT } from '../gfx/ui';
import { UI_V16, UI_V16_FRAME } from '../gfx/ui-art-v16';

export class InventoryScene extends Phaser.Scene {
  private currencyText?: Phaser.GameObjects.Text;
  constructor() { super('Inventory'); }

  create(): void {
    const { width } = VIEW;
    const inventory = getInventory();
    const account = getAccountSnapshot();
    addWorldBackground(this, 'world_crystal', 0.2);
    addAmbientMotes(this, 0x71ecff, 16, 2);
    this.add.text(34, 38, '‹  MENU', {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#e8eff9', fontStyle: 'bold',
    }).setDepth(14).setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.start('Menu'));
    this.add.text(width / 2, 68, 'PRISM INVENTORY', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#ffffff', fontStyle: 'bold', stroke: '#132e51', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(10);
    this.add.text(width / 2, 112, `${account.displayName}  •  ${account.connection === 'online' ? 'CLOUD SYNCED' : account.connection === 'guest' ? 'GUEST SAVE' : 'OFFLINE SAFE'}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: account.connection === 'online' ? '#7ff1d0' : '#ffc879', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(10);

    this.drawConsumables(inventory);
    this.drawRelics(inventory);
    this.drawCollection(inventory);
    this.drawLedger(inventory);
    void this.refreshPlatformCurrency();

    addArtButton(this, 130, 1208, 'STORE', () => {
      SFX.click();
      this.scene.start('Store');
    }, 210, 58, 14);
    addArtButton(this, 360, 1208, 'ACCOUNT', () => {
      SFX.click();
      this.scene.start('Account');
    }, 210, 58, 14);
    addArtButton(this, 590, 1208, 'SYNC NOW', () => void this.syncNow(), 210, 58, 14);
    sharpenSceneText(this);
  }

  private drawConsumables(inventory: InventorySnapshot): void {
    this.add.text(48, 154, 'FIELD SUPPLIES', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(10);
    const items = [
      { x: 135, texture: 'power_bomb', v16Frame: UI_V16_FRAME.inventory.bomb, accent: 0xff8b72, label: 'PRISM BOMBS', count: inventory.balances.bomb, detail: 'Break a dense cluster' },
      { x: 360, texture: 'power_rainbow', v16Frame: UI_V16_FRAME.inventory.wildcard, accent: 0x71ecff, label: 'RAINBOW ORBS', count: inventory.balances.rainbow, detail: 'Clear one orb colour' },
      { x: 585, texture: 'mechanic_crystal_seal', v16Frame: UI_V16_FRAME.inventory.crystal, accent: 0xd4ac5c, label: 'STORY SHARDS', count: inventory.balances.storyShard, detail: 'Restore lost memories' },
    ];
    items.forEach((item) => {
      addArtPanel(this, item.x, 292, 204, 236, 5, 0.98);
      addIconFrame(this, item.x, 244, 88, item.accent, 9);
      const itemImage = this.textures.exists(UI_V16.inventoryRewards)
        ? this.add.image(item.x, 244, UI_V16.inventoryRewards, item.v16Frame).setDisplaySize(104, 104)
        : this.add.image(item.x, 244, item.texture).setDisplaySize(68, 68);
      itemImage.setDepth(10);
      this.add.text(item.x, 301, `×${item.count}`, {
        fontFamily: UI_FONT, fontSize: TYPE.title, color: '#ffffff', fontStyle: 'bold', stroke: '#101225', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(11);
      fitText(this.add.text(item.x, 340, item.label, {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#7ff1d0', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(11), 180, 0.7);
      this.add.text(item.x, 378, item.detail, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#abbad0', align: 'center',
        wordWrap: { width: 174 }, lineSpacing: 1,
      }).setOrigin(0.5).setDepth(11);
    });
  }

  private drawRelics(inventory: InventorySnapshot): void {
    this.add.text(48, 434, 'OWNED RELICS', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(10);
    addArtPanel(this, VIEW.width / 2, 554, 640, 190, 5, 0.96);
    const owned = ARTIFACTS.filter((artifact) => inventory.ownedArtifacts.includes(artifact.id));
    owned.forEach((artifact, index) => {
      const gap = 160;
      const x = VIEW.width / 2 - ((owned.length - 1) * gap) / 2 + index * gap;
      const equipped = artifact.id === inventory.equippedArtifact;
      addIconFrame(this, x, 524, 78, artifact.accent, 9, equipped);
      this.add.image(x, 524, artifact.texture).setDisplaySize(62, 62).setDepth(10).setAlpha(equipped ? 1 : 0.76);
      fitText(this.add.text(x, 578, artifact.name, {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: equipped ? artifact.accentCss : '#c3cede', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(10), 155, 0.64);
      this.add.text(x, 606, equipped ? 'EQUIPPED' : 'OWNED', {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: equipped ? '#ffe07e' : '#8293aa', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(10);
    });
    if (!owned.length) this.add.text(VIEW.width / 2, 554, 'No relics collected yet.', { fontFamily: UI_FONT, fontSize: TYPE.body, color: '#b9c6d8' }).setOrigin(0.5).setDepth(10);
  }

  private drawCollection(inventory: InventorySnapshot): void {
    this.add.text(48, 678, 'COLLECTION & CURRENCY', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(10);
    addArtPanel(this, VIEW.width / 2, 766, 640, 130, 5, 0.96);
    this.currencyText = this.add.text(66, 732, `◆  ${inventory.coins.toLocaleString()} COINS     ◈ -- DIAMONDS     ✦ ${inventory.mysteryKeys} KEYS`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffdf73', fontStyle: 'bold',
    }).setDepth(10);
    const ownedSkins = ORB_SKINS.filter((skin) => inventory.ownedSkins.includes(skin.id));
    const activeSkin = ORB_SKINS.find((skin) => skin.id === inventory.equippedSkin) ?? ORB_SKINS[0];
    fitText(this.add.text(66, 784, `${ownedSkins.length} / ${ORB_SKINS.length} ORB SKINS  •  ACTIVE ${activeSkin.name}`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#bcdff1', fontStyle: 'bold',
    }).setDepth(10), 590, 0.62);
  }

  private async refreshPlatformCurrency(): Promise<void> {
    const account = await getPlatformAccount(true);
    if (!this.scene.isActive() || !account) return;
    this.currencyText?.setText(`◆ ${account.wallet.coins.toLocaleString()} COINS     ◈ ${account.wallet.diamonds.toLocaleString()} DIAMONDS     ✦ ${getInventory().mysteryKeys} KEYS`);
    if (this.currencyText) fitText(this.currencyText, 590, 0.66);
  }

  private drawLedger(inventory: InventorySnapshot): void {
    this.add.text(48, 862, 'RECENT INVENTORY ACTIVITY', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe7a6', fontStyle: 'bold', letterSpacing: 2,
    }).setDepth(10);
    addArtPanel(this, VIEW.width / 2, 1010, 640, 230, 5, 0.96);
    const recent = inventory.transactions.filter((entry) => entry.reason !== 'starter').slice(-4).reverse();
    const lines = recent.map((entry) => {
      const item = entry.item ? entry.item.replace(/([A-Z])/g, ' $1').toUpperCase() : 'RELIC PURCHASE';
      const quantity = entry.item ? `${entry.delta > 0 ? '+' : ''}${entry.delta}` : '';
      const coins = entry.coinDelta ? `  •  ◆ ${entry.coinDelta}` : '';
      return `${quantity.padStart(3, ' ')}  ${item}${coins}`;
    });
    if (lines.length) {
      this.add.text(76, 930, lines.join('\n'), {
        fontFamily: UI_FONT, fontSize: TYPE.label, color: '#dce6f5', lineSpacing: 14,
      }).setDepth(10);
    } else {
      this.add.text(VIEW.width / 2, 1008, 'Your inventory history will appear here.\nVisit the Relic Store to prepare for the next realm.', {
        fontFamily: UI_FONT,
        fontSize: TYPE.body,
        color: '#dce6f5',
        align: 'center',
        lineSpacing: 10,
      }).setOrigin(0.5).setDepth(10);
    }
    fitText(this.add.text(VIEW.width / 2, 1100, `REVISION ${inventory.revision}  •  PURCHASE HISTORY CLOUD-MERGED`, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#91a8c2', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(10), 580);
  }

  private async syncNow(): Promise<void> {
    SFX.click();
    const result = await syncOnline();
    if (!this.scene.isActive()) return;
    if (result.online) this.scene.restart();
    else this.toast(getAccountSnapshot().mode === 'guest' ? 'GUEST MODE — INVENTORY SAVED ON THIS DEVICE' : 'OFFLINE — INVENTORY WILL SYNC AUTOMATICALLY', 0xffc879);
  }

  private toast(message: string, color: number): void {
    const text = this.add.text(VIEW.width / 2, VIEW.height - 38, message, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#fff7e8', backgroundColor: 'rgba(8,10,24,0.96)',
      padding: { x: 18, y: 10 }, fontStyle: 'bold', stroke: Phaser.Display.Color.IntegerToColor(color).rgba, strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(50);
    fitText(text, 650, 0.72);
    this.tweens.add({ targets: text, y: text.y - 16, alpha: 0, delay: 1700, duration: 360, onComplete: () => text.destroy() });
  }
}
