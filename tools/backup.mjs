import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createSigningKeyring } from '../server/signing-keyring.mjs';

const MAGIC = Buffer.from('PAOPAO-BACKUP-V1\n', 'ascii');
const projectRoot = resolve(import.meta.dirname, '..');
const backupDirectory = resolve(process.env.PAOPAO_BACKUP_DIR ?? join(projectRoot, 'backups'));
const dataDirectory = resolve(process.env.PAOPAO_DATA_DIR ?? join(projectRoot, 'data'));
const releasesDirectory = resolve(process.env.PAOPAO_RELEASES_DIR ?? join(projectRoot, 'releases'));
const passphrase = process.env.PAOPAO_BACKUP_PASSPHRASE ?? '';
const keyId = String(process.env.PAOPAO_BACKUP_KEY_ID ?? 'local-primary').slice(0, 64);
const command = process.argv[2] ?? 'verify';
const RESTORABLE_DATA_FILES = new Map([
  ['data/paopao.sqlite', 'paopao.sqlite'],
  ['data/.session-secret', '.session-secret'],
  ['data/.content-signing-keyring.json', '.content-signing-keyring.json'],
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requirePassphrase() {
  if (Buffer.byteLength(passphrase, 'utf8') < 16) throw new Error('PAOPAO_BACKUP_PASSPHRASE must contain at least 16 bytes');
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep));
}

function audit(action, details) {
  mkdirSync(backupDirectory, { recursive: true });
  const path = join(backupDirectory, 'audit.jsonl');
  let previousHash = '0'.repeat(64);
  if (existsSync(path)) {
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line); const { entryHash, ...body } = entry;
      if (body.previousHash !== previousHash || entryHash !== sha256(JSON.stringify(body))) {
        throw new Error('backup audit trail integrity check failed');
      }
      previousHash = entryHash;
    }
  }
  const body = { at: new Date().toISOString(), action, keyId, previousHash, ...details };
  const entry = { ...body, entryHash: sha256(JSON.stringify(body)) };
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function encrypt(payload) {
  const salt = randomBytes(16); const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(contents) {
  if (contents.length < MAGIC.length + 44 || !contents.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a PaoPao encrypted backup');
  const saltStart = MAGIC.length; const ivStart = saltStart + 16; const tagStart = ivStart + 12; const dataStart = tagStart + 16;
  const key = scryptSync(passphrase, contents.subarray(saltStart, ivStart), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = createDecipheriv('aes-256-gcm', key, contents.subarray(ivStart, tagStart));
  decipher.setAAD(MAGIC); decipher.setAuthTag(contents.subarray(tagStart, dataStart));
  return Buffer.concat([decipher.update(contents.subarray(dataStart)), decipher.final()]);
}

function packedFile(path, logicalPath) {
  const data = readFileSync(path);
  return { path: logicalPath, bytes: data.length, sha256: sha256(data), data: data.toString('base64') };
}

function validateBundle(bundle) {
  if (![1, 2].includes(bundle?.schemaVersion) || !Array.isArray(bundle.files) || typeof bundle.createdAt !== 'string') throw new Error('backup payload schema is invalid');
  const paths = new Set();
  for (const file of bundle.files) {
    if (!file || typeof file.path !== 'string' || paths.has(file.path) || ![...RESTORABLE_DATA_FILES.keys(), 'releases/state.json', 'releases/release-manifest.json'].includes(file.path)) {
      throw new Error('backup contains an invalid or duplicate file path');
    }
    paths.add(file.path);
    const data = Buffer.from(String(file.data ?? ''), 'base64');
    if (data.length !== file.bytes || sha256(data) !== file.sha256) throw new Error(`backup integrity failed for ${file.path}`);
  }
  if (!paths.has('data/paopao.sqlite')) throw new Error('backup does not contain the SQLite snapshot');
  if (bundle.schemaVersion === 2) {
    if (bundle.releaseStatePolicy !== 'reference-only') throw new Error('backup release-state policy is invalid');
    if (paths.has('releases/state.json') || paths.has('releases/release-manifest.json')) {
      throw new Error('schema 2 backups must not embed mutable release state');
    }
    if (bundle.releaseReference !== null && (
      typeof bundle.releaseReference !== 'object'
      || !/^r[1-5]-[a-z0-9][a-z0-9.-]{1,62}$/.test(bundle.releaseReference.active ?? '')
      || !/^[a-f0-9]{64}$/.test(bundle.releaseReference.contentSha256 ?? '')
    )) throw new Error('backup release reference is invalid');
  }
  return bundle;
}

function readBundle(path) {
  requirePassphrase();
  return validateBundle(JSON.parse(decrypt(readFileSync(path)).toString('utf8')));
}

async function createBackup(outputArgument) {
  requirePassphrase();
  mkdirSync(backupDirectory, { recursive: true });
  const sourceDatabase = join(dataDirectory, 'paopao.sqlite');
  if (!existsSync(sourceDatabase)) throw new Error(`database not found at ${sourceDatabase}`);
  const snapshot = join(backupDirectory, `.snapshot-${process.pid}-${Date.now()}.sqlite`);
  const database = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
  try { await database.backup(snapshot); } finally { database.close(); }
  const files = [packedFile(snapshot, 'data/paopao.sqlite')];
  unlinkSync(snapshot);
  const serverSecret = join(dataDirectory, '.session-secret');
  if (existsSync(serverSecret)) files.push(packedFile(serverSecret, 'data/.session-secret'));
  const signingKeyring = join(dataDirectory, '.content-signing-keyring.json');
  if (existsSync(signingKeyring)) files.push(packedFile(signingKeyring, 'data/.content-signing-keyring.json'));

  let releaseReference = null;
  const statePath = join(releasesDirectory, 'state.json');
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (/^r[1-5]-[a-z0-9][a-z0-9.-]{1,62}$/.test(state.active ?? '')) {
      const manifestPath = resolve(releasesDirectory, state.active, 'release-manifest.json');
      if (isInside(releasesDirectory, manifestPath) && existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.releaseId === state.active && /^[a-f0-9]{64}$/.test(manifest.contentSha256 ?? '')
          && (!state.contentSha256 || state.contentSha256 === manifest.contentSha256)) {
          releaseReference = { active: state.active, contentSha256: manifest.contentSha256 };
        }
      }
    }
  }
  // Release artifacts are immutable deployment inputs, not mutable backup data. The
  // active pointer is intentionally reference-only so a database restore can never
  // point at a release directory that was not restored with it.
  const bundle = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    keyId,
    releaseStatePolicy: 'reference-only',
    releaseReference,
    files,
  };
  const output = resolve(outputArgument ?? join(backupDirectory, `paopao-${bundle.createdAt.replace(/[:.]/g, '-')}.pbackup`));
  if (existsSync(output)) throw new Error('backup destination already exists');
  mkdirSync(dirname(output), { recursive: true });
  const encrypted = encrypt(Buffer.from(JSON.stringify(bundle)));
  writeFileSync(output, encrypted, { flag: 'wx', mode: 0o600 });
  const backupSha256 = sha256(encrypted);
  audit('create', { file: output, bytes: encrypted.length, sha256: backupSha256, files: files.length });
  console.log(JSON.stringify({ ok: true, file: output, bytes: encrypted.length, sha256: backupSha256, files: files.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })) }, null, 2));
  return output;
}

function verifyBackup(pathArgument) {
  const path = resolve(pathArgument ?? '');
  if (!pathArgument || !existsSync(path)) throw new Error('verify requires an existing .pbackup path');
  const contents = readFileSync(path); const bundle = readBundle(path);
  audit('verify', { file: path, bytes: contents.length, sha256: sha256(contents), createdAt: bundle.createdAt });
  console.log(JSON.stringify({ ok: true, file: path, sha256: sha256(contents), createdAt: bundle.createdAt, keyId: bundle.keyId, files: bundle.files.map(({ path: name, bytes, sha256: hash }) => ({ path: name, bytes, sha256: hash })) }, null, 2));
}

function validateSqlite(path) {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('restored SQLite quick_check failed');
  } finally {
    database.close();
  }
}

function restoreBackup(pathArgument, options = {}) {
  const targetDataDirectory = resolve(options.dataDirectory ?? dataDirectory);
  const requireConfirmation = options.requireConfirmation !== false;
  if (requireConfirmation && (process.argv[4] !== '--confirm-paopao-restore' || process.env.PAOPAO_RESTORE_OFFLINE !== '1')) {
    throw new Error('restore requires --confirm-paopao-restore and PAOPAO_RESTORE_OFFLINE=1 after stopping the server');
  }
  const path = resolve(pathArgument ?? '');
  if (!pathArgument || !existsSync(path)) throw new Error('restore requires an existing .pbackup path');
  const bundle = readBundle(path); const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const restoreFiles = bundle.files.filter((file) => RESTORABLE_DATA_FILES.has(file.path));
  const prepared = [];
  try {
    for (const file of restoreFiles) {
      const target = join(targetDataDirectory, RESTORABLE_DATA_FILES.get(file.path));
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.restore-${process.pid}-${Date.now()}.tmp`;
      writeFileSync(temporary, Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o600 });
      if (file.path === 'data/paopao.sqlite') validateSqlite(temporary);
      if (file.path === 'data/.session-secret' && Buffer.byteLength(readFileSync(temporary, 'utf8').trim()) < 32) {
        throw new Error('restored session secret is invalid');
      }
      if (file.path === 'data/.content-signing-keyring.json') {
        createSigningKeyring({ path: temporary, seedSecret: 'unused-existing-keyring-validation-secret' });
      }
      prepared.push({
        target,
        temporary,
        recovery: existsSync(target) ? `${target}.pre-restore-${timestamp}` : null,
        movedOriginal: false,
        installed: false,
      });
    }
    try {
      for (const entry of prepared) {
        if (entry.recovery) {
          renameSync(entry.target, entry.recovery);
          entry.movedOriginal = true;
        }
      }
      for (const entry of prepared) {
        renameSync(entry.temporary, entry.target);
        entry.installed = true;
      }
    } catch (error) {
      for (const entry of prepared) {
        if (entry.installed && existsSync(entry.target)) unlinkSync(entry.target);
        if (entry.movedOriginal && existsSync(entry.recovery)) copyFileSync(entry.recovery, entry.target);
      }
      throw error;
    }
  } finally {
    for (const entry of prepared) {
      if (existsSync(entry.temporary)) unlinkSync(entry.temporary);
    }
  }
  audit(options.auditAction ?? 'restore', {
    file: path,
    sha256: sha256(readFileSync(path)),
    createdAt: bundle.createdAt,
    releaseStatePolicy: 'reference-only',
  });
  const result = {
    ok: true,
    restoredFrom: path,
    createdAt: bundle.createdAt,
    recoveryCopies: prepared.some((entry) => entry.recovery),
    releaseStateRestored: false,
    releaseReference: bundle.releaseReference ?? null,
  };
  console.log(JSON.stringify(result, null, 2));
  return { bundle, result };
}

async function drillBackup(outputArgument) {
  const output = await createBackup(outputArgument);
  verifyBackup(output);
  const drillRoot = mkdtempSync(join(tmpdir(), 'paopao-restore-drill-'));
  try {
    const drillData = join(drillRoot, 'data');
    const { bundle } = restoreBackup(output, {
      dataDirectory: drillData,
      requireConfirmation: false,
      auditAction: 'drill-restore',
    });
    const databaseEvidence = bundle.files.find((file) => file.path === 'data/paopao.sqlite');
    const restoredDatabase = join(drillData, 'paopao.sqlite');
    validateSqlite(restoredDatabase);
    if (sha256(readFileSync(restoredDatabase)) !== databaseEvidence.sha256) throw new Error('restore drill database hash mismatch');
    const secretEvidence = bundle.files.find((file) => file.path === 'data/.session-secret');
    if (secretEvidence && sha256(readFileSync(join(drillData, '.session-secret'))) !== secretEvidence.sha256) {
      throw new Error('restore drill session-secret hash mismatch');
    }
    const keyringEvidence = bundle.files.find((file) => file.path === 'data/.content-signing-keyring.json');
    if (keyringEvidence && sha256(readFileSync(join(drillData, '.content-signing-keyring.json'))) !== keyringEvidence.sha256) {
      throw new Error('restore drill signing-keyring hash mismatch');
    }
    if (existsSync(join(drillRoot, 'releases', 'state.json'))) throw new Error('restore drill created a dangling release state');
    audit('drill-complete', {
      file: output,
      databaseSha256: databaseEvidence.sha256,
      sessionSecretVerified: Boolean(secretEvidence),
      signingKeyringVerified: Boolean(keyringEvidence),
      releaseStateRestored: false,
    });
    console.log(JSON.stringify({
      ok: true,
      drill: 'isolated-create-verify-restore',
      databaseSha256: databaseEvidence.sha256,
      sessionSecretVerified: Boolean(secretEvidence),
      signingKeyringVerified: Boolean(keyringEvidence),
      releaseStateRestored: false,
    }, null, 2));
  } finally {
    rmSync(drillRoot, { recursive: true, force: true });
  }
}

try {
  if (command === 'create') await createBackup(process.argv[3]);
  else if (command === 'verify') verifyBackup(process.argv[3]);
  else if (command === 'restore') restoreBackup(process.argv[3]);
  else if (command === 'drill') await drillBackup(process.argv[3]);
  else throw new Error('use create, verify, restore, or drill');
} catch (error) {
  console.error(`backup: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
