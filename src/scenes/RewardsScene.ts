import Phaser from 'phaser';
import { COLOR_KEYS, ORB_SKINS, orbTexture, VIEW, type OrbSkinDef, type OrbSkinId } from '../config';
import {
  TIER_DEFS,
  claimDailyKey,
  equipSkin,
  getMeta,
  getTierProgress,
  grantSkinOwnership,
  openMysteryBox,
  type MysteryReward,
} from '../game/meta';
import {
  queueVerifiedArtCandidate,
  resolveArtAsset,
  type ResolvedGameplayArtAsset,
} from '../game/art-v14';
import { hostedAssetUrl } from '../game/hostedAsset';
import { SFX } from '../game/sfx';
import { scheduleOnlineSync } from '../game/online';
import { getPlatformAccount, purchaseOffer } from '../game/platform';
import {
  addArtButton,
  addArtPanel,
  addIconFrame,
  addWorldBackground,
  DISPLAY_FONT,
  fitText,
  sharpenSceneText,
  TYPE,
  UI_FONT,
} from '../gfx/ui';

const SKIN_OFFERS: Partial<Record<OrbSkinId, { id: string; price: number }>> = {
  aurora: { id: 'aurora_skin', price: 180 },
  voidforge: { id: 'voidforge_skin', price: 360 },
  aurora_optical: { id: 'aurora_optical_skin', price: 280 },
  voidforge_optical: { id: 'voidforge_optical_skin', price: 520 },
  phoenix: { id: 'phoenix_skin', price: 360 },
  frostglass: { id: 'frostglass_skin', price: 440 },
  nexus_crown: { id: 'nexus_crown_skin', price: 600 },
  phoenix_optical: { id: 'phoenix_optical_skin', price: 640 },
  frostglass_optical: { id: 'frostglass_optical_skin', price: 720 },
  nexus_crown_optical: { id: 'nexus_crown_optical_skin', price: 880 },
};

const SKIN_PAGES: readonly { label: string; skins: readonly OrbSkinDef[] }[] = [
  { label: 'V6 ROYAL', skins: ORB_SKINS.slice(0, 3) },
  { label: 'V7 OPTICAL', skins: ORB_SKINS.slice(3, 6) },
  { label: 'V11 CROWN ROYAL', skins: ORB_SKINS.slice(6, 9) },
  { label: 'V11 CROWN OPTICAL', skins: ORB_SKINS.slice(9, 12) },
] as const;
const rewardsManagedOrbKeys = new Set<string>();

interface RewardArtRetry {
  asset: ResolvedGameplayArtAsset;
  nextCandidate: number;
  legacyUrl: string;
  legacyQueued: boolean;
}

export class RewardsScene extends Phaser.Scene {
  private opening = false;
  private skinPage = 0;
  private checkoutLocked = false;

  constructor() {
    super('Rewards');
  }

  init(data: { skinPage?: number } = {}): void {
    this.skinPage = Phaser.Math.Clamp(Math.floor(data.skinPage ?? 0), 0, SKIN_PAGES.length - 1);
  }

  preload(): void {
    let queued = 0;
    const retryByKey = new Map<string, RewardArtRetry>();
    const initiallyMissing = new Set<string>();
    const image = (key: string, path: string): void => {
      if (this.textures.exists(key)) return;
      this.load.image(key, hostedAssetUrl(path));
      queued += 1;
    };

    const visiblePage = SKIN_PAGES[this.skinPage];
    const prefetchedPage = SKIN_PAGES[(this.skinPage + 1) % SKIN_PAGES.length];
    const streamedSkins = [...visiblePage.skins, ...prefetchedPage.skins];
    const desiredKeys = new Set(
      streamedSkins.flatMap((skin) => COLOR_KEYS.map((color) => orbTexture(skin.id, color))),
    );
    const equippedSkin = getMeta().equippedSkin;
    const pinnedEquippedKeys = new Set(COLOR_KEYS.map((color) => orbTexture(equippedSkin, color)));
    for (const key of [...rewardsManagedOrbKeys]) {
      if (desiredKeys.has(key) || pinnedEquippedKeys.has(key)) continue;
      if (this.textures.exists(key)) this.textures.remove(key);
      rewardsManagedOrbKeys.delete(key);
    }

    const quality = getMeta().quality;
    for (const skin of streamedSkins) {
      for (const color of COLOR_KEYS) {
        const key = orbTexture(skin.id, color);
        if (this.textures.exists(key)) continue;
        const legacyUrl = hostedAssetUrl(`assets/sprites/${skin.assetFolder}/${skin.assetSlug}-${color}.png`);
        const resolved = resolveArtAsset(key, quality);
        initiallyMissing.add(key);
        if (resolved?.mediaKind === 'image') {
          retryByKey.set(key, {
            asset: resolved,
            nextCandidate: 1,
            legacyUrl,
            legacyQueued: false,
          });
          if (queueVerifiedArtCandidate(this, resolved)) {
            queued += 1;
          } else {
            retryByKey.delete(key);
            image(key, legacyUrl);
          }
        } else {
          image(key, legacyUrl);
        }
      }
    }
    image('world_prize_vault', 'assets/worlds/v6/prize-vault-hd.jpg');
    image('mystery_chest_closed', 'assets/ui/v6/mystery-chest-closed.png');
    image('mystery_chest_open', 'assets/ui/v6/mystery-chest-open.png');
    image('gift_hamper', 'assets/ui/v6/gift-hamper.png');
    image('coin_stack', 'assets/ui/v6/coin-stack.png');
    image('skin_token', 'assets/ui/v6/skin-token.png');
    image('prize_pool', 'assets/ui/v6/prize-pool.png');

    if (queued === 0) return;
    const onLoadError = (file: Phaser.Loader.File): void => {
      const key = String(file.key);
      const retry = retryByKey.get(key);
      if (!retry) return;
      if (queueVerifiedArtCandidate(this, retry.asset, retry.nextCandidate)) {
        retry.nextCandidate += 1;
        return;
      }
      if (!retry.legacyQueued) {
        retry.legacyQueued = true;
        this.load.image(key, retry.legacyUrl);
        return;
      }
      retryByKey.delete(key);
    };
    const cover = this.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x06091a, 1).setOrigin(0).setDepth(200);
    const loadingPrism = this.add.graphics().setDepth(201);
    const prismX = VIEW.width / 2;
    const prismY = VIEW.height / 2 - 45;
    const prismPoints = [
      { x: prismX - 112, y: prismY - 22 },
      { x: prismX - 54, y: prismY - 92 },
      { x: prismX + 76, y: prismY - 76 },
      { x: prismX + 116, y: prismY + 10 },
      { x: prismX + 45, y: prismY + 86 },
      { x: prismX - 82, y: prismY + 70 },
    ];
    loadingPrism.fillStyle(0x211449, 0.72).fillPoints(prismPoints, true);
    loadingPrism.fillStyle(0x7043aa, 0.2).fillTriangle(prismX - 112, prismY - 22, prismX - 54, prismY - 92, prismX - 12, prismY + 4);
    loadingPrism.fillStyle(0x36c9e8, 0.18).fillTriangle(prismX + 76, prismY - 76, prismX + 116, prismY + 10, prismX - 12, prismY + 4);
    loadingPrism.lineStyle(2, 0x7beaff, 0.42).strokePoints(prismPoints, true);
    const title = this.add.text(VIEW.width / 2, VIEW.height / 2 - 56, 'OPENING THE PRIZE VAULT', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#fff0bd', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(202);
    const track = this.add.rectangle(VIEW.width / 2, VIEW.height / 2 + 8, 420, 14, 0x11172d, 0.96)
      .setStrokeStyle(1, 0xffdd83, 0.5).setDepth(202);
    const bar = this.add.rectangle(VIEW.width / 2 - 207, VIEW.height / 2 + 8, 0, 8, 0x74ecff, 1)
      .setOrigin(0, 0.5).setDepth(203);
    const status = this.add.text(VIEW.width / 2, VIEW.height / 2 + 43, `PREPARING ${queued} TREASURES`, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#b9cae2', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(202);
    const onProgress = (value: number): void => {
      bar.width = 414 * value;
      status.setText(`PREPARING TREASURES  •  ${Math.round(value * 100)}%`);
    };
    this.load.on('loaderror', onLoadError);
    this.load.on('progress', onProgress);
    this.load.once('complete', () => {
      this.load.off('loaderror', onLoadError);
      this.load.off('progress', onProgress);
      for (const key of initiallyMissing) {
        if (this.textures.exists(key)) rewardsManagedOrbKeys.add(key);
      }
      [cover, loadingPrism, title, track, bar, status].forEach((item) => item.destroy());
    });
  }

  create(): void {
    const { width, height } = VIEW;
    const daily = claimDailyKey();
    if (daily.claimed) scheduleOnlineSync();
    const meta = daily.meta;
    const tierProgress = getTierProgress(meta);
    this.opening = false;
    this.cameras.main.fadeIn(220, 0, 0, 0);
    addWorldBackground(this, 'world_prize_vault', 0.12);

    addArtPanel(this, width / 2, 106, 640, 188, 8, 0.96);
    addArtButton(this, 82, 43, '‹  MENU', () => {
      SFX.click();
      this.scene.start('Menu');
    }, 132, 48, 18);
    this.add.text(width / 2, 88, 'PRIZE VAULT', {
      fontFamily: DISPLAY_FONT, fontSize: TYPE.screen, color: '#82edff', fontStyle: 'bold',
      stroke: '#14215a', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(12).setShadow(0, 5, '#000000', 11);
    this.add.text(width / 2, 142, `${tierProgress.tier.name}   •   ${tierProgress.renown.toLocaleString()} RENOWN`, {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: tierProgress.tier.accentCss, fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);
    this.add.text(width - 22, 28, `◆ ${meta.coins.toLocaleString()}\nKEYS ${meta.mysteryKeys}`, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#ffe078', align: 'right', fontStyle: 'bold',
      stroke: '#101225', strokeThickness: 4, lineSpacing: 4,
    }).setOrigin(1, 0).setDepth(20);

    this.addPrismPedestal(width / 2, 480);
    const chest = this.add.image(width / 2, 360, 'mystery_chest_closed')
      .setDisplaySize(286, 286).setDepth(9).setInteractive({ useHandCursor: true });
    chest.on('pointerup', () => this.openChest(chest));

    addArtButton(this, width / 2, 541, `OPEN MYSTERY BOX  •  KEY 1`, () => this.openChest(chest), 390, 76, 16);
    this.addRuneRail(width / 2, 613, 630, 58);
    this.add.text(width / 2, 602, 'LIVE PRIZE POOL', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe29a', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    fitText(this.add.text(width / 2, 626, daily.claimed ? 'DAILY GIFT  •  +1 MYSTERY KEY CLAIMED' : 'WIN KEYS BY CLEARING LEVELS', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: daily.claimed ? '#8fffd0' : '#c5d3e7', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12), 540);
    this.addPrizePreview(92, 674, 'coin_stack', 'COIN JACKPOTS');
    this.addPrizePreview(270, 674, 'skin_token', 'MYTHIC SKINS');
    this.addPrizePreview(450, 674, 'gift_hamper', 'GIFT HAMPERS');
    this.addPrizePreview(628, 674, 'prize_pool', 'PRIZE POOLS');

    const skinPage = SKIN_PAGES[this.skinPage];
    const visibleSkins = skinPage.skins;
    addArtButton(this, 67, 752, '‹', () => {
      SFX.click();
      this.scene.restart({ skinPage: (this.skinPage + SKIN_PAGES.length - 1) % SKIN_PAGES.length });
    }, 72, 44, 18);
    addArtButton(this, width - 67, 752, '›', () => {
      SFX.click();
      this.scene.restart({ skinPage: (this.skinPage + 1) % SKIN_PAGES.length });
    }, 72, 44, 18);
    fitText(this.add.text(width / 2, 755, `ORB SKINS  •  ${skinPage.label}  •  ${this.skinPage + 1}/${SKIN_PAGES.length}`, {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe4a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12), 490);
    visibleSkins.forEach((skin, index) => this.addSkinCard(skin, 120 + index * 240, 902));

    this.add.text(width / 2, 1046, 'ROYAL TIER ASCENSION', {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#ffe4a0', fontStyle: 'bold', letterSpacing: 2,
    }).setOrigin(0.5).setDepth(12);
    addArtPanel(this, width / 2, 1158, 650, 184, 8, 0.9);
    TIER_DEFS.forEach((tier, index) => {
      const x = 100 + index * 174;
      const unlocked = tierProgress.renown >= tier.threshold;
      const active = tier.id === tierProgress.tier.id;
      addIconFrame(this, x, 1128, active ? 104 : 90, tier.accent, 10, active);
      const badge = this.add.image(x, 1128, tier.texture).setDisplaySize(active ? 99 : 84, active ? 99 : 84).setDepth(11);
      if (!unlocked) badge.setTint(0x7d8493).setAlpha(0.68);
      this.add.text(x, 1188, tier.id.toUpperCase(), {
        fontFamily: UI_FONT, fontSize: TYPE.caption, color: unlocked ? tier.accentCss : '#8f99aa', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(12);
    });
    const progressX = 110;
    this.add.rectangle(width / 2, 1216, 500, 12, 0x10172d, 0.92).setStrokeStyle(1, 0xffdc7b, 0.36).setDepth(12);
    this.add.rectangle(progressX, 1216, 500 * tierProgress.progress, 8, tierProgress.tier.accent, 0.95)
      .setOrigin(0, 0.5).setDepth(13);
    this.add.text(width / 2, 1242, tierProgress.next
      ? `${Math.max(0, tierProgress.next.threshold - tierProgress.renown).toLocaleString()} RENOWN TO ${tierProgress.next.name}`
      : 'MAXIMUM PRISMATIC TIER ACHIEVED', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ccd9ea', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);

    sharpenSceneText(this);
  }

  private addPrizePreview(x: number, y: number, texture: string, label: string): void {
    addIconFrame(this, x, y, 72, 0xd4ac5c, 10);
    this.add.image(x, y, texture).setDisplaySize(58, 58).setDepth(11);
    fitText(this.add.text(x, y + 45, label, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#dce7f5', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12), 154);
  }

  private addSkinCard(skin: OrbSkinDef, x: number, y: number): void {
    const meta = getMeta();
    const owned = meta.ownedSkins.includes(skin.id);
    const equipped = meta.equippedSkin === skin.id;
    addArtPanel(this, x, y, 218, 258, 8, owned ? 0.95 : 0.8);
    addIconFrame(this, x, y - 58, 132, skin.accent, 10, equipped);
    const orb = this.add.image(x, y - 58, orbTexture(skin.id, 'blue')).setDisplaySize(112, 112).setDepth(11);
    // Keep premium materials readable before purchase; the BUY footer carries
    // ownership state without crushing the collectible art into a dark disc.
    if (!owned) orb.setAlpha(0.78);
    fitText(this.add.text(x, y + 26, skin.name, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: owned ? skin.accentCss : '#929baa', fontStyle: 'bold',
      stroke: '#101225', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(12), 182);
    this.add.text(x, y + 51, skin.rarity, {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#ffe2a0', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(12);
    const offer = SKIN_OFFERS[skin.id];
    const label = equipped ? 'EQUIPPED' : owned ? 'EQUIP' : !offer ? 'OWNED' : `BUY  ◈ ${offer.price}`;
    addArtButton(this, x, y + 94, label, () => void this.handleSkin(skin), 174, 50, 15);
  }

  private async handleSkin(skin: OrbSkinDef): Promise<void> {
    const meta = getMeta();
    if (meta.equippedSkin === skin.id) {
      this.toast(`${skin.name} IS ACTIVE`, skin.accent);
      return;
    }
    if (meta.ownedSkins.includes(skin.id)) {
      equipSkin(skin.id);
      scheduleOnlineSync();
      SFX.click();
      this.scene.restart({ skinPage: this.skinPage });
      return;
    }
    const offer = SKIN_OFFERS[skin.id];
    if (!offer || this.checkoutLocked) return;
    this.checkoutLocked = true;
    try {
      if (!(await getPlatformAccount())) throw new Error('online-email-account-required');
      await purchaseOffer(offer.id);
      grantSkinOwnership(skin.id);
      equipSkin(skin.id);
      scheduleOnlineSync();
      if (!this.scene.isActive()) return;
      SFX.win();
      this.scene.restart({ skinPage: this.skinPage });
    } catch (error) {
      this.checkoutLocked = false;
      if (this.scene.isActive()) this.toast(error instanceof Error ? error.message.toUpperCase().replace(/-/g, ' ') : 'PURCHASE FAILED', 0xff6f7d);
    }
  }

  private addPrismPedestal(x: number, baseY: number): void {
    const art = this.add.graphics().setDepth(7);
    const backplate = [
      { x: x - 136, y: baseY - 228 },
      { x: x - 74, y: baseY - 282 },
      { x: x + 82, y: baseY - 266 },
      { x: x + 142, y: baseY - 166 },
      { x: x + 94, y: baseY - 26 },
      { x: x - 102, y: baseY - 38 },
    ];
    art.fillStyle(0x160e38, 0.78).fillPoints(backplate, true);
    art.fillStyle(0x6b35a4, 0.28).fillTriangle(
      backplate[0].x, backplate[0].y,
      backplate[1].x, backplate[1].y,
      x - 10, baseY - 144,
    );
    art.fillStyle(0x24b9d3, 0.24).fillTriangle(
      backplate[2].x, backplate[2].y,
      backplate[3].x, backplate[3].y,
      x - 10, baseY - 144,
    );
    art.fillStyle(0x31215f, 0.34).fillTriangle(
      backplate[0].x, backplate[0].y,
      x - 10, baseY - 144,
      backplate[5].x, backplate[5].y,
    );
    art.lineStyle(2, 0x78e7f6, 0.5).strokePoints(backplate, true);
    art.lineStyle(1, 0xa77be4, 0.38)
      .lineBetween(x - 10, baseY - 144, backplate[1].x, backplate[1].y)
      .lineBetween(x - 10, baseY - 144, backplate[3].x, backplate[3].y)
      .lineBetween(x - 10, baseY - 144, backplate[5].x, backplate[5].y);

    const topPlane = [
      { x: x - 146, y: baseY - 20 },
      { x: x - 96, y: baseY - 48 },
      { x: x + 102, y: baseY - 48 },
      { x: x + 150, y: baseY - 18 },
      { x: x + 92, y: baseY + 8 },
      { x: x - 94, y: baseY + 8 },
    ];
    const leftPlane = [
      { x: x - 146, y: baseY - 20 },
      { x: x - 94, y: baseY + 8 },
      { x: x - 38, y: baseY + 42 },
      { x: x - 112, y: baseY + 25 },
    ];
    const rightPlane = [
      { x: x - 94, y: baseY + 8 },
      { x: x + 92, y: baseY + 8 },
      { x: x + 116, y: baseY + 25 },
      { x: x - 38, y: baseY + 42 },
    ];
    art.fillStyle(0x24204d, 0.98).fillPoints(topPlane, true);
    art.fillStyle(0x48266f, 0.94).fillPoints(leftPlane, true);
    art.fillStyle(0x0d5268, 0.94).fillPoints(rightPlane, true);
    art.lineStyle(2, 0xe6c675, 0.52).strokePoints(topPlane, true);
    art.lineStyle(1, 0x65deef, 0.48).strokePoints(rightPlane, true);
    art.lineStyle(1, 0xb887ec, 0.42).strokePoints(leftPlane, true);
  }

  private addRuneRail(x: number, y: number, width: number, height: number): void {
    const rail = this.add.graphics().setDepth(8);
    const halfW = width / 2;
    const halfH = height / 2;
    const points = [
      { x: x - halfW + 22, y: y - halfH },
      { x: x + halfW - 48, y: y - halfH },
      { x: x + halfW, y: y - 4 },
      { x: x + halfW - 26, y: y + halfH },
      { x: x - halfW + 48, y: y + halfH },
      { x: x - halfW, y: y + 4 },
    ];
    rail.fillStyle(0x0b1029, 0.92).fillPoints(points, true);
    rail.fillStyle(0x5d318d, 0.18).fillTriangle(points[0].x, points[0].y, x - 160, y, points[4].x, points[4].y);
    rail.fillStyle(0x1ba4bf, 0.16).fillTriangle(points[1].x, points[1].y, points[2].x, points[2].y, x + 164, y);
    rail.lineStyle(2, 0x75e8f6, 0.4).strokePoints(points, true);
    rail.lineStyle(2, 0xe5bf69, 0.5)
      .lineBetween(x - halfW + 64, y - halfH, x - 100, y - halfH)
      .lineBetween(x + 100, y + halfH, x + halfW - 66, y + halfH);
    for (const runeX of [x - 270, x - 246, x + 246, x + 270]) {
      rail.lineStyle(1, 0x9a72d8, 0.44)
        .lineBetween(runeX - 5, y, runeX, y - 7)
        .lineBetween(runeX, y - 7, runeX + 5, y)
        .lineBetween(runeX + 5, y, runeX, y + 7)
        .lineBetween(runeX, y + 7, runeX - 5, y);
    }
  }

  private openChest(chest: Phaser.GameObjects.Image): void {
    if (this.opening) return;
    const result = openMysteryBox();
    if (!result.ok || !result.reward) {
      this.toast('NO MYSTERY KEYS • CLEAR A LEVEL TO EARN ONE', 0xff7d86);
      return;
    }
    this.opening = true;
    scheduleOnlineSync();
    SFX.click();
    this.tweens.killTweensOf(chest);
    this.tweens.add({
      targets: chest,
      angle: { from: -4, to: 4 },
      scaleX: chest.scaleX * 1.08,
      scaleY: chest.scaleY * 1.08,
      duration: 82,
      yoyo: true,
      repeat: 4,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        chest.setTexture('mystery_chest_open').setAngle(0);
        this.cameras.main.shake(150, 0.004);
        SFX.win();
        this.rewardBurst(chest.x, chest.y - 30, result.reward!.accent);
        this.time.delayedCall(430, () => this.showReward(result.reward!));
      },
    });
  }

  private rewardBurst(x: number, y: number, color: number): void {
    for (let i = 0; i < 4; i++) {
      const ring = this.add.graphics().setDepth(45);
      ring.lineStyle(4 - i * 0.55, i % 2 ? 0xffdf7c : color, 0.85)
        .strokeCircle(x, y, 42 + i * 14);
      this.tweens.add({ targets: ring, scale: 3.5, alpha: 0, delay: i * 70, duration: 680, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
    }
    const particles = this.add.particles(x, y, 'spark', {
      speed: { min: 100, max: 360 },
      angle: { min: 195, max: 345 },
      lifespan: { min: 520, max: 950 },
      scale: { start: 0.7, end: 0 },
      gravityY: 240,
      tint: [color, 0xffdc78, 0x70dff1],
      blendMode: 'NORMAL',
      emitting: false,
    }).setDepth(46);
    particles.explode(38);
    this.time.delayedCall(1100, () => particles.destroy());
  }

  private showReward(reward: MysteryReward): void {
    const { width, height } = VIEW;
    this.add.rectangle(0, 0, width, height, 0x02040c, 0.8).setOrigin(0).setDepth(70);
    addArtPanel(this, width / 2, height / 2, 610, 700, 71, 0.99);
    this.addRewardBackplate(width / 2, 440, reward.accent);
    const texture = reward.kind === 'coins'
      ? 'coin_stack'
      : reward.kind === 'skin' && reward.skinId
        ? orbTexture(reward.skinId, 'blue')
        : 'gift_hamper';
    const icon = this.add.image(width / 2, 440, texture).setDisplaySize(235, 235).setDepth(73).setAlpha(0);
    const targetScaleX = icon.scaleX;
    const targetScaleY = icon.scaleY;
    icon.setScale(targetScaleX * 0.2, targetScaleY * 0.2);
    this.tweens.add({
      targets: icon,
      scaleX: targetScaleX,
      scaleY: targetScaleY,
      alpha: 1,
      angle: { from: -8, to: 0 },
      duration: 620,
      ease: 'Cubic.easeOut',
    });
    this.add.text(width / 2, 615, 'MYSTERY REWARD', {
      fontFamily: UI_FONT, fontSize: TYPE.label, color: '#ffe2a0', fontStyle: 'bold', letterSpacing: 3,
    }).setOrigin(0.5).setDepth(74);
    fitText(this.add.text(width / 2, 670, reward.title, {
      fontFamily: UI_FONT, fontSize: TYPE.screen, color: reward.accentCss, fontStyle: 'bold',
      stroke: '#111329', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(74).setShadow(0, 5, '#000000', 10), 520);
    this.add.text(width / 2, 725, reward.detail, {
      fontFamily: UI_FONT, fontSize: TYPE.section, color: '#f1f6ff', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(74);
    this.add.text(width / 2, 772, reward.kind === 'skin' ? 'A NEW VISUAL FAMILY HAS JOINED YOUR COLLECTION' : 'THE VAULT HAS ADDED THIS PRIZE TO YOUR ACCOUNT', {
      fontFamily: UI_FONT, fontSize: TYPE.caption, color: '#bdcbe0', fontStyle: 'bold', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(74);
    addArtButton(this, width / 2, 858, 'COLLECT REWARD', () => {
      SFX.click();
      this.scene.restart({ skinPage: this.skinPage });
    }, 340, 78, 75);
    sharpenSceneText(this);
  }

  private addRewardBackplate(x: number, y: number, accent: number): void {
    const art = this.add.graphics().setDepth(72);
    const points = [
      { x: x - 122, y: y - 86 },
      { x: x - 44, y: y - 142 },
      { x: x + 104, y: y - 100 },
      { x: x + 132, y: y + 40 },
      { x: x + 42, y: y + 126 },
      { x: x - 116, y: y + 88 },
    ];
    art.fillStyle(0x17103a, 0.94).fillPoints(points, true);
    art.fillStyle(0x663a91, 0.24).fillTriangle(points[0].x, points[0].y, points[1].x, points[1].y, x, y);
    art.fillStyle(0x1aa7bd, 0.2).fillTriangle(points[2].x, points[2].y, points[3].x, points[3].y, x, y);
    art.fillStyle(accent, 0.14).fillTriangle(points[3].x, points[3].y, points[4].x, points[4].y, x, y);
    art.lineStyle(3, accent, 0.58).strokePoints(points, true);
    art.lineStyle(1, 0x75e8f6, 0.42)
      .lineBetween(x, y, points[1].x, points[1].y)
      .lineBetween(x, y, points[3].x, points[3].y)
      .lineBetween(x, y, points[5].x, points[5].y);

    const topPlane = [
      { x: x - 112, y: y + 104 },
      { x: x - 66, y: y + 82 },
      { x: x + 74, y: y + 82 },
      { x: x + 114, y: y + 104 },
      { x: x + 68, y: y + 124 },
      { x: x - 70, y: y + 124 },
    ];
    const leftPlane = [
      { x: x - 112, y: y + 104 },
      { x: x - 70, y: y + 124 },
      { x: x - 24, y: y + 146 },
      { x: x - 88, y: y + 136 },
    ];
    const rightPlane = [
      { x: x - 70, y: y + 124 },
      { x: x + 68, y: y + 124 },
      { x: x + 90, y: y + 136 },
      { x: x - 24, y: y + 146 },
    ];
    art.fillStyle(0x29214e, 0.96).fillPoints(topPlane, true);
    art.fillStyle(0x4d2871, 0.9).fillPoints(leftPlane, true);
    art.fillStyle(0x105368, 0.9).fillPoints(rightPlane, true);
    art.lineStyle(1, 0xe6c675, 0.52).strokePoints(topPlane, true);
  }

  private toast(message: string, color: number): void {
    const text = fitText(this.add.text(VIEW.width / 2, VIEW.height - 76, message, {
      fontFamily: UI_FONT, fontSize: TYPE.body, color: '#fff9ed', backgroundColor: 'rgba(5,8,20,0.96)',
      padding: { x: 18, y: 12 }, fontStyle: 'bold',
      stroke: Phaser.Display.Color.IntegerToColor(color).rgba, strokeThickness: 2,
    }).setOrigin(0.5).setDepth(90), 630);
    this.tweens.add({ targets: text, y: text.y - 20, alpha: 0, delay: 1650, duration: 420, onComplete: () => text.destroy() });
    text.setResolution(Phaser.Math.Clamp(window.devicePixelRatio || 1, 1, 2));
  }
}
