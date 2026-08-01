import { createHash, randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomBytes(16).toString('base64url')}`;
const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const cleanName = (value) => String(value ?? 'PLAYER').trim().slice(0, 20)
  .replace(/[^\p{L}\p{N} _-]/gu, '') || 'PLAYER';
const cleanEmail = (value) => String(value ?? '').trim().toLowerCase();
const safeReturnPath = (value) => {
  const path = String(value ?? '/').trim();
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path.slice(0, 240) : '/';
};
const onlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));

export const SOCIAL_BUNDLES = Object.freeze({
  'hamper:friendship': Object.freeze([
    Object.freeze({ itemId: 'bomb', quantity: 2 }),
    Object.freeze({ itemId: 'rainbow', quantity: 1 }),
    Object.freeze({ itemId: 'storyShard', quantity: 3 }),
  ]),
  'hamper:royal': Object.freeze([
    Object.freeze({ itemId: 'bomb', quantity: 5 }),
    Object.freeze({ itemId: 'rainbow', quantity: 3 }),
    Object.freeze({ itemId: 'storyShard', quantity: 10 }),
  ]),
});

const PROVIDERS = Object.freeze({
  google: Object.freeze({
    clientIdEnv: 'PAOPAO_GOOGLE_CLIENT_ID', clientSecretEnv: 'PAOPAO_GOOGLE_CLIENT_SECRET',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile', pkce: true,
  }),
  facebook: Object.freeze({
    clientIdEnv: 'PAOPAO_FACEBOOK_APP_ID', clientSecretEnv: 'PAOPAO_FACEBOOK_APP_SECRET',
    authorizationUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    profileUrl: 'https://graph.facebook.com/me?fields=id,name,email',
    scope: 'email,public_profile', pkce: false,
  }),
});

function providerConfig(provider) {
  const definition = PROVIDERS[provider];
  if (!definition) return null;
  const clientId = String(process.env[definition.clientIdEnv] ?? '').trim();
  const clientSecret = String(process.env[definition.clientSecretEnv] ?? '').trim();
  return clientId && clientSecret ? { ...definition, provider, clientId, clientSecret } : null;
}

function publicProviders() {
  return Object.keys(PROVIDERS).map((provider) => ({ provider, configured: Boolean(providerConfig(provider)) }));
}

function redirectUriFor(request, provider) {
  const configured = String(process.env.PAOPAO_PUBLIC_ORIGIN ?? '').trim().replace(/\/$/, '');
  if (configured) return `${configured}/api/auth/${provider}/callback`;
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const protocol = forwardedProto === 'https' || request.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${request.headers.host}/api/auth/${provider}/callback`;
}

async function responseJson(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`${label}-failed`), { detail: body });
  return body;
}

export function installSocialPlatform({ app, db, requireSession, sessionFor, publicProfile, setSessionCookie }) {
  if (!app || !db || !requireSession || !sessionFor || !publicProfile || !setSessionCookie) {
    throw new Error('social platform dependencies are required');
  }
  db.exec(`
    INSERT OR IGNORE INTO schema_versions(version,applied_at) VALUES(21,datetime('now'));
    CREATE TABLE IF NOT EXISTS oauth_states(
      state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,code_verifier TEXT,return_path TEXT NOT NULL,
      expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_social(
      user_id TEXT PRIMARY KEY REFERENCES users(user_id),friend_code TEXT NOT NULL UNIQUE,
      presence_visibility TEXT NOT NULL DEFAULT 'friends',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friendships(
      user_id TEXT NOT NULL REFERENCES users(user_id),friend_user_id TEXT NOT NULL REFERENCES users(user_id),
      created_at TEXT NOT NULL,PRIMARY KEY(user_id,friend_user_id),CHECK(user_id<>friend_user_id)
    );
    CREATE TABLE IF NOT EXISTS social_gifts(
      gift_id TEXT PRIMARY KEY,sender_user_id TEXT NOT NULL REFERENCES users(user_id),
      recipient_user_id TEXT NOT NULL REFERENCES users(user_id),offer_id TEXT NOT NULL REFERENCES catalog_offers(offer_id),
      status TEXT NOT NULL CHECK(status IN ('pending','claimed')),message TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL,amount INTEGER NOT NULL,created_at TEXT NOT NULL,claimed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS social_gifts_recipient_status ON social_gifts(recipient_user_id,status,created_at DESC);
  `);

  const ensureSocial = (userId) => {
    const existing = db.prepare('SELECT friend_code AS friendCode,presence_visibility AS presenceVisibility FROM player_social WHERE user_id=?').get(userId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase();
      try {
        const timestamp = nowIso();
        db.prepare('INSERT INTO player_social(user_id,friend_code,created_at,updated_at) VALUES(?,?,?,?)')
          .run(userId, code, timestamp, timestamp);
        return { friendCode: code, presenceVisibility: 'friends' };
      } catch (error) {
        if (!String(error?.message).includes('UNIQUE')) throw error;
      }
    }
    throw new Error('friend-code-allocation-failed');
  };

  const friendRows = (userId) => db.prepare(`SELECT f.friend_user_id AS userId,p.display_name AS displayName,
    s.friend_code AS friendCode,f.created_at AS connectedAt FROM friendships f
    JOIN player_profiles p ON p.user_id=f.friend_user_id
    JOIN player_social s ON s.user_id=f.friend_user_id WHERE f.user_id=? ORDER BY p.display_name,f.friend_user_id`).all(userId);
  const socialSockets = new Map();
  const send = (socket, message) => {
    if (socket?.readyState !== 1) return false;
    try { socket.send(JSON.stringify(message)); return true; } catch { return false; }
  };
  const notify = (userId, message) => send(socialSockets.get(userId), message);
  const socialSnapshot = (userId) => {
    const social = ensureSocial(userId);
    const friends = friendRows(userId).map((friend) => ({ ...friend, online: socialSockets.has(friend.userId) }));
    const pendingGifts = db.prepare("SELECT COUNT(*) AS count FROM social_gifts WHERE recipient_user_id=? AND status='pending'").get(userId).count;
    return { ...social, friends, pendingGifts, online: true };
  };

  app.get('/api/auth/providers', async () => ({ providers: publicProviders() }));
  app.get('/api/auth/:provider/start', async (request, reply) => {
    const config = providerConfig(String(request.params.provider));
    if (!config) return reply.code(503).send({ error: 'oauth-provider-unconfigured' });
    db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(nowIso());
    const state = randomBytes(32).toString('base64url');
    const verifier = config.pkce ? randomBytes(48).toString('base64url') : '';
    const challenge = verifier ? createHash('sha256').update(verifier).digest('base64url') : '';
    const returnPath = safeReturnPath(request.query?.returnTo);
    const createdAt = nowIso();
    db.prepare('INSERT INTO oauth_states(state_hash,provider,code_verifier,return_path,expires_at,created_at) VALUES(?,?,?,?,?,?)')
      .run(digest(state), config.provider, verifier || null, returnPath, new Date(Date.now() + 10 * 60_000).toISOString(), createdAt);
    const redirectUri = redirectUriFor(request, config.provider);
    const target = new URL(config.authorizationUrl);
    target.searchParams.set('client_id', config.clientId);
    target.searchParams.set('redirect_uri', redirectUri);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('scope', config.scope);
    target.searchParams.set('state', state);
    if (config.provider === 'google') {
      target.searchParams.set('prompt', 'select_account');
      target.searchParams.set('include_granted_scopes', 'true');
    }
    if (challenge) {
      target.searchParams.set('code_challenge', challenge);
      target.searchParams.set('code_challenge_method', 'S256');
    }
    return reply.redirect(target.toString());
  });

  const establishOAuthAccount = db.transaction(({ provider, subject, email, displayName }) => {
    const identifier = `${provider}:${subject}`;
    const identity = db.prepare(`SELECT i.user_id AS userId,u.status FROM auth_identities i JOIN users u ON u.user_id=i.user_id
      WHERE i.identifier=?`).get(identifier);
    if (identity?.status && identity.status !== 'active') throw Object.assign(new Error('account-disabled'), { statusCode: 403 });
    const emailIdentity = email ? db.prepare(`SELECT i.user_id AS userId,u.status FROM auth_identities i JOIN users u ON u.user_id=i.user_id
      WHERE i.kind='email' AND i.identifier=?`).get(email) : null;
    if (emailIdentity?.status && emailIdentity.status !== 'active') throw Object.assign(new Error('account-disabled'), { statusCode: 403 });
    const userId = identity?.userId ?? emailIdentity?.userId ?? id('usr');
    const timestamp = nowIso();
    if (!identity && !emailIdentity) {
      db.prepare('INSERT INTO users(user_id,created_at,updated_at) VALUES(?,?,?)').run(userId, timestamp, timestamp);
      db.prepare('INSERT INTO player_profiles(user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)')
        .run(userId, cleanName(displayName), timestamp, timestamp);
      db.prepare('INSERT INTO player_progress(user_id,updated_at) VALUES(?,?)').run(userId, timestamp);
      db.prepare('INSERT INTO wallets(user_id,updated_at) VALUES(?,?)').run(userId, timestamp);
    }
    if (!identity) db.prepare('INSERT INTO auth_identities(identity_id,user_id,kind,identifier,verified_at) VALUES(?,?,?,?,?)')
      .run(id('ident'), userId, provider, identifier, timestamp);
    if (email && !emailIdentity) db.prepare('INSERT INTO auth_identities(identity_id,user_id,kind,identifier,verified_at) VALUES(?,?,?,?,?)')
      .run(id('ident'), userId, 'email', email, timestamp);
    const rawToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(18).toString('base64url');
    db.prepare('INSERT INTO sessions(session_id,user_id,token_hash,csrf_token,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)')
      .run(id('ses'), userId, digest(rawToken), csrfToken, new Date(Date.now() + 30 * 86_400_000).toISOString(), timestamp, timestamp);
    ensureSocial(userId);
    return { userId, rawToken, csrfToken };
  });

  app.get('/api/auth/:provider/callback', async (request, reply) => {
    const provider = String(request.params.provider);
    const config = providerConfig(provider);
    if (!config) return reply.code(503).send({ error: 'oauth-provider-unconfigured' });
    const state = String(request.query?.state ?? '');
    const code = String(request.query?.code ?? '');
    const stored = state ? db.prepare('SELECT * FROM oauth_states WHERE state_hash=?').get(digest(state)) : null;
    if (!stored || stored.provider !== provider || stored.consumed_at || stored.expires_at <= nowIso() || !code) {
      return reply.code(400).send({ error: 'oauth-state-invalid' });
    }
    db.prepare('UPDATE oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL').run(nowIso(), digest(state));
    const redirectUri = redirectUriFor(request, provider);
    try {
      const tokenBody = new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code',
      });
      if (stored.code_verifier) tokenBody.set('code_verifier', stored.code_verifier);
      const token = await responseJson(await fetch(config.tokenUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody,
      }), 'oauth-token');
      const accessToken = String(token.access_token ?? '');
      if (!accessToken) throw new Error('oauth-access-token-missing');
      const profileResponse = await fetch(config.profileUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      const profile = await responseJson(profileResponse, 'oauth-profile');
      const subject = String(profile.sub ?? profile.id ?? '');
      if (!/^[A-Za-z0-9._:-]{2,160}$/.test(subject)) throw new Error('oauth-profile-invalid');
      const email = cleanEmail(profile.email);
      // Only merge with an existing email identity when the provider gives us
      // an explicit, machine-verifiable email assertion. Facebook identities
      // remain linked by their stable provider subject instead of email.
      const verifiedEmail = provider === 'google' && profile.email_verified === true ? email : '';
      const session = establishOAuthAccount({ provider, subject, email: verifiedEmail || '', displayName: profile.name });
      setSessionCookie(reply, session.rawToken);
      return reply.redirect(`${safeReturnPath(stored.return_path)}?auth=${encodeURIComponent(provider)}&connected=1`);
    } catch (error) {
      request.log.error({ err: error, provider }, 'OAuth callback failed');
      return reply.redirect(`${safeReturnPath(stored.return_path)}?auth=${encodeURIComponent(provider)}&error=oauth-failed`);
    }
  });

  app.get('/api/social/me', { preHandler: requireSession }, async (request) => socialSnapshot(request.account.userId));
  app.get('/api/social/friends', { preHandler: requireSession }, async (request) => ({ friends: socialSnapshot(request.account.userId).friends }));
  app.post('/api/social/connect', { preHandler: requireSession, bodyLimit: 1_024, schema: { body: {
    type: 'object', required: ['friendCode'], properties: { friendCode: { type: 'string', minLength: 6, maxLength: 12 } }, additionalProperties: false,
  } } }, async (request, reply) => {
    const userId = request.account.userId;
    const code = String(request.body.friendCode).trim().toUpperCase();
    const target = db.prepare('SELECT user_id AS userId FROM player_social WHERE friend_code=?').get(code);
    if (!target) return reply.code(404).send({ error: 'friend-code-not-found' });
    if (target.userId === userId) return reply.code(409).send({ error: 'cannot-connect-self' });
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_user_id,created_at) VALUES(?,?,?)').run(userId, target.userId, timestamp);
      db.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_user_id,created_at) VALUES(?,?,?)').run(target.userId, userId, timestamp);
    })();
    notify(target.userId, { type: 'social-friend-connected', userId, serverTime: Date.now() });
    return { connected: true, social: socialSnapshot(userId) };
  });

  const giftRows = (userId) => db.prepare(`SELECT g.gift_id AS giftId,g.sender_user_id AS senderUserId,
    p.display_name AS senderName,g.offer_id AS offerId,o.title,g.status,g.message,g.created_at AS createdAt,g.claimed_at AS claimedAt
    FROM social_gifts g JOIN player_profiles p ON p.user_id=g.sender_user_id JOIN catalog_offers o ON o.offer_id=g.offer_id
    WHERE g.recipient_user_id=? ORDER BY g.created_at DESC LIMIT 40`).all(userId);
  app.get('/api/social/gifts', { preHandler: requireSession }, async (request) => ({ gifts: giftRows(request.account.userId) }));

  const sendGift = db.transaction((senderUserId, recipientUserId, offerId, message, key) => {
    const giftId = `gift_${digest(`${senderUserId}\0${key}`).slice(0, 32)}`;
    const existing = db.prepare('SELECT gift_id AS giftId FROM social_gifts WHERE gift_id=? AND sender_user_id=?').get(giftId, senderUserId);
    if (existing) return { duplicate: true, giftId };
    const friend = db.prepare('SELECT 1 FROM friendships WHERE user_id=? AND friend_user_id=?').get(senderUserId, recipientUserId);
    if (!friend) throw Object.assign(new Error('friend-connection-required'), { statusCode: 403 });
    const offer = db.prepare("SELECT * FROM catalog_offers WHERE offer_id=? AND active=1 AND grant_kind='bundle'").get(offerId);
    if (!offer || !SOCIAL_BUNDLES[offer.grant_id]) throw Object.assign(new Error('gift-offer-not-found'), { statusCode: 404 });
    const wallet = db.prepare('SELECT coins,diamonds FROM wallets WHERE user_id=?').get(senderUserId);
    if (Number(wallet?.[offer.currency] ?? 0) < offer.price) throw Object.assign(new Error('insufficient-funds'), { statusCode: 409 });
    const timestamp = nowIso();
    const balance = Number(wallet[offer.currency]) - offer.price;
    db.prepare(`UPDATE wallets SET ${offer.currency}=?,revision=revision+1,updated_at=? WHERE user_id=?`).run(balance, timestamp, senderUserId);
    db.prepare('INSERT INTO wallet_ledger(entry_id,user_id,currency,delta,balance_after,kind,reference_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id('led'), senderUserId, offer.currency, -offer.price, balance, 'social-gift', giftId, timestamp);
    db.prepare('INSERT INTO social_gifts(gift_id,sender_user_id,recipient_user_id,offer_id,status,message,currency,amount,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(giftId, senderUserId, recipientUserId, offerId, 'pending', String(message ?? '').trim().slice(0, 80), offer.currency, offer.price, timestamp);
    return { duplicate: false, giftId, balance, currency: offer.currency, createdAt: timestamp };
  });
  app.post('/api/social/gifts', { preHandler: requireSession, bodyLimit: 2_048, schema: { body: {
    type: 'object', required: ['recipientUserId', 'offerId', 'idempotencyKey'], properties: {
      recipientUserId: { type: 'string', minLength: 20, maxLength: 80 }, offerId: { enum: ['friendship_hamper', 'royal_hamper'] },
      idempotencyKey: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' }, message: { type: 'string', maxLength: 80 },
    }, additionalProperties: false,
  } } }, async (request, reply) => {
    try {
      const result = sendGift(request.account.userId, request.body.recipientUserId, request.body.offerId, request.body.message, request.body.idempotencyKey);
      if (!result.duplicate) notify(request.body.recipientUserId, { type: 'social-gift-received', giftId: result.giftId, serverTime: Date.now() });
      return result;
    } catch (error) {
      return reply.code(error.statusCode ?? 500).send({ error: error.statusCode ? error.message : 'gift-send-failed' });
    }
  });

  const claimGift = db.transaction((userId, giftId) => {
    const gift = db.prepare(`SELECT g.*,o.grant_id FROM social_gifts g JOIN catalog_offers o ON o.offer_id=g.offer_id
      WHERE g.gift_id=? AND g.recipient_user_id=?`).get(giftId, userId);
    if (!gift) throw Object.assign(new Error('gift-not-found'), { statusCode: 404 });
    if (gift.status === 'claimed') return { duplicate: true, giftId, claimedAt: gift.claimed_at };
    const bundle = SOCIAL_BUNDLES[gift.grant_id];
    if (!bundle) throw Object.assign(new Error('gift-bundle-invalid'), { statusCode: 409 });
    const timestamp = nowIso();
    for (const grant of bundle) db.prepare('INSERT INTO inventory_ledger(entry_id,user_id,item_id,delta,reason,reference_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id('inv'), userId, grant.itemId, grant.quantity, 'social-gift', giftId, timestamp);
    db.prepare("UPDATE social_gifts SET status='claimed',claimed_at=? WHERE gift_id=? AND status='pending'").run(timestamp, giftId);
    return { duplicate: false, giftId, grants: bundle, claimedAt: timestamp, senderUserId: gift.sender_user_id };
  });
  app.post('/api/social/gifts/:giftId/claim', { preHandler: requireSession }, async (request, reply) => {
    try {
      const result = claimGift(request.account.userId, String(request.params.giftId));
      if (!result.duplicate) notify(result.senderUserId, { type: 'social-gift-claimed', giftId: result.giftId, serverTime: Date.now() });
      return result;
    } catch (error) {
      return reply.code(error.statusCode ?? 500).send({ error: error.statusCode ? error.message : 'gift-claim-failed' });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024, perMessageDeflate: false });
  const rejectUpgrade = (socket, status, message) => {
    if (!socket.destroyed) socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  const upgradeHandler = (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; } catch { rejectUpgrade(socket, 400, 'Bad Request'); return; }
    if (pathname !== '/ws/v3/social') return;
    try {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) { rejectUpgrade(socket, 403, 'Forbidden'); return; }
      const session = sessionFor({ headers: request.headers, method: 'GET', raw: request, ip: request.socket.remoteAddress });
      if (!session) { rejectUpgrade(socket, 401, 'Unauthorized'); return; }
      wss.handleUpgrade(request, socket, head, (ws) => { ws.account = session; wss.emit('connection', ws); });
    } catch { rejectUpgrade(socket, 401, 'Unauthorized'); }
  };
  app.server.on('upgrade', upgradeHandler);
  wss.on('connection', (ws) => {
    const userId = ws.account.userId;
    const previous = socialSockets.get(userId);
    if (previous && previous !== ws) previous.close(4001, 'replaced');
    socialSockets.set(userId, ws);
    send(ws, { type: 'social-ready', serverTime: Date.now(), social: socialSnapshot(userId) });
    for (const friend of friendRows(userId)) notify(friend.userId, { type: 'social-presence', userId, online: true, serverTime: Date.now() });
    ws.on('message', (buffer, isBinary) => {
      if (isBinary) { ws.close(1008, 'invalid-message'); return; }
      let message;
      try { message = JSON.parse(String(buffer)); } catch { send(ws, { type: 'error', error: 'invalid-json' }); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message) || !onlyKeys(message, new Set(['type']))) {
        send(ws, { type: 'error', error: 'invalid-message' }); return;
      }
      if (message.type === 'heartbeat') send(ws, { type: 'heartbeat', serverTime: Date.now() });
      else if (message.type === 'refresh-social') send(ws, { type: 'social-snapshot', social: socialSnapshot(userId), serverTime: Date.now() });
      else send(ws, { type: 'error', error: 'unsupported-message' });
    });
    ws.on('close', () => {
      if (socialSockets.get(userId) !== ws) return;
      socialSockets.delete(userId);
      for (const friend of friendRows(userId)) notify(friend.userId, { type: 'social-presence', userId, online: false, serverTime: Date.now() });
    });
  });
  app.addHook('onClose', async () => {
    app.server.off('upgrade', upgradeHandler);
    for (const ws of wss.clients) ws.terminate();
    socialSockets.clear();
    try { wss.close(); } catch { /* already closed */ }
  });

  return Object.freeze({ providers: publicProviders, socialSnapshot });
}
