import { RealtimeHub } from './realtime';
import { ENDLESS_REPLAY_RULES, simulateEndlessReplay } from '../../shared/runtime/endless-replay.mjs';

export { RealtimeHub };

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  REALTIME: DurableObjectNamespace;
  ENVIRONMENT: string;
  PAOPAO_EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  PAOPAO_GOOGLE_CLIENT_ID?: string;
  PAOPAO_GOOGLE_CLIENT_SECRET?: string;
  PAOPAO_FACEBOOK_APP_ID?: string;
  PAOPAO_FACEBOOK_APP_SECRET?: string;
}

interface Session {
  sessionId: string;
  userId: string;
  csrfToken: string;
}

interface WalletRow { coins: number; diamonds: number; revision: number; updatedAt: string }
interface ProfileRow { userId: string; displayName: string; updatedAt: string; coins: number; diamonds: number; revision: number; walletUpdatedAt: string }
interface OfferRow { offerId: string; title: string; currency: 'coins' | 'diamonds'; price: number; grantKind: 'inventory' | 'entitlement' | 'bundle'; grantId: string; quantity: number }

const COOKIE = 'paopao_session';
const nowIso = (): string => new Date().toISOString();
const id = (prefix: string): string => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const cleanEmail = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const cleanName = (value: unknown): string => String(value ?? 'PLAYER').trim().slice(0, 20).replace(/[^\p{L}\p{N} _-]/gu, '') || 'PLAYER';
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{8,96}$/.test(value);
const hub = (env: Env): DurableObjectStub => env.REALTIME.get(env.REALTIME.idFromName('global-v1'));
let signingKeys: Promise<CryptoKeyPair> | undefined;

function response(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') ?? 0) > 65_536) throw new Error('body-too-large');
  const parsed = await request.json<unknown>();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body-invalid');
  return parsed as Record<string, unknown>;
}

function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = ''; for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cookie(request: Request, name: string): string {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('='); if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

async function getSession(request: Request, env: Env): Promise<Session | null> {
  const token = cookie(request, COOKIE); if (!token) return null;
  const row = await env.DB.prepare(`SELECT s.session_id AS sessionId,s.user_id AS userId,s.csrf_token AS csrfToken
    FROM sessions s JOIN users u ON u.user_id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active'`).bind(await sha256(token), nowIso()).first<Session>();
  return row ?? null;
}

async function requireSession(request: Request, env: Env, csrf = false): Promise<Session | Response> {
  const session = await getSession(request, env);
  if (!session) return response({ error: 'authentication-required' }, 401);
  if (csrf && request.headers.get('X-CSRF-Token') !== session.csrfToken) return response({ error: 'csrf-invalid' }, 403);
  return session;
}

async function profile(env: Env, userId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(`SELECT p.user_id AS userId,p.display_name AS displayName,p.updated_at AS updatedAt,
    w.coins,w.diamonds,w.revision,w.updated_at AS walletUpdatedAt FROM player_profiles p JOIN wallets w ON w.user_id=p.user_id WHERE p.user_id=?`)
    .bind(userId).first<ProfileRow>();
  if (!row) throw new Error('profile-missing');
  return { userId: row.userId, displayName: row.displayName, updatedAt: row.updatedAt, wallet: { coins: row.coins, diamonds: row.diamonds, revision: row.revision, updatedAt: row.walletUpdatedAt } };
}

async function createSession(env: Env, userId: string): Promise<{ token: string; csrfToken: string }> {
  const token = randomToken(); const csrfToken = randomToken(18); const timestamp = nowIso();
  await env.DB.prepare(`INSERT INTO sessions(session_id,user_id,token_hash,csrf_token,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(id('ses'), userId, await sha256(token), csrfToken, new Date(Date.now() + 30 * 86_400_000).toISOString(), timestamp, timestamp).run();
  return { token, csrfToken };
}

async function createUser(env: Env, email: string, displayName: string): Promise<string> {
  const existing = await env.DB.prepare(`SELECT i.user_id AS userId FROM auth_identities i JOIN users u ON u.user_id=i.user_id WHERE i.kind='email' AND i.identifier=? AND u.status='active'`).bind(email).first<{ userId: string }>();
  if (existing) return existing.userId;
  const userId = id('usr'); const timestamp = nowIso();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const friendCode = randomToken(6).replace(/[-_]/g, '').slice(0, 8).toUpperCase();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users(user_id,created_at,updated_at) VALUES(?,?,?)').bind(userId, timestamp, timestamp),
        env.DB.prepare('INSERT INTO auth_identities(identity_id,user_id,kind,identifier,verified_at) VALUES(?,?,?,?,?)').bind(id('ident'), userId, 'email', email, timestamp),
        env.DB.prepare('INSERT INTO player_profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').bind(userId, cleanName(displayName), timestamp, timestamp),
        env.DB.prepare('INSERT INTO player_progress(user_id,updated_at) VALUES(?,?)').bind(userId, timestamp),
        env.DB.prepare('INSERT INTO wallets(user_id,updated_at) VALUES(?,?)').bind(userId, timestamp),
        env.DB.prepare('INSERT INTO player_social(user_id,friend_code,created_at,updated_at) VALUES(?,?,?,?)').bind(userId, friendCode, timestamp, timestamp),
      ]);
      return userId;
    } catch (error) {
      if (!String(error).includes('UNIQUE') || attempt === 7) throw error;
    }
  }
  throw new Error('friend-code-allocation-failed');
}

async function inventory(env: Env, userId: string): Promise<Record<string, unknown>> {
  const ledger = await env.DB.prepare(`SELECT item_id AS itemId,COALESCE(SUM(delta),0) AS delta FROM inventory_ledger WHERE user_id=? GROUP BY item_id`).bind(userId).all<{ itemId: string; delta: number }>();
  const balances = new Map<string, number>([['bomb', 3], ['rainbow', 2], ['storyShard', 0]]);
  for (const row of ledger.results) balances.set(row.itemId, Math.max(0, (balances.get(row.itemId) ?? 0) + Number(row.delta)));
  const entitlements = await env.DB.prepare('SELECT entitlement_id AS entitlementId,source,created_at AS createdAt FROM entitlements WHERE user_id=? ORDER BY entitlement_id').bind(userId).all();
  return { revision: ledger.results.length + entitlements.results.length, items: [...balances].map(([itemId, quantity]) => ({ itemId, quantity })).filter((item) => item.quantity > 0), entitlements: entitlements.results };
}

const BUNDLES: Record<string, Array<{ itemId: string; quantity: number }>> = {
  'hamper:friendship': [{ itemId: 'bomb', quantity: 2 }, { itemId: 'rainbow', quantity: 1 }, { itemId: 'storyShard', quantity: 3 }],
  'hamper:royal': [{ itemId: 'bomb', quantity: 5 }, { itemId: 'rainbow', quantity: 3 }, { itemId: 'storyShard', quantity: 10 }],
};

async function notify(env: Env, userId: string, message: unknown): Promise<void> {
  await hub(env).fetch('https://realtime/notify', { method: 'POST', body: JSON.stringify({ userId, message }) });
}

async function socialSnapshot(env: Env, userId: string): Promise<Record<string, unknown>> {
  const social = await env.DB.prepare('SELECT friend_code AS friendCode FROM player_social WHERE user_id=?').bind(userId).first<{ friendCode: string }>();
  const friends = await env.DB.prepare(`SELECT f.friend_user_id AS userId,p.display_name AS displayName,s.friend_code AS friendCode,f.created_at AS connectedAt
    FROM friendships f JOIN player_profiles p ON p.user_id=f.friend_user_id JOIN player_social s ON s.user_id=f.friend_user_id
    WHERE f.user_id=? ORDER BY p.display_name`).bind(userId).all<Record<string, unknown>>();
  const presenceResponse = await hub(env).fetch('https://realtime/presence', { method: 'POST', body: JSON.stringify({ userIds: friends.results.map((friend) => friend.userId) }) });
  const presence = await presenceResponse.json<{ online: string[] }>(); const online = new Set(presence.online);
  const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM social_gifts WHERE recipient_user_id=? AND status='pending'").bind(userId).first<{ count: number }>();
  return { friendCode: social?.friendCode ?? '', presenceVisibility: 'friends', friends: friends.results.map((friend) => ({ ...friend, online: online.has(String(friend.userId)) })), pendingGifts: pending?.count ?? 0, online: true };
}

function defaultProgress(): Record<string, unknown> {
  return { unlocked: 1, bestScores: Array(30).fill(0), stars: Array(30).fill(0), cleared: [], mastered: [], claimedFirstClears: [] };
}

function mergeProgress(remoteValue: unknown, localValue: unknown): Record<string, unknown> {
  const normalize = (value: unknown): Record<string, unknown> => {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const array = (key: string, max: number): number[] => Array.from({ length: 30 }, (_, index) => Math.max(0, Math.min(max, Math.trunc(Number((Array.isArray(raw[key]) ? raw[key] : [])[index] ?? 0)))));
    const set = (key: string): number[] => [...new Set((Array.isArray(raw[key]) ? raw[key] : []).map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item < 30))];
    return { unlocked: Math.max(1, Math.min(30, Math.trunc(Number(raw.unlocked ?? 1)))), bestScores: array('bestScores', 10_000_000), stars: array('stars', 3), cleared: set('cleared'), mastered: set('mastered'), claimedFirstClears: set('claimedFirstClears') };
  };
  const a = normalize(remoteValue); const b = normalize(localValue);
  return {
    unlocked: Math.max(Number(a.unlocked), Number(b.unlocked)),
    bestScores: (a.bestScores as number[]).map((score, i) => Math.max(score, (b.bestScores as number[])[i])),
    stars: (a.stars as number[]).map((score, i) => Math.max(score, (b.stars as number[])[i])),
    cleared: [...new Set([...(a.cleared as number[]), ...(b.cleared as number[])])], mastered: [...new Set([...(a.mastered as number[]), ...(b.mastered as number[])])],
    claimedFirstClears: [...new Set([...(a.claimedFirstClears as number[]), ...(b.claimedFirstClears as number[])])],
  };
}

async function progressEnvelope(env: Env, userId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare('SELECT progress_json AS progressJson,client_state_json AS stateJson,revision,updated_at AS updatedAt FROM player_progress WHERE user_id=?').bind(userId).first<{ progressJson: string; stateJson: string; revision: number; updatedAt: string }>();
  const progress = row ? JSON.parse(row.progressJson) : defaultProgress(); const stored = row ? JSON.parse(row.stateJson) as Record<string, unknown> : {};
  const entitlements = await env.DB.prepare('SELECT entitlement_id AS id FROM entitlements WHERE user_id=? ORDER BY entitlement_id').bind(userId).all<{ id: string }>();
  const defaults = {
    clientIdentity: { id: 'classic', platform: 'web', build: 'cloudflare-v1', installId: '', lastSeenAt: row?.updatedAt ?? nowIso() },
    campaign: { activeWorld: 0, activeLevel: Math.max(0, Number((progress as Record<string, unknown>).unlocked ?? 1) - 1), storyFlags: [] },
    endless: { seasonId: '', bestWave: 0, bestScore: 0, seasonPoints: 0, completedRunIds: [] },
    liveEvent: { seasonId: '', rewardTrackTier: 0, claimedRewardIds: [], completedChallengeIds: [] },
    deviceSettings: { quality: 'high', reducedMotion: false },
    handProfile: { enabled: true, handedness: 'auto', aimSensitivity: 1, smoothing: 0.35, pinchContactRatio: 0.28, pinchReleaseRatio: 0.38, calibrationRevision: 0 },
  };
  return { saveVersion: 4, revision: row?.revision ?? 0, updatedAt: row?.updatedAt ?? nowIso(), client: 'classic', progress, ...defaults, ...stored, entitlements: { revision: entitlements.results.length, ids: entitlements.results.map((entry) => entry.id) } };
}

const PROVIDERS = {
  google: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', profile: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile' },
  facebook: { auth: 'https://www.facebook.com/v21.0/dialog/oauth', token: 'https://graph.facebook.com/v21.0/oauth/access_token', profile: 'https://graph.facebook.com/me?fields=id,name,email', scope: 'email,public_profile' },
} as const;

function providerSecrets(env: Env, provider: keyof typeof PROVIDERS): { clientId: string; clientSecret: string } | null {
  const clientId = provider === 'google' ? env.PAOPAO_GOOGLE_CLIENT_ID : env.PAOPAO_FACEBOOK_APP_ID;
  const clientSecret = provider === 'google' ? env.PAOPAO_GOOGLE_CLIENT_SECRET : env.PAOPAO_FACEBOOK_APP_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function oauth(request: Request, env: Env, provider: keyof typeof PROVIDERS, callback: boolean): Promise<Response> {
  const secrets = providerSecrets(env, provider); if (!secrets) return response({ error: 'oauth-provider-unconfigured' }, 503);
  const url = new URL(request.url); const redirectUri = `${url.origin}/api/auth/${provider}/callback`; const config = PROVIDERS[provider];
  if (!callback) {
    const state = randomToken(); const verifier = provider === 'google' ? randomToken(48) : ''; const returnTo = String(url.searchParams.get('returnTo') ?? '/');
    await env.DB.prepare('INSERT INTO oauth_states(state_hash,provider,code_verifier,return_path,expires_at,created_at) VALUES(?,?,?,?,?,?)')
      .bind(await sha256(state), provider, verifier || null, returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo.slice(0, 240) : '/', new Date(Date.now() + 600_000).toISOString(), nowIso()).run();
    const target = new URL(config.auth); target.searchParams.set('client_id', secrets.clientId); target.searchParams.set('redirect_uri', redirectUri); target.searchParams.set('response_type', 'code'); target.searchParams.set('scope', config.scope); target.searchParams.set('state', state);
    if (provider === 'google') { target.searchParams.set('prompt', 'select_account'); target.searchParams.set('code_challenge', await sha256Base64(verifier)); target.searchParams.set('code_challenge_method', 'S256'); }
    return Response.redirect(target, 302);
  }
  const stateValue = url.searchParams.get('state') ?? ''; const code = url.searchParams.get('code') ?? '';
  const stored = stateValue ? await env.DB.prepare('SELECT provider,code_verifier AS codeVerifier,return_path AS returnPath,expires_at AS expiresAt,consumed_at AS consumedAt FROM oauth_states WHERE state_hash=?').bind(await sha256(stateValue)).first<{ provider: string; codeVerifier: string | null; returnPath: string; expiresAt: string; consumedAt: string | null }>() : null;
  if (!stored || stored.provider !== provider || stored.consumedAt || stored.expiresAt <= nowIso() || !code) return response({ error: 'oauth-state-invalid' }, 400);
  await env.DB.prepare('UPDATE oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL').bind(nowIso(), await sha256(stateValue)).run();
  const tokenBody = new URLSearchParams({ client_id: secrets.clientId, client_secret: secrets.clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }); if (stored.codeVerifier) tokenBody.set('code_verifier', stored.codeVerifier);
  const tokenResponse = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody }); const token = await tokenResponse.json<Record<string, unknown>>();
  if (!tokenResponse.ok || typeof token.access_token !== 'string') return Response.redirect(`${url.origin}${stored.returnPath}?auth=${provider}&error=oauth-failed`, 302);
  const profileResponse = await fetch(config.profile, { headers: { Authorization: `Bearer ${token.access_token}` } }); const remote = await profileResponse.json<Record<string, unknown>>(); const subject = String(remote.sub ?? remote.id ?? '');
  if (!profileResponse.ok || !/^[A-Za-z0-9._:-]{2,160}$/.test(subject)) return Response.redirect(`${url.origin}${stored.returnPath}?auth=${provider}&error=oauth-failed`, 302);
  const identifier = `${provider}:${subject}`; let identity = await env.DB.prepare('SELECT user_id AS userId FROM auth_identities WHERE identifier=?').bind(identifier).first<{ userId: string }>();
  if (!identity) {
    const verifiedEmail = provider === 'google' && remote.email_verified === true ? cleanEmail(remote.email) : '';
    const userId = verifiedEmail ? await createUser(env, verifiedEmail, String(remote.name ?? 'PLAYER')) : await createUser(env, `${identifier}@oauth.invalid`, String(remote.name ?? 'PLAYER'));
    await env.DB.prepare('INSERT OR IGNORE INTO auth_identities(identity_id,user_id,kind,identifier,verified_at) VALUES(?,?,?,?,?)').bind(id('ident'), userId, provider, identifier, nowIso()).run(); identity = { userId };
  }
  const session = await createSession(env, identity.userId); return new Response(null, { status: 302, headers: { Location: `${stored.returnPath}?auth=${provider}&connected=1`, 'Set-Cookie': sessionCookie(session.token, request) } });
}

async function sha256Base64(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); let binary = ''; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonical(source[key])]));
}

async function keyPair(): Promise<CryptoKeyPair> {
  signingKeys ??= crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  return signingKeys;
}

function base64Url(data: ArrayBuffer): string {
  let binary = ''; for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function signed<T extends Record<string, unknown>>(payload: T): Promise<T & { integrity: Record<string, unknown> }> {
  const keys = await keyPair(); const contentHash = await sha256(JSON.stringify(canonical(payload)));
  const publicKey = await crypto.subtle.exportKey('spki', keys.publicKey);
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(contentHash));
  return { ...payload, integrity: { algorithm: 'Ed25519', keyId: `worker-${(await sha256(base64Url(publicKey))).slice(0, 16)}`, publicKey: base64Url(publicKey), contentHash, signature: base64Url(signature) } };
}

async function livePayload(): Promise<Record<string, unknown>> {
  const epoch = Date.UTC(2026, 0, 1); const duration = 28 * 86_400_000; const seasonNumber = Math.max(0, Math.floor((Date.now() - epoch) / duration));
  const startsAt = epoch + seasonNumber * duration; const endsAt = startsAt + duration; const seasonId = `season-${String(seasonNumber + 1).padStart(3, '0')}`;
  const seed = Number.parseInt((await sha256(`paopao:endless:${seasonId}`)).slice(0, 8), 16) & 0x7fffffff;
  return signed({
    schemaVersion: 3, season: seasonId, minimumFps: 30, preferredFps: 60,
    handTracking: { targetFps: 30, adaptive: true, workerInference: true, framesUploaded: false },
    features: { arena: true, cloudSync: true, telemetry: false, endless: true, liveEvents: false },
    endless: { seasonId, seed, rulesVersion: ENDLESS_REPLAY_RULES.rulesVersion, replayVersion: ENDLESS_REPLAY_RULES.replayVersion, maximumShots: ENDLESS_REPLAY_RULES.maximumShots, aimMilliDegrees: { minimum: ENDLESS_REPLAY_RULES.aimMinimumMilliDegrees, maximum: ENDLESS_REPLAY_RULES.aimMaximumMilliDegrees }, pointsPerRewardTier: 500, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), modifiers: ['rising-pressure', 'prism-drift', 'boss-echo'] },
    events: [],
  });
}

async function contentPayload(): Promise<Record<string, unknown>> {
  return signed({ schemaVersion: 3, contentVersion: '2026.08.01-cloudflare-r1', saveVersion: 4, clients: { classic: { route: '/classic/', engine: 'phaser-3.90.0', status: 'production', platforms: ['web'] } }, worlds: 6, levels: 30, modes: ['classic', 'rush', 'precision', 'endless'], artifacts: ['chrono', 'phoenix', 'void', 'fortune'], compatibility: { minimumApiVersion: 3, legacyAdaptersThroughRelease: 2 } });
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const method = request.method;
  if (path === '/api/health' || path === '/api/ready') {
    try { await env.DB.prepare('SELECT 1').first(); return response({ ok: true, service: 'paopao-fusion', database: 'ready', runtime: 'cloudflare-workers', time: nowIso() }); }
    catch { return response({ ok: false, database: 'unavailable' }, 503); }
  }
  if (path === '/api/auth/providers' && method === 'GET') return response({ providers: (Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>).map((provider) => ({ provider, configured: Boolean(providerSecrets(env, provider)) })) });
  if ((path === '/api/telemetry/batch' || path === '/api/v3/telemetry/batch') && method === 'POST') {
    const input = await body(request); const events = Array.isArray(input.events) ? input.events : [];
    const allowedTypes = new Set(['performance', 'frame-health', 'tutorial-step', 'level-start', 'level-end', 'level-exit', 'shot-result', 'boss-phase', 'reward-claim', 'hand-state', 'session-exit', 'next-action']);
    const productTypes = new Set(['tutorial-step', 'level-start', 'level-end', 'level-exit', 'shot-result', 'boss-phase', 'reward-claim', 'hand-state', 'session-exit', 'next-action']);
    if (events.length < 1 || events.length > 50 || events.some((event) => !event || typeof event !== 'object' || Array.isArray(event) || !allowedTypes.has(String((event as Record<string, unknown>).type ?? '')))) {
      return response({ error: 'telemetry-invalid' }, 400);
    }
    const containsProductEvents = events.some((event) => productTypes.has(String((event as Record<string, unknown>).type)));
    if (containsProductEvents && (input.anonymous !== true || input.consentVersion !== 'product-telemetry-v1' || events.some((event) => {
      const item = event as Record<string, unknown>;
      return productTypes.has(String(item.type)) && (!validKey(item.eventId) || !validKey(item.sessionId) || !Number.isInteger(item.occurredAtMs));
    }))) return response({ error: 'product-telemetry-consent-required' }, 400);
    const requestedBatchId = input.batchId; const batchId = validKey(requestedBatchId) ? requestedBatchId : id('tel');
    const existing = await env.DB.prepare('SELECT 1 FROM telemetry_batches WHERE batch_id=?').bind(batchId).first();
    if (existing) return response({ accepted: 0, duplicate: true, batchId });
    const session = await getSession(request, env);
    await env.DB.prepare('INSERT INTO telemetry_batches(batch_id,user_id,events_json,created_at) VALUES(?,?,?,?)')
      .bind(batchId, input.anonymous === true ? null : session?.userId ?? null, JSON.stringify(events), nowIso()).run();
    return response({ accepted: events.length, duplicate: false, batchId });
  }
  if (path === '/api/v3/bootstrap' && method === 'GET') {
    const session = await getSession(request, env);
    return response({ apiVersion: 3, serverTime: nowIso(), content: await contentPayload(), live: await livePayload(), account: session ? { authenticated: true, authentication: 'web', ...(await profile(env, session.userId)), csrfToken: session.csrfToken } : { authenticated: false } });
  }
  const oauthMatch = path.match(/^\/api\/auth\/(google|facebook)\/(start|callback)$/);
  if (oauthMatch && method === 'GET') return oauth(request, env, oauthMatch[1] as keyof typeof PROVIDERS, oauthMatch[2] === 'callback');
  if (path === '/api/auth/otp/request' && method === 'POST') {
    const input = await body(request); const email = cleanEmail(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: 'email-invalid' }, 400);
    const recent = await env.DB.prepare('SELECT COUNT(*) AS count FROM otp_challenges WHERE email=? AND created_at>?').bind(email, new Date(Date.now() - 3_600_000).toISOString()).first<{ count: number }>();
    if ((recent?.count ?? 0) >= 5) return response({ error: 'otp-rate-limited' }, 429);
    if ((!env.RESEND_API_KEY || !env.PAOPAO_EMAIL_FROM) && env.ENVIRONMENT !== 'development') return response({ error: 'email-provider-unconfigured' }, 503);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900_000 + 100_000); const challengeId = id('otp'); const expiresAt = new Date(Date.now() + 600_000).toISOString();
    await env.DB.prepare('INSERT INTO otp_challenges(challenge_id,email,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)').bind(challengeId, email, await sha256(`${challengeId}:${code}`), expiresAt, nowIso()).run();
    if (env.RESEND_API_KEY && env.PAOPAO_EMAIL_FROM) {
      const sent = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.PAOPAO_EMAIL_FROM, to: [email], subject: 'Your PaoPao Fusion sign-in code', text: `Your PaoPao Fusion code is ${code}. It expires in 10 minutes.` }) });
      if (!sent.ok) { await env.DB.prepare('DELETE FROM otp_challenges WHERE challenge_id=?').bind(challengeId).run(); return response({ error: 'email-delivery-failed' }, 503); }
    }
    return response({ challengeId, expiresAt, ...(env.ENVIRONMENT === 'development' ? { developmentCode: code } : {}) });
  }
  if (path === '/api/auth/otp/verify' && method === 'POST') {
    const input = await body(request); const challengeId = String(input.challengeId ?? ''); const code = String(input.code ?? '');
    const challenge = await env.DB.prepare('SELECT email,code_hash AS codeHash,attempts,expires_at AS expiresAt,consumed_at AS consumedAt FROM otp_challenges WHERE challenge_id=?').bind(challengeId).first<{ email: string; codeHash: string; attempts: number; expiresAt: string; consumedAt: string | null }>();
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= nowIso()) return response({ error: 'otp-expired' }, 410);
    if (challenge.attempts >= 5) return response({ error: 'otp-locked' }, 429);
    if (!/^\d{6}$/.test(code) || await sha256(`${challengeId}:${code}`) !== challenge.codeHash) { await env.DB.prepare('UPDATE otp_challenges SET attempts=attempts+1 WHERE challenge_id=?').bind(challengeId).run(); return response({ error: 'otp-invalid' }, 401); }
    const userId = await createUser(env, challenge.email, cleanName(input.displayName)); const session = await createSession(env, userId);
    await env.DB.prepare('UPDATE otp_challenges SET consumed_at=? WHERE challenge_id=?').bind(nowIso(), challengeId).run();
    return response({ ...(await profile(env, userId)), authentication: 'web', csrfToken: session.csrfToken }, 200, { 'Set-Cookie': sessionCookie(session.token, request) });
  }
  if (path === '/api/account/status' && method === 'GET') { const session = await getSession(request, env); return session ? response({ authenticated: true, authentication: 'web', ...(await profile(env, session.userId)), csrfToken: session.csrfToken }) : response({ authenticated: false }); }
  if (path === '/api/catalog' && method === 'GET') { const offers = await env.DB.prepare(`SELECT offer_id AS offerId,title,currency,price,grant_kind AS grantKind,grant_id AS grantId,grant_quantity AS quantity FROM catalog_offers WHERE active=1 ORDER BY currency,price`).all<OfferRow>(); return response({ version: 1, offers: offers.results }); }
  const authenticated = await requireSession(request, env, method !== 'GET'); if (authenticated instanceof Response) return authenticated; const userId = authenticated.userId;
  if (path === '/api/auth/logout' && method === 'POST') { await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE session_id=?').bind(nowIso(), authenticated.sessionId).run(); return response({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` }); }
  if ((path === '/api/account' || path === '/api/wallet') && method === 'GET') { const data = await profile(env, userId); return response(path.endsWith('wallet') ? data.wallet : { ...data, authentication: 'web', csrfToken: authenticated.csrfToken }); }
  if (path === '/api/inventory/v2' && method === 'GET') return response(await inventory(env, userId));
  if (path === '/api/inventory/v2/consume' && method === 'POST') {
    const input = await body(request); const itemId = String(input.itemId ?? ''); const quantity = Number(input.quantity); const key = input.idempotencyKey;
    if (!['bomb', 'rainbow'].includes(itemId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !validKey(key)) return response({ error: 'inventory-request-invalid' }, 400);
    const reference = `consume:${key}`; const existing = await env.DB.prepare("SELECT entry_id AS entryId FROM inventory_ledger WHERE user_id=? AND reason='gameplay' AND reference_id=? AND item_id=?").bind(userId, reference, itemId).first<{ entryId: string }>();
    if (existing) return response({ duplicate: true, entryId: existing.entryId, inventory: await inventory(env, userId) });
    const current = await inventory(env, userId); const balance = (current.items as Array<{ itemId: string; quantity: number }>).find((item) => item.itemId === itemId)?.quantity ?? 0;
    if (balance < quantity) return response({ error: 'inventory-insufficient' }, 409);
    const entryId = id('inv'); await env.DB.prepare('INSERT INTO inventory_ledger(entry_id,user_id,item_id,delta,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(entryId, userId, itemId, -quantity, 'gameplay', reference, nowIso()).run();
    return response({ duplicate: false, entryId, inventory: await inventory(env, userId) });
  }
  if (path === '/api/purchases' && method === 'POST') return purchase(request, env, authenticated);
  if (path === '/api/wallet/exchange' && method === 'POST') return exchange(request, env, authenticated);
  if (path === '/api/v3/progress' && method === 'GET') return response(await progressEnvelope(env, userId));
  if (path === '/api/v3/progress' && method === 'PUT') {
    const input = await body(request); const current = await env.DB.prepare('SELECT progress_json AS progressJson,revision FROM player_progress WHERE user_id=?').bind(userId).first<{ progressJson: string; revision: number }>();
    if (!current || Number(input.revision) !== current.revision) return response({ error: 'revision-conflict', ...(await progressEnvelope(env, userId)) }, 409);
    const progress = mergeProgress(JSON.parse(current.progressJson), input.progress); const state: Record<string, unknown> = {}; for (const key of ['clientIdentity','campaign','deviceSettings','handProfile']) if (input[key] && typeof input[key] === 'object') state[key] = input[key];
    await env.DB.prepare('UPDATE player_progress SET progress_json=?,client_state_json=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?').bind(JSON.stringify(progress), JSON.stringify(state), nowIso(), userId, current.revision).run();
    return response(await progressEnvelope(env, userId));
  }
  if (path === '/api/v3/runs' && method === 'POST') return settleEndlessRun(request, env, authenticated);
  if ((path === '/api/social/me' || path === '/api/social/friends') && method === 'GET') { const snapshot = await socialSnapshot(env, userId); return response(path.endsWith('friends') ? { friends: snapshot.friends } : snapshot); }
  if (path === '/api/social/connect' && method === 'POST') {
    const input = await body(request); const code = String(input.friendCode ?? '').trim().toUpperCase(); const target = await env.DB.prepare('SELECT user_id AS userId FROM player_social WHERE friend_code=?').bind(code).first<{ userId: string }>();
    if (!target) return response({ error: 'friend-code-not-found' }, 404); if (target.userId === userId) return response({ error: 'cannot-connect-self' }, 409); const timestamp = nowIso();
    await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_user_id,created_at) VALUES(?,?,?)').bind(userId, target.userId, timestamp), env.DB.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_user_id,created_at) VALUES(?,?,?)').bind(target.userId, userId, timestamp)]);
    await notify(env, target.userId, { type: 'social-friend-connected', userId, serverTime: Date.now() }); return response({ connected: true, social: await socialSnapshot(env, userId) });
  }
  if (path === '/api/social/gifts' && method === 'GET') return gifts(env, userId);
  if (path === '/api/social/gifts' && method === 'POST') return sendGift(request, env, authenticated);
  const claim = path.match(/^\/api\/social\/gifts\/([^/]+)\/claim$/); if (claim && method === 'POST') return claimGift(env, userId, decodeURIComponent(claim[1]));
  return response({ error: 'api-route-not-found' }, 404);
}

async function settleEndlessRun(request: Request, env: Env, session: Session): Promise<Response> {
  const input = await body(request); const runId = String(input.runId ?? '');
  if (!/^[A-Za-z0-9._:-]{8,96}$/.test(runId) || input.client !== 'classic' || input.mode !== 'endless') return response({ error: 'run-invalid' }, 400);
  const duplicate = await env.DB.prepare('SELECT receipt_json AS receiptJson FROM v3_run_receipts WHERE run_id=? AND user_id=?').bind(runId, session.userId).first<{ receiptJson: string }>();
  if (duplicate) return response({ ...JSON.parse(duplicate.receiptJson), duplicate: true, replayed: true });
  const live = await livePayload(); const endless = live.endless as Record<string, unknown>; const seasonId = String(input.seasonId ?? '');
  if (seasonId !== endless.seasonId || Number(input.seed) !== endless.seed || input.contentVersion !== '2026.08.01-cloudflare-r1') return response({ error: 'run-config-mismatch' }, 409);
  const trace = Array.isArray(input.shotTrace) ? input.shotTrace : []; const simulation = simulateEndlessReplay({ seed: Number(input.seed), level: Number(input.level), durationMs: Number(input.durationMs), shotTrace: trace, modifier: null, eventBoss: false });
  if (!simulation.ok) return response({ error: simulation.error }, 422);
  const result = simulation.result;
  if (Number(input.score) !== result.score || Number(input.shots ?? trace.length) !== result.shots || Number(input.hits ?? result.hits) !== result.hits) return response({ error: 'run-claim-mismatch' }, 422);
  const previous = await env.DB.prepare('SELECT best_wave AS bestWave,best_score AS bestScore,season_points AS seasonPoints FROM endless_season_progress WHERE user_id=? AND season_id=?').bind(session.userId, seasonId).first<{ bestWave: number; bestScore: number; seasonPoints: number }>();
  const runPoints = Math.max(0, Math.floor(result.score / 100)); const seasonPoints = (previous?.seasonPoints ?? 0) + runPoints; const timestamp = nowIso();
  const validationPayload = { runId, userId: session.userId, client: 'classic', contentVersion: String(input.contentVersion), createdAt: String(input.createdAt ?? timestamp), scoreClaim: Number(input.score), wonClaim: Boolean(input.won), replayHash: String(input.replayHash ?? '') };
  const receipt = {
    accepted: true, duplicate: false, runId, serverAcceptedAt: timestamp,
    validation: await signed({ payload: validationPayload }),
    replayVerification: { status: 'authoritative', authoritative: true, rewardEligible: true, reason: 'deterministic-replay-verified', replayVersion: 1, shotCount: result.shots, result: { score: result.score, hits: result.hits, shots: result.shots, wave: result.wave, won: result.won, maxCombo: result.maxCombo, seasonPoints: runPoints, boss: result.boss, stateChecksum: result.stateChecksum } },
    progression: { applied: true, seasonId, runPoints, bestWave: Math.max(previous?.bestWave ?? 0, result.wave), bestScore: Math.max(previous?.bestScore ?? 0, result.score), seasonPoints, rewardTrackTier: Math.floor(seasonPoints / 500) },
  };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO endless_season_progress(user_id,season_id,best_wave,best_score,season_points,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,season_id) DO UPDATE SET best_wave=MAX(best_wave,excluded.best_wave),best_score=MAX(best_score,excluded.best_score),season_points=excluded.season_points,updated_at=excluded.updated_at`).bind(session.userId, seasonId, result.wave, result.score, seasonPoints, timestamp),
    env.DB.prepare('INSERT INTO v3_run_receipts(run_id,user_id,receipt_json,created_at) VALUES(?,?,?,?)').bind(runId, session.userId, JSON.stringify(receipt), timestamp),
  ]);
  return response(receipt);
}

async function purchase(request: Request, env: Env, session: Session): Promise<Response> {
  const input = await body(request); const offerId = String(input.offerId ?? ''); const key = request.headers.get('Idempotency-Key') ?? String(input.idempotencyKey ?? ''); if (!validKey(key)) return response({ error: 'idempotency-key-invalid' }, 400);
  const prior = await env.DB.prepare('SELECT offer_id AS offerId,receipt_json AS receiptJson FROM orders WHERE user_id=? AND idempotency_key=?').bind(session.userId, key).first<{ offerId: string; receiptJson: string }>();
  if (prior) return prior.offerId === offerId ? response(JSON.parse(prior.receiptJson)) : response({ error: 'idempotency-key-conflict' }, 409);
  const offer = await env.DB.prepare(`SELECT offer_id AS offerId,title,currency,price,grant_kind AS grantKind,grant_id AS grantId,grant_quantity AS quantity FROM catalog_offers WHERE offer_id=? AND active=1`).bind(offerId).first<OfferRow>(); if (!offer) return response({ error: 'offer-not-found' }, 404);
  const wallet = await env.DB.prepare('SELECT coins,diamonds,revision,updated_at AS updatedAt FROM wallets WHERE user_id=?').bind(session.userId).first<WalletRow>(); if (!wallet || wallet[offer.currency] < offer.price) return response({ error: 'insufficient-funds' }, 409);
  if (offer.grantKind === 'entitlement' && await env.DB.prepare('SELECT 1 FROM entitlements WHERE user_id=? AND entitlement_id=?').bind(session.userId, offer.grantId).first()) return response({ error: 'already-owned' }, 409);
  const orderId = id('ord'); const receiptId = id('rcp'); const timestamp = nowIso(); const balance = wallet[offer.currency] - offer.price; const receipt = { receiptId, orderId, offerId, status: 'settled', currency: offer.currency, amount: offer.price, balance, grant: { kind: offer.grantKind, id: offer.grantId, quantity: offer.quantity }, createdAt: timestamp };
  const statements = [env.DB.prepare(`UPDATE wallets SET ${offer.currency}=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?`).bind(balance, timestamp, session.userId, wallet.revision), env.DB.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id('led'), session.userId, offer.currency, -offer.price, balance, 'purchase', orderId, timestamp)];
  if (offer.grantKind === 'inventory') statements.push(env.DB.prepare('INSERT INTO inventory_ledger(entry_id,user_id,item_id,delta,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(id('inv'), session.userId, offer.grantId, offer.quantity, 'purchase', orderId, timestamp));
  else if (offer.grantKind === 'bundle') for (const grant of BUNDLES[offer.grantId] ?? []) statements.push(env.DB.prepare('INSERT INTO inventory_ledger(entry_id,user_id,item_id,delta,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(id('inv'), session.userId, grant.itemId, grant.quantity, 'purchase', orderId, timestamp));
  else statements.push(env.DB.prepare('INSERT INTO entitlements(user_id,entitlement_id,source,created_at) VALUES(?,?,?,?)').bind(session.userId, offer.grantId, orderId, timestamp));
  statements.push(env.DB.prepare('INSERT INTO orders(order_id,user_id,offer_id,idempotency_key,receipt_json,created_at) VALUES(?,?,?,?,?,?)').bind(orderId, session.userId, offerId, key, JSON.stringify(receipt), timestamp)); await env.DB.batch(statements); return response(receipt);
}

async function exchange(request: Request, env: Env, session: Session): Promise<Response> {
  const input = await body(request); const packs = Number(input.packs); const key = input.idempotencyKey; if (![1, 2].includes(packs) || !validKey(key)) return response({ error: 'exchange-request-invalid' }, 400); const reference = `exchange:${key}`;
  if (await env.DB.prepare("SELECT 1 FROM wallet_ledger WHERE user_id=? AND kind='weekly-exchange' AND reference_id=?").bind(session.userId, reference).first()) {
    const duplicateProfile = await profile(env, session.userId) as { wallet: Record<string, unknown> };
    return response({ ...duplicateProfile.wallet, duplicate: true });
  }
  const wallet = await env.DB.prepare('SELECT coins,diamonds,revision,updated_at AS updatedAt FROM wallets WHERE user_id=?').bind(session.userId).first<WalletRow>(); if (!wallet || wallet.coins < packs * 100) return response({ error: 'insufficient-funds' }, 409);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString(); const used = await env.DB.prepare("SELECT COALESCE(SUM(delta),0) AS amount FROM wallet_ledger WHERE user_id=? AND kind='weekly-exchange' AND currency='diamonds' AND created_at>?").bind(session.userId, since).first<{ amount: number }>(); const diamonds = packs * 10; if ((used?.amount ?? 0) + diamonds > 100) return response({ error: 'weekly-exchange-cap' }, 409);
  const timestamp = nowIso(); await env.DB.batch([env.DB.prepare('UPDATE wallets SET coins=?,diamonds=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?').bind(wallet.coins - packs * 100, wallet.diamonds + diamonds, timestamp, session.userId, wallet.revision), env.DB.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id('led'), session.userId, 'diamonds', diamonds, wallet.diamonds + diamonds, 'weekly-exchange', reference, timestamp)]); return response({ coins: wallet.coins - packs * 100, diamonds: wallet.diamonds + diamonds, revision: wallet.revision + 1, updatedAt: timestamp, exchangedThisWeek: (used?.amount ?? 0) + diamonds, weeklyCap: 100 });
}

async function gifts(env: Env, userId: string): Promise<Response> {
  const rows = await env.DB.prepare(`SELECT g.gift_id AS giftId,g.sender_user_id AS senderUserId,p.display_name AS senderName,g.offer_id AS offerId,o.title,g.status,g.message,g.created_at AS createdAt,g.claimed_at AS claimedAt FROM social_gifts g JOIN player_profiles p ON p.user_id=g.sender_user_id JOIN catalog_offers o ON o.offer_id=g.offer_id WHERE g.recipient_user_id=? ORDER BY g.created_at DESC LIMIT 40`).bind(userId).all(); return response({ gifts: rows.results });
}

async function sendGift(request: Request, env: Env, session: Session): Promise<Response> {
  const input = await body(request); const recipient = String(input.recipientUserId ?? ''); const offerId = String(input.offerId ?? ''); const key = input.idempotencyKey; if (!validKey(key) || !['friendship_hamper','royal_hamper'].includes(offerId)) return response({ error: 'gift-request-invalid' }, 400); const giftId = `gift_${(await sha256(`${session.userId}\0${key}`)).slice(0, 32)}`;
  if (await env.DB.prepare('SELECT 1 FROM social_gifts WHERE gift_id=? AND sender_user_id=?').bind(giftId, session.userId).first()) return response({ duplicate: true, giftId }); if (!await env.DB.prepare('SELECT 1 FROM friendships WHERE user_id=? AND friend_user_id=?').bind(session.userId, recipient).first()) return response({ error: 'friend-connection-required' }, 403);
  const offer = await env.DB.prepare(`SELECT offer_id AS offerId,title,currency,price,grant_kind AS grantKind,grant_id AS grantId,grant_quantity AS quantity FROM catalog_offers WHERE offer_id=? AND active=1 AND grant_kind='bundle'`).bind(offerId).first<OfferRow>(); const wallet = await env.DB.prepare('SELECT coins,diamonds,revision,updated_at AS updatedAt FROM wallets WHERE user_id=?').bind(session.userId).first<WalletRow>(); if (!offer) return response({ error: 'gift-offer-not-found' }, 404); if (!wallet || wallet[offer.currency] < offer.price) return response({ error: 'insufficient-funds' }, 409); const timestamp = nowIso(); const balance = wallet[offer.currency] - offer.price;
  await env.DB.batch([env.DB.prepare(`UPDATE wallets SET ${offer.currency}=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?`).bind(balance, timestamp, session.userId, wallet.revision), env.DB.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id('led'), session.userId, offer.currency, -offer.price, balance, 'social-gift', giftId, timestamp), env.DB.prepare('INSERT INTO social_gifts(gift_id,sender_user_id,recipient_user_id,offer_id,status,message,currency,amount,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(giftId, session.userId, recipient, offerId, 'pending', String(input.message ?? '').trim().slice(0, 80), offer.currency, offer.price, timestamp)]); await notify(env, recipient, { type: 'social-gift-received', giftId, serverTime: Date.now() }); return response({ duplicate: false, giftId, balance, currency: offer.currency, createdAt: timestamp });
}

async function claimGift(env: Env, userId: string, giftId: string): Promise<Response> {
  const gift = await env.DB.prepare(`SELECT g.sender_user_id AS senderUserId,g.status,g.claimed_at AS claimedAt,o.grant_id AS grantId FROM social_gifts g JOIN catalog_offers o ON o.offer_id=g.offer_id WHERE g.gift_id=? AND g.recipient_user_id=?`).bind(giftId, userId).first<{ senderUserId: string; status: string; claimedAt: string | null; grantId: string }>(); if (!gift) return response({ error: 'gift-not-found' }, 404); if (gift.status === 'claimed') return response({ duplicate: true, giftId, claimedAt: gift.claimedAt }); const grants = BUNDLES[gift.grantId]; if (!grants) return response({ error: 'gift-bundle-invalid' }, 409); const timestamp = nowIso(); const statements = grants.map((grant) => env.DB.prepare('INSERT INTO inventory_ledger(entry_id,user_id,item_id,delta,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(id('inv'), userId, grant.itemId, grant.quantity, 'social-gift', giftId, timestamp)); statements.push(env.DB.prepare("UPDATE social_gifts SET status='claimed',claimed_at=? WHERE gift_id=? AND status='pending'").bind(timestamp, giftId)); await env.DB.batch(statements); await notify(env, gift.senderUserId, { type: 'social-gift-claimed', giftId, serverTime: Date.now() }); return response({ duplicate: false, giftId, grants, claimedAt: timestamp });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
        if ((url.pathname === '/api/arena' || url.pathname === '/ws/v3/arena' || url.pathname === '/ws/v3/social') && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
          const session = await getSession(request, env); if (!session) return response({ error: 'authentication-required' }, 401);
          if (request.headers.get('Origin') && new URL(request.headers.get('Origin')!).origin !== url.origin) return response({ error: 'origin-invalid' }, 403);
          const headers = new Headers(request.headers); headers.set('X-PaoPao-User', session.userId); headers.set('X-PaoPao-Mode', url.pathname.includes('social') ? 'social' : 'arena'); return hub(env).fetch(new Request(request, { headers }));
        }
        return await api(request, env);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal-error';
      return response({ error: message === 'body-too-large' ? message : 'internal-error' }, message === 'body-too-large' ? 413 : 500);
    }
  },
} satisfies ExportedHandler<Env>;
