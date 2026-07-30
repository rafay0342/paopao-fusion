import Phaser from 'phaser';
import { VIEW } from '../config';
import { getQualityProfile, type QualityProfile } from '../game/meta';
import type { WorldPresentation } from '../game/world-presentation';
import {
  accessibilityRuntimeForCanvas,
  activeAccessibilitySceneForCanvas,
  type AccessibilityButtonRegistration,
  type AccessibilityButtonUpdate,
} from './accessibility';
import { resolveTextFitScale } from './text-layout';

export const DISPLAY_FONT = '"PaoPao Display", Cinzel, Georgia, serif';
export const UI_FONT = '"Fusion Sans", Sora, "Avenir Next", "Trebuchet MS", Arial, sans-serif';

/**
 * One shared type scale for the whole app. The game is authored at 720 px and
 * commonly displayed around 390–430 CSS px wide, so anything below 14 design
 * pixels becomes illegible on a phone. Keep all durable UI on these tokens.
 */
export const TYPE = {
  display: '80px',
  hero: '60px',
  screen: '42px',
  title: '32px',
  section: '26px',
  metric: '26px',
  body: '22px',
  control: '20px',
  label: '21px',
  caption: '20px',
} as const;

export const UI_COLORS = {
  canvas: 0x150a31,
  surface: 0x211443,
  raised: 0x32205f,
  quietBorder: 0x7966a0,
  cyan: 0x8af3ff,
  gold: 0xf5c96c,
  text: '#fff3dd',
  secondaryText: '#dfe7f4',
  mutedText: '#aab5cd',
  success: '#7de2b8',
  danger: '#f17692',
} as const;

const accessibleButtonSerial = new WeakMap<Phaser.Scene, number>();

function humanizeSceneKey(scene: Phaser.Scene): string {
  return scene.sys.settings.key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Game screen';
}

function accessibleButtonId(scene: Phaser.Scene, label: string): string {
  const serial = (accessibleButtonSerial.get(scene) ?? 0) + 1;
  accessibleButtonSerial.set(scene, serial);
  const token = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'action';
  return `${scene.sys.settings.key.toLowerCase()}-${token}-${serial}`;
}

function ensureAccessibleScene(scene: Phaser.Scene) {
  const canvas = scene.game.canvas;
  const active = activeAccessibilitySceneForCanvas(canvas);
  if (active?.isActive) return active;
  return accessibilityRuntimeForCanvas(canvas).mountScene({
    id: scene.sys.settings.key,
    heading: humanizeSceneKey(scene),
    description: 'Use Tab to move through actions. Press Enter or Space to activate the focused action.',
    lifecycle: scene.events,
  });
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function fitText(text: Phaser.GameObjects.Text, maxWidth: number, minScale = 0.88): Phaser.GameObjects.Text {
  text.setScale(resolveTextFitScale(text.width, maxWidth, minScale));
  return text;
}

/**
 * Canvas equivalent of a min-width:0, wrapping text item. Prefer this for
 * player-facing copy; fitText remains useful for short, single-line metrics.
 */
export function wrapText(
  text: Phaser.GameObjects.Text,
  maxWidth: number,
  maxLines = 2,
): Phaser.GameObjects.Text {
  text.setScale(1);
  text.setWordWrapWidth(maxWidth, true);
  text.setMaxLines(maxLines);
  return text;
}

/** Return centered positions for a gap-driven row instead of hand-tuned x offsets. */
export function flowRowCenters(
  itemWidths: readonly number[],
  centerX: number,
  gap: number,
): number[] {
  const totalWidth = itemWidths.reduce((sum, width) => sum + Math.max(0, width), 0)
    + Math.max(0, itemWidths.length - 1) * Math.max(0, gap);
  let cursor = centerX - totalWidth / 2;
  return itemWidths.map((width) => {
    const safeWidth = Math.max(0, width);
    const x = cursor + safeWidth / 2;
    cursor += safeWidth + Math.max(0, gap);
    return x;
  });
}

/** Clamp a floating card or tooltip so both edges remain inside the viewport. */
export function clampFloatingCenterX(
  preferredCenterX: number,
  width: number,
  padding = 18,
): number {
  const halfWidth = Math.max(0, width) / 2;
  return Phaser.Math.Clamp(preferredCenterX, padding + halfWidth, VIEW.width - padding - halfWidth);
}

/**
 * Shared art/UI separation plane. Scenes add this after the world background
 * and before route/game/UI objects, keeping text contrast predictable.
 */
export function addUiScrim(
  scene: Phaser.Scene,
  alpha = 0.4,
  depth = 2,
): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(
    VIEW.width / 2,
    VIEW.height / 2,
    VIEW.width,
    VIEW.height,
    0x050711,
    Phaser.Math.Clamp(alpha, 0.35, 0.45),
  ).setDepth(depth).setData({ paopaoResourceRole: 'ui-scrim' });
}

/** Render canvas text at device-aware resolution after a scene is composed. */
export function sharpenSceneText(scene: Phaser.Scene): void {
  const resolution = Phaser.Math.Clamp(window.devicePixelRatio || 1, 1, getQualityProfile().dprCap);
  const sharpen = (child: Phaser.GameObjects.GameObject): void => {
    if (child instanceof Phaser.GameObjects.Text) {
      child.setResolution(resolution);
      return;
    }
    if (child instanceof Phaser.GameObjects.Container) {
      for (const nested of child.list) sharpen(nested);
    }
  };
  for (const child of scene.children.list) sharpen(child);
}

export function addWorldBackground(
  scene: Phaser.Scene,
  texture: string,
  shade = 0.16,
  presentation?: WorldPresentation,
): Phaser.GameObjects.Image {
  const quality = getQualityProfile();
  const reducedMotion = prefersReducedMotion();
  const image = scene.add.image(VIEW.width / 2, VIEW.height / 2, texture)
    .setDisplaySize(VIEW.width + 34, VIEW.height + 54)
    .setDepth(0);
  const baseScaleX = image.scaleX;
  const baseScaleY = image.scaleY;
  image.setData({
    paopaoResourceRole: 'world-background',
    paopaoBaseX: VIEW.width / 2,
    paopaoBaseY: VIEW.height / 2,
    paopaoBaseScaleX: baseScaleX,
    paopaoBaseScaleY: baseScaleY,
  });
  if (quality.parallax && !prefersReducedMotion()) {
    scene.tweens.add({
      targets: image,
      x: VIEW.width / 2 + 7,
      y: VIEW.height / 2 - 8,
      scaleX: baseScaleX * 1.025,
      scaleY: baseScaleY * 1.025,
      duration: 10500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  if (presentation) {
    addCinematicRealmLayers(scene, presentation, quality, reducedMotion);
  }

  const cinematicWash = scene.add.graphics().setDepth(1);
  if (texture === 'world_crystal') {
    // Luma Orchard is authored as a bright storybook playfield. Preserve its
    // sunrise and colour separation, shading only the HUD and launcher lanes.
    cinematicWash.fillGradientStyle(0x4a287a, 0x4a287a, 0x24134f, 0x24134f, 0.17, 0.17, 0.015, 0.015);
    cinematicWash.fillRect(0, 0, VIEW.width, 430);
    cinematicWash.fillGradientStyle(0x21104a, 0x21104a, 0x170936, 0x170936, 0, 0, 0.24, 0.24);
    cinematicWash.fillRect(0, VIEW.height - 360, VIEW.width, 360);
    cinematicWash.fillGradientStyle(0xffe3a8, 0xffe3a8, 0x77eaff, 0x77eaff, 0, 0, 0.045, 0.045);
    cinematicWash.fillRect(0, VIEW.height * 0.5, VIEW.width, VIEW.height * 0.34);
  } else {
    cinematicWash.fillGradientStyle(0x020817, 0x020817, 0x02040c, 0x02040c, 0.04, 0.04, 0.58, 0.58);
    cinematicWash.fillRect(0, 0, VIEW.width, VIEW.height);
    cinematicWash.fillGradientStyle(0x020611, 0x020611, 0x020611, 0x020611, shade, shade, shade * 0.42, shade * 0.42);
    cinematicWash.fillRect(0, 0, VIEW.width, VIEW.height * 0.54);
    cinematicWash.fillGradientStyle(0x02040a, 0x02040a, 0x02040a, 0x02040a, 0, 0, 0.5, 0.5);
    cinematicWash.fillRect(0, VIEW.height - 300, VIEW.width, 300);
  }

  const realmLight: Record<string, number> = {
    world_crystal: 0x62f3ef,
    world_emerald: 0x70ef98,
    world_celestial: 0x79d9ff,
    world_ember: 0xff715a,
    world_frostbound: 0x78dcff,
    world_nexus: 0xa88cff,
    world_prize_vault: 0x82edff,
  };
  const lightColor = texture.startsWith('world_arcade_rainway')
    ? 0x73eaff
    : texture.startsWith('world_arcade_memory')
      ? 0xb69cff
      : realmLight[texture] ?? UI_COLORS.cyan;
  scene.add.ellipse(
    VIEW.width / 2,
    VIEW.height * 0.68,
    VIEW.width * 0.9,
    250,
    lightColor,
    texture === 'world_crystal'
      ? quality.bloom ? 0.075 : 0.04
      : quality.bloom ? 0.035 : 0.018,
  ).setDepth(1);
  if (texture === 'world_crystal') {
    scene.add.ellipse(
      VIEW.width / 2,
      VIEW.height * 0.82,
      VIEW.width * 0.72,
      190,
      UI_COLORS.gold,
      quality.bloom ? 0.055 : 0.028,
    ).setDepth(1);
  }
  if (quality.glints) addUltraWorldOptics(scene, lightColor, reducedMotion);
  return image;
}

/**
 * Bounded optical finish for Ultra. These are small additive planes and pooled
 * spark textures, not a fake full-screen blur or a gameplay-affecting shader.
 */
function addUltraWorldOptics(
  scene: Phaser.Scene,
  tint: number,
  reducedMotion: boolean,
): void {
  const shafts = scene.add.graphics()
    .setDepth(1.06)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setData({ paopaoResourceRole: 'world-ultra-optic' });
  shafts.fillStyle(tint, 0.025);
  shafts.fillTriangle(74, 0, 244, 0, 454, VIEW.height);
  shafts.fillStyle(UI_COLORS.gold, 0.018);
  shafts.fillTriangle(VIEW.width - 196, 0, VIEW.width - 48, 0, 244, VIEW.height);

  const positions = [
    { x: 102, y: 268, scale: 0.18 },
    { x: 618, y: 338, scale: 0.13 },
    { x: 174, y: 684, scale: 0.1 },
    { x: 552, y: 792, scale: 0.16 },
    { x: 332, y: 1_016, scale: 0.11 },
    { x: 406, y: 454, scale: 0.08 },
  ] as const;
  positions.forEach((position, index) => {
    const glint = scene.add.image(position.x, position.y, 'spark')
      .setTint(index % 3 === 0 ? UI_COLORS.gold : tint)
      .setAlpha(0.12)
      .setScale(position.scale)
      .setDepth(1.08)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setData({
        paopaoResourceRole: 'world-ultra-optic',
        paopaoOpticIndex: index,
      });
    if (reducedMotion) return;
    scene.tweens.add({
      targets: glint,
      alpha: 0.28,
      scale: position.scale * 1.55,
      angle: 90,
      duration: 2_800 + index * 430,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: index * 260,
    });
  });
}

function addCinematicRealmLayers(
  scene: Phaser.Scene,
  presentation: WorldPresentation,
  quality: QualityProfile,
  reducedMotion: boolean,
): void {
  const corrupted = presentation.state === 'corrupted';
  const atmosphereExists = scene.textures.exists(presentation.atmosphereKey);

  if (atmosphereExists && quality.parallax && corrupted) {
    const atmosphere = scene.add.image(
      VIEW.width / 2,
      VIEW.height / 2,
      presentation.atmosphereKey,
    ).setDisplaySize(VIEW.width + 38, VIEW.height + 58)
      .setDepth(0.42)
      .setAlpha(quality.bloom ? 0.46 : 0.3)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setData({
        paopaoResourceRole: 'world-atmosphere',
        paopaoBaseX: VIEW.width / 2,
        paopaoBaseY: VIEW.height / 2,
      });
    if (!reducedMotion) {
      scene.tweens.add({
        targets: atmosphere,
        x: VIEW.width / 2 + 5,
        y: VIEW.height / 2 - 9,
        alpha: quality.bloom ? 0.54 : 0.36,
        duration: 12_800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  const edgeVeil = scene.add.graphics().setDepth(0.6);
  const edgeAlpha = corrupted ? 0.28 + presentation.intensity * 0.16 : 0.12;
  edgeVeil.fillGradientStyle(
    presentation.shadow,
    presentation.shadow,
    presentation.shadow,
    presentation.shadow,
    edgeAlpha,
    0,
    edgeAlpha,
    0,
  );
  edgeVeil.fillRect(0, 0, 116, VIEW.height);
  edgeVeil.fillGradientStyle(
    presentation.shadow,
    presentation.shadow,
    presentation.shadow,
    presentation.shadow,
    0,
    edgeAlpha,
    0,
    edgeAlpha,
  );
  edgeVeil.fillRect(VIEW.width - 116, 0, 116, VIEW.height);
  edgeVeil.setData({ paopaoResourceRole: 'world-static-veil' });

  const fractureArt = scene.add.graphics().setDepth(0.72);
  const fractureCount = corrupted ? quality.bloom ? 7 : quality.parallax ? 5 : 3 : 2;
  for (let index = 0; index < fractureCount; index += 1) {
    const left = index % 2 === 0;
    const seed = presentation.motionSeed + index * 17;
    const startX = left ? 12 + seed % 42 : VIEW.width - 12 - seed % 42;
    const direction = left ? 1 : -1;
    const startY = 168 + (seed * 43) % 840;
    const reach = 42 + (seed * 7) % 86;
    fractureArt.lineStyle(
      index % 3 === 0 ? 2 : 1,
      index % 3 === 0 ? presentation.ember : presentation.accent,
      corrupted ? 0.18 + presentation.intensity * 0.18 : 0.1,
    );
    fractureArt.beginPath();
    fractureArt.moveTo(startX, startY);
    fractureArt.lineTo(startX + direction * reach * 0.46, startY + 34);
    fractureArt.lineTo(startX + direction * reach, startY + 9);
    fractureArt.strokePath();
  }
  fractureArt.setData({ paopaoResourceRole: 'world-static-fractures' });

  if (!corrupted) {
    const restorationLight = scene.add.graphics().setDepth(0.7);
    restorationLight.fillGradientStyle(
      presentation.ember,
      presentation.accent,
      presentation.ember,
      presentation.accent,
      0.055,
      0.04,
      0.14,
      0.1,
    );
    restorationLight.fillRect(0, VIEW.height * 0.36, VIEW.width, VIEW.height * 0.64);
    restorationLight.setData({ paopaoResourceRole: 'world-restoration-light' });
  }

  if (!quality.parallax) return;
  const fogPlanes = quality.bloom ? 3 : 1;
  for (let index = 0; index < fogPlanes; index += 1) {
    const fog = scene.add.ellipse(
      VIEW.width * (index % 2 === 0 ? 0.26 : 0.74),
      VIEW.height * (0.38 + index * 0.18),
      420 + index * 80,
      120 + index * 26,
      presentation.fog,
      corrupted ? 0.055 : 0.032,
    ).setDepth(0.68)
      .setBlendMode(Phaser.BlendModes.SCREEN)
      .setData({
        paopaoResourceRole: 'world-atmosphere',
        paopaoBaseX: VIEW.width * (index % 2 === 0 ? 0.26 : 0.74),
        paopaoBaseY: VIEW.height * (0.38 + index * 0.18),
      });
    if (reducedMotion) continue;
    scene.tweens.add({
      targets: fog,
      x: fog.x + (index % 2 === 0 ? 34 : -34),
      y: fog.y - 10,
      alpha: fog.alpha * 1.35,
      duration: 10_600 + index * 1_700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }
}

export function addWorldStateBadge(
  scene: Phaser.Scene,
  presentation: WorldPresentation,
  y: number,
  compact = false,
): Phaser.GameObjects.Container {
  const restored = presentation.state === 'restored';
  const badge = scene.add.container(VIEW.width / 2, y).setDepth(14);
  const art = scene.add.graphics();
  const width = compact ? 438 : 568;
  const height = compact ? 54 : 84;
  const points = facetedSurfacePoints(width, height, 9);
  art.fillStyle(restored ? 0x102d2c : 0x100b22, 0.92);
  art.fillPoints(points, true);
  art.lineStyle(2, restored ? presentation.ember : presentation.accent, 0.76);
  art.strokePoints(points, true);
  art.lineStyle(1, restored ? UI_COLORS.gold : presentation.ember, 0.42);
  art.lineBetween(-width * 0.32, -height / 2 + 3, width * 0.32, -height / 2 + 3);
  const label = scene.add.text(0, compact ? 0 : -18, presentation.label, {
    fontFamily: UI_FONT,
    fontSize: TYPE.section,
    color: restored ? '#d7fff2' : '#f0eaff',
    fontStyle: 'bold',
    letterSpacing: 1.2,
  }).setOrigin(0.5);
  fitText(label, width - 48, 0.9);
  badge.add([art, label]);
  if (!compact) {
    const guidance = scene.add.text(0, 18, presentation.guidance, {
      fontFamily: UI_FONT,
      fontSize: TYPE.section,
      color: restored ? '#d3f7ec' : '#e5deef',
      fontStyle: 'bold',
      letterSpacing: 0.35,
    }).setOrigin(0.5);
    fitText(guidance, width - 52, 0.84);
    badge.add(guidance);
  }
  return badge;
}

type CrystalPoint = { x: number; y: number };

function facetedSurfacePoints(width: number, height: number, inset = 0): CrystalPoint[] {
  const halfWidth = Math.max(1, width / 2 - inset);
  const halfHeight = Math.max(1, height / 2 - inset);
  const shortCut = Math.min(halfWidth * 0.22, Phaser.Math.Clamp(height * 0.11, 8, 20));
  const longCut = Math.min(halfWidth * 0.3, Phaser.Math.Clamp(height * 0.18, 12, 30));
  return [
    { x: -halfWidth + shortCut, y: -halfHeight },
    { x: halfWidth - longCut, y: -halfHeight },
    { x: halfWidth, y: -halfHeight + longCut * 0.72 },
    { x: halfWidth, y: halfHeight - shortCut },
    { x: halfWidth - shortCut * 0.68, y: halfHeight },
    { x: -halfWidth + longCut, y: halfHeight },
    { x: -halfWidth, y: halfHeight - longCut * 0.7 },
    { x: -halfWidth, y: -halfHeight + shortCut * 0.76 },
  ];
}

function offsetPoints(points: CrystalPoint[], x: number, y: number): CrystalPoint[] {
  return points.map((point) => ({ x: point.x + x, y: point.y + y }));
}

export function addArtPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  depth = 10,
  alpha = 1,
): Phaser.GameObjects.Container {
  const panel = scene.add.container(x, y).setDepth(depth);
  const shell = scene.add.graphics();
  const outer = facetedSurfacePoints(width, height);
  const inner = facetedSurfacePoints(width, height, 6);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const topSeam = Math.min(82, width * 0.19);
  const lowerSeam = Math.min(108, width * 0.24);

  // A grounded shadow and offset lower crystal plane establish depth without a
  // luminous overlay or animation loop.
  shell.fillStyle(0x130629, 0.46);
  shell.fillPoints(offsetPoints(outer, 4, 9), true);
  shell.fillStyle(0x4a3277, 0.36);
  shell.fillPoints([
    outer[4], outer[5], outer[6],
    { x: inner[6].x, y: inner[6].y - 1 },
    { x: inner[5].x, y: inner[5].y - 1 },
    { x: inner[4].x, y: inner[4].y - 1 },
  ], true);
  shell.fillGradientStyle(
    0x4b347a,
    0x33245f,
    UI_COLORS.surface,
    0x160d36,
    0.94,
    0.94,
    0.97,
    0.97,
  );
  shell.fillPoints(outer, true);

  // Uneven translucent planes make the card feel cut from one living crystal
  // rather than assembled from a generic rectangular UI kit.
  shell.fillStyle(UI_COLORS.cyan, 0.055);
  shell.fillPoints([outer[0], outer[1], { x: width * 0.08, y: -height * 0.08 }, inner[7]], true);
  shell.fillStyle(UI_COLORS.gold, 0.045);
  shell.fillPoints([outer[2], outer[3], { x: width * 0.19, y: height * 0.1 }, inner[1]], true);
  shell.fillStyle(0x654594, 0.18);
  shell.fillPoints([outer[5], outer[6], { x: -width * 0.12, y: height * 0.12 }, inner[5]], true);

  shell.lineStyle(1, UI_COLORS.quietBorder, 0.92);
  shell.strokePoints(outer, true);
  shell.lineStyle(1, UI_COLORS.cyan, 0.2);
  shell.strokePoints(inner, true);
  shell.lineStyle(2, UI_COLORS.gold, 0.62);
  shell.lineBetween(-topSeam, -halfHeight + 1, topSeam * 0.58, -halfHeight + 1);
  shell.lineStyle(2, UI_COLORS.cyan, 0.34);
  shell.lineBetween(-halfWidth + 1, halfHeight - 28, -halfWidth + 1, halfHeight - 28 - Math.min(58, height * 0.26));
  shell.lineStyle(1, UI_COLORS.cyan, 0.28);
  shell.lineBetween(halfWidth - lowerSeam, halfHeight - 1, halfWidth - 14, halfHeight - 1);
  shell.lineStyle(1, UI_COLORS.gold, 0.32);
  shell.lineBetween(halfWidth - 1, -halfHeight + 20, halfWidth - 1, -halfHeight + Math.min(64, height * 0.28));
  panel.add(shell);

  if (prefersReducedMotion()) return panel.setAlpha(alpha);
  panel.setY(y + 8).setAlpha(0).setScale(0.99);
  scene.tweens.add({ targets: panel, y, alpha, scale: 1, duration: 210, ease: 'Cubic.easeOut' });
  return panel;
}

export function addArtButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onPress: () => void,
  width = 280,
  height = 76,
  depth = 20,
): Phaser.GameObjects.Container {
  const button = scene.add.container(x, y).setDepth(depth);
  const surface = scene.add.graphics();
  const outer = facetedSurfacePoints(width, height);
  const inner = facetedSurfacePoints(width, height, 4);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const topSeam = Math.min(54, width * 0.18);
  const drawSurface = (state: 'idle' | 'hover' | 'pressed'): void => {
    surface.clear();
    const hover = state === 'hover';
    const pressed = state === 'pressed';

    surface.fillStyle(0x16072f, pressed ? 0.32 : 0.46);
    surface.fillPoints(offsetPoints(outer, 2, pressed ? 3 : 6), true);
    surface.fillGradientStyle(
      hover ? 0x694596 : pressed ? 0x2a1b55 : 0x503477,
      hover ? 0x4e367d : pressed ? 0x211642 : 0x38255f,
      pressed ? 0x160d35 : 0x26194d,
      pressed ? 0x211441 : 0x190f39,
      0.97,
      0.97,
      0.98,
      0.98,
    );
    surface.fillPoints(outer, true);

    surface.fillStyle(UI_COLORS.cyan, hover ? 0.12 : pressed ? 0.035 : 0.065);
    surface.fillPoints([outer[0], outer[1], { x: width * 0.04, y: 1 }, inner[7]], true);
    surface.fillStyle(UI_COLORS.gold, hover ? 0.095 : pressed ? 0.035 : 0.055);
    surface.fillPoints([outer[2], outer[3], { x: width * 0.22, y: height * 0.12 }, inner[1]], true);
    surface.fillStyle(0x8b5bb2, pressed ? 0.07 : 0.16);
    surface.fillPoints([outer[5], outer[6], { x: -width * 0.16, y: height * 0.08 }, inner[5]], true);

    surface.lineStyle(state === 'hover' ? 2 : 1, state === 'hover' ? UI_COLORS.gold : UI_COLORS.cyan, state === 'hover' ? 0.9 : 0.56);
    surface.strokePoints(outer, true);
    surface.lineStyle(1, UI_COLORS.quietBorder, pressed ? 0.42 : 0.72);
    surface.strokePoints(inner, true);
    surface.lineStyle(2, UI_COLORS.gold, state === 'pressed' ? 0.3 : 0.58);
    surface.lineBetween(-topSeam, -halfHeight + 1, topSeam * 0.62, -halfHeight + 1);
    surface.lineStyle(2, UI_COLORS.cyan, hover ? 0.62 : pressed ? 0.22 : 0.38);
    surface.lineBetween(-halfWidth + 1, halfHeight - 12, -halfWidth + 1, halfHeight - Math.min(36, height * 0.42));
    surface.lineStyle(1, UI_COLORS.gold, hover ? 0.58 : 0.3);
    surface.lineBetween(halfWidth - 1, -halfHeight + 12, halfWidth - 1, -halfHeight + Math.min(30, height * 0.38));
  };
  drawSurface('idle');
  const text = scene.add.text(0, -1, label, {
    fontFamily: UI_FONT,
    fontSize: `${Phaser.Math.Clamp(Math.round(height * 0.34), 20, 26)}px`,
    color: UI_COLORS.text,
    fontStyle: 'bold',
    stroke: '#251044',
    strokeThickness: 2,
    letterSpacing: 0.8,
  }).setOrigin(0.5).setShadow(0, 2, '#1c0a36', 4);
  fitText(text, width * 0.8, 0.84);
  button.add([surface, text]);
  // At the 320x568 baseline the 720x1280 canvas scales to 0.44375. A
  // 100-design-pixel target therefore remains at least 44 CSS pixels.
  button.setSize(Math.max(100, width), Math.max(100, height)).setInteractive({ useHandCursor: true });
  if (!prefersReducedMotion()) {
    button.setY(y + 6).setAlpha(0);
    scene.tweens.add({ targets: button, y, alpha: 1, duration: 190, ease: 'Cubic.easeOut' });
  }
  button.on('pointerover', () => drawSurface('hover'));
  button.on('pointerout', () => {
    drawSurface('idle');
    button.setScale(1);
  });
  button.on('pointerdown', () => {
    drawSurface('pressed');
    button.setScale(0.98);
  });
  button.on('pointerup', () => {
    drawSurface('hover');
    button.setScale(1);
    onPress();
  });
  const accessibleScene = ensureAccessibleScene(scene);
  const accessibilityRegistration = accessibleScene.registerButton({
    id: accessibleButtonId(scene, label),
    label,
    onActivate: onPress,
    onFocusChange: (focused) => {
      drawSurface(focused ? 'hover' : 'idle');
      button.setScale(focused ? 1.025 : 1);
    },
  });
  button.setData('paopaoAccessibilityRegistration', accessibilityRegistration);
  button.once(Phaser.GameObjects.Events.DESTROY, () => accessibilityRegistration.unregister());
  return button;
}

export function updateArtButtonAccessibility(
  button: Phaser.GameObjects.Container | undefined,
  update: AccessibilityButtonUpdate,
): void {
  const registration = button?.getData('paopaoAccessibilityRegistration') as
    | AccessibilityButtonRegistration
    | undefined;
  registration?.update(update);
}

/**
 * Expand a compact art button's pointer target without scaling its artwork.
 * Phaser does not resize an existing interactive rectangle when Container
 * size changes, so both values must be updated together.
 */
export function setArtButtonHitArea(
  button: Phaser.GameObjects.Container,
  width: number,
  height: number,
): Phaser.GameObjects.Container {
  button.setSize(width, height);
  const hitArea = button.input?.hitArea;
  if (hitArea instanceof Phaser.Geom.Rectangle) {
    hitArea.setTo(0, 0, width, height);
  }
  return button;
}

/** Static frame for texture or vector icons; callers place their icon above it. */
export function addIconFrame(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  accent: number,
  depth = 10,
  selected = false,
): Phaser.GameObjects.Container {
  const frame = scene.add.container(x, y).setDepth(depth);
  const art = scene.add.graphics();
  const outer = facetedSurfacePoints(size, size);
  const inner = facetedSurfacePoints(size, size, Math.max(6, size * 0.1));
  const radius = size / 2;

  art.fillStyle(0x15062f, 0.46);
  art.fillPoints(offsetPoints(outer, 2, 4), true);
  art.fillGradientStyle(0x4d347d, 0x342461, UI_COLORS.surface, 0x170d36, 0.95, 0.95, 0.98, 0.98);
  art.fillPoints(outer, true);

  // Static, differently tinted crystal planes let each caller's accent colour
  // identify the icon while keeping the frame itself calm and readable.
  art.fillStyle(accent, selected ? 0.16 : 0.09);
  art.fillPoints([outer[0], outer[1], { x: 0, y: 0 }, outer[7]], true);
  art.fillStyle(UI_COLORS.cyan, selected ? 0.1 : 0.05);
  art.fillPoints([outer[2], outer[3], { x: 0, y: 0 }, outer[1]], true);
  art.fillStyle(UI_COLORS.gold, selected ? 0.12 : 0.055);
  art.fillPoints([outer[4], outer[5], { x: 0, y: 0 }, outer[3]], true);
  art.fillStyle(0x75509e, 0.16);
  art.fillPoints([outer[6], outer[7], { x: 0, y: 0 }, outer[5]], true);

  art.lineStyle(selected ? 3 : 2, selected ? UI_COLORS.gold : accent, selected ? 0.92 : 0.62);
  art.strokePoints(outer, true);
  art.lineStyle(1, accent, selected ? 0.62 : 0.32);
  art.strokePoints(inner, true);
  // A quiet aperture supports circular orb art without turning the outer frame
  // back into the generic ring it replaced.
  art.lineStyle(1, accent, selected ? 0.22 : 0.12);
  art.strokeCircle(0, 0, radius * 0.56);
  art.lineStyle(2, UI_COLORS.gold, selected ? 0.78 : 0.36);
  art.lineBetween(-Math.min(14, size * 0.12), -radius + 1, Math.min(10, size * 0.09), -radius + 1);
  art.lineStyle(2, UI_COLORS.cyan, selected ? 0.64 : 0.3);
  art.lineBetween(-radius + 1, radius * 0.14, -radius + 1, radius * 0.48);
  art.lineStyle(1, UI_COLORS.gold, selected ? 0.5 : 0.24);
  art.lineBetween(radius - 1, -radius * 0.46, radius - 1, -radius * 0.18);
  frame.add(art);
  return frame;
}

export function addAmbientMotes(scene: Phaser.Scene, tint: number, count = 18, depth = 2): void {
  const quality = getQualityProfile();
  const reducedMotion = prefersReducedMotion();
  const cap = quality.glints ? 18 : quality.parallax ? 10 : 4;
  const adjustedCount = Math.min(cap, Math.max(3, Math.round(count * quality.motes)));
  for (let i = 0; i < adjustedCount; i++) {
    const mote = scene.add.image(
      Phaser.Math.Between(20, VIEW.width - 20),
      Phaser.Math.Between(80, VIEW.height - 120),
      'spark',
    ).setTint(i % 5 === 0 ? 0xd8b875 : tint)
      .setAlpha(Phaser.Math.FloatBetween(0.06, 0.2))
      .setScale(Phaser.Math.FloatBetween(0.06, 0.18))
      .setDepth(depth);
    mote.setData({ paopaoResourceRole: 'ambient-mote', paopaoMoteIndex: i });
    if (reducedMotion) continue;
    scene.tweens.add({
      targets: mote,
      y: mote.y - Phaser.Math.Between(35, 110),
      x: mote.x + Phaser.Math.Between(-28, 28),
      scale: mote.scale * Phaser.Math.FloatBetween(1.1, 1.45),
      angle: Phaser.Math.Between(80, 220),
      alpha: Phaser.Math.FloatBetween(0.02, 0.12),
      duration: Phaser.Math.Between(3600, 6200),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: Phaser.Math.Between(0, 1600),
    });
  }
}

/**
 * Apply a lower render profile to objects that are already alive. This is
 * intentionally one-way inside a scene: upgrades take effect when the next
 * scene is composed, while a pressure-triggered downgrade removes work now.
 * Deterministic gameplay and MediaPipe cadence are not changed here.
 */
export function applyLiveSceneQuality(scene: Phaser.Scene, profile: QualityProfile): void {
  const moteCap = profile.glints ? 18 : profile.parallax ? 10 : 4;
  const moteLimit = Math.min(moteCap, Math.max(3, Math.round(18 * profile.motes)));
  for (const child of scene.children.list) {
    const dataObject = child as Phaser.GameObjects.GameObject & {
      getData?: (key: string) => unknown;
      setVisible?: (visible: boolean) => unknown;
      setPosition?: (x: number, y: number) => unknown;
      setScale?: (x: number, y?: number) => unknown;
    };
    const role = dataObject.getData?.('paopaoResourceRole');
    if (role === 'ambient-mote') {
      const index = Number(dataObject.getData?.('paopaoMoteIndex'));
      if (!Number.isInteger(index) || index < moteLimit) continue;
      scene.tweens.killTweensOf(child);
      dataObject.setVisible?.(false);
      continue;
    }
    if (role === 'world-background' && !profile.parallax) {
      scene.tweens.killTweensOf(child);
      const x = Number(dataObject.getData?.('paopaoBaseX'));
      const y = Number(dataObject.getData?.('paopaoBaseY'));
      const scaleX = Number(dataObject.getData?.('paopaoBaseScaleX'));
      const scaleY = Number(dataObject.getData?.('paopaoBaseScaleY'));
      if ([x, y, scaleX, scaleY].every(Number.isFinite)) {
        dataObject.setPosition?.(x, y);
        dataObject.setScale?.(scaleX, scaleY);
      }
      continue;
    }
    if (role === 'world-atmosphere' && !profile.parallax) {
      scene.tweens.killTweensOf(child);
      dataObject.setVisible?.(false);
      continue;
    }
    if (role === 'world-ultra-optic' && !profile.glints) {
      scene.tweens.killTweensOf(child);
      dataObject.setVisible?.(false);
    }
  }
  sharpenSceneText(scene);
}
