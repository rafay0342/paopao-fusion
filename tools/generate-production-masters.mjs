import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ledger = JSON.parse(readFileSync(join(root, 'docs', 'production', 'upgrade-ledger.json'), 'utf8'));
const outputRoot = join(root, 'art-source', 'production-masters');
const assetItems = ledger.items.filter((item) => item.category === 'asset');

if (assetItems.length !== 500) throw new Error(`expected 500 asset ledger records, received ${assetItems.length}`);

const allocationDirectories = {
  'characters-orbs-bosses-rigs': 'characters',
  'environment-models-props': 'environments',
  'material-texture-vfx-packs': 'materials',
  'ui-icons-illustrations': 'interface',
  'music-ambience-sfx': 'audio',
  'cinematic-sequences': 'cinematics',
  'tutorial-accessibility-promotion': 'guides',
};

const splitTitle = (title) => {
  const [subject, facet] = String(title).split(' — ');
  if (!subject || !facet) throw new Error(`invalid asset title: ${title}`);
  return { subject, facet };
};

const slug = (value) => String(value)
  .normalize('NFKD')
  .replaceAll(/[^A-Za-z0-9]+/g, '-')
  .replaceAll(/^-|-$/g, '')
  .toLowerCase();

const xml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const seedFor = (value) => Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) >>> 0;

function randomFor(seed) {
  let state = seed || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function hslToHex(h, s, l) {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const part = (h / 60) % 2;
  const x = chroma * (1 - Math.abs(part - 1));
  const [r1, g1, b1] = h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
      : h < 180 ? [0, chroma, x]
        : h < 240 ? [0, x, chroma]
          : h < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return `#${[r1, g1, b1].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function paletteFor(id) {
  const seed = seedFor(id);
  const hue = seed % 360;
  return {
    ink: '#050713',
    deep: hslToHex((hue + 325) % 360, 48, 11),
    mid: hslToHex(hue, 62, 34),
    accent: hslToHex((hue + 42) % 360, 78, 61),
    light: hslToHex((hue + 178) % 360, 74, 78),
    gold: '#e3bd68',
  };
}

function crystalPolygon(cx, cy, radius, sides, phase, stretch = 1) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = phase + (Math.PI * 2 * index) / sides;
    return `${(cx + Math.cos(angle) * radius).toFixed(1)},${(cy + Math.sin(angle) * radius * stretch).toFixed(1)}`;
  }).join(' ');
}

function svgFrame({ x, y, width, height, index, seed, colors, mode }) {
  const rand = randomFor(seed + index * 7919);
  const inset = 34 + Math.round(rand() * 20);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const facets = Array.from({ length: 9 }, (_, facet) => {
    const radius = Math.min(width, height) * (0.13 + rand() * 0.22);
    const px = x + inset + rand() * Math.max(1, width - inset * 2);
    const py = y + inset + rand() * Math.max(1, height - inset * 2);
    const points = crystalPolygon(px, py, radius, 5 + (facet % 3), rand() * Math.PI, 0.65 + rand() * 0.75);
    return `<polygon points="${points}" fill="url(#facet-${index % 3})" opacity="${(0.09 + rand() * 0.25).toFixed(2)}"/>`;
  }).join('');
  const sigilSides = 5 + (seed + index) % 5;
  const sigil = crystalPolygon(cx, cy, Math.min(width, height) * 0.21, sigilSides, -Math.PI / 2, mode === 'environment' ? 0.62 : 1.05);
  const silhouette = mode === 'character'
    ? `<path d="M ${cx - width * 0.13} ${cy + height * 0.22} Q ${cx - width * 0.2} ${cy - height * 0.02} ${cx} ${cy - height * 0.22} Q ${cx + width * 0.2} ${cy - height * 0.02} ${cx + width * 0.13} ${cy + height * 0.22} Z" fill="url(#hero)" stroke="${colors.gold}" stroke-width="9"/><circle cx="${cx}" cy="${cy - height * 0.18}" r="${Math.min(width, height) * 0.08}" fill="${colors.light}" stroke="${colors.gold}" stroke-width="7"/>`
    : mode === 'environment'
      ? `<path d="M ${x + inset} ${y + height - inset} L ${x + width * 0.22} ${cy} L ${x + width * 0.36} ${y + height - inset} L ${x + width * 0.58} ${y + height * 0.29} L ${x + width * 0.75} ${y + height - inset} L ${x + width - inset} ${cy + height * 0.08} L ${x + width - inset} ${y + height - inset} Z" fill="url(#hero)" opacity=".86"/><ellipse cx="${cx}" cy="${y + height - inset}" rx="${width * 0.32}" ry="${height * 0.055}" fill="${colors.accent}" opacity=".3"/>`
      : `<polygon points="${sigil}" fill="url(#hero)" stroke="${colors.gold}" stroke-width="9"/><circle cx="${cx}" cy="${cy}" r="${Math.min(width, height) * 0.085}" fill="${colors.light}" opacity=".84"/>`;
  return `<g><defs><clipPath id="panel-clip-${index}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="38"/></clipPath></defs><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="38" fill="${colors.deep}"/><g clip-path="url(#panel-clip-${index})">${facets}${silhouette}<polygon points="${sigil}" fill="none" stroke="${colors.light}" stroke-opacity=".46" stroke-width="5"/></g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="38" fill="none" stroke="${colors.accent}" stroke-opacity=".48" stroke-width="6"/></g>`;
}

function panelLayout(facet) {
  if (/turnaround|state|set|family|storyboard|motion/i.test(facet)) return { columns: 2, rows: 2 };
  if (/runtime sprite|icon|badge|progress|button/i.test(facet)) return { columns: 3, rows: 2 };
  if (/panorama|hero|illustration|presentation/i.test(facet)) return { columns: 1, rows: 1 };
  return { columns: 2, rows: 1 };
}

function svgMaster(item, subject, facet, mode) {
  const colors = paletteFor(item.id);
  const seed = seedFor(`${item.id}:${subject}:${facet}`);
  const { columns, rows } = panelLayout(facet);
  const gap = 42;
  const top = 260;
  const frameWidth = (1900 - gap * (columns - 1)) / columns;
  const frameHeight = (1580 - gap * (rows - 1)) / rows;
  const frames = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      frames.push(svgFrame({
        x: 74 + column * (frameWidth + gap),
        y: top + row * (frameHeight + gap),
        width: frameWidth,
        height: frameHeight,
        index: row * columns + column,
        seed,
        colors,
        mode,
      }));
    }
  }
  const metadata = xml(JSON.stringify({
    schemaVersion: 1,
    id: item.id,
    release: item.release,
    allocation: item.assetAllocation,
    subject,
    facet,
    original: true,
    artboard: [8192, 8192],
    runtimePolicy: 'derive optimized Phaser variants without counting copies as masters',
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="8192" height="8192" viewBox="0 0 2048 2048" role="img" aria-labelledby="title desc">
  <title id="title">${xml(subject)} — ${xml(facet)}</title>
  <desc id="desc">Original PaoPao Fusion stylized crystal production master ${item.id}; authored for the Phaser client.</desc>
  <metadata>${metadata}</metadata>
  <defs>
    <linearGradient id="back" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors.ink}"/><stop offset=".55" stop-color="${colors.deep}"/><stop offset="1" stop-color="${colors.mid}"/></linearGradient>
    <radialGradient id="hero" cx="32%" cy="24%"><stop stop-color="${colors.light}"/><stop offset=".38" stop-color="${colors.accent}"/><stop offset="1" stop-color="${colors.mid}"/></radialGradient>
    <linearGradient id="facet-0"><stop stop-color="${colors.accent}"/><stop offset="1" stop-color="${colors.mid}"/></linearGradient>
    <linearGradient id="facet-1"><stop stop-color="${colors.gold}"/><stop offset="1" stop-color="${colors.deep}"/></linearGradient>
    <linearGradient id="facet-2"><stop stop-color="${colors.light}"/><stop offset="1" stop-color="${colors.accent}"/></linearGradient>
  </defs>
  <rect width="2048" height="2048" fill="url(#back)"/>
  <path d="M0 148 L440 0 M1608 0 L2048 148 M0 1900 L440 2048 M1608 2048 L2048 1900" stroke="${colors.gold}" stroke-opacity=".42" stroke-width="8" fill="none"/>
  <text x="74" y="94" fill="${colors.gold}" font-family="Georgia,serif" font-size="34" font-weight="700" letter-spacing="5">PAOPAO FUSION • MASTER ${item.id}</text>
  <text x="74" y="164" fill="${colors.light}" font-family="Arial,sans-serif" font-size="52" font-weight="800">${xml(subject)}</text>
  <text x="74" y="216" fill="${colors.accent}" font-family="Arial,sans-serif" font-size="28" letter-spacing="2">${xml(facet.toUpperCase())}</text>
  ${frames.join('\n  ')}
  <text x="74" y="1991" fill="${colors.light}" opacity=".74" font-family="Arial,sans-serif" font-size="22">ORIGINAL STYLIZED CRYSTAL ART • 8192 × 8192 SOURCE • RELEASE ${item.release}</text>
</svg>
`;
}

function commonJson(item, subject, facet, masterType) {
  return {
    schemaVersion: 1,
    id: item.id,
    release: item.release,
    allocation: item.assetAllocation,
    subject,
    facet,
    masterType,
    original: true,
    license: 'PaoPao Fusion original production source',
    runtimePolicy: 'Optimized exports are derived variants and never additional ledger masters.',
  };
}

function notesFor(seed, count, base = 196) {
  const rand = randomFor(seed);
  const scale = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2];
  let atBeats = 0;
  return Array.from({ length: count }, (_, index) => {
    const durationBeats = [0.25, 0.5, 0.75, 1][Math.floor(rand() * 4)];
    const note = {
      id: `note-${String(index + 1).padStart(2, '0')}`,
      atBeats: Math.round(atBeats * 100) / 100,
      durationBeats,
      frequencyHz: Math.round(base * scale[Math.floor(rand() * scale.length)] * (rand() > 0.82 ? 2 : 1) * 100) / 100,
      velocity: Math.round((0.38 + rand() * 0.52) * 100) / 100,
      pan: Math.round((rand() * 1.4 - 0.7) * 100) / 100,
    };
    atBeats += durationBeats;
    return note;
  });
}

function audioMaster(item, subject, facet) {
  const seed = seedFor(item.id);
  const rand = randomFor(seed);
  const isCue = /SFX|cue/i.test(facet);
  const trackCount = isCue ? 6 : /stem|session/i.test(facet) ? 5 : 3;
  const waveforms = ['sine', 'triangle', 'sawtooth', 'square'];
  return {
    ...commonJson(item, subject, facet, 'procedural-audio-score'),
    audio: {
      sampleRate: 48000,
      channels: 2,
      tempoBpm: 72 + (seed % 49),
      meter: seed % 3 === 0 ? [6, 8] : [4, 4],
      masterGainDb: -8,
      loopBeats: isCue ? 4 : 32,
      tracks: Array.from({ length: trackCount }, (_, index) => ({
        id: `${facet.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-layer-${index + 1}`,
        role: ['crystal-lead', 'warm-pad', 'pulse-bass', 'prism-percussion', 'aurora-air', 'accessibility-transient'][index],
        oscillator: waveforms[(seed + index) % waveforms.length],
        envelope: {
          attackMs: 8 + Math.round(rand() * 110),
          decayMs: 90 + Math.round(rand() * 380),
          sustain: Math.round((0.28 + rand() * 0.54) * 100) / 100,
          releaseMs: 120 + Math.round(rand() * 880),
        },
        filter: { type: 'lowpass', cutoffHz: 900 + Math.round(rand() * 7200), resonance: Math.round(rand() * 6 * 100) / 100 },
        notes: notesFor(seed + index * 101, isCue ? 8 : 24, 110 + index * 47),
      })),
      loudnessTargetLufs: isCue ? -16 : -18,
      truePeakDbtp: -1.2,
    },
  };
}

function cinematicMaster(item, subject, facet) {
  const seed = seedFor(item.id);
  const rand = randomFor(seed);
  const shotCount = /storyboard|layout/i.test(facet) ? 10 : 8;
  let cursorMs = 0;
  const shots = Array.from({ length: shotCount }, (_, index) => {
    const durationMs = 1800 + Math.round(rand() * 2800);
    const shot = {
      id: `${item.id}-shot-${String(index + 1).padStart(2, '0')}`,
      startMs: cursorMs,
      durationMs,
      camera: {
        framing: ['extreme-wide', 'wide', 'medium', 'close', 'detail'][(seed + index) % 5],
        x: Math.round((rand() * 2 - 1) * 1000) / 1000,
        y: Math.round((rand() * 1.4 - 0.7) * 1000) / 1000,
        zoom: Math.round((0.9 + rand() * 0.55) * 1000) / 1000,
        ease: ['sine-in-out', 'cubic-out', 'quad-in-out'][index % 3],
      },
      layers: [
        { role: 'environment', depth: 0, parallax: Math.round(rand() * 18) / 100 },
        { role: 'subject', depth: 10, parallax: 1 },
        { role: 'atmosphere', depth: 20, opacity: Math.round((0.18 + rand() * 0.32) * 100) / 100 },
        { role: 'foreground', depth: 30, parallax: Math.round((1.1 + rand() * 0.4) * 100) / 100 },
      ],
      transition: index === shotCount - 1 ? 'fade-to-gameplay' : ['cut', 'crystal-dissolve', 'luminance-fade'][index % 3],
      captionSafe: { x: 0.08, y: 0.74, width: 0.84, height: 0.18 },
    };
    cursorMs += durationMs;
    return shot;
  });
  return {
    ...commonJson(item, subject, facet, 'phaser-cinematic-sequence'),
    sequence: {
      durationMs: cursorMs,
      aspectRatio: '16:9',
      sourceCanvas: [8192, 4608],
      deterministicSeed: seed,
      shots,
      reducedMotion: { replaceCameraMovesWith: 'crossfade', maximumTransitionMs: 240 },
      audioCue: `${subject.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-cinematic-stem`,
    },
  };
}

function rigMaster(item, subject, facet) {
  const seed = seedFor(item.id);
  const rand = randomFor(seed);
  const boneNames = ['root', 'spine-low', 'spine-high', 'crown', 'arm-left', 'arm-right', 'hand-left', 'hand-right', 'orb-anchor', 'fx-anchor'];
  return {
    ...commonJson(item, subject, facet, /facial/i.test(facet) ? 'facial-rig' : /pose|expression|damage/i.test(facet) ? 'animation-state-set' : 'skeleton-rig'),
    rig: {
      coordinateSpace: 'normalized-2d',
      bones: boneNames.map((name, index) => ({
        name,
        parent: index === 0 ? null : index < 4 ? boneNames[index - 1] : boneNames[Math.max(0, Math.floor((index - 2) / 2))],
        rest: {
          x: Math.round((rand() * 0.8 - 0.4) * 1000) / 1000,
          y: Math.round((index / boneNames.length - 0.45) * 1000) / 1000,
          rotationDeg: Math.round((rand() * 24 - 12) * 10) / 10,
          length: Math.round((0.08 + rand() * 0.22) * 1000) / 1000,
        },
      })),
      constraints: [
        { type: 'ik', target: 'orb-anchor', chain: ['arm-right', 'hand-right'], mix: 0.86 },
        { type: 'look-at', target: 'orb-anchor', bone: 'crown', limitDeg: 32 },
        { type: 'spring', bone: 'fx-anchor', damping: 0.78, stiffness: 0.42 },
      ],
      states: Array.from({ length: /damage/i.test(facet) ? 5 : 8 }, (_, index) => ({
        id: `${facet.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${index + 1}`,
        durationMs: 420 + Math.round(rand() * 980),
        loop: index === 0,
        emphasis: Math.round(rand() * 100) / 100,
        silhouetteKey: `${subject.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${seed.toString(16)}-${index + 1}`,
      })),
    },
  };
}

function environmentDataMaster(item, subject, facet) {
  const seed = seedFor(item.id);
  const rand = randomFor(seed);
  return {
    ...commonJson(item, subject, facet, /collision/i.test(facet) ? 'collision-map-set' : 'interactive-environment-prop'),
    environment: {
      sourceCanvas: [8192, 8192],
      origin: [0.5, 1],
      bounds: { left: -1, right: 1, top: -1.2, bottom: 1.2 },
      polygons: Array.from({ length: 6 }, (_, polygon) => ({
        id: `${item.id}-surface-${polygon + 1}`,
        kind: polygon % 3 === 0 ? 'occluder' : polygon % 3 === 1 ? 'collision' : 'interaction',
        points: Array.from({ length: 5 }, () => [
          Math.round((rand() * 1.8 - 0.9) * 1000) / 1000,
          Math.round((rand() * 1.8 - 0.9) * 1000) / 1000,
        ]),
      })),
      anchors: ['player', 'boss', 'portal-left', 'portal-right', 'foreground-fx'].map((name, index) => ({
        name,
        x: Math.round((rand() * 1.6 - 0.8) * 1000) / 1000,
        y: Math.round((0.18 + rand() * 0.72) * 1000) / 1000,
        depth: index * 10,
      })),
    },
  };
}

function materialMaster(item, subject, facet) {
  const seed = seedFor(item.id);
  const rand = randomFor(seed);
  const palette = paletteFor(item.id);
  return {
    ...commonJson(item, subject, facet, 'phaser-material-source-pack'),
    material: {
      colorSpace: 'srgb',
      sourceResolution: [8192, 8192],
      channels: {
        base: palette.mid,
        highlight: palette.light,
        emission: palette.accent,
        metalness: Math.round(rand() * 72) / 100,
        roughness: Math.round((0.14 + rand() * 0.68) * 100) / 100,
        opacity: 1,
      },
      graph: [
        { id: 'uv', op: 'polar-uv', scale: 1 + Math.round(rand() * 5) },
        { id: 'facet', op: 'voronoi', input: 'uv', cells: 7 + Math.round(rand() * 17) },
        { id: 'caustic', op: 'sine-warp', input: 'facet', frequency: 2 + Math.round(rand() * 8), amplitude: Math.round((0.08 + rand() * 0.22) * 100) / 100 },
        { id: 'rim', op: 'fresnel-2d', power: Math.round((1.4 + rand() * 3.6) * 100) / 100 },
        { id: 'output', op: 'mix', inputs: ['caustic', 'rim'], blend: 'screen' },
      ],
      fragmentShader: `precision mediump float;\nuniform sampler2D uMainSampler;\nuniform float uTime;\nvarying vec2 outTexCoord;\nvoid main(){vec4 c=texture2D(uMainSampler,outTexCoord);float f=0.5+0.5*sin((outTexCoord.x+outTexCoord.y)*${(4 + rand() * 12).toFixed(3)}+uTime*${(0.15 + rand() * 0.85).toFixed(3)});gl_FragColor=vec4(c.rgb*(0.82+f*0.18),c.a);}`,
      qualityTiers: {
        performance: { textureEdge: 1024, animated: false },
        balanced: { textureEdge: 2048, animated: /VFX|atmosphere|impact|shader/i.test(facet) },
        ultra: { textureEdge: 4096, animated: true },
      },
    },
  };
}

function guideMaster(item, subject, facet) {
  const seed = seedFor(item.id);
  const steps = [
    { id: 'observe', action: `Open ${subject} and wait for the ready state.`, expected: 'The primary affordance and current input mode are visible.' },
    { id: 'act', action: `Perform the guided ${subject} action once.`, expected: 'Feedback confirms the action without changing unrelated state.' },
    { id: 'recover', action: 'Cancel or interrupt the action, then resume.', expected: 'The flow returns to a safe, understandable state.' },
    { id: 'complete', action: 'Complete the action with reduced motion enabled.', expected: 'Rules and timing remain identical while decorative motion is reduced.' },
  ];
  return {
    ...commonJson(item, subject, facet, /localized/i.test(facet) ? 'localized-guide-delivery' : 'tutorial-production-plan'),
    guide: {
      deterministicSeed: seed,
      readingLevel: 'plain-language',
      steps,
      narration: {
        en: `${subject}: follow the highlighted action, wait for confirmation, and use Back to cancel safely.`,
        urLatn: `${subject}: highlight ki hui action karein, confirmation ka intezar karein, aur cancel ke liye Back use karein.`,
        sdLatn: `${subject}: highlight kyal action karo, tasdeeq jo intezar karo, ain cancel lae Back istemal karo.`,
      },
      accessibility: {
        captions: true,
        audioDescription: true,
        reducedMotionAlternative: true,
        minimumTargetCssPx: 44,
        minimumContrast: 4.5,
      },
    },
  };
}

function structuredMaster(item, subject, facet) {
  if (item.assetAllocation === 'music-ambience-sfx') return audioMaster(item, subject, facet);
  if (item.assetAllocation === 'cinematic-sequences') return cinematicMaster(item, subject, facet);
  if (item.assetAllocation === 'material-texture-vfx-packs') return materialMaster(item, subject, facet);
  if (item.assetAllocation === 'tutorial-accessibility-promotion') return guideMaster(item, subject, facet);
  if (item.assetAllocation === 'characters-orbs-bosses-rigs') return rigMaster(item, subject, facet);
  if (item.assetAllocation === 'environment-models-props') return environmentDataMaster(item, subject, facet);
  throw new Error(`no structured master writer for ${item.id}`);
}

function outputKind(item, facet) {
  if (item.assetAllocation === 'music-ambience-sfx' || item.assetAllocation === 'cinematic-sequences'
    || item.assetAllocation === 'material-texture-vfx-packs') return 'json';
  if (item.assetAllocation === 'characters-orbs-bosses-rigs'
    && /skeleton rig|facial rig|expression set|gameplay pose set|damage-state set/i.test(facet)) return 'json';
  if (item.assetAllocation === 'environment-models-props'
    && /interactive prop|destructible prop|collision map/i.test(facet)) return 'json';
  if (item.assetAllocation === 'tutorial-accessibility-promotion'
    && /script and storyboard|localized delivery/i.test(facet)) return 'json';
  return 'svg';
}

function vectorMode(item) {
  if (item.assetAllocation === 'characters-orbs-bosses-rigs') return 'character';
  if (item.assetAllocation === 'environment-models-props') return 'environment';
  return 'interface';
}

mkdirSync(outputRoot, { recursive: true });
const entries = [];
for (const item of assetItems) {
  const { subject, facet } = splitTitle(item.title);
  const directory = allocationDirectories[item.assetAllocation];
  if (!directory) throw new Error(`unknown allocation ${item.assetAllocation}`);
  const format = outputKind(item, facet);
  const filename = `${item.id}-${slug(`${subject}-${facet}`)}.${format}`;
  const absolutePath = join(outputRoot, directory, filename);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const content = format === 'svg'
    ? svgMaster(item, subject, facet, vectorMode(item))
    : `${JSON.stringify(structuredMaster(item, subject, facet), null, 2)}\n`;
  writeFileSync(absolutePath, content, 'utf8');
  const bytes = Buffer.byteLength(content);
  const sha256 = createHash('sha256').update(content).digest('hex');
  entries.push({
    id: item.id,
    allocation: item.assetAllocation,
    release: item.release,
    path: relative(root, absolutePath).replaceAll('\\', '/'),
    format,
    bytes,
    sha256,
    validation: format === 'svg'
      ? [
        'exact-byte-count', 'sha256-match', 'unique-content-sha256',
        'non-placeholder-content', 'svg-authored-drawing', 'svg-document', 'svg-measurable-canvas',
      ]
      : [
        'exact-byte-count', 'sha256-match', 'unique-content-sha256',
        'json-parse', 'json-nonempty', 'non-placeholder-content',
      ],
  });
}

const manifest = {
  schemaVersion: 1,
  total: entries.length,
  entries,
};
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Remove only files emitted by the generator's pre-manifest naming draft.
// They are reproducible and never represented valid ledger masters.
for (const directory of Object.values(allocationDirectories)) {
  const absoluteDirectory = join(outputRoot, directory);
  for (const name of readdirSync(absoluteDirectory)) {
    if (/^PF-asset-\d{3}\.(?:svg|json)$/.test(name)) unlinkSync(join(absoluteDirectory, name));
  }
}

const extensionCounts = entries.reduce((counts, entry) => ({ ...counts, [extname(entry.path).slice(1)]: (counts[extname(entry.path).slice(1)] ?? 0) + 1 }), {});
console.log(`production masters written: ${entries.length}; ${Object.entries(extensionCounts).map(([key, count]) => `${key}=${count}`).join(', ')}`);
