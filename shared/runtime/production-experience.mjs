export const PRODUCTION_EXPERIENCE_SCHEMA_VERSION = 1;
export const PRODUCTION_EXPERIENCE_PAGE_SIZE = 10;
export const PRODUCTION_EXPERIENCE_CATEGORIES = Object.freeze([
  'ux-element',
  'animated-element',
  'animation',
]);

const CATEGORY_TOTAL = 500;
const RELEASE_TOTAL = 5;
const ACCEPTANCE_PATTERN = /^AT-(PF-(ux-element|animated-element|animation)-(\d{3}))$/;
const EASES = Object.freeze(['Linear', 'Sine.easeInOut', 'Cubic.easeOut', 'Back.easeOut']);
const ACTION_FACETS = new Set(['primary action', 'secondary action', 'confirmation', 'undo notice']);
const STATUS_FACETS = new Set([
  'status badge', 'progress indicator', 'loading skeleton', 'empty message', 'error message',
  'numeric readout', 'reduced-motion state',
]);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!record(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort().join('\0');
  if (actual !== [...expected].sort().join('\0')) throw new Error(`${label} has an invalid shape`);
}

function finite(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function splitTitle(title) {
  const separator = title.indexOf(' — ');
  if (separator < 1 || separator >= title.length - 3) throw new Error(`experience title is not canonical: ${title}`);
  return [title.slice(0, separator).trim(), title.slice(separator + 3).trim()];
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function roleForFacet(facet) {
  if (ACTION_FACETS.has(facet)) return 'button';
  if (facet === 'tooltip') return 'tooltip';
  if (facet === 'icon label') return 'img';
  if (facet === 'responsive container') return 'region';
  if (facet === 'keyboard hint' || facet === 'controller hint' || facet === 'touch hint' || facet === 'hand hint') return 'note';
  if (facet === 'error message') return 'alert';
  if (facet === 'screen-reader description') return 'definition';
  if (facet === 'progress indicator') return 'progressbar';
  return 'status';
}

function eventForFacet(facet) {
  if (ACTION_FACETS.has(facet)) return facet === 'undo notice' ? 'undo' : 'activate';
  if (facet === 'focus target' || facet.endsWith(' hint') || facet === 'tooltip') return 'focus';
  if (facet === 'error message') return 'recover';
  if (STATUS_FACETS.has(facet)) return 'observe';
  return 'inspect';
}

function createUxSpec({ subject, facet, seed }) {
  const role = roleForFacet(facet);
  const event = eventForFacet(facet);
  const focusable = role === 'button' || facet === 'focus target' || facet === 'tooltip';
  const liveRegion = facet === 'error message' ? 'assertive'
    : STATUS_FACETS.has(facet) || facet === 'undo notice' ? 'polite' : 'off';
  return {
    kind: 'ux',
    component: {
      primitive: role === 'button' ? 'action' : role === 'progressbar' ? 'meter' : role === 'img' ? 'icon' : 'panel',
      role,
      label: `${subject} ${facet}`,
      description: `${facet} for ${subject}; deterministic feedback remains equivalent across pointer, keyboard, touch and hand input.`,
      focusable,
      liveRegion,
      minWidth: 144 + (seed % 5) * 16,
      maxWidth: 520 + (seed % 5) * 32,
      minHeight: 44 + (seed % 3) * 4,
      padding: 12 + (seed % 4) * 2,
      radius: 10 + (seed % 8),
      accentHue: seed % 360,
    },
    interaction: {
      event,
      keyboard: focusable ? ['Enter', 'Space'] : [],
      disabledPolicy: 'block-action-announce-reason',
      confirmation: facet === 'confirmation',
      undoWindowMs: facet === 'undo notice' ? 5000 : 0,
    },
    feedback: {
      visual: facet === 'error message' ? 'error-emphasis' : event === 'activate' ? 'pressed-confirmation' : 'state-emphasis',
      audio: event === 'activate' || event === 'undo' ? 'ui-confirm' : 'none',
      announcement: liveRegion === 'off' ? 'on-focus' : 'on-change',
      latencyBudgetMs: 50 + (seed % 4) * 10,
    },
    states: ['idle', focusable ? 'focused' : 'observed', 'disabled', facet === 'error message' ? 'error' : 'confirmed'],
  };
}

function channel(seed, index, range, base = 0) {
  const signed = ((seed >>> (index * 3)) % (range * 2 + 1)) - range;
  return base + signed;
}

function createMotionSpec({ subject, facet, seed }) {
  const reducedFacet = facet === 'reduced-motion substitute';
  const poolResetFacet = facet === 'pool reset';
  const cullingFacet = facet === 'offscreen culling';
  return {
    kind: 'motion',
    actor: {
      primitive: subject.includes('bubble') || subject.includes('orb') || subject.includes('token') ? 'circle' : 'diamond',
      label: `${subject} ${facet}`,
      accentHue: seed % 360,
      size: 48 + (seed % 5) * 8,
    },
    timeline: {
      durationMs: 320 + (seed % 9) * 80,
      delayMs: (seed % 5) * 20,
      repeat: facet.includes('idle') || facet.includes('loading') || facet.includes('progress') ? 2 : 0,
      yoyo: facet.includes('idle') || facet.includes('attention') || facet.includes('hover'),
      ease: EASES[seed % EASES.length],
      canonicalMarker: 0.25 + (seed % 3) * 0.25,
    },
    channels: {
      x: channel(seed, 0, 18),
      y: channel(seed, 1, 18),
      scale: 1 + channel(seed, 2, 12) / 100,
      rotation: channel(seed, 3, 14) / 100,
      alpha: 0.72 + (seed % 25) / 100,
    },
    reducedMotion: {
      durationMs: reducedFacet ? 1 : 120,
      substitute: 'opacity-only',
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      alpha: 1,
    },
    lifecycle: {
      pauseSafe: facet === 'pause behavior' || facet === 'resume behavior',
      cullOffscreen: cullingFacet,
      pooled: poolResetFacet || subject.includes('bubble') || subject.includes('cluster'),
      resetAtMs: poolResetFacet ? 0 : null,
    },
  };
}

function createClipSpec({ subject, facet, seed }) {
  const durationMs = 480 + (seed % 13) * 120;
  const x = channel(seed, 0, 24);
  const y = channel(seed, 1, 24);
  const rotation = channel(seed, 2, 18) / 100;
  const scale = 1 + channel(seed, 3, 14) / 100;
  const reducedFacet = facet === 'reduced-motion variant';
  return {
    kind: 'clip',
    actor: {
      primitive: subject.includes('bubble') || subject.includes('blast') || subject.includes('burst') ? 'circle' : 'hex',
      label: `${subject} ${facet}`,
      accentHue: seed % 360,
      size: 52 + (seed % 5) * 8,
    },
    clip: {
      durationMs,
      ease: EASES[seed % EASES.length],
      loop: facet === 'idle loop',
      pauseSafe: facet === 'pause-safe variant',
      replayMarkerMs: Math.round(durationMs * (0.25 + (seed % 3) * 0.25)),
      audioMarkerMs: facet === 'audio-synced cue' ? Math.round(durationMs * 0.5) : null,
      keyframes: [
        { at: 0, x: 0, y: 0, scale: 0.96, rotation: 0, alpha: facet === 'transition in' ? 0 : 1 },
        { at: 0.34, x: Math.round(x * 0.7), y: Math.round(y * 0.7), scale, rotation, alpha: 1 },
        { at: 0.68, x, y, scale: Math.max(0.8, 2 - scale), rotation: rotation === 0 ? 0 : -rotation, alpha: 0.92 },
        { at: 1, x: 0, y: 0, scale: 1, rotation: 0, alpha: facet === 'transition out' ? 0 : 1 },
      ],
    },
    reducedMotion: {
      durationMs: reducedFacet ? 1 : 120,
      substitute: 'crossfade',
      keyframes: [
        { at: 0, x: 0, y: 0, scale: 1, rotation: 0, alpha: 0.88 },
        { at: 1, x: 0, y: 0, scale: 1, rotation: 0, alpha: 1 },
      ],
    },
    lifecycle: {
      pooled: subject.includes('bubble') || subject.includes('particle') || subject.includes('trail'),
      resetFrame: { x: 0, y: 0, scale: 1, rotation: 0, alpha: 1 },
    },
  };
}

export function createProductionExperienceEntry(item) {
  if (!record(item)) throw new Error('ledger experience item must be an object');
  const { id, acceptanceTest, category, ordinal, release, title } = item;
  const match = typeof acceptanceTest?.id === 'string' ? ACCEPTANCE_PATTERN.exec(acceptanceTest.id) : null;
  if (!match || match[1] !== id || match[2] !== category || Number(match[3]) !== ordinal
    || !PRODUCTION_EXPERIENCE_CATEGORIES.includes(category)
    || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > CATEGORY_TOTAL
    || !Number.isInteger(release) || release !== Math.ceil(ordinal / 100)
    || typeof title !== 'string') {
    throw new Error(`ledger experience identity is invalid: ${String(id)}`);
  }
  const [subject, facet] = splitTitle(title);
  const seed = fnv1a(`${id}|${acceptanceTest.id}|${title}`);
  const common = { subject, facet, seed };
  const specification = category === 'ux-element'
    ? createUxSpec(common)
    : category === 'animated-element'
      ? createMotionSpec(common)
      : createClipSpec(common);
  return {
    schemaVersion: PRODUCTION_EXPERIENCE_SCHEMA_VERSION,
    id,
    acceptanceId: acceptanceTest.id,
    category,
    ordinal,
    release,
    title,
    subject,
    facet,
    behaviorFingerprint: `PX-${slug(category)}-${String(ordinal).padStart(3, '0')}-${seed.toString(16).padStart(8, '0')}`,
    specification,
  };
}

function validateActor(actor, label) {
  exactKeys(actor, ['primitive', 'label', 'accentHue', 'size'], label);
  if (!['circle', 'diamond', 'hex'].includes(actor.primitive) || typeof actor.label !== 'string' || actor.label.length < 3
    || !Number.isInteger(actor.accentHue) || !finite(actor.accentHue, 0, 359)
    || !Number.isInteger(actor.size) || !finite(actor.size, 44, 96)) throw new Error(`${label} is invalid`);
}

function validateFrame(frame, label) {
  exactKeys(frame, ['at', 'x', 'y', 'scale', 'rotation', 'alpha'], label);
  if (!finite(frame.at, 0, 1) || !finite(frame.x, -32, 32) || !finite(frame.y, -32, 32)
    || !finite(frame.scale, 0.75, 1.25) || !finite(frame.rotation, -0.25, 0.25)
    || !finite(frame.alpha, 0, 1)) throw new Error(`${label} exceeds production bounds`);
}

export function validateProductionExperienceEntry(value) {
  exactKeys(value, [
    'schemaVersion', 'id', 'acceptanceId', 'category', 'ordinal', 'release', 'title',
    'subject', 'facet', 'behaviorFingerprint', 'specification',
  ], 'production experience entry');
  const match = typeof value.acceptanceId === 'string' ? ACCEPTANCE_PATTERN.exec(value.acceptanceId) : null;
  if (value.schemaVersion !== PRODUCTION_EXPERIENCE_SCHEMA_VERSION || !match || match[1] !== value.id
    || match[2] !== value.category || Number(match[3]) !== value.ordinal
    || !PRODUCTION_EXPERIENCE_CATEGORIES.includes(value.category)
    || value.release !== Math.ceil(value.ordinal / 100)
    || typeof value.title !== 'string' || value.title !== `${value.subject} — ${value.facet}`
    || typeof value.behaviorFingerprint !== 'string' || !/^PX-[a-z-]+-\d{3}-[a-f0-9]{8}$/.test(value.behaviorFingerprint)) {
    throw new Error(`production experience identity is invalid: ${String(value.id)}`);
  }
  const spec = value.specification;
  if (value.category === 'ux-element') {
    exactKeys(spec, ['kind', 'component', 'interaction', 'feedback', 'states'], `${value.id} UX specification`);
    if (spec.kind !== 'ux') throw new Error(`${value.id} UX kind is invalid`);
    exactKeys(spec.component, [
      'primitive', 'role', 'label', 'description', 'focusable', 'liveRegion', 'minWidth', 'maxWidth',
      'minHeight', 'padding', 'radius', 'accentHue',
    ], `${value.id} component`);
    if (!['action', 'meter', 'icon', 'panel'].includes(spec.component.primitive)
      || !['button', 'tooltip', 'img', 'region', 'note', 'alert', 'definition', 'progressbar', 'status'].includes(spec.component.role)
      || typeof spec.component.label !== 'string' || typeof spec.component.description !== 'string'
      || typeof spec.component.focusable !== 'boolean' || !['off', 'polite', 'assertive'].includes(spec.component.liveRegion)
      || !finite(spec.component.minWidth, 144, 208) || !finite(spec.component.maxWidth, 520, 648)
      || spec.component.maxWidth < spec.component.minWidth || !finite(spec.component.minHeight, 44, 52)
      || !finite(spec.component.padding, 12, 18) || !finite(spec.component.radius, 10, 17)
      || !finite(spec.component.accentHue, 0, 359)) throw new Error(`${value.id} component is not renderable or accessible`);
    exactKeys(spec.interaction, ['event', 'keyboard', 'disabledPolicy', 'confirmation', 'undoWindowMs'], `${value.id} interaction`);
    if (!['activate', 'undo', 'focus', 'recover', 'observe', 'inspect'].includes(spec.interaction.event)
      || !Array.isArray(spec.interaction.keyboard) || spec.interaction.keyboard.some((key) => !['Enter', 'Space'].includes(key))
      || spec.interaction.disabledPolicy !== 'block-action-announce-reason'
      || typeof spec.interaction.confirmation !== 'boolean' || !finite(spec.interaction.undoWindowMs, 0, 5000)) {
      throw new Error(`${value.id} interaction contract is invalid`);
    }
    exactKeys(spec.feedback, ['visual', 'audio', 'announcement', 'latencyBudgetMs'], `${value.id} feedback`);
    if (typeof spec.feedback.visual !== 'string' || !['ui-confirm', 'none'].includes(spec.feedback.audio)
      || !['on-focus', 'on-change'].includes(spec.feedback.announcement)
      || !finite(spec.feedback.latencyBudgetMs, 50, 80)) throw new Error(`${value.id} feedback is invalid`);
    if (!Array.isArray(spec.states) || spec.states.length !== 4 || new Set(spec.states).size !== 4) throw new Error(`${value.id} states are invalid`);
  } else if (value.category === 'animated-element') {
    exactKeys(spec, ['kind', 'actor', 'timeline', 'channels', 'reducedMotion', 'lifecycle'], `${value.id} motion specification`);
    if (spec.kind !== 'motion') throw new Error(`${value.id} motion kind is invalid`);
    validateActor(spec.actor, `${value.id} actor`);
    exactKeys(spec.timeline, ['durationMs', 'delayMs', 'repeat', 'yoyo', 'ease', 'canonicalMarker'], `${value.id} timeline`);
    if (!finite(spec.timeline.durationMs, 320, 960) || !finite(spec.timeline.delayMs, 0, 80)
      || !Number.isInteger(spec.timeline.repeat) || !finite(spec.timeline.repeat, 0, 2)
      || typeof spec.timeline.yoyo !== 'boolean' || !EASES.includes(spec.timeline.ease)
      || !finite(spec.timeline.canonicalMarker, 0.25, 0.75)) throw new Error(`${value.id} timeline exceeds bounds`);
    exactKeys(spec.channels, ['x', 'y', 'scale', 'rotation', 'alpha'], `${value.id} motion channels`);
    if (!finite(spec.channels.x, -18, 18) || !finite(spec.channels.y, -18, 18)
      || !finite(spec.channels.scale, 0.88, 1.12) || !finite(spec.channels.rotation, -0.14, 0.14)
      || !finite(spec.channels.alpha, 0.72, 0.96)) throw new Error(`${value.id} channels exceed bounds`);
    exactKeys(spec.reducedMotion, ['durationMs', 'substitute', 'x', 'y', 'scale', 'rotation', 'alpha'], `${value.id} reduced motion`);
    if (!finite(spec.reducedMotion.durationMs, 1, 120) || spec.reducedMotion.substitute !== 'opacity-only'
      || spec.reducedMotion.x !== 0 || spec.reducedMotion.y !== 0 || spec.reducedMotion.scale !== 1
      || spec.reducedMotion.rotation !== 0 || spec.reducedMotion.alpha !== 1) throw new Error(`${value.id} reduced motion is unsafe`);
    exactKeys(spec.lifecycle, ['pauseSafe', 'cullOffscreen', 'pooled', 'resetAtMs'], `${value.id} lifecycle`);
    if (typeof spec.lifecycle.pauseSafe !== 'boolean' || typeof spec.lifecycle.cullOffscreen !== 'boolean'
      || typeof spec.lifecycle.pooled !== 'boolean' || (spec.lifecycle.resetAtMs !== null && spec.lifecycle.resetAtMs !== 0)) {
      throw new Error(`${value.id} lifecycle is invalid`);
    }
  } else {
    exactKeys(spec, ['kind', 'actor', 'clip', 'reducedMotion', 'lifecycle'], `${value.id} clip specification`);
    if (spec.kind !== 'clip') throw new Error(`${value.id} clip kind is invalid`);
    validateActor(spec.actor, `${value.id} actor`);
    exactKeys(spec.clip, ['durationMs', 'ease', 'loop', 'pauseSafe', 'replayMarkerMs', 'audioMarkerMs', 'keyframes'], `${value.id} clip`);
    if (!finite(spec.clip.durationMs, 480, 1920) || !EASES.includes(spec.clip.ease)
      || typeof spec.clip.loop !== 'boolean' || typeof spec.clip.pauseSafe !== 'boolean'
      || !finite(spec.clip.replayMarkerMs, 0, spec.clip.durationMs)
      || (spec.clip.audioMarkerMs !== null && !finite(spec.clip.audioMarkerMs, 0, spec.clip.durationMs))
      || !Array.isArray(spec.clip.keyframes) || spec.clip.keyframes.length !== 4) throw new Error(`${value.id} clip is invalid`);
    spec.clip.keyframes.forEach((frame, index) => validateFrame(frame, `${value.id} keyframe ${index}`));
    if (spec.clip.keyframes.some((frame, index) => index > 0 && frame.at <= spec.clip.keyframes[index - 1].at)) {
      throw new Error(`${value.id} keyframe order is invalid`);
    }
    exactKeys(spec.reducedMotion, ['durationMs', 'substitute', 'keyframes'], `${value.id} reduced clip`);
    if (!finite(spec.reducedMotion.durationMs, 1, 120) || spec.reducedMotion.substitute !== 'crossfade'
      || !Array.isArray(spec.reducedMotion.keyframes) || spec.reducedMotion.keyframes.length !== 2) {
      throw new Error(`${value.id} reduced clip is invalid`);
    }
    spec.reducedMotion.keyframes.forEach((frame, index) => validateFrame(frame, `${value.id} reduced keyframe ${index}`));
    exactKeys(spec.lifecycle, ['pooled', 'resetFrame'], `${value.id} clip lifecycle`);
    if (typeof spec.lifecycle.pooled !== 'boolean') throw new Error(`${value.id} pooling flag is invalid`);
    validateFrame({ at: 0, ...spec.lifecycle.resetFrame }, `${value.id} reset frame`);
  }
  return value;
}

function easeProgress(progress, ease) {
  const bounded = Math.max(0, Math.min(1, progress));
  if (ease === 'Sine.easeInOut') return -(Math.cos(Math.PI * bounded) - 1) / 2;
  if (ease === 'Cubic.easeOut') return 1 - ((1 - bounded) ** 3);
  if (ease === 'Back.easeOut') {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return Math.max(0, Math.min(1, 1 + c3 * ((bounded - 1) ** 3) + c1 * ((bounded - 1) ** 2)));
  }
  return bounded;
}

function interpolateFrames(frames, progress) {
  if (progress <= frames[0].at) return { ...frames[0] };
  const last = frames[frames.length - 1];
  if (progress >= last.at) return { ...last };
  const rightIndex = frames.findIndex((frame) => frame.at >= progress);
  const left = frames[rightIndex - 1];
  const right = frames[rightIndex];
  const local = (progress - left.at) / (right.at - left.at);
  return {
    at: progress,
    x: left.x + (right.x - left.x) * local,
    y: left.y + (right.y - left.y) * local,
    scale: left.scale + (right.scale - left.scale) * local,
    rotation: left.rotation + (right.rotation - left.rotation) * local,
    alpha: left.alpha + (right.alpha - left.alpha) * local,
  };
}

export function runProductionExperienceOracle(entryValue, input = {}) {
  const entry = validateProductionExperienceEntry(entryValue);
  const timeMs = finite(input.timeMs, 0, 86_400_000) ? input.timeMs : 0;
  const action = typeof input.action === 'string' ? input.action : 'idle';
  const reducedMotion = input.reducedMotion === true;
  const paused = input.paused === true;
  const offscreen = input.offscreen === true;
  let frame = { x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, progress: 0, visible: true };
  let state = 'idle';
  let feedback = { visual: 'none', audio: 'none', announcement: 'none' };
  let reset = action === 'reset';

  if (entry.category === 'ux-element') {
    const spec = entry.specification;
    const allowedAction = action === spec.interaction.event || action === 'focus' || action === 'observe';
    const disabled = action === 'disabled';
    state = disabled ? 'disabled' : allowedAction ? (action === 'focus' ? 'focused' : 'confirmed') : 'idle';
    frame.scale = disabled ? 0.98 : allowedAction ? 1.02 : 1;
    frame.alpha = disabled ? 0.55 : 1;
    frame.progress = (timeMs % 1000) / 1000;
    feedback = {
      visual: disabled ? 'disabled-reason' : allowedAction ? spec.feedback.visual : 'none',
      audio: disabled ? 'none' : allowedAction ? spec.feedback.audio : 'none',
      announcement: disabled ? 'Action unavailable' : allowedAction ? spec.component.description : 'none',
    };
  } else if (entry.category === 'animated-element') {
    const spec = entry.specification;
    if (reset) {
      frame = { x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, progress: 0, visible: true };
      state = 'reset';
    } else if (reducedMotion) {
      frame = { ...spec.reducedMotion, progress: 1, visible: true };
      delete frame.durationMs;
      delete frame.substitute;
      state = 'reduced';
    } else {
      const elapsed = Math.max(0, (paused ? 0 : timeMs) - spec.timeline.delayMs);
      const raw = (elapsed % spec.timeline.durationMs) / spec.timeline.durationMs;
      const cycle = Math.floor(elapsed / spec.timeline.durationMs);
      const progress = spec.timeline.yoyo && cycle % 2 === 1 ? 1 - raw : raw;
      const eased = easeProgress(progress, spec.timeline.ease);
      frame = {
        x: spec.channels.x * eased,
        y: spec.channels.y * eased,
        scale: 1 + (spec.channels.scale - 1) * eased,
        rotation: spec.channels.rotation * eased,
        alpha: 1 + (spec.channels.alpha - 1) * eased,
        progress,
        visible: !(offscreen && spec.lifecycle.cullOffscreen),
      };
      state = paused ? 'paused' : frame.visible ? 'playing' : 'culled';
    }
    feedback = { visual: state, audio: 'none', announcement: state === 'culled' ? 'Animation culled offscreen' : 'none' };
  } else {
    const spec = entry.specification;
    if (reset) {
      frame = { ...spec.lifecycle.resetFrame, progress: 0, visible: true };
      state = 'reset';
    } else {
      const timeline = reducedMotion ? spec.reducedMotion : spec.clip;
      const duration = timeline.durationMs;
      const effective = paused && spec.clip.pauseSafe ? 0 : timeMs;
      const raw = spec.clip.loop ? (effective % duration) / duration : Math.min(1, effective / duration);
      const progress = easeProgress(raw, reducedMotion ? 'Linear' : spec.clip.ease);
      const sampled = interpolateFrames(timeline.keyframes, progress);
      frame = { x: sampled.x, y: sampled.y, scale: sampled.scale, rotation: sampled.rotation, alpha: sampled.alpha, progress, visible: !offscreen };
      state = paused && spec.clip.pauseSafe ? 'paused' : raw >= 1 && !spec.clip.loop ? 'complete' : reducedMotion ? 'reduced' : 'playing';
    }
    feedback = {
      visual: state,
      audio: spec.clip.audioMarkerMs !== null && timeMs >= spec.clip.audioMarkerMs ? 'timeline-cue' : 'none',
      announcement: 'none',
    };
  }

  for (const value of [frame.x, frame.y, frame.scale, frame.rotation, frame.alpha, frame.progress]) {
    if (!Number.isFinite(value)) throw new Error(`${entry.id} oracle emitted a non-finite frame`);
  }
  if (!finite(frame.x, -32, 32) || !finite(frame.y, -32, 32) || !finite(frame.scale, 0.75, 1.25)
    || !finite(frame.rotation, -0.25, 0.25) || !finite(frame.alpha, 0, 1) || !finite(frame.progress, 0, 1)) {
    throw new Error(`${entry.id} oracle emitted an out-of-bounds frame`);
  }
  return {
    id: entry.id,
    acceptanceId: entry.acceptanceId,
    kind: entry.specification.kind,
    state,
    frame,
    feedback,
    reset,
    accessibility: entry.category === 'ux-element' ? {
      role: entry.specification.component.role,
      label: entry.specification.component.label,
      description: entry.specification.component.description,
      focusable: entry.specification.component.focusable,
      liveRegion: entry.specification.component.liveRegion,
      keyboard: entry.specification.interaction.keyboard,
    } : {
      role: 'img',
      label: entry.specification.actor.label,
      description: `${entry.facet} motion preview for ${entry.subject}`,
      focusable: false,
      liveRegion: 'off',
      keyboard: [],
    },
  };
}

export function productionExperienceTestFullName(entryOrItem, target) {
  const acceptanceId = entryOrItem.acceptanceId ?? entryOrItem.acceptanceTest?.id;
  if (typeof acceptanceId !== 'string' || !['shared', 'phaser'].includes(target)) throw new Error('invalid experience evidence identity');
  const purpose = target === 'shared'
    ? 'executes the canonical accessible bounded behavior oracle'
    : 'renders the canonical behavior through the bounded Phaser executor';
  return `production experience ${target} evidence [${acceptanceId}][${target}] ${purpose}`;
}
