import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as signDetached,
  timingSafeEqual,
  verify as verifyDetached,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const KEY_ID_PATTERN = /^local-[a-f0-9]{16}$/;
const TOKEN_PATTERN = /^(local-[a-f0-9]{16})\.([A-Za-z0-9_-]{43})$/;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(first, second) {
  const left = Buffer.from(String(first));
  const right = Buffer.from(String(second));
  return left.length === right.length && timingSafeEqual(left, right);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function assertSecret(secret) {
  const value = String(secret ?? '');
  if (Buffer.byteLength(value) < 32) throw new Error('signing key material must contain at least 32 bytes');
  return value;
}

function keyIdFor(secret) {
  return `local-${digest(secret).slice(0, 16)}`;
}

// RFC 8410 PKCS#8 prefix for a raw 32-byte Ed25519 seed. Deriving the seed
// from the already durable keyring secret upgrades public content signatures
// without introducing a second secret file or breaking key rotation.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function ed25519KeyPair(secret) {
  const seed = createHash('sha256').update(assertSecret(secret)).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeySpki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
  };
}

export function signPublicPayload(payload, secret, explicitKeyId = keyIdFor(assertSecret(secret))) {
  const contentHash = digest(canonicalJson(payload));
  const keys = ed25519KeyPair(secret);
  return {
    algorithm: 'Ed25519',
    keyId: explicitKeyId,
    publicKey: keys.publicKeySpki,
    contentHash,
    signature: signDetached(null, Buffer.from(contentHash, 'utf8'), keys.privateKey).toString('base64url'),
  };
}

export function verifyPublicPayload(payload, integrity) {
  if (!integrity || integrity.algorithm !== 'Ed25519'
    || typeof integrity.publicKey !== 'string' || typeof integrity.signature !== 'string') return false;
  const contentHash = digest(canonicalJson(payload));
  if (!safeEqual(integrity.contentHash, contentHash)) return false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(integrity.publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    return verifyDetached(
      null,
      Buffer.from(contentHash, 'utf8'),
      publicKey,
      Buffer.from(integrity.signature, 'base64url'),
    );
  } catch { return false; }
}

function normalizeKey(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid signing key record');
  const secret = assertSecret(raw.secret);
  const keyId = String(raw.keyId ?? '');
  if (!KEY_ID_PATTERN.test(keyId) || keyId !== keyIdFor(secret)) throw new Error('signing key identifier mismatch');
  if (!['active', 'retired'].includes(raw.status)) throw new Error('invalid signing key status');
  if (Number.isNaN(Date.parse(raw.createdAt))) throw new Error('invalid signing key creation time');
  if (raw.status === 'retired' && Number.isNaN(Date.parse(raw.retiredAt))) throw new Error('invalid signing key retirement time');
  return {
    keyId,
    secret,
    status: raw.status,
    createdAt: raw.createdAt,
    ...(raw.status === 'retired' ? { retiredAt: raw.retiredAt } : {}),
  };
}

function loadState(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed?.version !== 1 || !Array.isArray(parsed.keys)) throw new Error('unsupported signing keyring format');
  const keys = parsed.keys.map(normalizeKey);
  if (keys.length === 0 || keys.filter((key) => key.status === 'active').length !== 1) {
    throw new Error('signing keyring must contain exactly one active key');
  }
  if (new Set(keys.map((key) => key.keyId)).size !== keys.length) throw new Error('duplicate signing key identifier');
  if (parsed.activeKeyId !== keys.find((key) => key.status === 'active').keyId) throw new Error('active signing key mismatch');
  return { version: 1, activeKeyId: parsed.activeKeyId, keys };
}

function persistState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
  try { chmodSync(path, 0o600); } catch { /* Windows ACLs are managed by the host. */ }
}

function newKey(secret, now) {
  return { keyId: keyIdFor(secret), secret, status: 'active', createdAt: now };
}

/**
 * Persistent HMAC keyring with bounded verification overlap. The file is never
 * served and callers only receive secret-free metadata. Rotation is atomic:
 * the new key reaches disk before it becomes observable through this object.
 */
export function createSigningKeyring({
  path,
  seedSecret,
  maxRetiredKeys = 2,
  now = () => new Date(),
} = {}) {
  if (!path) throw new Error('signing keyring path is required');
  const absolutePath = resolve(path);
  const retiredLimit = Math.max(1, Math.min(8, Math.trunc(Number(maxRetiredKeys) || 2)));
  let state;
  if (existsSync(absolutePath)) state = loadState(absolutePath);
  else {
    const timestamp = now().toISOString();
    const secret = assertSecret(seedSecret ?? randomBytes(48).toString('base64url'));
    const active = newKey(secret, timestamp);
    state = { version: 1, activeKeyId: active.keyId, keys: [active] };
    persistState(absolutePath, state);
  }

  const active = () => state.keys.find((key) => key.keyId === state.activeKeyId && key.status === 'active');
  const signFor = (key, purpose, message) => createHmac('sha256', key.secret)
    .update(`paopao:${purpose}:v1\0`)
    .update(String(message))
    .digest('base64url');
  const metadata = () => ({
    algorithm: 'Ed25519',
    activeKeyId: state.activeKeyId,
    verificationKeyIds: state.keys.map((key) => key.keyId),
    keys: state.keys.map(({ secret, ...key }) => ({
      ...key,
      publicKey: ed25519KeyPair(secret).publicKeySpki,
    })),
  });

  return Object.freeze({
    metadata,
    signPayload(payload) {
      const key = active();
      return signPublicPayload(payload, key.secret, key.keyId);
    },
    signMessage(message, purpose = 'message') {
      const key = active();
      return `${key.keyId}.${signFor(key, purpose, message)}`;
    },
    verifyMessage(token, message, purpose = 'message') {
      const match = TOKEN_PATTERN.exec(String(token ?? ''));
      if (!match) return false;
      const key = state.keys.find((candidate) => candidate.keyId === match[1]);
      return Boolean(key && safeEqual(match[2], signFor(key, purpose, message)));
    },
    rotate() {
      const timestamp = now().toISOString();
      const previous = active();
      let secret;
      let next;
      do {
        secret = randomBytes(48).toString('base64url');
        next = newKey(secret, timestamp);
      } while (state.keys.some((key) => key.keyId === next.keyId));
      const retired = { ...previous, status: 'retired', retiredAt: timestamp };
      const retained = state.keys
        .filter((key) => key.keyId !== previous.keyId && key.status === 'retired')
        .sort((left, right) => right.retiredAt.localeCompare(left.retiredAt))
        .slice(0, retiredLimit - 1);
      const nextState = { version: 1, activeKeyId: next.keyId, keys: [next, retired, ...retained] };
      persistState(absolutePath, nextState);
      state = nextState;
      return { previousKeyId: previous.keyId, ...metadata() };
    },
  });
}

export const signingCanonicalJson = canonicalJson;
