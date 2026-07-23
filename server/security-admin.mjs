import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { signingCanonicalJson } from './signing-keyring.mjs';

const ADMIN_COOKIE = '__Host-paopao_admin';
const CHALLENGE_TTL_MS = 2 * 60_000;
const SESSION_TTL_MS = 15 * 60_000;
const MAX_ACTIVE_CHALLENGES_PER_IP = 8;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

class SecurityAdminError extends Error {
  constructor(code, statusCode = 400) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(first, second) {
  const left = Buffer.from(String(first));
  const right = Buffer.from(String(second));
  return left.length === right.length && timingSafeEqual(left, right);
}

function base64urlBuffer(value, maximumBytes = 16_384) {
  const text = String(value ?? '');
  if (!text || text.length > Math.ceil(maximumBytes * 4 / 3) + 4 || !BASE64URL_PATTERN.test(text)) {
    throw new SecurityAdminError('webauthn-encoding-invalid');
  }
  const decoded = Buffer.from(text, 'base64url');
  if (decoded.length === 0 || decoded.length > maximumBytes || decoded.toString('base64url') !== text) {
    throw new SecurityAdminError('webauthn-encoding-invalid');
  }
  return decoded;
}

function normalizedAddress(address) {
  const text = String(address ?? '').trim().toLowerCase().split('%')[0];
  return text.startsWith('::ffff:') && isIP(text.slice(7)) === 4 ? text.slice(7) : text;
}

function ipv4Integer(address) {
  return address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function expandedIpv6(address) {
  if (isIP(address) !== 6) return null;
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? Array(8 - left.length - right.length).fill('0') : [];
  const groups = [...left, ...fill, ...right];
  return groups.length === 8 ? groups.map((group) => group.padStart(4, '0')) : null;
}

export function isTailnetAddress(address) {
  const normalized = normalizedAddress(address);
  if (isIP(normalized) === 4) {
    const value = ipv4Integer(normalized);
    return (value & 0xffc00000) === 0x64400000; // 100.64.0.0/10
  }
  const groups = expandedIpv6(normalized);
  return Boolean(groups && groups[0] === 'fd7a' && groups[1] === '115c' && groups[2] === 'a1e0');
}

function isLoopbackAddress(address) {
  const normalized = normalizedAddress(address);
  if (isIP(normalized) === 4) return (ipv4Integer(normalized) & 0xff000000) === 0x7f000000;
  return normalized === '::1';
}

/** Resolve the first untrusted hop. Forwarded headers are ignored unless the
 * direct peer is loopback, which is the only supported Tailscale proxy path. */
export function resolveAdminClientAddress(request) {
  let candidate = normalizedAddress(request.raw?.socket?.remoteAddress ?? request.ip ?? '');
  const forwarded = String(request.headers?.['x-forwarded-for'] ?? '')
    .split(',')
    .map(normalizedAddress)
    .filter((address) => isIP(address));
  for (let index = forwarded.length - 1; index >= 0 && isLoopbackAddress(candidate); index -= 1) {
    candidate = forwarded[index];
  }
  return candidate;
}

function cookieValue(request, name) {
  const header = String(request.headers.cookie ?? '');
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

function parseExpectedOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('PAOPAO_ADMIN_ORIGIN must be an absolute URL'); }
  const localDevelopment = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !localDevelopment) || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('PAOPAO_ADMIN_ORIGIN must be an HTTPS origin without path, query, or credentials');
  }
  return parsed.origin;
}

function tailscaleOriginFor(request) {
  const peer = normalizedAddress(request.raw?.socket?.remoteAddress ?? '');
  const throughLocalProxy = isLoopbackAddress(peer);
  const forwardedProto = throughLocalProxy ? String(request.headers['x-forwarded-proto'] ?? '').split(',').at(-1)?.trim().toLowerCase() : '';
  if (forwardedProto && forwardedProto !== 'https') return null;
  const rawHost = throughLocalProxy
    ? String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '').split(',').at(-1)?.trim()
    : String(request.headers.host ?? '').trim();
  if (!rawHost || rawHost.length > 253 || /[\s/@\\]/.test(rawHost)) return null;
  let parsed;
  try { parsed = new URL(`https://${rawHost}`); } catch { return null; }
  if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443')
    || !/^[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z0-9-]{1,63}$/.test(parsed.hostname)
    || !parsed.hostname.endsWith('.ts.net')) return null;
  return { origin: `https://${parsed.hostname}`, rpId: parsed.hostname };
}

function decodeCbor(buffer, start = 0, depth = 0) {
  if (!Buffer.isBuffer(buffer) || start >= buffer.length || depth > 12) throw new SecurityAdminError('webauthn-cbor-invalid');
  const initial = buffer[start];
  const major = initial >> 5;
  const additional = initial & 31;
  let offset = start + 1;
  let length;
  if (additional < 24) length = additional;
  else if (additional === 24) {
    if (offset + 1 > buffer.length) throw new SecurityAdminError('webauthn-cbor-invalid');
    length = buffer.readUInt8(offset); offset += 1;
  } else if (additional === 25) {
    if (offset + 2 > buffer.length) throw new SecurityAdminError('webauthn-cbor-invalid');
    length = buffer.readUInt16BE(offset); offset += 2;
  } else if (additional === 26) {
    if (offset + 4 > buffer.length) throw new SecurityAdminError('webauthn-cbor-invalid');
    length = buffer.readUInt32BE(offset); offset += 4;
  } else throw new SecurityAdminError('webauthn-cbor-invalid');

  if (major === 0) return { value: length, offset };
  if (major === 1) return { value: -1 - length, offset };
  if (major === 2 || major === 3) {
    if (offset + length > buffer.length) throw new SecurityAdminError('webauthn-cbor-invalid');
    const bytes = buffer.subarray(offset, offset + length);
    return { value: major === 2 ? Buffer.from(bytes) : bytes.toString('utf8'), offset: offset + length };
  }
  if (major === 4) {
    const value = [];
    for (let index = 0; index < length; index += 1) {
      const decoded = decodeCbor(buffer, offset, depth + 1); value.push(decoded.value); offset = decoded.offset;
    }
    return { value, offset };
  }
  if (major === 5) {
    const value = new Map();
    for (let index = 0; index < length; index += 1) {
      const key = decodeCbor(buffer, offset, depth + 1); offset = key.offset;
      const entry = decodeCbor(buffer, offset, depth + 1); offset = entry.offset;
      if (value.has(key.value)) throw new SecurityAdminError('webauthn-cbor-invalid');
      value.set(key.value, entry.value);
    }
    return { value, offset };
  }
  if (major === 7 && additional === 20) return { value: false, offset };
  if (major === 7 && additional === 21) return { value: true, offset };
  if (major === 7 && (additional === 22 || additional === 23)) return { value: null, offset };
  throw new SecurityAdminError('webauthn-cbor-invalid');
}

function decodedCbor(buffer) {
  const decoded = decodeCbor(buffer);
  if (decoded.offset !== buffer.length) throw new SecurityAdminError('webauthn-cbor-invalid');
  return decoded.value;
}

function validatedClientData(encoded, expectedType, challengeHash, origin) {
  const bytes = base64urlBuffer(encoded, 4096);
  let clientData;
  try { clientData = JSON.parse(bytes.toString('utf8')); } catch { throw new SecurityAdminError('webauthn-client-data-invalid'); }
  if (!clientData || typeof clientData !== 'object' || Array.isArray(clientData)
    || clientData.type !== expectedType || clientData.origin !== origin || clientData.crossOrigin === true
    || typeof clientData.challenge !== 'string') {
    throw new SecurityAdminError('webauthn-client-data-invalid');
  }
  const challenge = base64urlBuffer(clientData.challenge, 128);
  if (!safeEqual(digest(challenge), challengeHash)) throw new SecurityAdminError('webauthn-challenge-invalid', 401);
  return bytes;
}

function parsedAuthenticatorData(bytes, rpId, { attested = false } = {}) {
  if (bytes.length < 37) throw new SecurityAdminError('webauthn-authenticator-data-invalid');
  const rpIdHash = bytes.subarray(0, 32);
  if (!timingSafeEqual(rpIdHash, createHash('sha256').update(rpId).digest())) {
    throw new SecurityAdminError('webauthn-rp-invalid', 401);
  }
  const flags = bytes[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) throw new SecurityAdminError('webauthn-user-verification-required', 401);
  if ((flags & 0x10) !== 0 && (flags & 0x08) === 0) throw new SecurityAdminError('webauthn-backup-flags-invalid');
  const signCount = bytes.readUInt32BE(33);
  if (!attested) return { flags, signCount, credential: null };
  if ((flags & 0x40) === 0 || bytes.length < 56) throw new SecurityAdminError('webauthn-attestation-missing');
  const credentialIdLength = bytes.readUInt16BE(53);
  const credentialStart = 55;
  const credentialEnd = credentialStart + credentialIdLength;
  if (credentialIdLength < 16 || credentialIdLength > 1024 || credentialEnd >= bytes.length) {
    throw new SecurityAdminError('webauthn-credential-invalid');
  }
  const credentialId = Buffer.from(bytes.subarray(credentialStart, credentialEnd));
  const cose = decodeCbor(bytes, credentialEnd);
  if (!(cose.value instanceof Map)) throw new SecurityAdminError('webauthn-key-invalid');
  let offset = cose.offset;
  if ((flags & 0x80) !== 0) offset = decodeCbor(bytes, offset).offset;
  if (offset !== bytes.length) throw new SecurityAdminError('webauthn-authenticator-data-invalid');
  return { flags, signCount, credential: { credentialId, coseKey: cose.value } };
}

function cosePublicKey(cose) {
  if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) throw new SecurityAdminError('webauthn-algorithm-unsupported');
  const x = cose.get(-2); const y = cose.get(-3);
  if (!Buffer.isBuffer(x) || x.length !== 32 || !Buffer.isBuffer(y) || y.length !== 32) {
    throw new SecurityAdminError('webauthn-key-invalid');
  }
  try {
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') }, format: 'jwk' });
    return key.export({ type: 'spki', format: 'pem' }).toString();
  } catch { throw new SecurityAdminError('webauthn-key-invalid'); }
}

export function verifyWebAuthnRegistration({ credential, challengeHash, origin, rpId }) {
  if (credential?.type !== 'public-key' || typeof credential.id !== 'string' || !credential.response) {
    throw new SecurityAdminError('webauthn-credential-invalid');
  }
  const rawId = base64urlBuffer(credential.rawId ?? credential.id, 1024);
  if (credential.id !== rawId.toString('base64url')) throw new SecurityAdminError('webauthn-credential-invalid');
  validatedClientData(credential.response.clientDataJSON, 'webauthn.create', challengeHash, origin);
  const attestation = decodedCbor(base64urlBuffer(credential.response.attestationObject, 16_384));
  if (!(attestation instanceof Map) || attestation.get('fmt') !== 'none'
    || !(attestation.get('attStmt') instanceof Map) || attestation.get('attStmt').size !== 0
    || !Buffer.isBuffer(attestation.get('authData'))) {
    throw new SecurityAdminError('webauthn-attestation-unsupported');
  }
  const auth = parsedAuthenticatorData(attestation.get('authData'), rpId, { attested: true });
  if (!timingSafeEqual(rawId, auth.credential.credentialId)) throw new SecurityAdminError('webauthn-credential-invalid');
  return {
    credentialId: rawId.toString('base64url'),
    publicKeyPem: cosePublicKey(auth.credential.coseKey),
    algorithm: -7,
    signCount: auth.signCount,
    backupEligible: Boolean(auth.flags & 0x08),
    backupState: Boolean(auth.flags & 0x10),
  };
}

export function verifyWebAuthnAuthentication({ credential, challengeHash, origin, rpId, storedCredential }) {
  if (credential?.type !== 'public-key' || credential.id !== storedCredential.credentialId || !credential.response) {
    throw new SecurityAdminError('webauthn-credential-invalid', 401);
  }
  const rawId = base64urlBuffer(credential.rawId ?? credential.id, 1024);
  if (rawId.toString('base64url') !== storedCredential.credentialId) throw new SecurityAdminError('webauthn-credential-invalid', 401);
  const clientData = validatedClientData(credential.response.clientDataJSON, 'webauthn.get', challengeHash, origin);
  const authenticatorData = base64urlBuffer(credential.response.authenticatorData, 4096);
  const auth = parsedAuthenticatorData(authenticatorData, rpId);
  if (credential.response.userHandle) {
    const handle = base64urlBuffer(credential.response.userHandle, 128).toString('base64url');
    if (!safeEqual(handle, storedCredential.userHandle)) throw new SecurityAdminError('webauthn-user-invalid', 401);
  }
  const signature = base64urlBuffer(credential.response.signature, 1024);
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientData).digest()]);
  let verified = false;
  try { verified = verifySignature('sha256', signed, storedCredential.publicKeyPem, signature); } catch { /* invalid key/signature */ }
  if (!verified) throw new SecurityAdminError('webauthn-signature-invalid', 401);
  if (storedCredential.signCount > 0 && auth.signCount === 0) throw new SecurityAdminError('webauthn-counter-rollback', 409);
  if (storedCredential.signCount > 0 && auth.signCount <= storedCredential.signCount) throw new SecurityAdminError('webauthn-counter-replay', 409);
  return {
    signCount: auth.signCount,
    counterSupported: auth.signCount > 0 || storedCredential.signCount > 0,
    backupEligible: Boolean(auth.flags & 0x08),
    backupState: Boolean(auth.flags & 0x10),
  };
}

const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PaoPao Secure Admin</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#050a12;color:#edf8ff}body{max-width:840px;margin:0 auto;padding:32px 18px}section{background:#0d1828;border:1px solid #25435d;border-radius:16px;padding:20px;margin:16px 0}button,input{font:inherit;padding:11px 13px;border-radius:9px;border:1px solid #3c6684}button{background:#176b87;color:#fff;cursor:pointer;margin:4px}input{background:#07101b;color:#fff;min-width:min(420px,80vw)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#050a12;padding:14px;border-radius:10px}small{color:#9ec5d9}.danger{background:#8b2942}</style></head>
<body><h1>PaoPao Secure Admin</h1><p>Tailnet-only WebAuthn operations console.</p>
<section><h2>Access</h2><button id="login">Sign in with passkey</button><button id="logout">Sign out</button><pre id="status">Loading…</pre></section>
<section><h2>Credential enrollment</h2><input id="bootstrap" type="password" autocomplete="off" placeholder="One-time bootstrap token (first credential only)"><input id="name" maxlength="64" value="Primary admin passkey" aria-label="Credential name"><button id="enroll">Register passkey</button><small>The local bootstrap token is destroyed after the first successful enrollment.</small></section>
<section><h2>Signing keys</h2><button class="danger" id="rotate">Rotate active signing key</button><pre id="keys">Authenticate to view key state.</pre></section>
<section><h2>Live configuration</h2><button id="liveLoad">Load current</button><button id="livePublish">Publish revision</button><input id="liveKey" maxlength="96" placeholder="Idempotency key"><input id="liveRollback" inputmode="numeric" placeholder="Revision to restore"><button class="danger" id="liveRestore">Create rollback revision</button><textarea id="liveDraft" spellcheck="false" style="width:100%;min-height:300px;background:#050a12;color:#edf8ff;border:1px solid #3c6684;border-radius:9px;padding:12px;box-sizing:border-box"></textarea><pre id="liveState">Authenticate to manage events.</pre></section>
<section><h2>Security audit</h2><button id="audit">Refresh audit</button><pre id="events">Authenticate to view audit events.</pre></section>
<script src="/admin/console.js" defer></script></body></html>`;

const ADMIN_JS = `(() => {
'use strict';
const $=id=>document.getElementById(id); let csrf='';
const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
const encode=value=>{const bytes=new Uint8Array(value);let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
async function call(url,body,extra={}){const response=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(csrf?{'x-csrf-token':csrf}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||('HTTP '+response.status));return data}
const registrationJSON=credential=>({id:credential.id,rawId:encode(credential.rawId),type:credential.type,response:{clientDataJSON:encode(credential.response.clientDataJSON),attestationObject:encode(credential.response.attestationObject),transports:credential.response.getTransports?.()||[]}});
const authenticationJSON=credential=>({id:credential.id,rawId:encode(credential.rawId),type:credential.type,response:{clientDataJSON:encode(credential.response.clientDataJSON),authenticatorData:encode(credential.response.authenticatorData),signature:encode(credential.response.signature),userHandle:credential.response.userHandle?encode(credential.response.userHandle):undefined}});
async function refresh(){const status=await call('/api/v3/admin/status');$('status').textContent=JSON.stringify(status,null,2);if(status.authenticated){csrf=status.csrfToken;await Promise.all([keys(),audit(),liveLoad()])}else csrf=''}
async function enroll(){const token=$('bootstrap').value.trim();const name=$('name').value;const headers=token?{authorization:'Bearer '+token}:{};const options=await call('/api/v3/admin/webauthn/registration/options',{name},headers);const publicKey={...options.publicKey,challenge:decode(options.publicKey.challenge),user:{...options.publicKey.user,id:decode(options.publicKey.user.id)},excludeCredentials:options.publicKey.excludeCredentials.map(item=>({...item,id:decode(item.id)}) )};const credential=await navigator.credentials.create({publicKey});await call('/api/v3/admin/webauthn/registration/verify',{challengeId:options.challengeId,name,credential:registrationJSON(credential)},headers);$('bootstrap').value='';await login()}
async function login(){const options=await call('/api/v3/admin/webauthn/authentication/options',{});const publicKey={...options.publicKey,challenge:decode(options.publicKey.challenge),allowCredentials:options.publicKey.allowCredentials.map(item=>({...item,id:decode(item.id)}))};const credential=await navigator.credentials.get({publicKey});const result=await call('/api/v3/admin/webauthn/authentication/verify',{challengeId:options.challengeId,credential:authenticationJSON(credential)});csrf=result.csrfToken;await refresh()}
async function keys(){const result=await call('/api/v3/admin/signing/status');$('keys').textContent=JSON.stringify(result,null,2)}
async function audit(){const result=await call('/api/v3/admin/audit?limit=100');$('events').textContent=JSON.stringify(result,null,2)}
const liveId=prefix=>{const explicit=$('liveKey').value.trim();return explicit||prefix+'-'+Date.now().toString(36)+'-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36)};
async function liveLoad(){const result=await call('/api/v3/admin/live/config');$('liveState').textContent=JSON.stringify({activeRevision:result.activeRevision,source:result.source,history:result.history},null,2);$('liveDraft').value=JSON.stringify(result.current,(key,value)=>key==='integrity'||key==='submissionToken'?undefined:value,2)}
async function livePublish(){const config=JSON.parse($('liveDraft').value);const result=await call('/api/v3/admin/live/config/publish',{idempotencyKey:liveId('publish'),config});$('liveKey').value='';await liveLoad();return result}
async function liveRestore(){const targetRevision=Number($('liveRollback').value);if(!Number.isInteger(targetRevision)||targetRevision<1)throw new Error('Enter a valid revision');const result=await call('/api/v3/admin/live/config/rollback',{idempotencyKey:liveId('rollback'),targetRevision});$('liveKey').value='';await liveLoad();return result}
$('login').onclick=()=>login().catch(error=>alert(error.message));$('enroll').onclick=()=>enroll().catch(error=>alert(error.message));$('audit').onclick=()=>audit().catch(error=>alert(error.message));
$('rotate').onclick=()=>{if(confirm('Rotate the signing key now? Existing signatures remain valid only during the overlap window.'))call('/api/v3/admin/signing/rotate',{confirmation:'ROTATE'}).then(()=>Promise.all([keys(),audit()])).catch(error=>alert(error.message))};
$('liveLoad').onclick=()=>liveLoad().catch(error=>alert(error.message));$('livePublish').onclick=()=>livePublish().catch(error=>alert(error.message));$('liveRestore').onclick=()=>liveRestore().catch(error=>alert(error.message));
$('logout').onclick=()=>call('/api/v3/admin/session/logout',{}).then(()=>{csrf='';return refresh()}).catch(error=>alert(error.message));refresh().catch(error=>$('status').textContent=error.message);
})();`;

function securitySchema() {
  return `
    CREATE TABLE IF NOT EXISTS admin_principals(principal_id TEXT PRIMARY KEY,user_handle TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_webauthn_credentials(credential_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES admin_principals(principal_id),rp_id TEXT NOT NULL,name TEXT NOT NULL,public_key_pem TEXT NOT NULL,algorithm INTEGER NOT NULL,sign_count INTEGER NOT NULL DEFAULT 0,backup_eligible INTEGER NOT NULL DEFAULT 0,backup_state INTEGER NOT NULL DEFAULT 0,transports_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,last_used_at TEXT,disabled_at TEXT);
    CREATE TABLE IF NOT EXISTS admin_webauthn_challenges(challenge_id TEXT PRIMARY KEY,challenge_hash TEXT NOT NULL,ceremony TEXT NOT NULL,principal_id TEXT NOT NULL REFERENCES admin_principals(principal_id),expected_origin TEXT NOT NULL,rp_id TEXT NOT NULL,request_ip TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS admin_challenge_expiry ON admin_webauthn_challenges(expires_at,consumed_at);
    CREATE TABLE IF NOT EXISTS admin_sessions(session_id TEXT PRIMARY KEY,principal_id TEXT NOT NULL REFERENCES admin_principals(principal_id),credential_id TEXT NOT NULL REFERENCES admin_webauthn_credentials(credential_id),token_hash TEXT NOT NULL UNIQUE,csrf_token TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_security_audit(sequence INTEGER PRIMARY KEY,event_id TEXT NOT NULL UNIQUE,actor_credential_id TEXT,event_type TEXT NOT NULL,detail_json TEXT NOT NULL,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,key_id TEXT NOT NULL,signature TEXT NOT NULL,created_at TEXT NOT NULL);
  `;
}

export function installSecurityAdmin({
  app,
  db,
  dataDir = 'data',
  signingKeyring,
  liveConfigAdmin,
  backendCapabilities,
  origin = process.env.PAOPAO_ADMIN_ORIGIN ?? process.env.PAOPAO_PUBLIC_ORIGIN,
  rpId: configuredRpId = process.env.PAOPAO_ADMIN_RP_ID,
  bootstrapSecret = process.env.PAOPAO_ADMIN_BOOTSTRAP_TOKEN,
  now = () => new Date(),
} = {}) {
  if (!app || !db || !signingKeyring) throw new Error('security admin requires app, database, and signing keyring');
  const configuredOrigin = parseExpectedOrigin(origin);
  const originUrl = configuredOrigin ? new URL(configuredOrigin) : null;
  const configuredRp = String(configuredRpId ?? originUrl?.hostname ?? '').toLowerCase();
  if (configuredOrigin && (!configuredRp || (originUrl.hostname !== configuredRp && !originUrl.hostname.endsWith(`.${configuredRp}`)))) {
    throw new Error('PAOPAO_ADMIN_RP_ID must equal or be a registrable suffix of the admin origin host');
  }
  if (bootstrapSecret && Buffer.byteLength(bootstrapSecret) < 32) throw new Error('PAOPAO_ADMIN_BOOTSTRAP_TOKEN must contain at least 32 bytes');
  const bootstrapPath = resolve(dataDir, '.admin-bootstrap-token');
  const timestamp = () => now().toISOString();
  const identifier = (prefix) => `${prefix}_${randomBytes(18).toString('base64url')}`;
  db.exec(securitySchema());

  const credentialCount = () => Number(db.prepare('SELECT COUNT(*) AS count FROM admin_webauthn_credentials WHERE disabled_at IS NULL').get().count);
  if (credentialCount() === 0 && !bootstrapSecret && !existsSync(bootstrapPath)) {
    mkdirSync(resolve(dataDir), { recursive: true });
    writeFileSync(bootstrapPath, `${randomBytes(36).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 });
    try { chmodSync(bootstrapPath, 0o600); } catch { /* Windows ACLs are managed by the host. */ }
  } else if (credentialCount() > 0 && existsSync(bootstrapPath)) {
    try { unlinkSync(bootstrapPath); } catch { /* stale bootstrap cleanup is retried on restart */ }
  }

  const audit = (eventType, detail = {}, actorCredentialId = null) => db.transaction(() => {
    const previous = db.prepare('SELECT sequence,entry_hash AS entryHash FROM admin_security_audit ORDER BY sequence DESC LIMIT 1').get();
    const sequence = Number(previous?.sequence ?? 0) + 1;
    const createdAt = timestamp();
    const eventId = identifier('admaudit');
    const previousHash = previous?.entryHash ?? '0'.repeat(64);
    const payload = { sequence, eventId, actorCredentialId, eventType, detail, previousHash, createdAt };
    const entryHash = digest(signingCanonicalJson(payload));
    const signature = signingKeyring.signMessage(entryHash, 'admin-audit');
    const keyId = signature.split('.')[0];
    db.prepare(`INSERT INTO admin_security_audit(sequence,event_id,actor_credential_id,event_type,detail_json,previous_hash,entry_hash,key_id,signature,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(sequence, eventId, actorCredentialId, eventType, JSON.stringify(detail), previousHash, entryHash, keyId, signature, createdAt);
    return { sequence, eventId, entryHash };
  })();

  const tailnetOnly = async (request, reply) => {
    const address = resolveAdminClientAddress(request);
    request.adminClientAddress = address;
    if (!isTailnetAddress(address)) return reply.code(403).send({ error: 'tailnet-required' });
  };

  const sessionFor = (request) => {
    const rawToken = cookieValue(request, ADMIN_COOKIE);
    if (!rawToken || rawToken.length > 160) return null;
    const row = db.prepare(`SELECT s.session_id AS sessionId,s.principal_id AS principalId,s.credential_id AS credentialId,s.csrf_token AS csrfToken,s.expires_at AS expiresAt
      FROM admin_sessions s JOIN admin_webauthn_credentials c ON c.credential_id=s.credential_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND c.disabled_at IS NULL`).get(digest(rawToken), timestamp());
    if (row) db.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE session_id=?').run(timestamp(), row.sessionId);
    return row ?? null;
  };

  const requireAdmin = async (request, reply) => {
    const session = sessionFor(request);
    if (!session) return reply.code(401).send({ error: 'admin-authentication-required' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const csrf = String(request.headers['x-csrf-token'] ?? '');
      if (!csrf || !safeEqual(csrf, session.csrfToken)) return reply.code(403).send({ error: 'csrf-invalid' });
    }
    request.adminSession = session;
  };

  const validBootstrap = (request) => {
    const authorization = String(request.headers.authorization ?? '');
    if (!authorization.startsWith('Bearer ') || authorization.length > 512) return false;
    const supplied = authorization.slice(7);
    let expected = bootstrapSecret;
    if (!expected) {
      try { expected = readFileSync(bootstrapPath, 'utf8').trim(); } catch { return false; }
    }
    return Boolean(expected && safeEqual(digest(supplied), digest(expected)));
  };

  const enrollmentAuthorization = (request, reply) => {
    if (credentialCount() === 0) {
      if (!validBootstrap(request)) return reply.code(401).send({ error: 'admin-bootstrap-required' });
      request.adminEnrollmentKind = 'bootstrap';
      return true;
    }
    const session = sessionFor(request);
    const csrf = String(request.headers['x-csrf-token'] ?? '');
    if (!session) { reply.code(401).send({ error: 'admin-authentication-required' }); return false; }
    if (!csrf || !safeEqual(csrf, session.csrfToken)) { reply.code(403).send({ error: 'csrf-invalid' }); return false; }
    request.adminSession = session;
    request.adminEnrollmentKind = 'session';
    return true;
  };

  const originConfiguration = (request) => configuredOrigin && configuredRp
    ? { origin: configuredOrigin, rpId: configuredRp }
    : tailscaleOriginFor(request);
  const configured = (request, reply) => {
    const configuration = originConfiguration(request);
    if (configuration) return configuration;
    reply.code(503).send({ error: 'admin-origin-unconfigured' });
    return null;
  };

  const principal = () => {
    const existing = db.prepare('SELECT principal_id AS principalId,user_handle AS userHandle,display_name AS displayName FROM admin_principals ORDER BY created_at LIMIT 1').get();
    if (existing) return existing;
    const row = { principalId: identifier('admin'), userHandle: randomBytes(32).toString('base64url'), displayName: 'PaoPao Administrator' };
    db.prepare('INSERT INTO admin_principals(principal_id,user_handle,display_name,created_at) VALUES(?,?,?,?)')
      .run(row.principalId, row.userHandle, row.displayName, timestamp());
    return row;
  };

  const issueChallenge = (ceremony, principalId, request, configuration) => {
    const createdAt = timestamp();
    const expiresAt = new Date(now().getTime() + CHALLENGE_TTL_MS).toISOString();
    const address = request.adminClientAddress;
    const challenge = randomBytes(32).toString('base64url');
    const challengeId = identifier('wad');
    db.transaction(() => {
      db.prepare('DELETE FROM admin_webauthn_challenges WHERE expires_at<?').run(new Date(now().getTime() - 86_400_000).toISOString());
      const active = db.prepare(`SELECT COUNT(*) AS count FROM admin_webauthn_challenges
        WHERE request_ip=? AND consumed_at IS NULL AND expires_at>?`).get(address, createdAt).count;
      if (active >= MAX_ACTIVE_CHALLENGES_PER_IP) throw new SecurityAdminError('webauthn-challenge-rate-limited', 429);
      db.prepare(`INSERT INTO admin_webauthn_challenges(challenge_id,challenge_hash,ceremony,principal_id,expected_origin,rp_id,request_ip,expires_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(challengeId, digest(Buffer.from(challenge, 'base64url')), ceremony, principalId,
        configuration.origin, configuration.rpId, address, expiresAt, createdAt);
    })();
    return { challengeId, challenge, expiresAt };
  };

  const consumeChallenge = (challengeId, ceremony, request) => db.transaction(() => {
    const row = db.prepare(`SELECT challenge_id AS challengeId,challenge_hash AS challengeHash,principal_id AS principalId,expected_origin AS expectedOrigin,rp_id AS rpId,request_ip AS requestIp,expires_at AS expiresAt,consumed_at AS consumedAt
      FROM admin_webauthn_challenges WHERE challenge_id=? AND ceremony=?`).get(challengeId, ceremony);
    if (!row || row.consumedAt || row.expiresAt <= timestamp()) throw new SecurityAdminError('webauthn-challenge-expired', 410);
    if (!safeEqual(row.requestIp, request.adminClientAddress)) throw new SecurityAdminError('webauthn-challenge-client-mismatch', 401);
    const update = db.prepare('UPDATE admin_webauthn_challenges SET consumed_at=? WHERE challenge_id=? AND consumed_at IS NULL')
      .run(timestamp(), challengeId);
    if (update.changes !== 1) throw new SecurityAdminError('webauthn-challenge-expired', 410);
    return row;
  })();

  const ceremony = (eventType, handler) => async (request, reply) => {
    try { return await handler(request, reply); }
    catch (error) {
      const handled = error instanceof SecurityAdminError;
      request.log?.warn({ code: handled ? error.code : 'internal-error' }, `${eventType} failed`);
      try { audit(`${eventType}-failed`, { reason: handled ? error.code : 'internal-error', ip: request.adminClientAddress }); } catch { /* preserve original failure */ }
      if (handled) return reply.code(error.statusCode).send({ error: error.code });
      throw error;
    }
  };

  const transports = (value) => Array.isArray(value)
    ? Array.from(new Set(value.filter((entry) => ['ble', 'hybrid', 'internal', 'nfc', 'usb'].includes(entry))))
    : [];

  app.get('/admin', { preHandler: tailnetOnly }, async (_request, reply) => reply.redirect('/admin/'));
  app.get('/admin/', { preHandler: tailnetOnly }, async (_request, reply) => reply.type('text/html; charset=utf-8').send(ADMIN_HTML));
  app.get('/admin/console.js', { preHandler: tailnetOnly }, async (_request, reply) => reply.type('application/javascript; charset=utf-8').send(ADMIN_JS));

  app.get('/api/v3/admin/status', { preHandler: tailnetOnly }, async (request) => {
    const session = sessionFor(request);
    return {
      configured: Boolean(originConfiguration(request)),
      credentialCount: credentialCount(),
      enrollment: credentialCount() === 0 ? 'bootstrap-required' : 'authenticated-admin-required',
      authenticated: Boolean(session),
      ...(session ? { csrfToken: session.csrfToken, sessionExpiresAt: session.expiresAt } : {}),
    };
  });

  app.post('/api/v3/admin/webauthn/registration/options', {
    preHandler: tailnetOnly, bodyLimit: 2048,
    schema: { body: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 64 } }, additionalProperties: false } },
  }, ceremony('admin-registration-options', async (request, reply) => {
    const configuration = configured(request, reply);
    if (!configuration || !enrollmentAuthorization(request, reply)) return reply;
    const admin = principal();
    if (request.adminSession && request.adminSession.principalId !== admin.principalId) return reply.code(403).send({ error: 'admin-principal-invalid' });
    const issued = issueChallenge('create', admin.principalId, request, configuration);
    const excludeCredentials = db.prepare('SELECT credential_id AS id,transports_json AS transportsJson FROM admin_webauthn_credentials WHERE disabled_at IS NULL AND rp_id=?').all(configuration.rpId)
      .map((row) => ({ type: 'public-key', id: row.id, transports: JSON.parse(row.transportsJson) }));
    return {
      challengeId: issued.challengeId,
      expiresAt: issued.expiresAt,
      publicKey: {
        challenge: issued.challenge,
        rp: { id: configuration.rpId, name: 'PaoPao Fusion' },
        user: { id: admin.userHandle, name: 'paopao-admin', displayName: admin.displayName },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        timeout: CHALLENGE_TTL_MS,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'preferred', requireResidentKey: false, userVerification: 'required' },
        excludeCredentials,
      },
    };
  }));

  app.post('/api/v3/admin/webauthn/registration/verify', {
    preHandler: tailnetOnly, bodyLimit: 32_768,
    schema: { body: { type: 'object', required: ['challengeId', 'credential'], properties: {
      challengeId: { type: 'string', minLength: 20, maxLength: 96 }, name: { type: 'string', minLength: 1, maxLength: 64 }, credential: { type: 'object' },
    }, additionalProperties: false } },
  }, ceremony('admin-registration', async (request, reply) => {
    if (!enrollmentAuthorization(request, reply)) return reply;
    const row = consumeChallenge(request.body.challengeId, 'create', request);
    if (request.adminSession && row.principalId !== request.adminSession.principalId) throw new SecurityAdminError('admin-principal-invalid', 403);
    const verified = verifyWebAuthnRegistration({ credential: request.body.credential, challengeHash: row.challengeHash, origin: row.expectedOrigin, rpId: row.rpId });
    const name = String(request.body.name ?? 'Admin passkey').trim().slice(0, 64) || 'Admin passkey';
    const transportList = transports(request.body.credential.response?.transports);
    try {
      db.prepare(`INSERT INTO admin_webauthn_credentials(credential_id,principal_id,rp_id,name,public_key_pem,algorithm,sign_count,backup_eligible,backup_state,transports_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(verified.credentialId, row.principalId, row.rpId, name, verified.publicKeyPem, verified.algorithm, verified.signCount,
        verified.backupEligible ? 1 : 0, verified.backupState ? 1 : 0, JSON.stringify(transportList), timestamp());
    } catch (error) {
      if (String(error?.code).startsWith('SQLITE_CONSTRAINT')) throw new SecurityAdminError('webauthn-credential-exists', 409);
      throw error;
    }
    let bootstrapDestroyed = request.adminEnrollmentKind !== 'bootstrap' || Boolean(bootstrapSecret);
    if (request.adminEnrollmentKind === 'bootstrap' && existsSync(bootstrapPath)) {
      try { unlinkSync(bootstrapPath); bootstrapDestroyed = true; } catch { /* restart cleanup handles the stale file */ }
    }
    audit('admin-credential-registered', { credentialId: verified.credentialId, name, transports: transportList, bootstrapDestroyed, ip: request.adminClientAddress }, request.adminSession?.credentialId);
    return { registered: true, credentialId: verified.credentialId, bootstrapConsumed: request.adminEnrollmentKind === 'bootstrap', bootstrapDestroyed };
  }));

  app.post('/api/v3/admin/webauthn/authentication/options', {
    preHandler: tailnetOnly, bodyLimit: 256,
    schema: { body: { type: 'object', additionalProperties: false } },
  }, ceremony('admin-authentication-options', async (request, reply) => {
    const configuration = configured(request, reply);
    if (!configuration) return reply;
    const admin = db.prepare('SELECT principal_id AS principalId FROM admin_principals ORDER BY created_at LIMIT 1').get();
    const credentials = db.prepare('SELECT credential_id AS id,transports_json AS transportsJson FROM admin_webauthn_credentials WHERE disabled_at IS NULL AND rp_id=? ORDER BY created_at').all(configuration.rpId);
    if (!admin || credentials.length === 0) return reply.code(409).send({ error: 'admin-credential-not-enrolled' });
    const issued = issueChallenge('get', admin.principalId, request, configuration);
    return {
      challengeId: issued.challengeId,
      expiresAt: issued.expiresAt,
      publicKey: {
        challenge: issued.challenge,
        rpId: configuration.rpId,
        timeout: CHALLENGE_TTL_MS,
        userVerification: 'required',
        allowCredentials: credentials.map((row) => ({ type: 'public-key', id: row.id, transports: JSON.parse(row.transportsJson) })),
      },
    };
  }));

  app.post('/api/v3/admin/webauthn/authentication/verify', {
    preHandler: tailnetOnly, bodyLimit: 16_384,
    schema: { body: { type: 'object', required: ['challengeId', 'credential'], properties: {
      challengeId: { type: 'string', minLength: 20, maxLength: 96 }, credential: { type: 'object' },
    }, additionalProperties: false } },
  }, ceremony('admin-authentication', async (request, reply) => {
    const row = consumeChallenge(request.body.challengeId, 'get', request);
    const credentialId = String(request.body.credential?.id ?? '');
    const stored = db.prepare(`SELECT credential_id AS credentialId,principal_id AS principalId,rp_id AS rpId,public_key_pem AS publicKeyPem,sign_count AS signCount
      FROM admin_webauthn_credentials WHERE credential_id=? AND disabled_at IS NULL`).get(credentialId);
    if (!stored || stored.principalId !== row.principalId || stored.rpId !== row.rpId) throw new SecurityAdminError('webauthn-credential-invalid', 401);
    const admin = db.prepare('SELECT user_handle AS userHandle FROM admin_principals WHERE principal_id=?').get(stored.principalId);
    const verified = verifyWebAuthnAuthentication({ credential: request.body.credential, challengeHash: row.challengeHash, origin: row.expectedOrigin, rpId: row.rpId, storedCredential: { ...stored, userHandle: admin.userHandle } });
    const rawToken = randomBytes(36).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const createdAt = timestamp();
    const expiresAt = new Date(now().getTime() + SESSION_TTL_MS).toISOString();
    db.transaction(() => {
      db.prepare('UPDATE admin_webauthn_credentials SET sign_count=?,backup_eligible=?,backup_state=?,last_used_at=? WHERE credential_id=?')
        .run(verified.signCount, verified.backupEligible ? 1 : 0, verified.backupState ? 1 : 0, createdAt, credentialId);
      db.prepare(`INSERT INTO admin_sessions(session_id,principal_id,credential_id,token_hash,csrf_token,expires_at,created_at,last_seen_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(identifier('admses'), stored.principalId, credentialId, digest(rawToken), csrfToken, expiresAt, createdAt, createdAt);
    })();
    audit('admin-authentication-succeeded', { credentialId, counterSupported: verified.counterSupported, ip: request.adminClientAddress }, credentialId);
    reply.header('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    return { authenticated: true, csrfToken, expiresAt };
  }));

  app.post('/api/v3/admin/session/logout', { preHandler: [tailnetOnly, requireAdmin] }, async (request, reply) => {
    db.prepare('UPDATE admin_sessions SET revoked_at=? WHERE session_id=?').run(timestamp(), request.adminSession.sessionId);
    audit('admin-session-logout', { ip: request.adminClientAddress }, request.adminSession.credentialId);
    reply.header('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return { ok: true };
  });

  app.get('/api/v3/admin/signing/status', { preHandler: [tailnetOnly, requireAdmin] }, async () => signingKeyring.metadata());
  const backendDiagnosticContext = (request) => ({
    principal: { kind: 'admin', id: request.adminSession.credentialId },
    tailnet: true,
    webauthnVerified: true,
    capabilities: ['backend:diagnostics'],
  });
  app.get('/api/v3/admin/backend-capabilities', { preHandler: [tailnetOnly, requireAdmin] }, async (request, reply) => {
    if (!backendCapabilities) return reply.code(503).send({ error: 'backend-capabilities-unavailable' });
    return backendCapabilities.diagnostics(backendDiagnosticContext(request));
  });
  app.post('/api/v3/admin/backend-capabilities/probe', {
    preHandler: [tailnetOnly, requireAdmin], bodyLimit: 2_048,
    schema: { body: {
      type: 'object', properties: {
        subjects: {
          type: 'array', minItems: 1, maxItems: 25, uniqueItems: true,
          items: { type: 'string', minLength: 3, maxLength: 48, pattern: '^[a-z][a-z0-9-]+$' },
        },
      }, additionalProperties: false,
    } },
  }, async (request, reply) => {
    if (!backendCapabilities) return reply.code(503).send({ error: 'backend-capabilities-unavailable' });
    const report = backendCapabilities.diagnostics(backendDiagnosticContext(request));
    const available = new Map(report.subjects.map((subject) => [subject.key, subject]));
    const requested = request.body.subjects ?? report.subjects.map((subject) => subject.key);
    const unknown = requested.find((subject) => !available.has(subject));
    if (unknown) return reply.code(400).send({ error: 'backend-capability-unknown' });
    const checks = requested.map((key) => {
      const diagnostic = available.get(key);
      const persisted = backendCapabilities.repository.stats(key);
      const healthy = Number.isInteger(persisted.revision) && persisted.revision >= 1
        && persisted.revision === diagnostic.revision
        && Number.isInteger(persisted.receipts) && persisted.receipts >= 0
        && Number.isInteger(persisted.commits) && persisted.commits >= persisted.receipts
        && Number.isInteger(persisted.publications) && persisted.publications >= 0;
      return {
        key, healthy, revision: persisted.revision, receipts: persisted.receipts,
        commits: persisted.commits, publications: persisted.publications,
      };
    });
    const result = {
      schemaVersion: report.schemaVersion,
      healthy: checks.every((check) => check.healthy),
      checked: checks.length,
      checks,
    };
    audit('backend-capabilities-probed', {
      subjects: requested, healthy: result.healthy, ip: request.adminClientAddress,
    }, request.adminSession.credentialId);
    return result;
  });
  app.post('/api/v3/admin/signing/rotate', {
    preHandler: [tailnetOnly, requireAdmin], bodyLimit: 256,
    schema: { body: { type: 'object', required: ['confirmation'], properties: { confirmation: { const: 'ROTATE' } }, additionalProperties: false } },
  }, async (request) => {
    audit('content-signing-key-rotation-requested', { activeKeyId: signingKeyring.metadata().activeKeyId, ip: request.adminClientAddress }, request.adminSession.credentialId);
    const rotated = signingKeyring.rotate();
    audit('content-signing-key-rotated', { previousKeyId: rotated.previousKeyId, activeKeyId: rotated.activeKeyId, ip: request.adminClientAddress }, request.adminSession.credentialId);
    return rotated;
  });

  app.get('/api/v3/admin/live/config', { preHandler: [tailnetOnly, requireAdmin] }, async (_request, reply) => {
    if (!liveConfigAdmin) return reply.code(503).send({ error: 'live-config-admin-unavailable' });
    return liveConfigAdmin.status();
  });
  app.post('/api/v3/admin/live/config/publish', {
    preHandler: [tailnetOnly, requireAdmin], bodyLimit: 32_768,
    schema: { body: {
      type: 'object', required: ['idempotencyKey', 'config'], properties: {
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
        config: { type: 'object' },
      }, additionalProperties: false,
    } },
  }, async (request, reply) => {
    if (!liveConfigAdmin) return reply.code(503).send({ error: 'live-config-admin-unavailable' });
    try {
      const result = liveConfigAdmin.publish({
        config: request.body.config,
        idempotencyKey: request.body.idempotencyKey,
        actor: request.adminSession.credentialId,
      });
      audit('live-config-published', {
        revision: result.revision, duplicate: result.duplicate, season: result.current.season,
        ip: request.adminClientAddress,
      }, request.adminSession.credentialId);
      return result;
    } catch (error) {
      return reply.code(error.statusCode ?? 400).send({ error: error.message ?? 'live-config-invalid' });
    }
  });
  app.post('/api/v3/admin/live/config/rollback', {
    preHandler: [tailnetOnly, requireAdmin], bodyLimit: 1_024,
    schema: { body: {
      type: 'object', required: ['idempotencyKey', 'targetRevision'], properties: {
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 96, pattern: '^[A-Za-z0-9._:-]+$' },
        targetRevision: { type: 'integer', minimum: 1, maximum: 2147483647 },
      }, additionalProperties: false,
    } },
  }, async (request, reply) => {
    if (!liveConfigAdmin) return reply.code(503).send({ error: 'live-config-admin-unavailable' });
    try {
      const result = liveConfigAdmin.rollback({
        targetRevision: request.body.targetRevision,
        idempotencyKey: request.body.idempotencyKey,
        actor: request.adminSession.credentialId,
      });
      audit('live-config-rolled-back', {
        revision: result.revision, targetRevision: request.body.targetRevision, duplicate: result.duplicate,
        ip: request.adminClientAddress,
      }, request.adminSession.credentialId);
      return result;
    } catch (error) {
      return reply.code(error.statusCode ?? 400).send({ error: error.message ?? 'live-config-rollback-failed' });
    }
  });

  app.get('/api/v3/admin/audit', { preHandler: [tailnetOnly, requireAdmin] }, async (request) => {
    const requestedLimit = Number(request.query?.limit);
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(200, requestedLimit)) : 100;
    const rows = db.prepare(`SELECT sequence,event_id AS eventId,actor_credential_id AS actorCredentialId,event_type AS eventType,detail_json AS detailJson,
      previous_hash AS previousHash,entry_hash AS entryHash,key_id AS keyId,signature,created_at AS createdAt
      FROM admin_security_audit ORDER BY sequence ASC`).all();
    const retainedKeyIds = new Set(signingKeyring.metadata().verificationKeyIds);
    let prior = '0'.repeat(64); let chainValid = true; let retainedSignaturesValid = true;
    const verified = rows.map((row) => {
      let detail;
      try { detail = JSON.parse(row.detailJson); } catch { detail = null; }
      const payload = { sequence: row.sequence, eventId: row.eventId, actorCredentialId: row.actorCredentialId, eventType: row.eventType, detail, previousHash: row.previousHash, createdAt: row.createdAt };
      const expectedHash = digest(signingCanonicalJson(payload));
      const hashValid = row.previousHash === prior && safeEqual(expectedHash, row.entryHash);
      const signatureRetained = retainedKeyIds.has(row.keyId);
      const signatureValid = signatureRetained
        ? row.keyId === row.signature.split('.')[0] && signingKeyring.verifyMessage(row.signature, row.entryHash, 'admin-audit')
        : null;
      chainValid = chainValid && hashValid;
      retainedSignaturesValid = retainedSignaturesValid && signatureValid !== false;
      prior = row.entryHash;
      return { ...row, detail, detailJson: undefined, hashValid, signatureRetained, signatureValid };
    });
    return { chainValid, retainedSignaturesValid, total: verified.length, events: verified.slice(-limit).reverse() };
  });

  return Object.freeze({
    bootstrapPath,
    configured: Boolean(configuredOrigin && configuredRp),
    rpId: configuredRp,
    audit,
  });
}
