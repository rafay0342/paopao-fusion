import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { WebSocketServer } from 'ws';
import {
  ENDLESS_REPLAY_RULES,
  simulateEndlessReplay,
  validateEndlessShotTrace,
} from '../shared/runtime/endless-replay.mjs';
import {
  ARENA_REPLAY_RULES,
  appendArenaShot,
  simulateArenaReplay,
} from '../shared/runtime/arena-replay.mjs';
import {
  CLASSIC_AUTHORITY_RULES,
  classicAuthorityMinimumDurationMs,
  classicAuthorityRequiredShots,
  classicAuthorityTarget,
  evaluateClassicAuthorityTrace,
} from '../shared/runtime/classic-authority.mjs';
import { classicFirstClearReward } from '../shared/runtime/classic-economy.mjs';
import { signPublicPayload } from './signing-keyring.mjs';
import { installSocialPlatform, SOCIAL_BUNDLES } from './social-platform.mjs';

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomBytes(16).toString('base64url')}`;
const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};
const canonicalJson = (value) => JSON.stringify(canonicalize(value));
export const canonicalLiveEventChallengePayload = (event, endless) => canonicalJson({
  id: event.id,
  kind: event.kind,
  boss: event.boss,
  level: event.level,
  seed: event.seed,
  modifier: event.modifier,
  reward: event.reward,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  seasonId: endless.seasonId,
  rulesVersion: endless.rulesVersion,
});
const REPLAY_TRACE_VERSION = ENDLESS_REPLAY_RULES.replayVersion;
const MAX_REPLAY_SHOTS = ENDLESS_REPLAY_RULES.maximumShots;
const SEASON_POINTS_PER_TIER = 500;
const canonicalReplayPayload = (run) => ({
  replayVersion: REPLAY_TRACE_VERSION,
  rulesVersion: ENDLESS_REPLAY_RULES.rulesVersion,
  contentVersion: run.contentVersion,
  seasonId: run.seasonId,
  seed: run.seed,
  level: run.level,
  mode: run.mode,
  wave: run.wave,
  durationMs: run.durationMs,
  shotTrace: run.shotTrace,
  ...(run.eventId ? { eventId: run.eventId } : {}),
});
const replayTraceIntegrity = (run, event) => {
  if (run.shotTrace === undefined) {
    return {
      ok: true,
      verification: {
        status: 'unverified', authoritative: false, rewardEligible: false,
        reason: 'authoritative-shot-trace-required',
      },
    };
  }
  if (run.replayVersion !== REPLAY_TRACE_VERSION) {
    return { ok: false, error: 'replay-version-unsupported' };
  }
  if (!Number.isInteger(run.shots) || run.shots !== run.shotTrace.length) {
    return { ok: false, error: 'replay-shot-count-mismatch' };
  }
  if (!Number.isInteger(run.hits)) return { ok: false, error: 'replay-result-claims-required' };
  const traceValidation = validateEndlessShotTrace(run.shotTrace, run.durationMs);
  if (!traceValidation.ok) return { ok: false, error: traceValidation.error };
  const canonicalHash = digest(canonicalJson(canonicalReplayPayload(run)));
  if (!secureEqual(canonicalHash, run.replayHash)) return { ok: false, error: 'replay-hash-mismatch' };
  const simulation = simulateEndlessReplay({
    seed: run.seed,
    level: run.level,
    durationMs: run.durationMs,
    shotTrace: run.shotTrace,
    modifier: event?.modifier ?? null,
    eventBoss: Boolean(event),
  });
  if (!simulation.ok) return { ok: false, error: simulation.error };
  const result = simulation.result;
  if (run.score !== result.score || run.hits !== result.hits || run.shots !== result.shots
    || run.wave !== result.wave || run.won !== result.won) {
    return { ok: false, error: 'replay-result-mismatch' };
  }
  return {
    ok: true,
    result,
    verification: {
      status: 'authoritative', authoritative: true, rewardEligible: Boolean(event && result.won),
      reason: 'authoritative-replay-verified', canonicalHash,
      replayVersion: REPLAY_TRACE_VERSION, shotCount: run.shotTrace.length,
      result: {
        score: result.score, hits: result.hits, shots: result.shots, wave: result.wave,
        won: result.won, maxCombo: result.maxCombo, seasonPoints: result.seasonPoints,
        boss: result.boss, stateChecksum: result.stateChecksum,
      },
    },
  };
};
const encodeAuthorityToken = (secret, purpose, payload) => {
  const encoded = Buffer.from(canonicalJson(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${purpose}.${encoded}`).digest('base64url');
  return `${encoded}.${signature}`;
};
const decodeAuthorityToken = (secret, purpose, token) => {
  if (typeof token !== 'string' || token.length < 32 || token.length > 1_024) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(`${purpose}.${encoded}`).digest('base64url');
  if (!secureEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return isPlainRecord(payload) ? payload : null;
  } catch { return null; }
};
const publicClassicTrace = (storedTrace) => storedTrace.map((shot) => ({
  sequence: shot.sequence,
  atMs: shot.atMs,
  angleMilliDegrees: shot.angleMilliDegrees,
}));
const classicReplayIntegrity = (run, { db, userId, signingSecret }) => {
  if (run.shotTrace === undefined || run.replayVersion === undefined) {
    return {
      ok: true,
      verification: {
        status: 'unverified', authoritative: false, rewardEligible: false,
        reason: 'authoritative-shot-trace-required',
      },
    };
  }
  if (run.replayVersion !== REPLAY_TRACE_VERSION) return { ok: false, error: 'replay-version-unsupported' };
  if (!Number.isInteger(run.shots) || run.shots !== run.shotTrace.length) {
    return { ok: false, error: 'replay-shot-count-mismatch' };
  }
  if (!Number.isInteger(run.hits) || run.hits > run.shots) return { ok: false, error: 'replay-result-claims-required' };
  if (!run.classicTicketId || !run.classicTicketToken || !run.classicTerminalChallenge) {
    return { ok: false, error: 'classic-authority-proof-required' };
  }
  const ticket = db.prepare(`SELECT ticket_id AS ticketId,run_id AS runId,user_id AS userId,level,mode,seed,nonce,
    started_at AS startedAt,expires_at AS expiresAt,status,trace_json AS traceJson,
    terminal_challenge_hash AS terminalChallengeHash FROM classic_run_tickets WHERE ticket_id=?`)
    .get(run.classicTicketId);
  if (!ticket || ticket.userId !== userId || ticket.runId !== run.runId
    || ticket.level !== run.level || ticket.mode !== run.mode) {
    return { ok: false, error: 'classic-authority-ticket-mismatch' };
  }
  if (ticket.status !== 'active') return { ok: false, error: 'classic-authority-ticket-consumed' };
  if (Date.parse(ticket.expiresAt) <= Date.now()) return { ok: false, error: 'classic-authority-ticket-expired' };
  const ticketToken = decodeAuthorityToken(signingSecret, 'classic-ticket-v1', run.classicTicketToken);
  if (!ticketToken || ticketToken.ticketId !== ticket.ticketId || ticketToken.runId !== ticket.runId
    || ticketToken.userId !== userId || ticketToken.level !== run.level || ticketToken.mode !== run.mode
    || ticketToken.nonce !== ticket.nonce || ticketToken.startedAt !== ticket.startedAt
    || ticketToken.expiresAt !== ticket.expiresAt) {
    return { ok: false, error: 'classic-authority-ticket-invalid' };
  }
  const storedTrace = json(ticket.traceJson, []);
  if (!Array.isArray(storedTrace)) return { ok: false, error: 'classic-authority-trace-corrupt' };
  const trace = publicClassicTrace(storedTrace);
  if (canonicalJson(trace) !== canonicalJson(run.shotTrace) || run.shots !== trace.length) {
    return { ok: false, error: 'classic-authority-trace-mismatch' };
  }
  const evaluation = evaluateClassicAuthorityTrace({ seed: ticket.seed, level: run.level, shotTrace: trace });
  if (!evaluation.ok) return { ok: false, error: evaluation.error };
  if (!evaluation.result.completed) return { ok: false, error: 'classic-authority-input-proof-incomplete' };
  const terminal = decodeAuthorityToken(signingSecret, 'classic-terminal-v1', run.classicTerminalChallenge);
  const traceHash = digest(canonicalJson(trace));
  if (!terminal || terminal.ticketId !== ticket.ticketId || terminal.runId !== ticket.runId
    || terminal.userId !== userId || terminal.sequence !== trace.length - 1
    || terminal.traceHash !== traceHash || terminal.completed !== true
    || !secureEqual(digest(run.classicTerminalChallenge), ticket.terminalChallengeHash ?? '')) {
    return { ok: false, error: 'classic-authority-terminal-challenge-invalid' };
  }
  const serverDurationMs = Date.now() - Date.parse(ticket.startedAt);
  if (serverDurationMs < classicAuthorityMinimumDurationMs(run.level)
    || run.durationMs < classicAuthorityMinimumDurationMs(run.level)) {
    return { ok: false, error: 'classic-authority-duration-incomplete' };
  }
  const canonicalHash = digest(canonicalJson({
    rulesVersion: CLASSIC_AUTHORITY_RULES.rulesVersion,
    ticketId: ticket.ticketId,
    runId: ticket.runId,
    level: run.level,
    mode: run.mode,
    trace,
    terminalTraceHash: traceHash,
  }));
  const rewardEligible = run.won === true;
  return {
    ok: true,
    classicAuthority: {
      ticketId: ticket.ticketId,
      traceHash,
      result: evaluation.result,
    },
    verification: {
      status: 'authoritative',
      authoritative: true,
      rewardEligible,
      reason: rewardEligible ? 'classic-server-input-proof-verified' : 'classic-win-not-claimed',
      scope: 'server-observed-input-proof',
      replayVersion: REPLAY_TRACE_VERSION,
      shotCount: trace.length,
      canonicalHash,
      proof: {
        rulesVersion: evaluation.result.rulesVersion,
        proofHits: evaluation.result.proofHits,
        requiredProofHits: evaluation.result.requiredProofHits,
        requiredShots: evaluation.result.requiredShots,
      },
    },
  };
};
const cleanEmail = (value) => String(value ?? '').trim().toLowerCase();
const cleanName = (value) => String(value ?? 'PLAYER').trim().slice(0, 20).replace(/[^\p{L}\p{N} _-]/gu, '') || 'PLAYER';
const json = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const secureEqual = (a, b) => {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};
const isPlainRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const cookieValue = (request, name) => {
  for (const rawPart of String(request.headers.cookie ?? '').split(';')) {
    const part = rawPart.trim(); const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator) === name) return part.slice(separator + 1);
  }
  return '';
};
const safeCookieToken = (request, name) => {
  const encoded = cookieValue(request, name);
  if (!encoded || encoded.length > 256) return '';
  try {
    const decoded = decodeURIComponent(encoded);
    return /^[A-Za-z0-9_-]{20,128}$/.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
};
const isLoopback = (address) => {
  const value = String(address ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  return value === '::1' || value === 'localhost' || value.startsWith('127.') || value.startsWith('::ffff:127.');
};
const isExplicitDevelopmentOtp = (request) => {
  if (process.env.PAOPAO_ALLOW_DEV_OTP !== '1') return false;
  const remote = request.ip ?? request.raw.socket.remoteAddress;
  const local = request.raw.socket.localAddress;
  return isLoopback(remote) && (!local || isLoopback(local));
};
const finiteInteger = (value, minimum, maximum, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback;
};
const MAX_PROGRESS_LEVELS = 42;
const ECHO_CREST_ENTITLEMENTS = new Map([
  [31, 'badge:echo-crest-crystal'],
  [33, 'badge:echo-crest-emerald'],
  [35, 'badge:echo-crest-celestial'],
  [37, 'badge:echo-crest-ember'],
  [39, 'badge:echo-crest-frost'],
  [41, 'badge:echo-crest-nexus'],
]);
const progressArray = (value, maximum) => {
  const source = Array.isArray(value) ? value.slice(0, MAX_PROGRESS_LEVELS) : [];
  return Array.from({ length: MAX_PROGRESS_LEVELS }, (_, index) => finiteInteger(source[index], 0, maximum));
};
const progressSet = (value) => Array.from(new Set((Array.isArray(value) ? value : [])
  .slice(0, MAX_PROGRESS_LEVELS)
  .map((entry) => finiteInteger(entry, 0, MAX_PROGRESS_LEVELS - 1, -1))
  .filter((entry) => entry >= 0)));
const normalizeProgress = (value) => {
  const raw = isPlainRecord(value) ? value : {};
  return {
    unlocked: finiteInteger(raw.unlocked, 1, MAX_PROGRESS_LEVELS, 1),
    bestScores: progressArray(raw.bestScores, 10_000_000),
    stars: progressArray(raw.stars, 3),
    cleared: progressSet(raw.cleared),
    mastered: progressSet(raw.mastered),
    claimedFirstClears: progressSet(raw.claimedFirstClears),
  };
};
const mergeProgress = (remoteValue, localValue) => {
  const remote = normalizeProgress(remoteValue); const local = normalizeProgress(localValue);
  return {
    unlocked: Math.max(remote.unlocked, local.unlocked),
    bestScores: remote.bestScores.map((value, index) => Math.max(value, local.bestScores[index])),
    stars: remote.stars.map((value, index) => Math.max(value, local.stars[index])),
    cleared: Array.from(new Set([...remote.cleared, ...local.cleared])),
    mastered: Array.from(new Set([...remote.mastered, ...local.mastered])),
    claimedFirstClears: Array.from(new Set([...remote.claimedFirstClears, ...local.claimedFirstClears])),
  };
};
const safeStringSet = (value, maximum = 200, itemLength = 96) => Array.from(new Set((Array.isArray(value) ? value : [])
  .slice(0, maximum)
  .filter((entry) => typeof entry === 'string')
  .map((entry) => entry.trim().slice(0, itemLength))
  .filter(Boolean)));
const safeRatio = (value, minimum, maximum, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};
const clientId = () => 'classic';
const clientPlatform = (value) => ['windows', 'android'].includes(value) ? value : 'web';
const normalizeClientState = (value, progress, live, updatedAt = nowIso()) => {
  const raw = isPlainRecord(value) ? value : {};
  const identity = isPlainRecord(raw.clientIdentity) ? raw.clientIdentity : {};
  const campaign = isPlainRecord(raw.campaign) ? raw.campaign : {};
  const endless = isPlainRecord(raw.endless) ? raw.endless : {};
  const liveEvent = isPlainRecord(raw.liveEvent) ? raw.liveEvent : {};
  const device = isPlainRecord(raw.deviceSettings) ? raw.deviceSettings : {};
  const hand = isPlainRecord(raw.handProfile) ? raw.handProfile : {};
  const pinchContactRatio = safeRatio(hand.pinchContactRatio, 0.08, 0.8, 0.28);
  const currentSeason = endless.seasonId === live.endless.seasonId;
  const currentLiveEventSeason = liveEvent.seasonId === live.endless.seasonId;
  return {
    clientIdentity: {
      id: clientId(identity.id),
      platform: clientPlatform(identity.platform),
      build: String(identity.build ?? 'legacy-v4').slice(0, 64),
      installId: String(identity.installId ?? '').slice(0, 96),
      lastSeenAt: typeof identity.lastSeenAt === 'string' && !Number.isNaN(Date.parse(identity.lastSeenAt))
        ? identity.lastSeenAt
        : updatedAt,
    },
    campaign: {
      progress,
      activeWorld: finiteInteger(campaign.activeWorld, 0, 5),
      activeLevel: finiteInteger(campaign.activeLevel, 0, 41, Math.max(0, progress.unlocked - 1)),
      storyFlags: safeStringSet(campaign.storyFlags, 256),
    },
    endless: {
      seasonId: live.endless.seasonId,
      bestWave: finiteInteger(endless.bestWave, 0, 100_000),
      bestScore: finiteInteger(endless.bestScore, 0, 1_000_000_000),
      seasonPoints: currentSeason ? finiteInteger(endless.seasonPoints, 0, 1_000_000_000) : 0,
      completedRunIds: currentSeason ? safeStringSet(endless.completedRunIds, 200) : [],
    },
    liveEvent: {
      seasonId: live.endless.seasonId,
      rewardTrackTier: currentLiveEventSeason ? finiteInteger(liveEvent.rewardTrackTier, 0, 10_000) : 0,
      claimedRewardIds: currentLiveEventSeason ? safeStringSet(liveEvent.claimedRewardIds, 200) : [],
      completedChallengeIds: currentLiveEventSeason ? safeStringSet(liveEvent.completedChallengeIds, 200) : [],
    },
    deviceSettings: {
      quality: ['ultra', 'balanced', 'performance'].includes(device.quality) ? device.quality : 'balanced',
      targetFps: device.targetFps === 30 ? 30 : 60,
      reducedMotion: device.reducedMotion === true,
      highContrast: device.highContrast === true,
      subtitles: device.subtitles !== false,
      musicVolume: safeRatio(device.musicVolume, 0, 1, 0.8),
      effectsVolume: safeRatio(device.effectsVolume, 0, 1, 0.9),
    },
    handProfile: {
      enabled: hand.enabled !== false,
      handedness: ['left', 'right'].includes(hand.handedness) ? hand.handedness : 'auto',
      aimSensitivity: safeRatio(hand.aimSensitivity, 0.25, 3, 1),
      smoothing: safeRatio(hand.smoothing, 0, 1, 0.58),
      pinchContactRatio,
      pinchReleaseRatio: Math.max(pinchContactRatio + 0.03, safeRatio(hand.pinchReleaseRatio, 0.1, 1.2, 0.38)),
      calibrationRevision: finiteInteger(hand.calibrationRevision, 0, Number.MAX_SAFE_INTEGER),
    },
  };
};
const mergeClientState = (remoteValue, localValue, progress, live, updatedAt) => {
  const remote = normalizeClientState(remoteValue, progress, live, updatedAt);
  const local = normalizeClientState(localValue, progress, live, updatedAt);
  return normalizeClientState({
    clientIdentity: { ...local.clientIdentity, lastSeenAt: updatedAt },
    campaign: {
      ...local.campaign,
      storyFlags: [...remote.campaign.storyFlags, ...local.campaign.storyFlags],
    },
    // Endless and live-event progression changes only through validated run
    // submission; a save upload can carry these views but cannot mint progress.
    endless: remote.endless,
    liveEvent: remote.liveEvent,
    deviceSettings: local.deviceSettings,
    handProfile: local.handProfile,
  }, progress, live, updatedAt);
};

const OTP_WINDOW_MS = 15 * 60_000;
const OTP_LIMIT = 5;
const retryAfterFor = (entries, now) => Math.max(1, Math.ceil((entries[0] + OTP_WINDOW_MS - now) / 1000));

const CATALOG = [
  ['bomb_pack_3', 'BOMB CACHE', 'coins', 180, 'inventory', 'bomb', 3],
  ['rainbow_pack_2', 'RAINBOW VAULT', 'coins', 260, 'inventory', 'rainbow', 2],
  ['phoenix_relic', 'PHOENIX CROWN', 'diamonds', 90, 'entitlement', 'artifact:phoenix', 1],
  ['fortune_relic', 'FORTUNE IDOL', 'diamonds', 100, 'entitlement', 'artifact:fortune', 1],
  ['void_relic', 'VOID COMPASS', 'diamonds', 130, 'entitlement', 'artifact:void', 1],
  ['aurora_skin', 'ROYAL AURORA', 'diamonds', 180, 'entitlement', 'skin:aurora', 1],
  ['voidforge_skin', 'VOIDFORGE', 'diamonds', 360, 'entitlement', 'skin:voidforge', 1],
  ['aurora_optical_skin', 'AURORA OPTICAL', 'diamonds', 280, 'entitlement', 'skin:aurora_optical', 1],
  ['voidforge_optical_skin', 'VOID OPTICAL', 'diamonds', 520, 'entitlement', 'skin:voidforge_optical', 1],
  ['phoenix_skin', 'PHOENIX EMBER', 'diamonds', 360, 'entitlement', 'skin:phoenix', 1],
  ['frostglass_skin', 'FROSTGLASS', 'diamonds', 440, 'entitlement', 'skin:frostglass', 1],
  ['nexus_crown_skin', 'NEXUS CROWN', 'diamonds', 600, 'entitlement', 'skin:nexus_crown', 1],
  ['phoenix_optical_skin', 'PHOENIX OPTICAL', 'diamonds', 640, 'entitlement', 'skin:phoenix_optical', 1],
  ['frostglass_optical_skin', 'FROST OPTICAL', 'diamonds', 720, 'entitlement', 'skin:frostglass_optical', 1],
  ['nexus_crown_optical_skin', 'NEXUS OPTICAL', 'diamonds', 880, 'entitlement', 'skin:nexus_crown_optical', 1],
  ['aurora_media_pack', 'AURORA PLAYER CARD', 'coins', 320, 'entitlement', 'media:aurora-card', 1],
  ['friendship_hamper', 'FRIENDSHIP HAMPER', 'coins', 420, 'bundle', 'hamper:friendship', 1],
  ['royal_hamper', 'ROYAL REALM HAMPER', 'diamonds', 75, 'bundle', 'hamper:royal', 1],
];

const V3_CONTENT = Object.freeze({
  schemaVersion: 3,
  contentVersion: '2026.08.06-v16-crown-echoes',
  saveVersion: 4,
  clients: {
    classic: { route: '/classic/', engine: 'phaser-3.90.0', status: 'production', platforms: ['web'] },
  },
  worlds: 6,
  levels: 42,
  modes: ['classic', 'rush', 'precision', 'endless'],
  artifacts: ['chrono', 'phoenix', 'void', 'fortune'],
  compatibility: { minimumApiVersion: 3, legacyAdaptersThroughRelease: 2 },
});

const SEASON_EPOCH_MS = Date.UTC(2026, 0, 1);
const SEASON_DURATION_MS = 28 * 86_400_000;
const deterministicSeed = (scope) => Number.parseInt(digest(scope).slice(0, 8), 16) & 0x7fffffff;
const buildLivePayload = (now = new Date()) => {
  const nowMs = now.getTime();
  const seasonNumber = Math.max(0, Math.floor((nowMs - SEASON_EPOCH_MS) / SEASON_DURATION_MS));
  const startsAtMs = SEASON_EPOCH_MS + seasonNumber * SEASON_DURATION_MS;
  const endsAtMs = startsAtMs + SEASON_DURATION_MS;
  const seasonId = `season-${String(seasonNumber + 1).padStart(3, '0')}`;
  const eventStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const eventId = `crownfall-${new Date(eventStartMs).toISOString().slice(0, 10)}`;
  const eventSeed = deterministicSeed(`paopao:event:${eventId}`);
  return {
    schemaVersion: 3,
    season: seasonId,
    minimumFps: 30,
    preferredFps: 60,
    handTracking: { targetFps: 30, adaptive: true, workerInference: true, framesUploaded: false },
    features: { arena: true, cloudSync: true, telemetry: true, endless: true, liveEvents: true },
    endless: {
      seasonId,
      seed: deterministicSeed(`paopao:endless:${seasonId}`),
      rulesVersion: ENDLESS_REPLAY_RULES.rulesVersion,
      replayVersion: ENDLESS_REPLAY_RULES.replayVersion,
      maximumShots: ENDLESS_REPLAY_RULES.maximumShots,
      aimMilliDegrees: {
        minimum: ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees,
        maximum: ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees,
      },
      pointsPerRewardTier: SEASON_POINTS_PER_TIER,
      startsAt: new Date(startsAtMs).toISOString(),
      endsAt: new Date(endsAtMs).toISOString(),
      modifiers: ['rising-pressure', 'prism-drift', 'boss-echo'],
    },
    events: [{
      id: eventId,
      kind: 'event-boss',
      boss: ['prism-warden', 'heartwood-guardian', 'astral-sentinel', 'inferno-sovereign'][eventSeed % 4],
      level: eventSeed % MAX_PROGRESS_LEVELS,
      seed: eventSeed,
      modifier: ['mirror-orbs', 'short-fuse', 'precision-plus'][eventSeed % 3],
      reward: { currency: 'coins', amount: 750 },
      startsAt: new Date(eventStartMs).toISOString(),
      endsAt: new Date(eventStartMs + 7 * 86_400_000).toISOString(),
    }],
  };
};

const LIVE_EVENT_MODIFIERS = new Set(['mirror-orbs', 'short-fuse', 'precision-plus']);
const normalizeRemoteLivePayload = (value) => {
  if (!isPlainRecord(value)) throw Object.assign(new Error('live-config-invalid'), { statusCode: 400 });
  const baseline = buildLivePayload();
  const endless = isPlainRecord(value.endless) ? value.endless : {};
  const seasonId = String(endless.seasonId ?? value.season ?? '').trim();
  const startsAt = String(endless.startsAt ?? '');
  const endsAt = String(endless.endsAt ?? '');
  const startsMs = Date.parse(startsAt); const endsMs = Date.parse(endsAt);
  if (!/^[a-z0-9][a-z0-9.-]{2,63}$/.test(seasonId)
    || !Number.isInteger(Number(endless.seed)) || Number(endless.seed) < 0 || Number(endless.seed) > 0x7fffffff
    || !Number.isFinite(startsMs) || !Number.isFinite(endsMs) || endsMs <= startsMs
    || endsMs - startsMs > 366 * 86_400_000) {
    throw Object.assign(new Error('live-season-invalid'), { statusCode: 400 });
  }
  const modifiers = safeStringSet(endless.modifiers, 16, 48);
  if (!modifiers.length) throw Object.assign(new Error('live-modifiers-required'), { statusCode: 400 });
  const sourceEvents = Array.isArray(value.events) ? value.events : [];
  if (sourceEvents.length > 16) throw Object.assign(new Error('live-event-limit'), { statusCode: 400 });
  const seen = new Set();
  const events = sourceEvents.map((candidate) => {
    if (!isPlainRecord(candidate)) throw Object.assign(new Error('live-event-invalid'), { statusCode: 400 });
    const eventId = String(candidate.id ?? '').trim();
    const eventStartsAt = String(candidate.startsAt ?? ''); const eventEndsAt = String(candidate.endsAt ?? '');
    const eventStartsMs = Date.parse(eventStartsAt); const eventEndsMs = Date.parse(eventEndsAt);
    const reward = isPlainRecord(candidate.reward) ? candidate.reward : {};
    if (!/^[a-z0-9][a-z0-9.-]{2,95}$/.test(eventId) || seen.has(eventId)
      || candidate.kind !== 'event-boss'
      || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(String(candidate.boss ?? ''))
      || !Number.isInteger(Number(candidate.level)) || Number(candidate.level) < 0 || Number(candidate.level) >= MAX_PROGRESS_LEVELS
      || !Number.isInteger(Number(candidate.seed)) || Number(candidate.seed) < 0 || Number(candidate.seed) > 0x7fffffff
      || !LIVE_EVENT_MODIFIERS.has(String(candidate.modifier ?? ''))
      || reward.currency !== 'coins' || !Number.isInteger(Number(reward.amount)) || Number(reward.amount) < 1 || Number(reward.amount) > 10_000
      || !Number.isFinite(eventStartsMs) || !Number.isFinite(eventEndsMs) || eventEndsMs <= eventStartsMs
      || eventStartsMs < startsMs || eventEndsMs > endsMs) {
      throw Object.assign(new Error('live-event-invalid'), { statusCode: 400 });
    }
    seen.add(eventId);
    return {
      id: eventId, kind: 'event-boss', boss: String(candidate.boss), level: Number(candidate.level),
      seed: Number(candidate.seed), modifier: String(candidate.modifier),
      reward: { currency: 'coins', amount: Number(reward.amount) },
      startsAt: new Date(eventStartsMs).toISOString(), endsAt: new Date(eventEndsMs).toISOString(),
    };
  });
  return {
    ...baseline,
    season: seasonId,
    minimumFps: finiteInteger(value.minimumFps, 30, 60, 30),
    preferredFps: finiteInteger(value.preferredFps, 30, 120, 60),
    endless: {
      ...baseline.endless,
      seasonId,
      seed: Number(endless.seed),
      pointsPerRewardTier: finiteInteger(endless.pointsPerRewardTier, 100, 10_000, SEASON_POINTS_PER_TIER),
      startsAt: new Date(startsMs).toISOString(), endsAt: new Date(endsMs).toISOString(), modifiers,
    },
    events,
  };
};

const v3ProgressSchema = {
  type: 'object',
  properties: {
    unlocked: { type: 'integer', minimum: 1, maximum: 42 },
    bestScores: { type: 'array', maxItems: 42, items: { type: 'integer', minimum: 0, maximum: 10000000 } },
    stars: { type: 'array', maxItems: 42, items: { type: 'integer', minimum: 0, maximum: 3 } },
    cleared: { type: 'array', maxItems: 42, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 41 } },
    mastered: { type: 'array', maxItems: 42, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 41 } },
    claimedFirstClears: { type: 'array', maxItems: 42, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 41 } },
  },
  additionalProperties: false,
};

const stringIdArraySchema = { type: 'array', maxItems: 200, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 96 } };
const v4ClientStateSchema = {
  clientIdentity: {
    type: 'object', required: ['id', 'platform', 'build', 'installId'], properties: {
      id: { const: 'classic' }, platform: { enum: ['web', 'windows', 'android'] },
      build: { type: 'string', minLength: 1, maxLength: 64 }, installId: { type: 'string', maxLength: 96 },
      lastSeenAt: { type: 'string', format: 'date-time', maxLength: 40 },
    }, additionalProperties: false,
  },
  campaign: {
    type: 'object', properties: {
      activeWorld: { type: 'integer', minimum: 0, maximum: 5 }, activeLevel: { type: 'integer', minimum: 0, maximum: 41 },
      storyFlags: { ...stringIdArraySchema, maxItems: 256 },
    }, additionalProperties: false,
  },
  endless: {
    type: 'object', properties: {
      seasonId: { type: 'string', maxLength: 64 }, bestWave: { type: 'integer', minimum: 0, maximum: 100000 },
      bestScore: { type: 'integer', minimum: 0, maximum: 1000000000 }, seasonPoints: { type: 'integer', minimum: 0, maximum: 1000000000 },
      completedRunIds: stringIdArraySchema,
    }, additionalProperties: false,
  },
  liveEvent: {
    type: 'object', properties: {
      seasonId: { type: 'string', maxLength: 64 }, rewardTrackTier: { type: 'integer', minimum: 0, maximum: 10000 },
      claimedRewardIds: stringIdArraySchema, completedChallengeIds: stringIdArraySchema,
    }, additionalProperties: false,
  },
  deviceSettings: {
    type: 'object', properties: {
      quality: { enum: ['ultra', 'balanced', 'performance'] }, targetFps: { enum: [30, 60] },
      reducedMotion: { type: 'boolean' }, highContrast: { type: 'boolean' }, subtitles: { type: 'boolean' },
      musicVolume: { type: 'number', minimum: 0, maximum: 1 }, effectsVolume: { type: 'number', minimum: 0, maximum: 1 },
    }, additionalProperties: false,
  },
  handProfile: {
    type: 'object', properties: {
      enabled: { type: 'boolean' }, handedness: { enum: ['auto', 'left', 'right'] },
      aimSensitivity: { type: 'number', minimum: 0.25, maximum: 3 }, smoothing: { type: 'number', minimum: 0, maximum: 1 },
      pinchContactRatio: { type: 'number', minimum: 0.08, maximum: 0.8 }, pinchReleaseRatio: { type: 'number', minimum: 0.1, maximum: 1.2 },
      calibrationRevision: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
    }, additionalProperties: false,
  },
};

export function installPlatform({ app, db, arena: arenaOptions = {}, otpRate: otpRateOptions = {}, signingSecret, signingKeyring } = {}) {
  const contentSigningSecret = String(signingSecret ?? process.env.PAOPAO_CONTENT_SIGNING_SECRET
    ?? process.env.PAOPAO_SESSION_SECRET ?? randomBytes(32).toString('base64url'));
  if (Buffer.byteLength(contentSigningSecret) < 32) {
    throw new Error('platform content signing secret must contain at least 32 bytes');
  }
  const nativeTokenRootSecret = String(process.env.PAOPAO_NATIVE_TOKEN_SECRET ?? contentSigningSecret);
  const nativeTokenSigningSecret = createHmac('sha256', nativeTokenRootSecret)
    .update('paopao-native-access-v3').digest('base64url');
  const signingKeyId = `local-${digest(contentSigningSecret).slice(0, 16)}`;
  const fallbackSignedIntegrity = (payload) => signPublicPayload(payload, contentSigningSecret, signingKeyId);
  const signedIntegrity = signingKeyring?.signPayload ?? fallbackSignedIntegrity;
  const signEventToken = (event, endless) => {
    const payload = canonicalLiveEventChallengePayload(event, endless);
    return signingKeyring?.signMessage(payload, 'live-event')
      ?? createHmac('sha256', contentSigningSecret).update(payload).digest('base64url');
  };
  const verifyEventToken = (token, event, endless) => {
    const payload = canonicalLiveEventChallengePayload(event, endless);
    return signingKeyring?.verifyMessage(token, payload, 'live-event')
      ?? secureEqual(token, createHmac('sha256', contentSigningSecret).update(payload).digest('base64url'));
  };
  const currentManifest = () => Object.freeze({ ...V3_CONTENT, integrity: signedIntegrity(V3_CONTENT) });
  const currentLiveConfig = () => {
    const stored = db.prepare('SELECT config_json AS configJson FROM live_config_revisions ORDER BY revision DESC LIMIT 1').get();
    const livePayload = stored ? normalizeRemoteLivePayload(json(stored.configJson)) : buildLivePayload();
    const publicPayload = {
      ...livePayload,
      events: livePayload.events.map((event) => ({
        ...event,
        submissionToken: signEventToken(event, livePayload.endless),
      })),
    };
    return Object.freeze({ ...publicPayload, integrity: signedIntegrity(publicPayload) });
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(12,datetime('now'));
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(13,datetime('now'));
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(14,datetime('now'));
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(15,datetime('now'));
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(16,datetime('now'));
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(17,datetime('now'));
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(18,datetime('now'));
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(19,datetime('now'));
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(20,datetime('now'));
    CREATE TABLE IF NOT EXISTS users(user_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_identities(identity_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(user_id),kind TEXT NOT NULL,identifier TEXT NOT NULL UNIQUE,verified_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS otp_challenges(challenge_id TEXT PRIMARY KEY,email TEXT NOT NULL,code_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS otp_email_created ON otp_challenges(email,created_at DESC);
    CREATE TABLE IF NOT EXISTS sessions(session_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(user_id),token_hash TEXT NOT NULL UNIQUE,csrf_token TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS native_refresh_tokens(token_id TEXT PRIMARY KEY,family_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(user_id),token_hash TEXT NOT NULL UNIQUE,client TEXT NOT NULL,expires_at TEXT NOT NULL,rotated_at TEXT,replaced_by TEXT,reused_at TEXT,revoked_at TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_config_revisions(revision INTEGER PRIMARY KEY AUTOINCREMENT,config_json TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('publish','rollback')),source_revision INTEGER,idempotency_key TEXT NOT NULL UNIQUE,actor TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS native_refresh_family ON native_refresh_tokens(family_id,created_at);
    CREATE TABLE IF NOT EXISTS player_profiles(user_id TEXT PRIMARY KEY REFERENCES users(user_id),display_name TEXT NOT NULL,legacy_import_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS player_progress(user_id TEXT PRIMARY KEY REFERENCES users(user_id),progress_json TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS player_client_state_v4(user_id TEXT PRIMARY KEY REFERENCES users(user_id),state_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wallets(user_id TEXT PRIMARY KEY REFERENCES users(user_id),coins INTEGER NOT NULL DEFAULT 600 CHECK(coins>=0),diamonds INTEGER NOT NULL DEFAULT 0 CHECK(diamonds>=0),revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wallet_ledger(entry_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(user_id),currency TEXT NOT NULL,delta INTEGER NOT NULL,balance_after INTEGER NOT NULL,kind TEXT NOT NULL,reference_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS wallet_user_created ON wallet_ledger(user_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_live_event_claim ON wallet_ledger(user_id,reference_id) WHERE kind='live-event-reward';
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_classic_first_clear_claim ON wallet_ledger(user_id,reference_id) WHERE kind='classic-first-clear';
    CREATE TABLE IF NOT EXISTS inventory_ledger(entry_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(user_id),item_id TEXT NOT NULL,delta INTEGER NOT NULL,reason TEXT NOT NULL,reference_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entitlements(user_id TEXT NOT NULL REFERENCES users(user_id),entitlement_id TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,entitlement_id));
    CREATE TABLE IF NOT EXISTS catalog_offers(offer_id TEXT PRIMARY KEY,title TEXT NOT NULL,currency TEXT NOT NULL,price INTEGER NOT NULL,grant_kind TEXT NOT NULL,grant_id TEXT NOT NULL,grant_quantity INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders(order_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(user_id),offer_id TEXT NOT NULL REFERENCES catalog_offers(offer_id),idempotency_key TEXT NOT NULL,status TEXT NOT NULL,currency TEXT NOT NULL,amount INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS purchase_receipts(receipt_id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES orders(order_id),user_id TEXT NOT NULL REFERENCES users(user_id),payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS matches(match_id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,seed INTEGER NOT NULL,level INTEGER NOT NULL,started_at TEXT,finished_at TEXT,winner_user_id TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS match_players(match_id TEXT NOT NULL REFERENCES matches(match_id),user_id TEXT NOT NULL REFERENCES users(user_id),score INTEGER NOT NULL DEFAULT 0,shots INTEGER NOT NULL DEFAULT 0,last_seq INTEGER NOT NULL DEFAULT 0,finished_at TEXT,PRIMARY KEY(match_id,user_id));
    CREATE TABLE IF NOT EXISTS arena_match_replays(match_id TEXT NOT NULL REFERENCES matches(match_id),user_id TEXT NOT NULL REFERENCES users(user_id),replay_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(match_id,user_id),FOREIGN KEY(match_id,user_id) REFERENCES match_players(match_id,user_id));
    CREATE TABLE IF NOT EXISTS match_results(match_id TEXT PRIMARY KEY REFERENCES matches(match_id),result_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS telemetry_batches(batch_id TEXT PRIMARY KEY,user_id TEXT,events_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS v3_runs(run_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(user_id),client TEXT NOT NULL,level INTEGER NOT NULL,mode TEXT NOT NULL,score INTEGER NOT NULL,duration_ms INTEGER NOT NULL,won INTEGER NOT NULL,summary_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS v3_runs_user_created ON v3_runs(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS v3_run_receipts(run_id TEXT PRIMARY KEY REFERENCES v3_runs(run_id),receipt_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS v3_replay_claims(run_id TEXT PRIMARY KEY REFERENCES v3_runs(run_id),user_id TEXT NOT NULL REFERENCES users(user_id),season_id TEXT NOT NULL,replay_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,season_id,replay_hash));
    CREATE INDEX IF NOT EXISTS v3_replay_user_created ON v3_replay_claims(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS classic_run_tickets(
      ticket_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 29),
      mode TEXT NOT NULL CHECK(mode IN ('classic','rush','precision')),
      seed INTEGER NOT NULL,
      nonce TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','consumed','abandoned','expired')),
      trace_json TEXT NOT NULL DEFAULT '[]',
      last_received_at TEXT,
      terminal_challenge_hash TEXT,
      completed_run_id TEXT,
      UNIQUE(user_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS classic_tickets_user_status ON classic_run_tickets(user_id,status,started_at DESC);
    CREATE TABLE IF NOT EXISTS classic_authority_clears(
      user_id TEXT NOT NULL REFERENCES users(user_id),
      level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 29),
      run_id TEXT NOT NULL UNIQUE REFERENCES v3_runs(run_id),
      verified_at TEXT NOT NULL,
      PRIMARY KEY(user_id,level)
    );
    CREATE TABLE IF NOT EXISTS security_audit(event_id TEXT PRIMARY KEY,user_id TEXT,event_type TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
  const upsertOffer = db.prepare(`INSERT INTO catalog_offers(offer_id,title,currency,price,grant_kind,grant_id,grant_quantity,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(offer_id) DO UPDATE SET title=excluded.title,currency=excluded.currency,price=excluded.price,grant_kind=excluded.grant_kind,grant_id=excluded.grant_id,grant_quantity=excluded.grant_quantity,updated_at=excluded.updated_at`);
  const seedCatalog = db.transaction(() => CATALOG.forEach((offer) => upsertOffer.run(...offer, nowIso())));
  seedCatalog();

  const liveConfigStatus = () => {
    const rows = db.prepare(`SELECT revision,operation,source_revision AS sourceRevision,idempotency_key AS idempotencyKey,
      actor,created_at AS createdAt FROM live_config_revisions ORDER BY revision DESC LIMIT 25`).all();
    return {
      activeRevision: rows[0]?.revision ?? 0,
      source: rows.length ? 'remote' : 'scheduled-default',
      current: currentLiveConfig(),
      history: rows,
    };
  };
  const publishLiveConfig = db.transaction(({ config, idempotencyKey, actor }) => {
    const normalized = normalizeRemoteLivePayload(config);
    const serialized = canonicalJson(normalized);
    const existing = db.prepare(`SELECT revision,operation,config_json AS configJson FROM live_config_revisions
      WHERE idempotency_key=?`).get(idempotencyKey);
    if (existing) {
      if (existing.operation !== 'publish' || existing.configJson !== serialized) {
        throw Object.assign(new Error('live-config-idempotency-conflict'), { statusCode: 409 });
      }
      return { duplicate: true, revision: existing.revision, ...liveConfigStatus() };
    }
    const inserted = db.prepare(`INSERT INTO live_config_revisions(config_json,operation,source_revision,idempotency_key,actor,created_at)
      VALUES(?,'publish',NULL,?,?,?)`).run(serialized, idempotencyKey, actor, nowIso());
    return { duplicate: false, revision: Number(inserted.lastInsertRowid), ...liveConfigStatus() };
  });
  const rollbackLiveConfig = db.transaction(({ targetRevision, idempotencyKey, actor }) => {
    const target = db.prepare('SELECT config_json AS configJson FROM live_config_revisions WHERE revision=?').get(targetRevision);
    if (!target) throw Object.assign(new Error('live-config-revision-not-found'), { statusCode: 404 });
    const existing = db.prepare(`SELECT revision,operation,source_revision AS sourceRevision FROM live_config_revisions
      WHERE idempotency_key=?`).get(idempotencyKey);
    if (existing) {
      if (existing.operation !== 'rollback' || Number(existing.sourceRevision) !== targetRevision) {
        throw Object.assign(new Error('live-config-idempotency-conflict'), { statusCode: 409 });
      }
      return { duplicate: true, revision: existing.revision, ...liveConfigStatus() };
    }
    // Rollback is itself an immutable revision, preserving a complete audit
    // timeline and making every state transition recoverable.
    const inserted = db.prepare(`INSERT INTO live_config_revisions(config_json,operation,source_revision,idempotency_key,actor,created_at)
      VALUES(?,'rollback',?,?,?,?)`).run(target.configJson, targetRevision, idempotencyKey, actor, nowIso());
    return { duplicate: false, revision: Number(inserted.lastInsertRowid), ...liveConfigStatus() };
  });
  const liveConfigAdmin = Object.freeze({ status: liveConfigStatus, publish: publishLiveConfig, rollback: rollbackLiveConfig });

  const otpByIp = new Map();
  const otpByEmail = new Map();
  const otpRateMaxKeys = finiteInteger(otpRateOptions.maxKeys, 2, 100_000, 10_000);
  const otpRateSweepMs = finiteInteger(otpRateOptions.sweepMs, 25, OTP_WINDOW_MS, 60_000);
  const smtpUrl = process.env.PAOPAO_SMTP_URL;
  const smtpTransport = smtpUrl ? nodemailer.createTransport(smtpUrl, {
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  }) : null;
  const sweepRateStore = (store, now) => {
    for (const [key, entries] of store) {
      const active = entries.filter((timestamp) => timestamp > now - OTP_WINDOW_MS);
      if (active.length) store.set(key, active); else store.delete(key);
    }
    while (store.size > otpRateMaxKeys) store.delete(store.keys().next().value);
  };
  const storeRateEntries = (store, key, entries, now) => {
    if (!store.has(key) && store.size >= otpRateMaxKeys) sweepRateStore(store, now);
    while (!store.has(key) && store.size >= otpRateMaxKeys) store.delete(store.keys().next().value);
    store.delete(key); store.set(key, entries);
  };
  const rateEntries = (store, key, now) => {
    const active = (store.get(key) ?? []).filter((timestamp) => timestamp > now - OTP_WINDOW_MS);
    if (active.length) storeRateEntries(store, key, active, now); else store.delete(key);
    return active;
  };
  const sweepOtpRates = () => {
    const now = Date.now(); sweepRateStore(otpByIp, now); sweepRateStore(otpByEmail, now);
  };
  const otpRateSweep = setInterval(sweepOtpRates, otpRateSweepMs);
  otpRateSweep.unref?.();
  app.addHook('onClose', async () => { clearInterval(otpRateSweep); otpByIp.clear(); otpByEmail.clear(); });
  const consumeOtpRate = (request, email, reply) => {
    const now = Date.now();
    const ip = String(request.ip ?? request.raw.socket.remoteAddress ?? 'unknown').slice(0, 80);
    const ipEntries = rateEntries(otpByIp, ip, now); const emailEntries = rateEntries(otpByEmail, email, now);
    const limited = ipEntries.length >= OTP_LIMIT ? ipEntries : emailEntries.length >= OTP_LIMIT ? emailEntries : null;
    if (limited) {
      reply.header('Retry-After', String(retryAfterFor(limited, now))).code(429).send({ error: 'otp-rate-limited' });
      return false;
    }
    ipEntries.push(now); emailEntries.push(now);
    storeRateEntries(otpByIp, ip, ipEntries, now); storeRateEntries(otpByEmail, email, emailEntries, now);
    return true;
  };

  const sessionFor = (request) => {
    const token = safeCookieToken(request, 'paopao_session');
    if (!token) return null;
    const row = db.prepare(`SELECT s.session_id AS sessionId,s.user_id AS userId,s.csrf_token AS csrfToken,p.display_name AS displayName
      FROM sessions s JOIN users u ON u.user_id=s.user_id JOIN player_profiles p ON p.user_id=s.user_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active'`).get(digest(token), nowIso());
    if (row) db.prepare('UPDATE sessions SET last_seen_at=? WHERE session_id=?').run(nowIso(), row.sessionId);
    return row ? { ...row, authKind: 'web' } : null;
  };
  const signNativePayload = (payload) => createHmac('sha256', nativeTokenSigningSecret).update(payload).digest('base64url');
  const issueAccessToken = (userId, client, familyId, issuedAt = Date.now()) => {
    const expiresAtMs = issuedAt + 15 * 60_000;
    const payload = Buffer.from(JSON.stringify({
      version: 1, type: 'access', subject: userId, client, familyId, issuedAt, expiresAt: expiresAtMs, tokenId: id('atk'),
    })).toString('base64url');
    return { accessToken: `${payload}.${signNativePayload(payload)}`, accessExpiresAt: new Date(expiresAtMs).toISOString() };
  };
  const issueNativeCredentials = (userId, client, familyId = id('family')) => {
    const timestamp = nowIso();
    const tokenId = id('refresh');
    const refreshToken = `rfr_${randomBytes(32).toString('base64url')}`;
    const refreshExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    db.prepare(`INSERT INTO native_refresh_tokens
      (token_id,family_id,user_id,token_hash,client,expires_at,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(tokenId, familyId, userId, digest(refreshToken), client, refreshExpiresAt, timestamp);
    return {
      tokenType: 'Bearer', client, ...issueAccessToken(userId, client, familyId),
      refreshToken, refreshExpiresAt,
      refreshTokenId: tokenId,
    };
  };
  const publicNativeCredentials = ({ refreshTokenId: _refreshTokenId, ...credentials }) => credentials;
  const nativeAccountFor = (request) => {
    const authorization = String(request.headers.authorization ?? '');
    if (!authorization.startsWith('Bearer ') || authorization.length > 4096) return null;
    const [payload, signature, extra] = authorization.slice(7).split('.');
    if (!payload || !signature || extra || !secureEqual(signNativePayload(payload), signature)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (claims.version !== 1 || claims.type !== 'access' || !claims.subject || !claims.familyId || claims.expiresAt <= Date.now()
        || !['windows', 'android'].includes(claims.client)) return null;
      const activeFamily = db.prepare(`SELECT 1 FROM native_refresh_tokens WHERE family_id=? AND revoked_at IS NULL
        AND reused_at IS NULL AND expires_at>? LIMIT 1`).get(claims.familyId, nowIso());
      if (!activeFamily) return null;
      const profile = db.prepare(`SELECT p.display_name AS displayName FROM users u JOIN player_profiles p ON p.user_id=u.user_id
        WHERE u.user_id=? AND u.status='active'`).get(claims.subject);
      return profile ? {
        userId: claims.subject, displayName: profile.displayName, authKind: 'native', client: claims.client,
        tokenId: String(claims.tokenId ?? ''), familyId: claims.familyId, csrfToken: '',
      } : null;
    } catch { return null; }
  };
  const accountFor = (request) => sessionFor(request) ?? nativeAccountFor(request);
  const requireSession = async (request, reply) => {
    const session = accountFor(request);
    if (!session) return reply.code(401).send({ error: 'authentication-required' });
    if (session.authKind === 'web' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrf = String(request.headers['x-csrf-token'] ?? '');
      if (!csrf || !secureEqual(csrf, session.csrfToken)) return reply.code(403).send({ error: 'csrf-invalid' });
    }
    request.account = session;
  };
  const setSessionCookie = (reply, token) => {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header('Set-Cookie', `paopao_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
  };
  const publicProfile = (userId) => {
    const profile = db.prepare('SELECT display_name AS displayName,updated_at AS updatedAt FROM player_profiles WHERE user_id=?').get(userId);
    const wallet = db.prepare('SELECT coins,diamonds,revision,updated_at AS updatedAt FROM wallets WHERE user_id=?').get(userId);
    return { userId, ...profile, wallet };
  };
  const entitlementStateFor = (userId) => {
    const rows = db.prepare('SELECT entitlement_id AS id FROM entitlements WHERE user_id=? ORDER BY entitlement_id').all(userId);
    return { revision: rows.length, ids: rows.map((row) => row.id) };
  };
  const persistedClientStateFor = (userId, progress, updatedAt) => {
    const row = db.prepare('SELECT state_json FROM player_client_state_v4 WHERE user_id=?').get(userId);
    return normalizeClientState(json(row?.state_json), progress, currentLiveConfig(), updatedAt);
  };
  const progressEnvelopeFor = (userId, row) => {
    const progress = normalizeProgress(json(row.progress ?? row.progress_json));
    const state = persistedClientStateFor(userId, progress, row.updatedAt ?? row.updated_at);
    return {
      saveVersion: 4,
      revision: row.revision,
      updatedAt: row.updatedAt ?? row.updated_at,
      client: state.clientIdentity.id,
      progress,
      ...state,
      entitlements: entitlementStateFor(userId),
    };
  };

  const readiness = async (_request, reply) => {
    try {
      const probe = db.prepare('SELECT 1 AS ok').get();
      const schema = db.prepare('SELECT MAX(version) AS version FROM schema_versions').get();
      if (probe?.ok !== 1 || Number(schema?.version) < 20) throw new Error('database-not-ready');
      return { ok: true, service: 'paopao-fusion', schemaVersion: Number(schema.version), database: 'ready', time: nowIso() };
    } catch (error) {
      app.log.error({ err: error }, 'readiness probe failed');
      return reply.code(503).send({ ok: false, service: 'paopao-fusion', database: 'unavailable', time: nowIso() });
    }
  };
  app.get('/api/health', readiness);
  app.get('/api/ready', readiness);

  app.get('/api/v3/content/manifest', async (_request, reply) => {
    const manifest = currentManifest();
    reply.header('Cache-Control', 'public, max-age=300, must-revalidate');
    reply.header('ETag', `"sha256-${manifest.integrity.contentHash}"`);
    return manifest;
  });
  app.get('/api/v3/live/config', async (_request, reply) => {
    const liveConfig = currentLiveConfig();
    reply.header('Cache-Control', 'public, max-age=60, must-revalidate');
    reply.header('ETag', `"sha256-${liveConfig.integrity.contentHash}"`);
    return liveConfig;
  });
  app.get('/api/v3/bootstrap', async (request) => {
    const session = accountFor(request);
    return {
      apiVersion: 3,
      serverTime: nowIso(),
      content: currentManifest(),
      live: currentLiveConfig(),
      account: session ? {
        authenticated: true,
        authentication: session.authKind,
        ...publicProfile(session.userId),
        ...(session.authKind === 'web' ? { csrfToken: session.csrfToken } : { nativeClient: session.client }),
      } : { authenticated: false },
    };
  });

  app.post('/api/auth/otp/request', { bodyLimit: 2_048, schema: { body: {
    type: 'object', required: ['email'], properties: { email: { type: 'string', minLength: 5, maxLength: 254 } }, additionalProperties: false,
  } } }, async (request, reply) => {
    const email = cleanEmail(request.body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: 'email-invalid' });
    if (!consumeOtpRate(request, email, reply)) return reply;
    const cutoff = new Date(Date.now() - OTP_WINDOW_MS).toISOString();
    const recent = db.prepare('SELECT COUNT(*) AS count FROM otp_challenges WHERE email=? AND created_at>?').get(email, cutoff).count;
    if (recent >= 5) return reply.code(429).send({ error: 'otp-rate-limited' });
    const developmentOtp = isExplicitDevelopmentOtp(request);
    if (!smtpTransport && !developmentOtp) return reply.code(503).send({ error: 'email-provider-unconfigured' });
    const code = String(randomInt(100000, 1_000_000));
    const challengeId = id('otp'); const createdAt = nowIso(); const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    db.prepare('INSERT INTO otp_challenges(challenge_id,email,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
      .run(challengeId, email, digest(`${challengeId}:${code}`), expiresAt, createdAt);
    if (smtpTransport) {
      try {
        await smtpTransport.sendMail({ from: process.env.PAOPAO_EMAIL_FROM, to: email, subject: 'Your PaoPao Fusion sign-in code', text: `Your PaoPao Fusion code is ${code}. It expires in 10 minutes.` });
      } catch (error) {
        db.prepare('DELETE FROM otp_challenges WHERE challenge_id=?').run(challengeId);
        request.log.error({ err: error, challengeId }, 'OTP delivery failed');
        return reply.code(503).send({ error: 'email-delivery-failed' });
      }
    } else app.log.info({ email, challengeId }, 'explicit loopback development OTP issued');
    return { challengeId, expiresAt, ...(developmentOtp ? { developmentCode: code } : {}) };
  });

  app.post('/api/auth/otp/verify', { bodyLimit: 2_048, schema: { body: { type: 'object', required: ['challengeId', 'code'], properties: {
    challengeId: { type: 'string', minLength: 20, maxLength: 80 }, code: { type: 'string', pattern: '^[0-9]{6}$' }, displayName: { type: 'string', maxLength: 32 },
    nativeClient: { enum: ['windows', 'android'] },
  }, additionalProperties: false } } }, async (request, reply) => {
    const { challengeId, code } = request.body;
    const challenge = db.prepare('SELECT * FROM otp_challenges WHERE challenge_id=?').get(challengeId);
    if (!challenge || challenge.consumed_at || challenge.expires_at < nowIso()) return reply.code(410).send({ error: 'otp-expired' });
    if (challenge.attempts >= 5) return reply.code(429).send({ error: 'otp-locked' });
    if (!secureEqual(challenge.code_hash, digest(`${challengeId}:${code}`))) {
      db.prepare('UPDATE otp_challenges SET attempts=attempts+1 WHERE challenge_id=?').run(challengeId);
      return reply.code(401).send({ error: 'otp-invalid' });
    }
    const existing = db.prepare(`SELECT i.user_id,u.status FROM auth_identities i JOIN users u ON u.user_id=i.user_id
      WHERE i.kind='email' AND i.identifier=?`).get(challenge.email);
    if (existing && existing.status !== 'active') return reply.code(403).send({ error: 'account-disabled' });
    const userId = existing?.user_id ?? id('usr'); const timestamp = nowIso();
    const establish = db.transaction(() => {
      db.prepare('UPDATE otp_challenges SET consumed_at=? WHERE challenge_id=?').run(timestamp, challengeId);
      if (!existing) {
        db.prepare('INSERT INTO users(user_id,created_at,updated_at) VALUES(?,?,?)').run(userId, timestamp, timestamp);
        db.prepare('INSERT INTO auth_identities(identity_id,user_id,kind,identifier,verified_at) VALUES(?,?,?,?,?)').run(id('ident'), userId, 'email', challenge.email, timestamp);
        db.prepare('INSERT INTO player_profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(userId, cleanName(request.body.displayName), timestamp, timestamp);
        db.prepare('INSERT INTO player_progress(user_id,updated_at) VALUES(?,?)').run(userId, timestamp);
        db.prepare('INSERT INTO wallets(user_id,updated_at) VALUES(?,?)').run(userId, timestamp);
      }
      if (request.body.nativeClient) return null;
      const rawToken = randomBytes(32).toString('base64url'); const csrfToken = randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO sessions(session_id,user_id,token_hash,csrf_token,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)')
        .run(id('ses'), userId, digest(rawToken), csrfToken, new Date(Date.now() + 30 * 86_400_000).toISOString(), timestamp, timestamp);
      return { rawToken, csrfToken };
    });
    const session = establish();
    if (request.body.nativeClient) {
      const credentials = publicNativeCredentials(issueNativeCredentials(userId, request.body.nativeClient));
      return { ...publicProfile(userId), authentication: 'native', ...credentials };
    }
    setSessionCookie(reply, session.rawToken);
    return { ...publicProfile(userId), authentication: 'web', csrfToken: session.csrfToken };
  });

  app.post('/api/v3/auth/native/refresh', { bodyLimit: 2_048, schema: { body: {
    type: 'object', required: ['refreshToken'], properties: {
      refreshToken: { type: 'string', minLength: 40, maxLength: 128, pattern: '^rfr_[A-Za-z0-9_-]+$' },
    }, additionalProperties: false,
  } } }, async (request, reply) => {
    const row = db.prepare(`SELECT token_id AS tokenId,family_id AS familyId,user_id AS userId,client,expires_at AS expiresAt,
      rotated_at AS rotatedAt,reused_at AS reusedAt,revoked_at AS revokedAt FROM native_refresh_tokens WHERE token_hash=?`)
      .get(digest(request.body.refreshToken));
    if (!row) return reply.code(401).send({ error: 'refresh-invalid' });
    if (row.rotatedAt || row.reusedAt) {
      const timestamp = nowIso();
      db.transaction(() => {
        db.prepare('UPDATE native_refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?').run(timestamp, row.familyId);
        db.prepare('UPDATE native_refresh_tokens SET reused_at=COALESCE(reused_at,?) WHERE token_id=?').run(timestamp, row.tokenId);
        db.prepare('INSERT INTO security_audit(event_id,user_id,event_type,detail_json,created_at) VALUES(?,?,?,?,?)')
          .run(id('audit'), row.userId, 'native-refresh-reuse', JSON.stringify({ familyId: row.familyId, tokenId: row.tokenId }), timestamp);
      })();
      return reply.code(401).send({ error: 'refresh-reuse-detected' });
    }
    if (row.revokedAt) return reply.code(401).send({ error: 'refresh-revoked' });
    if (row.expiresAt <= nowIso()) {
      db.prepare('UPDATE native_refresh_tokens SET revoked_at=? WHERE token_id=?').run(nowIso(), row.tokenId);
      return reply.code(401).send({ error: 'refresh-expired' });
    }
    const credentials = db.transaction(() => {
      const next = issueNativeCredentials(row.userId, row.client, row.familyId);
      const timestamp = nowIso();
      db.prepare('UPDATE native_refresh_tokens SET rotated_at=?,replaced_by=? WHERE token_id=?')
        .run(timestamp, next.refreshTokenId, row.tokenId);
      return next;
    })();
    return { authentication: 'native', ...publicNativeCredentials(credentials) };
  });

  app.post('/api/v3/auth/native/revoke', { preHandler: requireSession, bodyLimit: 2_048, schema: { body: {
    type: 'object', required: ['refreshToken'], properties: {
      refreshToken: { type: 'string', minLength: 40, maxLength: 128, pattern: '^rfr_[A-Za-z0-9_-]+$' },
    }, additionalProperties: false,
  } } }, async (request) => {
    const row = db.prepare('SELECT family_id AS familyId,user_id AS userId FROM native_refresh_tokens WHERE token_hash=?')
      .get(digest(request.body.refreshToken));
    if (row?.userId === request.account.userId) {
      db.prepare('UPDATE native_refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?').run(nowIso(), row.familyId);
    }
    return { ok: true };
  });

  app.post('/api/auth/logout', { preHandler: requireSession }, async (request, reply) => {
    if (request.account.authKind === 'web') {
      db.prepare('UPDATE sessions SET revoked_at=? WHERE session_id=?').run(nowIso(), request.account.sessionId);
      reply.header('Set-Cookie', 'paopao_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    } else db.prepare('UPDATE native_refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?')
      .run(nowIso(), request.account.familyId);
    return { ok: true };
  });
  app.get('/api/account/status', async (request) => {
    const session = accountFor(request);
    return session ? {
      authenticated: true,
      authentication: session.authKind,
      ...publicProfile(session.userId),
      ...(session.authKind === 'web' ? { csrfToken: session.csrfToken } : { nativeClient: session.client }),
    } : { authenticated: false };
  });
  app.get('/api/account', { preHandler: requireSession }, async (request) => ({
    ...publicProfile(request.account.userId),
    authentication: request.account.authKind,
    ...(request.account.authKind === 'web' ? { csrfToken: request.account.csrfToken } : { nativeClient: request.account.client }),
  }));
  app.get('/api/wallet', { preHandler: requireSession }, async (request) => publicProfile(request.account.userId).wallet);
  app.get('/api/catalog', async () => ({ version: 1, offers: db.prepare(`SELECT offer_id AS offerId,title,currency,price,grant_kind AS grantKind,grant_id AS grantId,grant_quantity AS quantity
    FROM catalog_offers WHERE active=1 ORDER BY currency,price,offer_id`).all() }));

  const inventoryStateFor = (userId) => {
    const balances = new Map([['bomb', 3], ['rainbow', 2], ['storyShard', 0]]);
    const rows = db.prepare('SELECT item_id AS itemId,COALESCE(SUM(delta),0) AS delta FROM inventory_ledger WHERE user_id=? GROUP BY item_id').all(userId);
    for (const row of rows) {
      if (balances.has(row.itemId)) balances.set(row.itemId, Math.max(0, balances.get(row.itemId) + Number(row.delta)));
    }
    const items = Array.from(balances, ([itemId, quantity]) => ({ itemId, quantity }))
      .filter(({ quantity }) => quantity > 0);
    const entitlements = db.prepare('SELECT entitlement_id AS entitlementId,source,created_at AS createdAt FROM entitlements WHERE user_id=?').all(userId);
    const inventoryEntries = db.prepare('SELECT COUNT(*) AS count FROM inventory_ledger WHERE user_id=?').get(userId).count;
    return { revision: Number(inventoryEntries) + entitlements.length, items, entitlements };
  };

  app.get('/api/inventory/v2', { preHandler: requireSession }, async (request) => inventoryStateFor(request.account.userId));

  const consumeInventory = db.transaction((userId, itemId, quantity, key) => {
    const entryId = `inv_consume_${digest(`${userId}\0${key}`).slice(0, 32)}`;
    const existing = db.prepare('SELECT item_id AS itemId,delta FROM inventory_ledger WHERE entry_id=? AND user_id=?').get(entryId, userId);
    if (existing) {
      if (existing.itemId !== itemId || Number(existing.delta) !== -quantity) {
        throw Object.assign(new Error('idempotency-key-conflict'), { statusCode: 409 });
      }
      return { duplicate: true, entryId, inventory: inventoryStateFor(userId) };
    }
    const current = inventoryStateFor(userId).items.find((entry) => entry.itemId === itemId)?.quantity ?? 0;
    if (current < quantity) throw Object.assign(new Error('inventory-insufficient'), { statusCode: 409 });
    db.prepare('INSERT INTO inventory_ledger(entry_id,user_id,item_id,delta,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(entryId, userId, itemId, -quantity, 'gameplay', `consume:${key}`, nowIso());
    return { duplicate: false, entryId, inventory: inventoryStateFor(userId) };
  });

  app.post('/api/inventory/v2/consume', { preHandler: requireSession, bodyLimit: 2_048, schema: { body: {
    type: 'object', required: ['itemId', 'quantity', 'idempotencyKey'], properties: {
      itemId: { enum: ['bomb', 'rainbow'] },
      quantity: { type: 'integer', minimum: 1, maximum: 99 },
      idempotencyKey: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
    }, additionalProperties: false,
  } } }, async (request, reply) => {
    try { return consumeInventory(request.account.userId, request.body.itemId, request.body.quantity, request.body.idempotencyKey); }
    catch (error) {
      if (error.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      request.log.error({ err: error }, 'inventory consumption failed');
      return reply.code(500).send({ error: 'inventory-consumption-failed' });
    }
  });

  const purchase = db.transaction((userId, offerId, idempotencyKey) => {
    const duplicate = db.prepare(`SELECT o.offer_id,r.payload_json FROM orders o JOIN purchase_receipts r ON r.order_id=o.order_id WHERE o.user_id=? AND o.idempotency_key=?`).get(userId, idempotencyKey);
    if (duplicate) {
      if (duplicate.offer_id !== offerId) throw Object.assign(new Error('idempotency-key-conflict'), { statusCode: 409 });
      return json(duplicate.payload_json);
    }
    const offer = db.prepare('SELECT * FROM catalog_offers WHERE offer_id=? AND active=1').get(offerId);
    if (!offer) throw Object.assign(new Error('offer-not-found'), { statusCode: 404 });
    if (offer.grant_kind === 'entitlement' && db.prepare('SELECT 1 FROM entitlements WHERE user_id=? AND entitlement_id=?').get(userId, offer.grant_id)) {
      throw Object.assign(new Error('already-owned'), { statusCode: 409 });
    }
    const wallet = db.prepare('SELECT coins,diamonds,revision FROM wallets WHERE user_id=?').get(userId);
    if (wallet[offer.currency] < offer.price) throw Object.assign(new Error('insufficient-funds'), { statusCode: 409 });
    const orderId = id('ord'); const receiptId = id('rcp'); const timestamp = nowIso(); const nextBalance = wallet[offer.currency] - offer.price;
    db.prepare(`UPDATE wallets SET ${offer.currency}=?,revision=revision+1,updated_at=? WHERE user_id=?`).run(nextBalance, timestamp, userId);
    db.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id('led'), userId, offer.currency, -offer.price, nextBalance, 'purchase', orderId, timestamp);
    db.prepare('INSERT INTO orders(order_id,user_id,offer_id,idempotency_key,status,currency,amount,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(orderId, userId, offerId, idempotencyKey, 'settled', offer.currency, offer.price, timestamp);
    if (offer.grant_kind === 'inventory') db.prepare('INSERT INTO inventory_ledger(entry_id,user_id,item_id,delta,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id('inv'), userId, offer.grant_id, offer.grant_quantity, 'purchase', orderId, timestamp);
    else if (offer.grant_kind === 'bundle') {
      const grants = SOCIAL_BUNDLES[offer.grant_id];
      if (!grants) throw Object.assign(new Error('bundle-not-found'), { statusCode: 409 });
      for (const grant of grants) db.prepare('INSERT INTO inventory_ledger(entry_id,user_id,item_id,delta,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id('inv'), userId, grant.itemId, grant.quantity, 'purchase', orderId, timestamp);
    } else db.prepare('INSERT INTO entitlements(user_id,entitlement_id,source,created_at) VALUES(?,?,?,?)').run(userId, offer.grant_id, orderId, timestamp);
    const payload = { receiptId, orderId, offerId, status: 'settled', currency: offer.currency, amount: offer.price, balance: nextBalance, grant: { kind: offer.grant_kind, id: offer.grant_id, quantity: offer.grant_quantity }, createdAt: timestamp };
    db.prepare('INSERT INTO purchase_receipts(receipt_id,order_id,user_id,payload_json,created_at) VALUES(?,?,?,?,?)').run(receiptId, orderId, userId, JSON.stringify(payload), timestamp);
    return payload;
  });
  app.post('/api/purchases', { preHandler: requireSession, bodyLimit: 2_048, schema: { body: { type: 'object', required: ['offerId'], properties: { offerId: { type: 'string', minLength: 1, maxLength: 80 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 96 } }, additionalProperties: false } } }, async (request, reply) => {
    const key = String(request.headers['idempotency-key'] ?? request.body.idempotencyKey ?? '');
    if (key.length < 8 || key.length > 96 || !/^[A-Za-z0-9._:-]+$/.test(key)) return reply.code(400).send({ error: 'idempotency-key-invalid' });
    try { return purchase(request.account.userId, request.body.offerId, key); }
    catch (error) {
      if (error.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      request.log.error({ err: error }, 'purchase settlement failed');
      return reply.code(500).send({ error: 'purchase-failed' });
    }
  });
  app.get('/api/purchases/:receiptId', { preHandler: requireSession }, async (request, reply) => {
    const row = db.prepare('SELECT payload_json FROM purchase_receipts WHERE receipt_id=? AND user_id=?').get(request.params.receiptId, request.account.userId);
    return row ? json(row.payload_json) : reply.code(404).send({ error: 'receipt-not-found' });
  });

  const exchange = db.transaction((userId, packs, referenceId) => {
    const weekStart = new Date(); weekStart.setUTCHours(0, 0, 0, 0); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const exchanged = db.prepare("SELECT COALESCE(SUM(delta),0) AS total FROM wallet_ledger WHERE user_id=? AND currency='diamonds' AND kind='weekly-exchange' AND created_at>=?").get(userId, weekStart.toISOString()).total;
    const diamonds = packs * 50; const coins = packs * 1000;
    if (exchanged + diamonds > 100) throw Object.assign(new Error('weekly-exchange-cap'), { statusCode: 409 });
    const wallet = db.prepare('SELECT coins,diamonds FROM wallets WHERE user_id=?').get(userId);
    if (wallet.coins < coins) throw Object.assign(new Error('insufficient-coins'), { statusCode: 409 });
    const timestamp = nowIso(); const nextCoins = wallet.coins - coins; const nextDiamonds = wallet.diamonds + diamonds;
    db.prepare('UPDATE wallets SET coins=?,diamonds=?,revision=revision+1,updated_at=? WHERE user_id=?').run(nextCoins, nextDiamonds, timestamp, userId);
    db.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id('led'), userId, 'coins', -coins, nextCoins, 'weekly-exchange', referenceId, timestamp);
    db.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id('led'), userId, 'diamonds', diamonds, nextDiamonds, 'weekly-exchange', referenceId, timestamp);
    return { coins: nextCoins, diamonds: nextDiamonds, exchangedThisWeek: exchanged + diamonds, weeklyCap: 100 };
  });
  app.post('/api/wallet/exchange', { preHandler: requireSession, schema: { body: { type: 'object', required: ['packs'], properties: { packs: { type: 'integer', minimum: 1, maximum: 2 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 96 } }, additionalProperties: false } } }, async (request, reply) => {
    const reference = `exchange:${request.account.userId}:${request.body.idempotencyKey}`;
    const prior = db.prepare("SELECT 1 FROM wallet_ledger WHERE user_id=? AND reference_id=? AND kind='weekly-exchange'").get(request.account.userId, reference);
    if (prior) return { ...publicProfile(request.account.userId).wallet, duplicate: true };
    try { return exchange(request.account.userId, request.body.packs, reference); }
    catch (error) { return reply.code(error.statusCode ?? 500).send({ error: error.message }); }
  });

  app.get('/api/progress', { preHandler: requireSession }, async (request) => {
    const row = db.prepare('SELECT progress_json AS progress,revision,updated_at AS updatedAt FROM player_progress WHERE user_id=?').get(request.account.userId);
    return { ...row, progress: json(row.progress) };
  });
  app.get('/api/v3/progress', { preHandler: requireSession }, async (request) => {
    const row = db.prepare('SELECT progress_json AS progress,revision,updated_at AS updatedAt FROM player_progress WHERE user_id=?').get(request.account.userId);
    return progressEnvelopeFor(request.account.userId, row);
  });
  const rejectUnknownV4ProgressFields = async (request, reply) => {
    const allowed = new Set(['revision', 'progress', ...Object.keys(v4ClientStateSchema)]);
    if (Object.keys(request.body ?? {}).some((key) => !allowed.has(key))) {
      return reply.code(400).send({ error: 'progress-field-invalid' });
    }
  };
  app.put('/api/v3/progress', { preHandler: requireSession, preValidation: rejectUnknownV4ProgressFields, bodyLimit: 64_000, schema: { body: {
    type: 'object', required: ['revision', 'progress'], properties: {
      revision: { type: 'integer', minimum: 0, maximum: 2147483647 }, progress: v3ProgressSchema, ...v4ClientStateSchema,
    }, additionalProperties: false,
  } } }, async (request, reply) => {
    const current = db.prepare('SELECT progress_json,revision,updated_at FROM player_progress WHERE user_id=?').get(request.account.userId);
    if (request.body.revision !== current.revision) {
      return reply.code(409).send({ error: 'revision-conflict', ...progressEnvelopeFor(request.account.userId, current) });
    }
    const merged = mergeProgress(json(current.progress_json), request.body.progress);
    const updatedAt = nowIso();
    const liveConfig = currentLiveConfig();
    const stateRow = db.prepare('SELECT state_json FROM player_client_state_v4 WHERE user_id=?').get(request.account.userId);
    const remoteState = json(stateRow?.state_json);
    const submittedState = { ...remoteState };
    for (const key of Object.keys(v4ClientStateSchema)) {
      if (request.body[key] !== undefined) submittedState[key] = request.body[key];
    }
    const state = mergeClientState(remoteState, submittedState, merged, liveConfig, updatedAt);
    db.transaction(() => {
      db.prepare('UPDATE player_progress SET progress_json=?,revision=revision+1,updated_at=? WHERE user_id=?')
        .run(JSON.stringify(merged), updatedAt, request.account.userId);
      db.prepare(`INSERT INTO player_client_state_v4(user_id,state_json,updated_at) VALUES(?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
        .run(request.account.userId, JSON.stringify(state), updatedAt);
    })();
    return {
      saveVersion: 4,
      revision: current.revision + 1,
      updatedAt,
      client: state.clientIdentity.id,
      progress: merged,
      ...state,
      entitlements: entitlementStateFor(request.account.userId),
    };
  });

  const classicTicketTokenFor = (row) => encodeAuthorityToken(contentSigningSecret, 'classic-ticket-v1', {
    ticketId: row.ticketId,
    runId: row.runId,
    userId: row.userId,
    level: row.level,
    mode: row.mode,
    nonce: row.nonce,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
  });
  const classicShotAckFor = (row, trace) => trace.length === 0 ? '' : encodeAuthorityToken(
    contentSigningSecret,
    'classic-shot-ack-v1',
    {
      ticketId: row.ticketId,
      runId: row.runId,
      userId: row.userId,
      sequence: trace.length - 1,
      traceHash: digest(canonicalJson(publicClassicTrace(trace))),
    },
  );
  const classicTerminalChallengeFor = (row, trace, completed) => completed ? encodeAuthorityToken(
    contentSigningSecret,
    'classic-terminal-v1',
    {
      ticketId: row.ticketId,
      runId: row.runId,
      userId: row.userId,
      sequence: trace.length - 1,
      traceHash: digest(canonicalJson(publicClassicTrace(trace))),
      completed: true,
      rulesVersion: CLASSIC_AUTHORITY_RULES.rulesVersion,
    },
  ) : '';
  const classicTargetFor = (row, sequence) => {
    const target = classicAuthorityTarget({ seed: row.seed, level: row.level, sequence });
    return target.ok ? target.target : null;
  };
  const classicTicketEnvelope = (row, duplicate = false) => ({
    duplicate,
    ticketId: row.ticketId,
    ticketToken: classicTicketTokenFor(row),
    runId: row.runId,
    level: row.level,
    mode: row.mode,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    rulesVersion: CLASSIC_AUTHORITY_RULES.rulesVersion,
    requiredShots: classicAuthorityRequiredShots(row.level),
    requiredProofHits: 1,
    minimumDurationMs: classicAuthorityMinimumDurationMs(row.level),
    target: classicTargetFor(row, 0),
  });
  const beginClassicAuthority = db.transaction(({ userId, level, mode, idempotencyKey }) => {
    const existing = db.prepare(`SELECT ticket_id AS ticketId,run_id AS runId,user_id AS userId,level,mode,seed,nonce,
      started_at AS startedAt,expires_at AS expiresAt,status FROM classic_run_tickets
      WHERE user_id=? AND idempotency_key=?`).get(userId, idempotencyKey);
    if (existing) {
      if (existing.level !== level || existing.mode !== mode) {
        throw Object.assign(new Error('classic-authority-idempotency-conflict'), { statusCode: 409 });
      }
      if (existing.status !== 'active' || Date.parse(existing.expiresAt) <= Date.now()) {
        throw Object.assign(new Error('classic-authority-ticket-unavailable'), { statusCode: 409 });
      }
      return classicTicketEnvelope(existing, true);
    }
    const currentClear = db.prepare('SELECT 1 FROM classic_authority_clears WHERE user_id=? AND level=?').get(userId, level);
    const prerequisite = level === 0 || currentClear
      || db.prepare('SELECT 1 FROM classic_authority_clears WHERE user_id=? AND level=?').get(userId, level - 1);
    if (!prerequisite) {
      throw Object.assign(new Error('classic-authority-prerequisite-required'), { statusCode: 409 });
    }
    const timestampMs = Date.now();
    const startedAt = new Date(timestampMs).toISOString();
    const expiresAt = new Date(timestampMs + CLASSIC_AUTHORITY_RULES.ticketTtlMs).toISOString();
    db.prepare("UPDATE classic_run_tickets SET status=CASE WHEN expires_at<=? THEN 'expired' ELSE 'abandoned' END WHERE user_id=? AND status='active'")
      .run(startedAt, userId);
    const row = {
      ticketId: id('ctk'),
      runId: id('classic'),
      userId,
      level,
      mode,
      seed: randomInt(1, 0x7fffffff),
      nonce: randomBytes(24).toString('base64url'),
      startedAt,
      expiresAt,
    };
    db.prepare(`INSERT INTO classic_run_tickets
      (ticket_id,run_id,user_id,level,mode,seed,nonce,idempotency_key,started_at,expires_at,status,trace_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,'active','[]')`)
      .run(row.ticketId, row.runId, row.userId, row.level, row.mode, row.seed, row.nonce,
        idempotencyKey, row.startedAt, row.expiresAt);
    return classicTicketEnvelope(row, false);
  });
  app.post('/api/v3/classic/runs/start', { preHandler: requireSession, bodyLimit: 4_096, schema: { body: {
    type: 'object', required: ['level', 'mode', 'idempotencyKey'], properties: {
      level: { type: 'integer', minimum: 0, maximum: 41 },
      mode: { enum: ['classic', 'rush', 'precision'] },
      idempotencyKey: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
    }, additionalProperties: false,
  } } }, async (request, reply) => {
    try {
      return beginClassicAuthority({ userId: request.account.userId, ...request.body });
    } catch (error) {
      return reply.code(error.statusCode ?? 500).send({ error: error.message });
    }
  });

  const appendClassicAuthorityShot = db.transaction(({ userId, ticketId, ticketToken, previousAck, shot }) => {
    const row = db.prepare(`SELECT ticket_id AS ticketId,run_id AS runId,user_id AS userId,level,mode,seed,nonce,
      started_at AS startedAt,expires_at AS expiresAt,status,trace_json AS traceJson,
      last_received_at AS lastReceivedAt FROM classic_run_tickets WHERE ticket_id=?`).get(ticketId);
    if (!row || row.userId !== userId) throw Object.assign(new Error('classic-authority-ticket-mismatch'), { statusCode: 422 });
    if (row.status !== 'active') throw Object.assign(new Error('classic-authority-ticket-consumed'), { statusCode: 409 });
    if (Date.parse(row.expiresAt) <= Date.now()) {
      db.prepare("UPDATE classic_run_tickets SET status='expired' WHERE ticket_id=? AND status='active'").run(ticketId);
      throw Object.assign(new Error('classic-authority-ticket-expired'), { statusCode: 409 });
    }
    const token = decodeAuthorityToken(contentSigningSecret, 'classic-ticket-v1', ticketToken);
    if (!token || token.ticketId !== row.ticketId || token.runId !== row.runId || token.userId !== userId
      || token.level !== row.level || token.mode !== row.mode || token.nonce !== row.nonce
      || token.startedAt !== row.startedAt || token.expiresAt !== row.expiresAt) {
      throw Object.assign(new Error('classic-authority-ticket-invalid'), { statusCode: 422 });
    }
    const trace = json(row.traceJson, []);
    if (!Array.isArray(trace)) throw Object.assign(new Error('classic-authority-trace-corrupt'), { statusCode: 500 });
    if (shot.sequence < trace.length) {
      const prior = trace[shot.sequence];
      if (prior?.sequence !== shot.sequence || prior.atMs !== shot.atMs
        || prior.angleMilliDegrees !== shot.angleMilliDegrees) {
        throw Object.assign(new Error('classic-authority-shot-conflict'), { statusCode: 409 });
      }
      const prefix = trace.slice(0, shot.sequence + 1);
      const evaluation = evaluateClassicAuthorityTrace({ seed: row.seed, level: row.level, shotTrace: publicClassicTrace(prefix) });
      const terminalChallenge = evaluation.ok
        ? classicTerminalChallengeFor(row, prefix, evaluation.result.completed)
        : '';
      return {
        accepted: false,
        duplicate: true,
        sequence: shot.sequence,
        ack: classicShotAckFor(row, prefix),
        proofHit: Boolean(evaluation.ok && evaluation.result.outcomes.at(-1)?.hit),
        proofHits: evaluation.ok ? evaluation.result.proofHits : 0,
        requiredProofHits: 1,
        requiredShots: classicAuthorityRequiredShots(row.level),
        completed: Boolean(evaluation.ok && evaluation.result.completed),
        ...(terminalChallenge ? { terminalChallenge } : {}),
        nextTarget: classicTargetFor(row, shot.sequence + 1),
      };
    }
    if (shot.sequence !== trace.length) throw Object.assign(new Error('classic-authority-shot-order-invalid'), { statusCode: 422 });
    const expectedPreviousAck = classicShotAckFor(row, trace);
    if (!secureEqual(previousAck ?? '', expectedPreviousAck)) {
      throw Object.assign(new Error('classic-authority-shot-chain-invalid'), { statusCode: 422 });
    }
    const previousAtMs = trace.at(-1)?.atMs ?? 0;
    const intervalMs = shot.atMs - previousAtMs;
    const minimumMs = shot.sequence === 0
      ? CLASSIC_AUTHORITY_RULES.minimumFirstShotMs
      : CLASSIC_AUTHORITY_RULES.minimumShotIntervalMs;
    if (intervalMs < minimumMs || intervalMs > CLASSIC_AUTHORITY_RULES.maximumShotIntervalMs) {
      throw Object.assign(new Error('classic-authority-cadence-invalid'), { statusCode: 422 });
    }
    const receivedAtMs = Date.now();
    const serverElapsedMs = receivedAtMs - Date.parse(row.startedAt);
    if (shot.atMs > serverElapsedMs + CLASSIC_AUTHORITY_RULES.maximumFutureLeadMs) {
      throw Object.assign(new Error('classic-authority-shot-future'), { statusCode: 422 });
    }
    if (row.lastReceivedAt
      && receivedAtMs - Date.parse(row.lastReceivedAt) < CLASSIC_AUTHORITY_RULES.minimumServerReceiptIntervalMs) {
      throw Object.assign(new Error('classic-authority-shot-batched'), { statusCode: 429 });
    }
    const nextTrace = [...trace, { ...shot, receivedAt: new Date(receivedAtMs).toISOString() }];
    const evaluation = evaluateClassicAuthorityTrace({ seed: row.seed, level: row.level, shotTrace: publicClassicTrace(nextTrace) });
    if (!evaluation.ok) throw Object.assign(new Error(evaluation.error), { statusCode: 422 });
    const terminalChallenge = classicTerminalChallengeFor(row, nextTrace, evaluation.result.completed);
    db.prepare(`UPDATE classic_run_tickets SET trace_json=?,last_received_at=?,terminal_challenge_hash=?
      WHERE ticket_id=? AND status='active'`)
      .run(JSON.stringify(nextTrace), new Date(receivedAtMs).toISOString(), terminalChallenge ? digest(terminalChallenge) : null, ticketId);
    return {
      accepted: true,
      duplicate: false,
      sequence: shot.sequence,
      ack: classicShotAckFor(row, nextTrace),
      proofHit: Boolean(evaluation.result.outcomes.at(-1)?.hit),
      proofHits: evaluation.result.proofHits,
      requiredProofHits: evaluation.result.requiredProofHits,
      requiredShots: evaluation.result.requiredShots,
      completed: evaluation.result.completed,
      ...(terminalChallenge ? { terminalChallenge } : {}),
      nextTarget: classicTargetFor(row, shot.sequence + 1),
    };
  });
  app.post('/api/v3/classic/runs/:ticketId/shots', { preHandler: requireSession, bodyLimit: 8_192, schema: {
    params: { type: 'object', required: ['ticketId'], properties: {
      ticketId: { type: 'string', minLength: 8, maxLength: 96, pattern: '^ctk_[A-Za-z0-9_-]+$' },
    }, additionalProperties: false },
    body: { type: 'object', required: ['ticketToken', 'sequence', 'atMs', 'angleMilliDegrees'], properties: {
      ticketToken: { type: 'string', minLength: 32, maxLength: 1_024 },
      previousAck: { type: 'string', maxLength: 1_024 },
      sequence: { type: 'integer', minimum: 0, maximum: CLASSIC_AUTHORITY_RULES.maximumShots - 1 },
      atMs: { type: 'integer', minimum: 0, maximum: 14_400_000 },
      angleMilliDegrees: {
        type: 'integer',
        minimum: ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees,
        maximum: ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees,
      },
    }, additionalProperties: false },
  } }, async (request, reply) => {
    try {
      return appendClassicAuthorityShot({
        userId: request.account.userId,
        ticketId: request.params.ticketId,
        ...request.body,
        shot: {
          sequence: request.body.sequence,
          atMs: request.body.atMs,
          angleMilliDegrees: request.body.angleMilliDegrees,
        },
      });
    } catch (error) {
      if ((error.statusCode ?? 500) >= 400 && (error.statusCode ?? 500) < 500) {
        db.prepare('INSERT INTO security_audit(event_id,user_id,event_type,detail_json,created_at) VALUES(?,?,?,?,?)')
          .run(id('audit'), request.account.userId, 'classic-authority-shot-rejected', JSON.stringify({
            ticketId: request.params.ticketId, sequence: request.body.sequence, reason: error.message,
          }), nowIso());
      }
      return reply.code(error.statusCode ?? 500).send({ error: error.message });
    }
  });

  app.post('/api/v3/runs', { preHandler: requireSession, bodyLimit: 64_000, schema: { body: {
    type: 'object', required: ['runId', 'client', 'level', 'mode', 'score', 'durationMs', 'won', 'createdAt'], properties: {
      runId: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
      client: { const: 'classic' }, level: { type: 'integer', minimum: 0, maximum: 41 },
      mode: { enum: ['classic', 'rush', 'precision', 'endless'] }, score: { type: 'integer', minimum: 0, maximum: 10000000 },
      durationMs: { type: 'integer', minimum: 500, maximum: 14400000 }, won: { type: 'boolean' },
      shots: { type: 'integer', minimum: 0, maximum: 5000 }, hits: { type: 'integer', minimum: 0, maximum: 5000 },
      contentVersion: { type: 'string', minLength: 1, maxLength: 64 }, seasonId: { type: 'string', minLength: 1, maxLength: 64 },
      seed: { type: 'integer', minimum: 0, maximum: 2147483647 }, wave: { type: 'integer', minimum: 1, maximum: 100000 },
      replayHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, eventId: { type: 'string', minLength: 1, maxLength: 96 },
      replayVersion: { type: 'integer', enum: [REPLAY_TRACE_VERSION] },
      shotTrace: {
        type: 'array', maxItems: MAX_REPLAY_SHOTS, items: {
          type: 'object', required: ['sequence', 'atMs', 'angleMilliDegrees'], properties: {
            sequence: { type: 'integer', minimum: 0, maximum: MAX_REPLAY_SHOTS - 1 },
            atMs: { type: 'integer', minimum: 0, maximum: 14400000 },
            angleMilliDegrees: {
              type: 'integer',
              minimum: ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees,
              maximum: ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees,
            },
          }, additionalProperties: false,
        },
      },
      challengeToken: { type: 'string', minLength: 32, maxLength: 128 },
      classicTicketId: { type: 'string', minLength: 8, maxLength: 96, pattern: '^ctk_[A-Za-z0-9_-]+$' },
      classicTicketToken: { type: 'string', minLength: 32, maxLength: 1_024 },
      classicTerminalChallenge: { type: 'string', minLength: 32, maxLength: 1_024 },
      createdAt: { type: 'string', format: 'date-time', maxLength: 40 },
    }, additionalProperties: false,
  } } }, async (request, reply) => {
    const run = request.body;
    const userId = request.account.userId;
    const liveConfig = currentLiveConfig();
    const prior = db.prepare('SELECT user_id AS userId,summary_json AS summaryJson,created_at AS createdAt FROM v3_runs WHERE run_id=?').get(run.runId);
    const runProof = (submittedRun) => {
      const payload = {
        runId: submittedRun.runId, userId, client: submittedRun.client,
        contentVersion: submittedRun.contentVersion ?? V3_CONTENT.contentVersion, createdAt: submittedRun.createdAt,
        scoreClaim: submittedRun.score, wonClaim: submittedRun.won,
        ...(submittedRun.replayHash ? { replayHash: submittedRun.replayHash } : {}),
      };
      return { payload, ...signedIntegrity(payload) };
    };
    if (prior) {
      if (prior.userId !== userId || canonicalJson(json(prior.summaryJson)) !== canonicalJson(run)) {
        db.prepare('INSERT INTO security_audit(event_id,user_id,event_type,detail_json,created_at) VALUES(?,?,?,?,?)')
          .run(id('audit'), userId, 'run-id-conflict', JSON.stringify({ runId: run.runId }), nowIso());
        return reply.code(409).send({ error: 'run-id-conflict', runId: run.runId });
      }
      const receipt = db.prepare('SELECT receipt_json AS receiptJson FROM v3_run_receipts WHERE run_id=?').get(run.runId);
      return receipt
        ? { ...json(receipt.receiptJson), accepted: false, duplicate: true, replayed: true }
        : { accepted: false, duplicate: true, runId: run.runId, validation: runProof(run) };
    }
    if ((run.hits ?? 0) > (run.shots ?? 0) || run.score > Math.max(50_000, ((run.hits ?? 0) + 1) * 50_000)) {
      return reply.code(422).send({ error: 'implausible-run' });
    }
    if (Date.parse(run.createdAt) > Date.now() + 5 * 60_000) return reply.code(422).send({ error: 'run-created-at-future' });
    if (run.contentVersion && run.contentVersion !== V3_CONTENT.contentVersion) {
      return reply.code(409).send({ error: 'content-version-mismatch', required: V3_CONTENT.contentVersion });
    }
    let event;
    if (run.mode === 'endless') {
      if (run.classicTicketId || run.classicTicketToken || run.classicTerminalChallenge) {
        return reply.code(422).send({ error: 'classic-authority-fields-not-allowed' });
      }
      event = run.eventId ? liveConfig.events.find((candidate) => candidate.id === run.eventId) : undefined;
      if (!run.contentVersion || !run.seasonId || !Number.isInteger(run.seed) || !Number.isInteger(run.wave) || !run.replayHash) {
        return reply.code(422).send({ error: 'endless-proof-required' });
      }
      if (run.seasonId !== liveConfig.endless.seasonId) return reply.code(409).send({ error: 'season-mismatch', required: liveConfig.endless.seasonId });
      if (run.eventId && !event) return reply.code(422).send({ error: 'event-not-active' });
      if (run.seed !== (event?.seed ?? liveConfig.endless.seed)) return reply.code(422).send({ error: 'seed-mismatch' });
      if (!event && run.challengeToken) return reply.code(422).send({ error: 'endless-challenge-token-unexpected' });
      if (event && (run.level !== event.level || !run.challengeToken
        || !verifyEventToken(run.challengeToken, event, liveConfig.endless))) {
        return reply.code(422).send({ error: 'event-proof-invalid' });
      }
      const challengeStartsAt = Date.parse(event?.startsAt ?? liveConfig.endless.startsAt);
      const challengeEndsAt = Date.parse(event?.endsAt ?? liveConfig.endless.endsAt);
      const runCreatedAt = Date.parse(run.createdAt);
      if (runCreatedAt < challengeStartsAt || runCreatedAt >= challengeEndsAt) {
        return reply.code(422).send({ error: event ? 'event-window-invalid' : 'season-window-invalid' });
      }
    } else if (run.eventId || run.challengeToken || run.seasonId || run.seed || run.wave || run.replayHash) {
      return reply.code(422).send({ error: 'endless-fields-not-allowed' });
    }

    const replayIntegrity = run.mode === 'endless'
      ? replayTraceIntegrity(run, event)
      : classicReplayIntegrity(run, { db, userId, signingSecret: contentSigningSecret });
    if (!replayIntegrity.ok) {
      db.prepare('INSERT INTO security_audit(event_id,user_id,event_type,detail_json,created_at) VALUES(?,?,?,?,?)')
        .run(id('audit'), userId, run.mode === 'endless' ? 'endless-replay-rejected' : 'classic-authority-run-rejected',
          JSON.stringify({ runId: run.runId, reason: replayIntegrity.error }), nowIso());
      return reply.code(422).send({ error: replayIntegrity.error });
    }
    const replayVerification = replayIntegrity.verification;

    const acceptedAt = nowIso();
    const settleRun = db.transaction(() => {
      if (replayIntegrity.result) {
        const reusedReplay = db.prepare('SELECT run_id AS runId FROM v3_replay_claims WHERE user_id=? AND season_id=? AND replay_hash=?')
          .get(userId, run.seasonId, run.replayHash);
        if (reusedReplay) {
          throw Object.assign(new Error('replay-proof-reused'), { statusCode: 409, originalRunId: reusedReplay.runId });
        }
      }
      if (replayIntegrity.classicAuthority) {
        const consumed = db.prepare(`UPDATE classic_run_tickets
          SET status='consumed',completed_run_id=? WHERE ticket_id=? AND user_id=? AND status='active'`)
          .run(run.runId, replayIntegrity.classicAuthority.ticketId, userId);
        if (consumed.changes !== 1) {
          throw Object.assign(new Error('classic-authority-ticket-consumed'), { statusCode: 409 });
        }
      }
      db.prepare(`INSERT INTO v3_runs
        (run_id,user_id,client,level,mode,score,duration_ms,won,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(run.runId, userId, run.client, run.level, run.mode, run.score, run.durationMs, run.won ? 1 : 0, JSON.stringify(run), run.createdAt);
      if (replayIntegrity.result) {
        db.prepare(`INSERT INTO v3_replay_claims
          (run_id,user_id,season_id,replay_hash,result_json,created_at) VALUES(?,?,?,?,?,?)`)
          .run(run.runId, userId, run.seasonId, run.replayHash, JSON.stringify(replayIntegrity.result), acceptedAt);
      }

      let reward;
      if (event) {
        const wallet = db.prepare('SELECT coins FROM wallets WHERE user_id=?').get(userId);
        const priorReward = db.prepare("SELECT balance_after AS balanceAfter FROM wallet_ledger WHERE user_id=? AND kind='live-event-reward' AND reference_id=?")
          .get(userId, event.id);
        if (!replayIntegrity.result?.won) {
          reward = {
            granted: false, alreadyClaimed: Boolean(priorReward), currency: 'coins', amount: 0,
            balance: wallet.coins, source: 'live-event', eventId: event.id,
            reason: replayIntegrity.result ? 'live-event-not-completed' : replayVerification.reason,
          };
        } else if (priorReward) {
          reward = {
            granted: false, alreadyClaimed: true, currency: 'coins', amount: 0,
            balance: wallet.coins, source: 'live-event', eventId: event.id, reason: 'live-event-reward-already-claimed',
          };
        } else {
          const amount = event.reward.amount;
          const balance = wallet.coins + amount;
          db.prepare('UPDATE wallets SET coins=?,revision=revision+1,updated_at=? WHERE user_id=?')
            .run(balance, acceptedAt, userId);
          db.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(id('led'), userId, 'coins', amount, balance, 'live-event-reward', event.id, acceptedAt);
          reward = {
            granted: true, alreadyClaimed: false, currency: 'coins', amount,
            balance, source: 'live-event', eventId: event.id,
          };
        }
      } else if (run.mode !== 'endless') {
        const wallet = db.prepare('SELECT coins FROM wallets WHERE user_id=?').get(userId);
        const referenceId = `classic-level:${run.level}`;
        const priorReward = db.prepare("SELECT balance_after AS balanceAfter FROM wallet_ledger WHERE user_id=? AND kind='classic-first-clear' AND reference_id=?")
          .get(userId, referenceId);
        if (!replayVerification.rewardEligible) {
          reward = {
            granted: false, alreadyClaimed: Boolean(priorReward), currency: 'coins', amount: 0,
            balance: wallet.coins, source: 'classic-first-clear', level: run.level,
            reason: replayVerification.reason,
          };
        } else if (priorReward) {
          reward = {
            granted: false, alreadyClaimed: true, currency: 'coins', amount: 0,
            balance: wallet.coins, source: 'classic-first-clear', level: run.level,
            reason: 'classic-first-clear-already-claimed',
          };
        } else {
          const amount = classicFirstClearReward(run.level);
          const balance = wallet.coins + amount;
          db.prepare('UPDATE wallets SET coins=?,revision=revision+1,updated_at=? WHERE user_id=?')
            .run(balance, acceptedAt, userId);
          db.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(id('led'), userId, 'coins', amount, balance, 'classic-first-clear', referenceId, acceptedAt);
          reward = {
            granted: true, alreadyClaimed: false, currency: 'coins', amount,
            balance, source: 'classic-first-clear', level: run.level,
          };
        }
        if (replayVerification.rewardEligible) {
          db.prepare(`INSERT OR IGNORE INTO classic_authority_clears(user_id,level,run_id,verified_at)
            VALUES(?,?,?,?)`).run(userId, run.level, run.runId, acceptedAt);
          const crestEntitlement = ECHO_CREST_ENTITLEMENTS.get(run.level);
          if (crestEntitlement) {
            db.prepare('INSERT OR IGNORE INTO entitlements(user_id,entitlement_id,source,created_at) VALUES(?,?,?,?)')
              .run(userId, crestEntitlement, `echo-level:${run.level}`, acceptedAt);
          }
          if (run.level === 41) {
            db.prepare('INSERT OR IGNORE INTO entitlements(user_id,entitlement_id,source,created_at) VALUES(?,?,?,?)')
              .run(userId, 'badge:crown-echo', 'echo-completion', acceptedAt);
            db.prepare('INSERT OR IGNORE INTO entitlements(user_id,entitlement_id,source,created_at) VALUES(?,?,?,?)')
              .run(userId, 'skin:nexus_crown_optical', 'echo-completion', acceptedAt);
          }
          const progressRow = db.prepare('SELECT progress_json,revision,updated_at FROM player_progress WHERE user_id=?').get(userId);
          const progress = normalizeProgress(json(progressRow.progress_json));
          progress.unlocked = Math.max(progress.unlocked, Math.min(MAX_PROGRESS_LEVELS, run.level + 2));
          progress.cleared = Array.from(new Set([...progress.cleared, run.level])).sort((a, b) => a - b);
          progress.stars[run.level] = Math.max(1, progress.stars[run.level] ?? 0);
          progress.claimedFirstClears = Array.from(new Set([...progress.claimedFirstClears, run.level])).sort((a, b) => a - b);
          db.prepare('UPDATE player_progress SET progress_json=?,revision=revision+1,updated_at=? WHERE user_id=?')
            .run(JSON.stringify(progress), acceptedAt, userId);
          const stateRow = db.prepare('SELECT state_json FROM player_client_state_v4 WHERE user_id=?').get(userId);
          const state = normalizeClientState(json(stateRow?.state_json), progress, liveConfig, acceptedAt);
          db.prepare(`INSERT INTO player_client_state_v4(user_id,state_json,updated_at) VALUES(?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
            .run(userId, JSON.stringify(state), acceptedAt);
        }
      }

      let progression;
      if (replayIntegrity.result) {
        const progressRow = db.prepare('SELECT progress_json,updated_at FROM player_progress WHERE user_id=?').get(userId);
        const progress = normalizeProgress(json(progressRow.progress_json));
        const stateRow = db.prepare('SELECT state_json FROM player_client_state_v4 WHERE user_id=?').get(userId);
        const state = normalizeClientState(json(stateRow?.state_json), progress, liveConfig, progressRow.updated_at);
        const result = replayIntegrity.result;
        const seasonPoints = Math.min(1_000_000_000, state.endless.seasonPoints + result.seasonPoints);
        const eventCompleted = Boolean(event && result.won);
        const nextState = normalizeClientState({
          ...state,
          endless: {
            ...state.endless,
            bestWave: Math.max(state.endless.bestWave, result.wave),
            bestScore: Math.max(state.endless.bestScore, result.score),
            seasonPoints,
            completedRunIds: [...state.endless.completedRunIds.slice(-199), run.runId],
          },
          liveEvent: {
            ...state.liveEvent,
            rewardTrackTier: Math.max(state.liveEvent.rewardTrackTier, Math.min(10_000, Math.floor(seasonPoints / SEASON_POINTS_PER_TIER))),
            completedChallengeIds: eventCompleted
              ? [...state.liveEvent.completedChallengeIds.filter((entry) => entry !== event.id).slice(-199), event.id]
              : state.liveEvent.completedChallengeIds,
            claimedRewardIds: eventCompleted && (reward?.granted || reward?.alreadyClaimed)
              ? [...state.liveEvent.claimedRewardIds.filter((entry) => entry !== event.id).slice(-199), event.id]
              : state.liveEvent.claimedRewardIds,
          },
        }, progress, liveConfig, acceptedAt);
        db.prepare(`INSERT INTO player_client_state_v4(user_id,state_json,updated_at) VALUES(?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`)
          .run(userId, JSON.stringify(nextState), acceptedAt);
        progression = {
          applied: true,
          seasonId: run.seasonId,
          runPoints: result.seasonPoints,
          bestWave: nextState.endless.bestWave,
          bestScore: nextState.endless.bestScore,
          seasonPoints: nextState.endless.seasonPoints,
          rewardTrackTier: nextState.liveEvent.rewardTrackTier,
        };
      }

      const validation = runProof(run);
      const rewardProof = reward ? { payload: { runId: run.runId, userId, ...reward }, ...signedIntegrity({ runId: run.runId, userId, ...reward }) } : undefined;
      const receipt = {
        accepted: true, duplicate: false, runId: run.runId, serverAcceptedAt: acceptedAt, validation,
        replayVerification,
        ...(run.mode === 'endless' ? { progression: progression ?? { applied: false, reason: replayVerification.reason } } : {}),
        ...(reward ? { reward, rewardProof } : {}),
      };
      db.prepare('INSERT INTO v3_run_receipts(run_id,receipt_json,created_at) VALUES(?,?,?)')
        .run(run.runId, JSON.stringify(receipt), acceptedAt);
      return receipt;
    });
    try { return settleRun(); }
    catch (error) {
      if (error.statusCode === 409) {
        db.prepare('INSERT INTO security_audit(event_id,user_id,event_type,detail_json,created_at) VALUES(?,?,?,?,?)')
          .run(id('audit'), userId, run.mode === 'endless' ? 'endless-replay-reused' : 'classic-authority-ticket-reused', JSON.stringify({
            runId: run.runId, originalRunId: error.originalRunId ?? null,
          }), nowIso());
        return reply.code(409).send({ error: error.message, ...(error.originalRunId ? { originalRunId: error.originalRunId } : {}) });
      }
      throw error;
    }
  });
  app.post('/api/progress/sync', { preHandler: requireSession, bodyLimit: 64_000, schema: { body: { type: 'object', required: ['progress'], properties: {
    progress: {
      type: 'object',
      properties: {
        unlocked: { type: 'integer', minimum: 1, maximum: 42 },
        bestScores: { type: 'array', maxItems: 42, items: { type: 'integer', minimum: 0, maximum: 10000000 } },
        stars: { type: 'array', maxItems: 42, items: { type: 'integer', minimum: 0, maximum: 3 } },
        cleared: { type: 'array', maxItems: 42, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 41 } },
        mastered: { type: 'array', maxItems: 42, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 41 } },
        claimedFirstClears: { type: 'array', maxItems: 42, uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 41 } },
      },
      additionalProperties: false,
    },
    legacyImportHash: { type: 'string', minLength: 8, maxLength: 128 }, legacyCoins: { type: 'integer', minimum: 0, maximum: 10000000 },
  }, additionalProperties: false } } }, async (request) => {
    const timestamp = nowIso(); const current = db.prepare('SELECT progress_json,revision FROM player_progress WHERE user_id=?').get(request.account.userId);
    const remote = json(current.progress_json); const local = request.body.progress;
    const merged = mergeProgress(remote, local);
    const sync = db.transaction(() => {
      db.prepare('UPDATE player_progress SET progress_json=?,revision=revision+1,updated_at=? WHERE user_id=?').run(JSON.stringify(merged), timestamp, request.account.userId);
    }); sync();
    const legacyCurrencyRequested = request.body.legacyCoins !== undefined || request.body.legacyImportHash !== undefined;
    return {
      progress: merged, revision: current.revision + 1,
      wallet: publicProfile(request.account.userId).wallet, syncedAt: timestamp,
      ...(legacyCurrencyRequested ? {
        legacyCurrencyImport: { accepted: false, reason: 'server-issued-proof-required' },
      } : {}),
    };
  });

  const productTelemetryTypes = new Set([
    'tutorial-step', 'level-start', 'level-end', 'level-exit', 'shot-result',
    'boss-phase', 'reward-claim', 'hand-state', 'session-exit', 'next-action',
  ]);
  const telemetryEventTypes = ['performance', 'frame-health', ...productTelemetryTypes];
  const telemetryModes = ['classic', 'rush', 'precision', 'endless', 'arena', 'tutorial'];
  const telemetryInputModes = [
    'touch', 'mouse', 'keyboard', 'gamepad', 'hand', 'gaze', 'gaze-hand', 'unknown',
  ];
  const telemetrySteps = [
    'aim', 'fire', 'match-three', 'drop-cluster', 'next-orb', 'swap',
    'danger-line', 'objective', 'hand-touch-one', 'hand-touch-two',
  ];
  const telemetryOutcomes = [
    'started', 'completed', 'failed', 'quit', 'won', 'lost', 'hit', 'miss',
    'claimed', 'denied', 'ready', 'uncertain', 'recovered', 'selected',
  ];
  const telemetryReasons = [
    'completed', 'danger-line', 'shot-limit', 'timer', 'player-exit', 'tracking-loss',
    'camera-loss', 'renderer-loss', 'offline', 'authority-denied', 'unknown',
  ];
  let lastTelemetryPurgeAt = 0;
  const acceptTelemetry = async (request, reply) => {
    const containsProductEvents = request.body.events.some((event) => productTelemetryTypes.has(event.type));
    if (containsProductEvents && (
      request.body.anonymous !== true
      || request.body.consentVersion !== 'product-telemetry-v1'
      || request.body.events.some((event) => (
        productTelemetryTypes.has(event.type)
        && (!event.eventId || !event.sessionId || !Number.isInteger(event.occurredAtMs))
      ))
    )) return reply.code(400).send({ error: 'product-telemetry-consent-required' });
    const safe = request.body.events.map((event) => ({
      type: event.type,
      ...(event.eventId === undefined ? {} : { eventId: event.eventId }),
      ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      ...(event.occurredAtMs === undefined ? {} : { occurredAtMs: event.occurredAtMs }),
      ...(event.averageFps === undefined ? {} : { averageFps: event.averageFps }),
      ...(event.p95FrameMs === undefined ? {} : { p95FrameMs: event.p95FrameMs }),
      ...(event.longFrames === undefined ? {} : { longFrames: event.longFrames }),
      ...(event.quality === undefined ? {} : { quality: event.quality }),
      ...(event.displayHz === undefined ? {} : { displayHz: event.displayHz }),
      ...(event.inferenceMs === undefined ? {} : { inferenceMs: event.inferenceMs }),
      ...(event.trackingFps === undefined ? {} : { trackingFps: event.trackingFps }),
      ...(event.level === undefined ? {} : { level: event.level }),
      ...(event.mode === undefined ? {} : { mode: event.mode }),
      ...(event.inputMode === undefined ? {} : { inputMode: event.inputMode }),
      ...(event.step === undefined ? {} : { step: event.step }),
      ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
      ...(event.reason === undefined ? {} : { reason: event.reason }),
      ...(event.bossPhase === undefined ? {} : { bossPhase: event.bossPhase }),
      ...(event.shots === undefined ? {} : { shots: event.shots }),
      ...(event.hits === undefined ? {} : { hits: event.hits }),
      ...(event.won === undefined ? {} : { won: event.won }),
      ...(event.bankShot === undefined ? {} : { bankShot: event.bankShot }),
      at: nowIso(),
    }));
    const batchId = request.body.batchId ?? id('tel');
    if (Date.now() - lastTelemetryPurgeAt >= 60 * 60_000) {
      lastTelemetryPurgeAt = Date.now();
      const retentionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
      db.prepare('DELETE FROM telemetry_batches WHERE created_at < ?').run(retentionCutoff);
    }
    const inserted = db.prepare('INSERT OR IGNORE INTO telemetry_batches(batch_id,user_id,events_json,created_at) VALUES(?,?,?,?)')
      .run(batchId, request.body.anonymous === true ? null : accountFor(request)?.userId ?? null, JSON.stringify(safe), nowIso());
    if (!request.body.batchId) return { accepted: safe.length };
    return { accepted: inserted.changes === 1 ? safe.length : 0, duplicate: inserted.changes === 0, batchId };
  };
  const rejectUnknownTelemetryFields = async (request, reply) => {
    const allowed = new Set([
      'type', 'eventId', 'sessionId', 'occurredAtMs',
      'averageFps', 'p95FrameMs', 'longFrames', 'quality', 'displayHz', 'inferenceMs', 'trackingFps',
      'level', 'mode', 'inputMode', 'step', 'outcome', 'reason', 'bossPhase', 'shots', 'hits', 'won', 'bankShot',
    ]);
    for (const event of request.body?.events ?? []) {
      if (Object.keys(event).some((key) => !allowed.has(key))) return reply.code(400).send({ error: 'telemetry-field-invalid' });
    }
  };
  const telemetrySchema = { body: {
    type: 'object',
    required: ['events'],
    properties: {
      batchId: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
      client: { const: 'classic' },
      anonymous: { type: 'boolean' },
      consentVersion: { const: 'product-telemetry-v1' },
      events: {
        type: 'array', minItems: 1, maxItems: 50,
        items: {
          type: 'object', required: ['type'], properties: {
            type: { enum: telemetryEventTypes },
            eventId: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
            sessionId: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
            occurredAtMs: { type: 'integer', minimum: 0, maximum: 4_000_000_000_000 },
            averageFps: { type: 'number', minimum: 0, maximum: 360 },
            p95FrameMs: { type: 'number', minimum: 0, maximum: 10000 }, longFrames: { type: 'integer', minimum: 0, maximum: 1000000 },
            quality: { enum: ['ultra', 'balanced', 'performance'] }, displayHz: { type: 'number', minimum: 0, maximum: 1000 },
            inferenceMs: { type: 'number', minimum: 0, maximum: 10000 }, trackingFps: { type: 'number', minimum: 0, maximum: 240 },
            level: { type: 'integer', minimum: 0, maximum: 999 },
            mode: { enum: telemetryModes },
            inputMode: { enum: telemetryInputModes },
            step: { enum: telemetrySteps },
            outcome: { enum: telemetryOutcomes },
            reason: { enum: telemetryReasons },
            bossPhase: { type: 'integer', minimum: 0, maximum: 20 },
            shots: { type: 'integer', minimum: 0, maximum: 10000 },
            hits: { type: 'integer', minimum: 0, maximum: 10000 },
            won: { type: 'boolean' },
            bankShot: { type: 'boolean' },
          }, additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  } };
  app.post('/api/telemetry/batch', { schema: telemetrySchema, preValidation: rejectUnknownTelemetryFields }, acceptTelemetry);
  app.post('/api/v3/telemetry/batch', { schema: telemetrySchema, preValidation: rejectUnknownTelemetryFields }, acceptTelemetry);

  installSocialPlatform({ app, db, requireSession, sessionFor: accountFor, publicProfile, setSessionCookie });
  installArena({ app, db, sessionFor: accountFor, options: arenaOptions });
  return Object.freeze({ liveConfigAdmin });
}

function installArena({ app, db, sessionFor, options = {} }) {
  const duration = (value, fallback, minimum, maximum) => finiteInteger(value, minimum, maximum, fallback);
  const timings = {
    startDelayMs: duration(options.startDelayMs, 3_000, 0, 30_000),
    matchTimeoutMs: duration(options.matchTimeoutMs, 12 * 60_000, 25, 60 * 60_000),
    finishGraceMs: duration(options.finishGraceMs, 20_000, 25, 5 * 60_000),
    disconnectGraceMs: duration(options.disconnectGraceMs, 20_000, 25, 5 * 60_000),
    resultRetentionMs: duration(options.resultRetentionMs, 45_000, 25, 5 * 60_000),
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024, perMessageDeflate: false });
  const waiting = [];
  const sockets = new Map();
  const matches = new Map();
  const persistMatchResult = db.transaction((matchId, finishedAt, winnerUserId, payload) => {
    const updated = db.prepare("UPDATE matches SET status='finished',finished_at=?,winner_user_id=? WHERE match_id=? AND status='active'")
      .run(finishedAt, winnerUserId, matchId);
    if (updated.changes !== 1) return false;
    db.prepare('INSERT INTO match_results(match_id,result_json,created_at) VALUES(?,?,?)')
      .run(matchId, JSON.stringify(payload), finishedAt);
    return true;
  });
  const persistArenaPlayerState = db.transaction((matchId, userId, previousSeq, player, replayJson, updatedAt) => {
    const updated = db.prepare(`UPDATE match_players
      SET score=?,shots=?,last_seq=?
      WHERE match_id=? AND user_id=? AND last_seq=?
        AND EXISTS(SELECT 1 FROM matches WHERE match_id=? AND status='active')`)
      .run(player.score, player.shots, player.lastSeq, matchId, userId, previousSeq, matchId);
    if (updated.changes !== 1) return false;
    db.prepare(`INSERT INTO arena_match_replays(match_id,user_id,replay_json,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(match_id,user_id) DO UPDATE SET replay_json=excluded.replay_json,updated_at=excluded.updated_at`)
      .run(matchId, userId, replayJson, updatedAt);
    return true;
  });
  const expireRecoveredMatch = db.transaction((matchId, finishedAt) => {
    db.prepare("UPDATE matches SET status='expired',finished_at=?,winner_user_id=NULL WHERE match_id=? AND status='active'")
      .run(finishedAt, matchId);
  });
  const later = (handler, delay) => {
    const timer = setTimeout(handler, Math.max(0, delay));
    timer.unref?.();
    return timer;
  };
  const send = (ws, payload) => {
    if (ws?.readyState !== 1) return;
    if (ws.bufferedAmount > 64 * 1024) { ws.close(1008, 'backpressure'); return; }
    try { ws.send(JSON.stringify(payload)); } catch (error) { app.log.warn({ err: error }, 'arena send failed'); }
  };
  const broadcast = (match, payload) => match.players.forEach((player) => send(sockets.get(player.userId), payload));
  const removeWaiting = (userId) => {
    const index = waiting.indexOf(userId); if (index >= 0) waiting.splice(index, 1);
  };
  const onlyKeys = (message, keys) => Object.keys(message).every((key) => keys.has(key));
  const matchForUser = (userId) => Array.from(matches.values()).find((match) => match.status === 'active' && match.players.some((player) => player.userId === userId));
  const compareIds = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const clearActiveTimers = (match) => {
    clearTimeout(match.deadlineTimer); clearTimeout(match.finishTimer);
    for (const timer of match.disconnectTimers.values()) clearTimeout(timer);
    match.disconnectTimers.clear(); match.disconnected.clear();
  };
  const authoritativeReplay = (match, player) => {
    const simulation = simulateArenaReplay({
      seed: match.seed,
      level: match.level,
      shotTrace: player.shotTrace,
    });
    if (!simulation.ok) throw new Error(`arena replay invariant failed: ${simulation.error}`);
    const result = simulation.result;
    player.score = result.score;
    player.shots = result.shots;
    player.hits = result.hits;
    player.maxCombo = result.maxCombo;
    player.stateChecksum = result.stateChecksum;
    return {
      replayVersion: result.replayVersion,
      rulesVersion: result.rulesVersion,
      shotCount: result.shots,
      hits: result.hits,
      maxCombo: result.maxCombo,
      stateChecksum: result.stateChecksum,
      traceChecksum: digest(canonicalJson({
        replayVersion: result.replayVersion,
        rulesVersion: result.rulesVersion,
        seed: match.seed,
        level: match.level,
        shotTrace: player.shotTrace,
      })),
      shotTrace: player.shotTrace.map((shot) => ({ ...shot })),
    };
  };
  const replayStateJson = (match, player) => JSON.stringify({
    schemaVersion: 1,
    replayVersion: ARENA_REPLAY_RULES.replayVersion,
    rulesVersion: ARENA_REPLAY_RULES.rulesVersion,
    shotTrace: player.shotTrace.map((shot) => ({ ...shot })),
    score: player.score,
    shots: player.shots,
    hits: player.hits,
    maxCombo: player.maxCombo,
    stateChecksum: player.stateChecksum,
  });
  const restoredPlayer = (matchRow, playerRow) => {
    let saved = null;
    if (playerRow.replayJson !== null && playerRow.replayJson !== undefined) {
      try { saved = JSON.parse(String(playerRow.replayJson)); } catch { throw new Error('arena-replay-json-invalid'); }
      if (!isPlainRecord(saved) || saved.schemaVersion !== 1 || !Array.isArray(saved.shotTrace)) {
        throw new Error('arena-replay-schema-invalid');
      }
      if (saved.replayVersion !== ARENA_REPLAY_RULES.replayVersion || saved.rulesVersion !== ARENA_REPLAY_RULES.rulesVersion) {
        throw new Error('arena-replay-version-invalid');
      }
    }
    const shotTrace = saved?.shotTrace ?? [];
    const simulation = simulateArenaReplay({ seed: matchRow.seed, level: matchRow.level, shotTrace });
    if (!simulation.ok) throw new Error(`arena-replay-invalid:${simulation.error}`);
    const result = simulation.result;
    if (result.score !== playerRow.score || result.shots !== playerRow.shots || result.shots !== playerRow.lastSeq) {
      throw new Error('arena-replay-database-state-mismatch');
    }
    if (saved && (
      saved.score !== result.score || saved.shots !== result.shots || saved.hits !== result.hits
      || saved.maxCombo !== result.maxCombo || saved.stateChecksum !== result.stateChecksum
    )) throw new Error('arena-replay-derived-state-mismatch');
    const finishedAt = playerRow.finishedAt === null ? null : Date.parse(String(playerRow.finishedAt));
    if (playerRow.finishedAt !== null && !Number.isFinite(finishedAt)) throw new Error('arena-finished-time-invalid');
    return {
      userId: String(playerRow.userId), score: result.score, shots: result.shots,
      hits: result.hits, maxCombo: result.maxCombo, lastSeq: result.shots,
      stateChecksum: result.stateChecksum, shotTrace: shotTrace.map((shot) => ({ ...shot })),
      finishedAt,
    };
  };
  const resultPlayers = (match) => [...match.players]
    .sort((left, right) => compareIds(left.userId, right.userId))
    .map((player) => ({
      userId: player.userId,
      score: player.score,
      shots: player.shots,
      hits: player.hits,
      finished: match.finished.has(player.userId),
      replayProof: authoritativeReplay(match, player),
    }));
  const resolveResult = (match, forcedWinnerUserId) => {
    const ranked = [...match.players].sort((left, right) => (
      right.score - left.score || left.shots - right.shots || compareIds(left.userId, right.userId)
    ));
    const finishers = ranked.filter((player) => match.finished.has(player.userId));
    const candidates = forcedWinnerUserId
      ? ranked.filter((player) => player.userId === forcedWinnerUserId)
      : finishers.length > 0 ? finishers : ranked;
    const leader = candidates[0];
    const tiedUserIds = forcedWinnerUserId || !leader ? [] : candidates
      .filter((player) => player.score === leader.score && player.shots === leader.shots)
      .map((player) => player.userId)
      .sort(compareIds);
    const isTie = tiedUserIds.length > 1;
    return { winnerUserId: isTie ? null : leader?.userId ?? null, isTie, tiedUserIds: isTie ? tiedUserIds : [] };
  };
  const finalizeMatch = (match, reason, forcedWinnerUserId) => {
    if (!match || match.status !== 'active') return false;
    const finishedAt = nowIso();
    // Recompute final state from the accepted action stream. The fields kept
    // on each player are only a streaming cache, never trusted result claims.
    for (const player of match.players) authoritativeReplay(match, player);
    const resolution = resolveResult(match, forcedWinnerUserId);
    const payload = {
      type: 'match-result', matchId: match.matchId, reason, finishedAt, serverTime: Date.now(),
      ...resolution, players: resultPlayers(match),
    };
    match.status = 'finalizing';
    try {
      if (!persistMatchResult(match.matchId, finishedAt, resolution.winnerUserId, payload)) {
        clearActiveTimers(match); matches.delete(match.matchId);
        return false;
      }
    } catch (error) {
      match.status = 'active';
      throw error;
    }
    match.status = 'finished'; match.result = payload;
    clearActiveTimers(match);
    broadcast(match, payload);
    match.cleanupTimer = later(() => {
      if (matches.get(match.matchId) === match) matches.delete(match.matchId);
    }, timings.resultRetentionMs);
    return true;
  };
  const finalizeSafely = (match, reason, forcedWinnerUserId) => {
    try { finalizeMatch(match, reason, forcedWinnerUserId); }
    catch (error) {
      app.log.error({ err: error, matchId: match?.matchId, reason }, 'arena match finalization failed');
      if (match?.status === 'active') match.deadlineTimer = later(() => finalizeSafely(match, reason, forcedWinnerUserId), 1_000);
    }
  };
  const clearDisconnect = (match, userId) => {
    clearTimeout(match.disconnectTimers.get(userId));
    match.disconnectTimers.delete(userId); match.disconnected.delete(userId);
  };
  const scheduleDisconnect = (match, userId) => {
    if (match.status !== 'active' || match.finished.has(userId) || match.disconnectTimers.has(userId)) return;
    match.disconnected.add(userId);
    match.disconnectTimers.set(userId, later(() => {
      match.disconnectTimers.delete(userId);
      if (match.status !== 'active' || !match.disconnected.has(userId) || sockets.get(userId)?.readyState === 1) return;
      const connected = match.players.filter((player) => sockets.get(player.userId)?.readyState === 1);
      finalizeSafely(match, 'disconnect-timeout', connected.length === 1 ? connected[0].userId : undefined);
    }, timings.disconnectGraceMs));
  };
  const freshPlayer = (userId) => ({
    userId, score: 0, shots: 0, hits: 0, maxCombo: 0, lastSeq: 0,
    stateChecksum: '0000000000000000', shotTrace: [],
  });
  const startMatch = (first, second, kind = 'ranked') => {
    const matchId = id('match'); const seed = Math.floor(Math.random() * 0x7fffffff); const level = seed % MAX_PROGRESS_LEVELS;
    const createdAt = nowIso(); const startedAt = Date.now() + timings.startDelayMs; const startedAtIso = new Date(startedAt).toISOString();
    const players = [first, second].map(freshPlayer);
    db.transaction(() => {
      db.prepare('INSERT INTO matches(match_id,kind,status,seed,level,started_at,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(matchId, kind, 'active', seed, level, startedAtIso, createdAt);
      for (const player of players) {
        db.prepare('INSERT INTO match_players(match_id,user_id) VALUES(?,?)').run(matchId, player.userId);
        db.prepare('INSERT INTO arena_match_replays(match_id,user_id,replay_json,updated_at) VALUES(?,?,?,?)')
          .run(matchId, player.userId, replayStateJson({ seed, level }, player), createdAt);
      }
    })();
    const match = {
      matchId, seed, level, status: 'active', startedAt, players,
      finished: new Set(), disconnected: new Set(), disconnectTimers: new Map(),
      deadlineTimer: undefined, finishTimer: undefined, cleanupTimer: undefined, result: undefined,
    };
    matches.set(matchId, match);
    broadcast(match, {
      type: 'match-found', matchId, seed, level, startsAt: match.startedAt, serverTime: Date.now(),
      players: match.players.map(({ userId }) => ({ userId })),
    });
    match.deadlineTimer = later(() => finalizeSafely(match, 'match-timeout'), match.startedAt - Date.now() + timings.matchTimeoutMs);
  };
  const loadPersistedResult = (row) => {
    let payload;
    try { payload = JSON.parse(String(row.resultJson)); } catch { throw new Error('arena-result-json-invalid'); }
    if (!isPlainRecord(payload) || payload.type !== 'match-result' || payload.matchId !== row.matchId
      || !Array.isArray(payload.players) || payload.players.length !== 2) {
      throw new Error('arena-result-schema-invalid');
    }
    const knownUsers = new Set(db.prepare('SELECT user_id AS userId FROM match_players WHERE match_id=?')
      .all(row.matchId).map((entry) => String(entry.userId)));
    const resultUserIds = new Set(payload.players.map((player) => String(player?.userId)));
    if (knownUsers.size !== 2 || resultUserIds.size !== 2
      || !payload.players.every((player) => isPlainRecord(player) && knownUsers.has(String(player.userId)))) {
      throw new Error('arena-result-player-invalid');
    }
    const players = payload.players.map((entry) => {
      const proof = entry.replayProof;
      if (!isPlainRecord(proof) || !Array.isArray(proof.shotTrace)) throw new Error('arena-result-proof-invalid');
      const simulation = simulateArenaReplay({ seed: row.seed, level: row.level, shotTrace: proof.shotTrace });
      if (!simulation.ok) throw new Error(`arena-result-replay-invalid:${simulation.error}`);
      const result = simulation.result;
      const expectedTraceChecksum = digest(canonicalJson({
        replayVersion: result.replayVersion, rulesVersion: result.rulesVersion,
        seed: row.seed, level: row.level, shotTrace: proof.shotTrace,
      }));
      if (proof.replayVersion !== result.replayVersion || proof.rulesVersion !== result.rulesVersion
        || proof.shotCount !== result.shots || proof.hits !== result.hits || proof.maxCombo !== result.maxCombo
        || proof.stateChecksum !== result.stateChecksum || proof.traceChecksum !== expectedTraceChecksum
        || entry.score !== result.score || entry.shots !== result.shots || entry.hits !== result.hits) {
        throw new Error('arena-result-proof-mismatch');
      }
      return {
        userId: String(entry.userId), score: result.score, shots: result.shots, hits: result.hits,
        maxCombo: result.maxCombo, lastSeq: result.shots, stateChecksum: result.stateChecksum,
        shotTrace: proof.shotTrace.map((shot) => ({ ...shot })),
      };
    });
    if (typeof payload.reason !== 'string' || !Number.isFinite(Date.parse(String(payload.finishedAt)))
      || typeof payload.isTie !== 'boolean' || !Array.isArray(payload.tiedUserIds)
      || payload.winnerUserId !== null && !knownUsers.has(String(payload.winnerUserId))) {
      throw new Error('arena-result-winner-invalid');
    }
    if (payload.isTie !== (payload.winnerUserId === null)
      || payload.tiedUserIds.some((userId) => !knownUsers.has(String(userId)))) {
      throw new Error('arena-result-resolution-invalid');
    }
    const createdAt = Date.parse(String(row.resultCreatedAt));
    if (!Number.isFinite(createdAt)) throw new Error('arena-result-time-invalid');
    return {
      matchId: row.matchId, seed: row.seed, level: row.level, status: 'finished',
      startedAt: Date.parse(String(row.startedAt)), players,
      finished: new Set(payload.players.filter((entry) => entry.finished === true).map((entry) => String(entry.userId))),
      disconnected: new Set(), disconnectTimers: new Map(), deadlineTimer: undefined, finishTimer: undefined,
      cleanupTimer: undefined, result: payload, resultCreatedAt: createdAt,
    };
  };
  const restoreArenaState = () => {
    const activeRows = db.prepare(`SELECT
      m.match_id AS matchId,m.kind,m.seed,m.level,m.started_at AS startedAt,m.created_at AS createdAt,
      p.user_id AS userId,p.score,p.shots,p.last_seq AS lastSeq,p.finished_at AS finishedAt,
      r.replay_json AS replayJson
      FROM matches m LEFT JOIN match_players p ON p.match_id=m.match_id
      LEFT JOIN arena_match_replays r ON r.match_id=p.match_id AND r.user_id=p.user_id
      WHERE m.status='active' ORDER BY m.created_at,m.match_id,p.user_id`).all();
    const grouped = new Map();
    for (const row of activeRows) {
      const group = grouped.get(row.matchId) ?? { match: row, players: [] };
      group.players.push(row); grouped.set(row.matchId, group);
    }
    for (const [matchId, group] of grouped) {
      try {
        const startedAt = Date.parse(String(group.match.startedAt));
        const createdAt = Date.parse(String(group.match.createdAt));
        if (!Number.isFinite(startedAt) || !Number.isFinite(createdAt)
          || startedAt < createdAt - 1_000 || startedAt > createdAt + 31_000
          || group.players.length !== 2 || new Set(group.players.map((row) => row.userId)).size !== 2) {
          throw new Error('arena-active-record-invalid');
        }
        const recoveredPlayers = group.players.map((row) => restoredPlayer(group.match, row));
        const match = {
          matchId, seed: group.match.seed, level: group.match.level, status: 'active', startedAt,
          players: recoveredPlayers.map(({ finishedAt: _finishedAt, ...player }) => player),
          finished: new Set(recoveredPlayers.filter((player) => player.finishedAt !== null).map((player) => player.userId)),
          disconnected: new Set(), disconnectTimers: new Map(), deadlineTimer: undefined,
          finishTimer: undefined, cleanupTimer: undefined, result: undefined,
        };
        matches.set(matchId, match);
        const currentTime = Date.now();
        if (match.finished.size === match.players.length) {
          finalizeSafely(match, 'completed'); continue;
        }
        const hardRemainingMs = match.startedAt + timings.matchTimeoutMs - currentTime;
        if (hardRemainingMs <= 0) { finalizeSafely(match, 'match-timeout'); continue; }
        match.deadlineTimer = later(() => finalizeSafely(match, 'match-timeout'), hardRemainingMs);
        const finishTimes = recoveredPlayers.filter((player) => player.finishedAt !== null).map((player) => player.finishedAt);
        if (finishTimes.length) {
          const finishRemainingMs = Math.min(...finishTimes) + timings.finishGraceMs - currentTime;
          if (finishRemainingMs <= 0) { finalizeSafely(match, 'finish-timeout'); continue; }
          match.finishTimer = later(() => finalizeSafely(match, 'finish-timeout'), finishRemainingMs);
        }
        for (const player of match.players) if (!match.finished.has(player.userId)) scheduleDisconnect(match, player.userId);
      } catch (error) {
        expireRecoveredMatch(matchId, nowIso());
        matches.delete(matchId);
        app.log.error({ err: error, matchId }, 'arena active replay recovery rejected');
      }
    }

    const minimumResultTime = new Date(Date.now() - timings.resultRetentionMs).toISOString();
    const resultRows = db.prepare(`SELECT
      m.match_id AS matchId,m.seed,m.level,m.started_at AS startedAt,
      r.result_json AS resultJson,r.created_at AS resultCreatedAt
      FROM match_results r JOIN matches m ON m.match_id=r.match_id
      WHERE m.status='finished' AND r.created_at>=? ORDER BY r.created_at`).all(minimumResultTime);
    for (const row of resultRows) {
      if (matches.has(row.matchId)) continue;
      try {
        const match = loadPersistedResult(row);
        matches.set(match.matchId, match);
        const remainingMs = match.resultCreatedAt + timings.resultRetentionMs - Date.now();
        if (remainingMs <= 0) matches.delete(match.matchId);
        else match.cleanupTimer = later(() => {
          if (matches.get(match.matchId) === match) matches.delete(match.matchId);
        }, remainingMs);
      } catch (error) {
        app.log.error({ err: error, matchId: row.matchId }, 'arena result replay recovery rejected');
      }
    }
  };
  restoreArenaState();
  const rejectUpgrade = (socket, status, message) => {
    if (!socket.destroyed) socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const upgradeHandler = (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; } catch { rejectUpgrade(socket, 400, 'Bad Request'); return; }
    if (pathname !== '/api/arena' && pathname !== '/ws/v3/arena') return;
    try {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) { rejectUpgrade(socket, 403, 'Forbidden'); return; }
      const fakeRequest = { headers: request.headers, method: 'GET', raw: request, ip: request.socket.remoteAddress };
      const session = sessionFor(fakeRequest);
      if (!session) { rejectUpgrade(socket, 401, 'Unauthorized'); return; }
      wss.handleUpgrade(request, socket, head, (ws) => { ws.account = session; wss.emit('connection', ws); });
    } catch (error) {
      app.log.warn({ err: error }, 'arena upgrade rejected'); rejectUpgrade(socket, 401, 'Unauthorized');
    }
  };
  app.server.on('upgrade', upgradeHandler);
  wss.on('connection', (ws) => {
    const userId = ws.account.userId; const previous = sockets.get(userId);
    if (previous && previous !== ws) previous.close(4001, 'replaced');
    sockets.set(userId, ws); ws.isAlive = true; ws.messageTimes = [];
    send(ws, { type: 'arena-ready', userId, serverTime: Date.now() });
    for (const match of matches.values()) {
      if (!match.players.some((player) => player.userId === userId)) continue;
      if (match.status === 'active') {
        clearDisconnect(match, userId);
        send(ws, {
          type: 'match-resumed', matchId: match.matchId, seed: match.seed, level: match.level,
          startsAt: match.startedAt, serverTime: Date.now(),
          players: match.players.map(({ userId: idValue, score, shots, hits, maxCombo, stateChecksum }) => ({
            userId: idValue, score, shots, hits, maxCombo, stateChecksum,
          })),
        });
      } else if (match.status === 'finished' && match.result) send(ws, { ...match.result, replayed: true });
    }
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (buffer, isBinary) => {
      try {
      const now = Date.now(); ws.messageTimes = ws.messageTimes.filter((timestamp) => timestamp > now - 10_000);
      if (ws.messageTimes.length >= 120) { send(ws, { type: 'error', error: 'message-rate-limited' }); ws.close(1008, 'rate-limited'); return; }
      ws.messageTimes.push(now);
      if (isBinary) { send(ws, { type: 'error', error: 'binary-not-supported' }); ws.close(1008, 'invalid-message'); return; }
      let message; try { message = JSON.parse(String(buffer)); } catch { send(ws, { type: 'error', error: 'invalid-json' }); return; }
      if (!isPlainRecord(message) || typeof message.type !== 'string') { send(ws, { type: 'error', error: 'invalid-message' }); return; }
      if (message.type === 'queue') {
        if (!onlyKeys(message, new Set(['type']))) { send(ws, { type: 'error', error: 'invalid-message' }); return; }
        if (matchForUser(userId)) { send(ws, { type: 'error', error: 'match-already-active' }); return; }
        if (waiting.includes(userId)) { send(ws, { type: 'queued', position: waiting.indexOf(userId) + 1 }); return; }
        let opponent;
        while (waiting.length && !opponent) {
          const candidate = waiting.shift(); if (candidate !== userId && sockets.get(candidate)?.readyState === 1 && !matchForUser(candidate)) opponent = candidate;
        }
        if (opponent) startMatch(opponent, userId);
        else { waiting.push(userId); send(ws, { type: 'queued', position: waiting.indexOf(userId) + 1 }); }
        return;
      }
      if (message.type === 'cancel-queue') {
        if (!onlyKeys(message, new Set(['type']))) { send(ws, { type: 'error', error: 'invalid-message' }); return; }
        removeWaiting(userId); send(ws, { type: 'queue-cancelled' }); return;
      }
      if (message.type === 'heartbeat') {
        if (!onlyKeys(message, new Set(['type']))) { send(ws, { type: 'error', error: 'invalid-message' }); return; }
        send(ws, { type: 'heartbeat', serverTime: Date.now() }); return;
      }
      const match = matches.get(String(message.matchId ?? '')); const player = match?.players.find((entry) => entry.userId === userId);
      if (!match || !player) { send(ws, { type: 'error', error: 'match-not-found' }); return; }
      if (message.type === 'input') {
        const seq = message.seq;
        const rejectInput = (error) => send(ws, {
          type: 'input-rejected', matchId: match.matchId, error, seq, expected: player.lastSeq + 1,
        });
        if (!onlyKeys(message, new Set(['type', 'matchId', 'seq', 'atMs', 'angleMilliDegrees']))) {
          rejectInput('invalid-message'); return;
        }
        if (match.status !== 'active') { rejectInput('match-finished'); return; }
        if (match.finished.has(userId)) { rejectInput('player-finished'); return; }
        if (!Number.isInteger(seq) || !Number.isInteger(message.atMs) || !Number.isInteger(message.angleMilliDegrees)) {
          rejectInput('invalid-input'); return;
        }
        const receivedAt = Date.now();
        const serverElapsedMs = receivedAt - match.startedAt;
        if (serverElapsedMs < 0) {
          rejectInput('match-not-started'); return;
        }
        if (message.atMs > serverElapsedMs + ARENA_REPLAY_RULES.maximumFutureLeadMs) {
          rejectInput('input-from-future'); return;
        }
        if (serverElapsedMs - message.atMs > ARENA_REPLAY_RULES.maximumReconnectAgeMs) {
          rejectInput('input-too-old'); return;
        }
        const appended = appendArenaShot({
          seed: match.seed,
          level: match.level,
          shotTrace: player.shotTrace,
          shot: { seq, atMs: message.atMs, angleMilliDegrees: message.angleMilliDegrees },
        });
        if (!appended.ok) {
          rejectInput(appended.error); return;
        }
        const nextPlayer = {
          ...player, shotTrace: appended.shotTrace, lastSeq: seq,
          score: appended.result.score, shots: appended.result.shots, hits: appended.result.hits,
          maxCombo: appended.result.maxCombo, stateChecksum: appended.result.stateChecksum,
        };
        if (!persistArenaPlayerState(
          match.matchId, userId, player.lastSeq, nextPlayer,
          replayStateJson(match, nextPlayer), new Date(receivedAt).toISOString(),
        )) {
          rejectInput('arena-state-conflict'); return;
        }
        player.shotTrace = nextPlayer.shotTrace;
        player.lastSeq = nextPlayer.lastSeq;
        player.score = nextPlayer.score;
        player.shots = nextPlayer.shots;
        player.hits = nextPlayer.hits;
        player.maxCombo = nextPlayer.maxCombo;
        player.stateChecksum = nextPlayer.stateChecksum;
        broadcast(match, {
          type: 'match-state', matchId: match.matchId, serverTime: receivedAt,
          players: match.players.map(({ userId: idValue, score, shots, hits, maxCombo, stateChecksum }) => ({
            userId: idValue, score, shots, hits, maxCombo, stateChecksum,
          })),
        });
        return;
      }
      if (message.type === 'finish') {
        if (!onlyKeys(message, new Set(['type', 'matchId']))) { send(ws, { type: 'error', error: 'invalid-message' }); return; }
        if (match.status !== 'active') { send(ws, { type: 'finish-ack', matchId: match.matchId, duplicate: true, finalized: true }); return; }
        if (match.finished.has(userId)) { send(ws, { type: 'finish-ack', matchId: match.matchId, duplicate: true }); return; }
        db.prepare('UPDATE match_players SET finished_at=? WHERE match_id=? AND user_id=?').run(nowIso(), match.matchId, userId);
        match.finished.add(userId); clearDisconnect(match, userId);
        if (match.finished.size === match.players.length) {
          finalizeSafely(match, 'completed');
        } else {
          broadcast(match, { type: 'player-finished', matchId: match.matchId, userId });
          if (!match.finishTimer) match.finishTimer = later(() => finalizeSafely(match, 'finish-timeout'), timings.finishGraceMs);
        }
        return;
      }
      send(ws, { type: 'error', error: 'unsupported-message' });
      } catch (error) {
        app.log.error({ err: error, userId }, 'arena message failed'); send(ws, { type: 'error', error: 'arena-internal-error' });
      }
    });
    ws.on('error', (error) => app.log.warn({ err: error, userId }, 'arena socket error'));
    ws.on('close', () => {
      if (sockets.get(userId) === ws) {
        sockets.delete(userId); removeWaiting(userId);
        const match = matchForUser(userId); if (match) scheduleDisconnect(match, userId);
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false; try { ws.ping(); } catch { ws.terminate(); }
    }
  }, 15_000);
  heartbeat.unref?.();
  app.addHook('onClose', async () => {
    clearInterval(heartbeat); app.server.off('upgrade', upgradeHandler);
    for (const match of matches.values()) { clearActiveTimers(match); clearTimeout(match.cleanupTimer); }
    matches.clear(); waiting.length = 0;
    for (const ws of wss.clients) ws.terminate();
    try { wss.close(); } catch { /* already closed */ }
  });
}
