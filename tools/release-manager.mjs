import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { auditLedgerEvidence, loadLedgerEvidenceFiles } from './ledger-evidence-lib.mjs';
import { assertPhaserReleaseProfile } from './release-profile-lib.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const releasesRoot = resolve(process.env.PAOPAO_RELEASES_DIR ?? join(projectRoot, 'releases'));
const statePath = join(releasesRoot, 'state.json');
const ledgerPath = resolve(process.env.PAOPAO_UPGRADE_LEDGER ?? join(projectRoot, 'docs', 'production', 'upgrade-ledger.json'));
const command = process.argv[2] ?? 'status';
const stateHistoryLimit = 64;

function fail(message) {
  console.error(`release-manager: ${message}`);
  process.exitCode = 1;
}

function releaseId(value) {
  const id = String(value ?? '').trim();
  if (!/^r[1-5]-[a-z0-9][a-z0-9.-]{1,62}$/.test(id)) {
    throw new Error('release ID must match r1-name through r5-name');
  }
  return id;
}

function releaseNumber(id) {
  return Number(/^r([1-5])-/.exec(releaseId(id))[1]);
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

function filesUnder(root, current = root) {
  const output = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(current, entry.name);
    const details = lstatSync(path);
    if (details.isSymbolicLink()) throw new Error(`release tree contains a symbolic link at ${relative(root, path)}`);
    if (details.isDirectory()) output.push(...filesUnder(root, path));
    else if (details.isFile()) output.push(path);
    else throw new Error(`release tree contains an unsupported filesystem entry at ${relative(root, path)}`);
  }
  return output;
}

function digestFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function contentManifest(clientRoot, id) {
  const files = filesUnder(clientRoot).map((path) => ({
    path: relative(clientRoot, path).split(sep).join('/'),
    bytes: statSync(path).size,
    sha256: digestFile(path),
  }));
  const contentSha256 = createHash('sha256')
    .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''))
    .digest('hex');
  return {
    schemaVersion: 2,
    releaseId: id,
    releaseNumber: releaseNumber(id),
    client: 'phaser',
    engine: 'phaser-3.90.0',
    routes: ['/', '/classic/', '/downloads/'],
    cacheNamespace: `paopao-fusion-release-${id}`,
    createdAt: new Date().toISOString(),
    contentSha256,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
}

function releasePath(id) {
  const path = resolve(releasesRoot, releaseId(id));
  if (!inside(releasesRoot, path)) throw new Error('release path escaped the releases directory');
  return path;
}

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function verifyClientGate(clientRoot, id, { production = false } = {}) {
  const launcherPath = join(clientRoot, 'index.html');
  const classicPath = join(clientRoot, 'classic', 'index.html');
  const downloadsPath = join(clientRoot, 'downloads', 'index.html');
  const workerPath = join(clientRoot, 'sw.js');
  const webManifestPath = join(clientRoot, 'manifest.webmanifest');
  const profilePath = join(clientRoot, 'release-profile.json');
  const excluded3dRoot = join(clientRoot, '3d');
  const requiredFiles = [launcherPath, classicPath, downloadsPath, ...(production ? [workerPath, webManifestPath, profilePath] : [])];
  if (!requiredFiles.every((path) => existsSync(path) && statSync(path).isFile())) {
    throw new Error(`${id} is missing the root launcher, Phaser /classic client, or /downloads page`);
  }
  if (existsSync(excluded3dRoot)) {
    throw new Error(`${id} contains an excluded /3d tree; production releases are Phaser-only`);
  }
  const launcher = readFileSync(launcherPath, 'utf8');
  if (!['/classic/', '/downloads/'].every((route) => launcher.includes(route)) || launcher.includes('/3d')) {
    throw new Error(`${id} launcher must expose only the permanent Phaser and downloads routes`);
  }
  if (production) {
    const number = releaseNumber(id);
    const profile = readJson(profilePath);
    try { assertPhaserReleaseProfile(profile, number); }
    catch { throw new Error(`${id} release profile does not exactly match gate ${number}`); }
    const meta = `<meta name="paopao-release-gate" content="${number}"`;
    if (!launcher.includes(meta) || !readFileSync(classicPath, 'utf8').includes(meta)) {
      throw new Error(`${id} launcher and Phaser shell are not stamped for gate ${number}`);
    }
    const worker = readFileSync(workerPath, 'utf8');
    if (!worker.includes(`const CACHE_VERSION = 'release-${id}';`)) {
      throw new Error(`${id} service-worker cache namespace is not release-pinned`);
    }
    const webManifest = readJson(webManifestPath);
    if (!webManifest || webManifest.start_url !== './' || webManifest.scope !== './'
      || webManifest.display !== 'standalone' || !Array.isArray(webManifest.icons)) {
      throw new Error(`${id} has no valid installable Phaser web manifest`);
    }
  }
}

function specializeClientRelease(clientRoot, id) {
  const workerPath = join(clientRoot, 'sw.js');
  if (!existsSync(workerPath) || !statSync(workerPath).isFile()) {
    throw new Error(`${id} build is missing the Phaser service worker`);
  }
  const source = readFileSync(workerPath, 'utf8');
  const pattern = /const CACHE_VERSION = '[^']+';/;
  if (!pattern.test(source)) throw new Error(`${id} service worker has no controlled cache-version declaration`);
  writeFileSync(workerPath, source.replace(pattern, `const CACHE_VERSION = 'release-${id}';`));
}

function verifyLedgerGate(id) {
  const number = releaseNumber(id);
  const ledger = readJson(ledgerPath);
  if (ledger?.schemaVersion !== 3 || ledger.title !== 'PaoPao Fusion Level-100 Phaser Production Ledger'
    || ledger.total !== 3710 || ledger.itemsPerRelease !== 742
    || !Array.isArray(ledger.items) || !Array.isArray(ledger.releases)) {
    throw new Error(`release ${number} cannot activate without the valid 3,710-item production ledger`);
  }
  if (ledger.items.length !== 3710 || new Set(ledger.items.map((item) => item?.id)).size !== 3710
    || [1, 2, 3, 4, 5].some((release) => ledger.items.filter((item) => item?.release === release).length !== 742)) {
    throw new Error('production ledger IDs and five-release partition failed activation validation');
  }
  const gate = ledger.releases.find((entry) => entry?.release === number);
  const items = ledger.items.filter((item) => item?.release === number);
  if (gate?.state !== 'closed' || gate.requiredVerifiedItems !== 742 || items.length !== 742) {
    throw new Error(`release ${number} gate must be closed with exactly 742 assigned records`);
  }
  const { claims, receipt } = loadLedgerEvidenceFiles(projectRoot, ledger);
  const evidenceAudit = auditLedgerEvidence({ ledger, projectRoot, claims, receipt });
  const evidenceExists = (entry) => [...entry.paths, ...entry.tests].every((evidencePath) => {
    if (typeof evidencePath !== 'string' || evidencePath.length === 0) return false;
    const path = resolve(projectRoot, evidencePath);
    return inside(projectRoot, path) && existsSync(path);
  });
  const verified = items.filter((item) => {
    const evidence = item?.evidence;
    if (!evidence || Object.keys(evidence).sort().join(',') !== 'phaser,shared,status') return false;
    if (evidence?.status !== 'verified' || evidence.shared?.state !== 'verified'
      || !Array.isArray(evidence.shared.paths) || evidence.shared.paths.length === 0
      || !Array.isArray(evidence.shared.tests) || evidence.shared.tests.length === 0
      || !evidenceExists(evidence.shared)) return false;
    if (item.clientFacing !== true) {
      return evidence.phaser?.state === 'not-applicable';
    }
    return evidence.phaser?.state === 'verified'
      && Array.isArray(evidence.phaser.paths) && evidence.phaser.paths.length > 0
      && Array.isArray(evidence.phaser.tests) && evidence.phaser.tests.length > 0
      && evidenceExists(evidence.phaser);
  });
  if (verified.length !== 742) {
    throw new Error(`release ${number} has ${verified.length}/742 fully verified ledger records; activation is blocked`);
  }
  if (evidenceAudit.verifiedByRelease[number] !== 742) {
    throw new Error(`release ${number} has ${evidenceAudit.verifiedByRelease[number]}/742 machine-receipted ledger records; activation is blocked`);
  }
  return {
    release: number,
    verifiedItems: verified.length,
    ledgerSha256: digestFile(ledgerPath),
    evidenceReceiptSha256: digestFile(join(projectRoot, 'docs', 'production', 'evidence', 'receipts.json')),
  };
}

function verify(id, quiet = false) {
  const root = releasePath(id);
  const clientRoot = join(root, 'client');
  const manifest = readJson(join(root, 'release-manifest.json'));
  if (!manifest || manifest.releaseId !== id || ![1, 2].includes(manifest.schemaVersion) || !Array.isArray(manifest.files)) {
    throw new Error(`${id} has no valid release manifest`);
  }
  if (manifest.schemaVersion === 2 && (manifest.releaseNumber !== releaseNumber(id)
    || manifest.client !== 'phaser' || manifest.engine !== 'phaser-3.90.0'
    || JSON.stringify(manifest.routes) !== JSON.stringify(['/', '/classic/', '/downloads/'])
    || manifest.cacheNamespace !== `paopao-fusion-release-${id}`)) {
    throw new Error(`${id} has invalid Phaser release metadata`);
  }
  verifyClientGate(clientRoot, id, { production: manifest.schemaVersion === 2 });
  const manifestPaths = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || manifestPaths.has(file.path)
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`${id} contains a malformed manifest entry`);
    }
    manifestPaths.add(file.path);
    const path = resolve(clientRoot, file.path);
    if (!inside(clientRoot, path) || !existsSync(path) || statSync(path).size !== file.bytes || digestFile(path) !== file.sha256) {
      throw new Error(`${id} failed integrity verification at ${file.path}`);
    }
  }
  const regenerated = contentManifest(clientRoot, id);
  if (regenerated.contentSha256 !== manifest.contentSha256
    || regenerated.totalBytes !== manifest.totalBytes
    || JSON.stringify(regenerated.files) !== JSON.stringify(manifest.files)) {
    throw new Error(`${id} content address does not match its complete manifest`);
  }
  const verified = { ...manifest, manifestSha256: digestFile(join(root, 'release-manifest.json')) };
  if (!quiet) console.log(JSON.stringify({
    ok: true,
    releaseId: id,
    releaseNumber: releaseNumber(id),
    manifestSchemaVersion: manifest.schemaVersion,
    contentSha256: manifest.contentSha256,
    manifestSha256: verified.manifestSha256,
    files: manifest.files.length,
    totalBytes: manifest.totalBytes,
  }, null, 2));
  return verified;
}

function writeState(next) {
  mkdirSync(releasesRoot, { recursive: true });
  const temporary = join(releasesRoot, `.state-${process.pid}-${Date.now()}.json`);
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, statePath);
}

function emptyState() {
  return {
    schemaVersion: 2,
    revision: 0,
    active: null,
    previous: null,
    activatedAt: null,
    contentSha256: null,
    manifestSha256: null,
    ledgerVerifiedItems: 0,
    activatedReleases: [],
    history: [],
  };
}

function validateState(raw) {
  if (!raw || raw.schemaVersion !== 2 || !Number.isSafeInteger(raw.revision) || raw.revision < 0
    || !Array.isArray(raw.activatedReleases) || !Array.isArray(raw.history)
    || raw.activatedReleases.length > 5 || raw.history.length > stateHistoryLimit) {
    throw new Error('release state is not a valid schema-v2 activation record');
  }
  const releaseIds = new Set();
  const releaseNumbers = new Set();
  for (const record of raw.activatedReleases) {
    const id = releaseId(record?.releaseId);
    const number = releaseNumber(id);
    if (record.releaseNumber !== number || releaseIds.has(id) || releaseNumbers.has(number)
      || !/^[a-f0-9]{64}$/.test(record.contentSha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(record.manifestSha256 ?? '')
      || record.ledgerVerifiedItems !== 742
      || !/^[a-f0-9]{64}$/.test(record.ledgerSha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(record.evidenceReceiptSha256 ?? '')
      || Number.isNaN(Date.parse(record.firstActivatedAt ?? ''))) {
      throw new Error(`release state contains an invalid activation pin for ${id}`);
    }
    releaseIds.add(id);
    releaseNumbers.add(number);
  }
  let previousSequence = null;
  let previousEventSha256 = null;
  let simulatedActive = null;
  const activatedFromHistory = new Set();
  for (const event of raw.history) {
    const { eventSha256, ...unsigned } = event ?? {};
    if (!Number.isSafeInteger(event?.sequence) || event.sequence < 1
      || (previousSequence !== null && event.sequence !== previousSequence + 1)
      || !['activate', 'reactivate', 'rollback'].includes(event.action)
      || !/^[a-f0-9]{64}$/.test(eventSha256 ?? '')
      || digestJson(unsigned) !== eventSha256
      || (previousEventSha256 !== null && event.previousEventSha256 !== previousEventSha256)) {
      throw new Error('release state activation history failed integrity validation');
    }
    const to = releaseId(event.to);
    const from = event.from === null ? null : releaseId(event.from);
    const targetRecord = raw.activatedReleases.find((record) => record.releaseId === to);
    if (from !== simulatedActive || !targetRecord
      || event.contentSha256 !== targetRecord.contentSha256
      || event.manifestSha256 !== targetRecord.manifestSha256
      || Number.isNaN(Date.parse(event.at ?? ''))) {
      throw new Error('release state activation history does not match its immutable pins');
    }
    if (event.action === 'activate') {
      const requiredNumber = simulatedActive === null ? 1 : releaseNumber(simulatedActive) + 1;
      if (releaseNumber(to) !== requiredNumber || activatedFromHistory.has(to)) {
        throw new Error('release state contains an invalid gated activation transition');
      }
      activatedFromHistory.add(to);
    } else if (event.action === 'reactivate') {
      if (!activatedFromHistory.has(to) || simulatedActive === null
        || releaseNumber(to) !== releaseNumber(simulatedActive) + 1) {
        throw new Error('release state contains an invalid gated reactivation transition');
      }
    } else if (!activatedFromHistory.has(to) || simulatedActive === null
      || releaseNumber(to) >= releaseNumber(simulatedActive)) {
      throw new Error('release state contains an invalid rollback transition');
    }
    simulatedActive = to;
    previousSequence = event.sequence;
    previousEventSha256 = eventSha256;
  }
  if ((raw.history[0]?.sequence ?? 0) !== (raw.history.length === 0 ? 0 : 1)
    || (raw.history.at(-1)?.sequence ?? 0) !== raw.revision
    || activatedFromHistory.size !== raw.activatedReleases.length) {
    throw new Error('release state revision does not match its activation history');
  }
  if (raw.active === null) {
    if (raw.revision !== 0 || raw.activatedReleases.length !== 0) throw new Error('empty release state contains activation data');
    return raw;
  }
  const active = releaseId(raw.active);
  const activeRecord = raw.activatedReleases.find((record) => record.releaseId === active);
  const lastEvent = raw.history.at(-1);
  if (!activeRecord || simulatedActive !== active || raw.previous !== (lastEvent?.from ?? null)
    || raw.activatedAt !== lastEvent?.at || raw.contentSha256 !== activeRecord.contentSha256
    || raw.manifestSha256 !== activeRecord.manifestSha256 || raw.ledgerVerifiedItems !== 742
    || Number.isNaN(Date.parse(raw.activatedAt ?? ''))) {
    throw new Error('active release pointer does not match its immutable activation pin');
  }
  if (raw.previous !== null) releaseId(raw.previous);
  if (raw.previous !== null && !raw.activatedReleases.some((record) => record.releaseId === raw.previous)) {
    throw new Error('previous release pointer does not reference an activated release');
  }
  return raw;
}

function readState({ optional = false } = {}) {
  if (!existsSync(statePath)) return emptyState();
  const raw = readJson(statePath);
  try { return validateState(raw); }
  catch (error) {
    if (optional) return { error: error instanceof Error ? error.message : String(error), raw };
    throw error;
  }
}

function appendStateEvent(state, event) {
  if (state.history.length >= stateHistoryLimit) {
    throw new Error(`release activation history reached its ${stateHistoryLimit}-event safety bound; archive the state before another switch`);
  }
  const sequence = state.revision + 1;
  const unsigned = {
    sequence,
    ...event,
    previousEventSha256: state.history.at(-1)?.eventSha256 ?? null,
  };
  const next = [...state.history, { ...unsigned, eventSha256: digestJson(unsigned) }];
  return { sequence, history: next };
}

function assertPinnedRelease(record, manifest) {
  if (record.contentSha256 !== manifest.contentSha256 || record.manifestSha256 !== manifest.manifestSha256) {
    throw new Error(`${record.releaseId} no longer matches its immutable activation pin`);
  }
}

function stage() {
  const id = releaseId(process.argv[3]);
  const source = resolve(process.argv[4] ?? join(projectRoot, 'dist'));
  if (!existsSync(join(source, 'index.html'))
    || !existsSync(join(source, 'classic', 'index.html'))
    || !existsSync(join(source, 'downloads', 'index.html'))) {
    throw new Error(`build at ${source} is missing the launcher, Phaser /classic client, or /downloads page`);
  }
  if (existsSync(join(source, '3d'))) {
    throw new Error(`build at ${source} contains an excluded /3d tree; Phaser-only staging refused`);
  }
  mkdirSync(releasesRoot, { recursive: true });
  const destination = releasePath(id);
  if (existsSync(destination)) throw new Error(`${id} already exists; immutable releases are never overwritten`);
  const temporary = mkdtempSync(join(releasesRoot, `.stage-${id}-`));
  const clientRoot = join(temporary, 'client');
  let staged = false;
  try {
    cpSync(source, clientRoot, { recursive: true, errorOnExist: true, force: false });
    specializeClientRelease(clientRoot, id);
    verifyClientGate(clientRoot, id, { production: true });
    const manifest = contentManifest(clientRoot, id);
    writeFileSync(join(temporary, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, destination);
    staged = true;
    verify(id, true);
    console.log(JSON.stringify({
      staged: id,
      releaseNumber: releaseNumber(id),
      path: destination,
      contentSha256: manifest.contentSha256,
      manifestSha256: digestFile(join(destination, 'release-manifest.json')),
      files: manifest.files.length,
      activation: 'blocked-until-742-machine-receipted-items',
    }, null, 2));
  } finally {
    if (!staged && existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
  }
}

function activate() {
  const id = releaseId(process.argv[3]);
  const manifest = verify(id, true);
  if (manifest.schemaVersion !== 2) throw new Error(`${id} uses a legacy manifest and must be restaged before activation`);
  const current = readState();
  const number = releaseNumber(id);
  if (current.active === id) throw new Error(`${id} is already active`);
  if (number === 1) {
    if (current.active) throw new Error(`release 1 can activate only before any other active release; current is ${current.active}`);
  } else {
    const expected = number - 1;
    if (!current.active || releaseNumber(current.active) !== expected) {
      throw new Error(`${id} requires an active release ${expected} predecessor; current is ${current.active ?? 'none'}`);
    }
  }
  const ledgerGate = verifyLedgerGate(id);
  const existingNumber = current.activatedReleases.find((record) => record.releaseNumber === number);
  if (existingNumber && existingNumber.releaseId !== id) {
    throw new Error(`release ${number} is already pinned to ${existingNumber.releaseId}; a second artifact cannot replace it`);
  }
  if (existingNumber) assertPinnedRelease(existingNumber, manifest);
  const timestamp = new Date().toISOString();
  const record = existingNumber ?? {
    releaseId: id,
    releaseNumber: number,
    contentSha256: manifest.contentSha256,
    manifestSha256: manifest.manifestSha256,
    ledgerVerifiedItems: ledgerGate.verifiedItems,
    ledgerSha256: ledgerGate.ledgerSha256,
    evidenceReceiptSha256: ledgerGate.evidenceReceiptSha256,
    firstActivatedAt: timestamp,
  };
  const stateEvent = appendStateEvent(current, {
    action: existingNumber ? 'reactivate' : 'activate',
    from: current.active,
    to: id,
    at: timestamp,
    contentSha256: manifest.contentSha256,
    manifestSha256: manifest.manifestSha256,
  });
  const next = {
    schemaVersion: 2,
    revision: stateEvent.sequence,
    active: id,
    previous: current.active && current.active !== id ? current.active : current.previous ?? null,
    activatedAt: timestamp,
    contentSha256: manifest.contentSha256,
    manifestSha256: manifest.manifestSha256,
    ledgerVerifiedItems: ledgerGate.verifiedItems,
    activatedReleases: existingNumber
      ? current.activatedReleases
      : [...current.activatedReleases, record].sort((left, right) => left.releaseNumber - right.releaseNumber),
    history: stateEvent.history,
  };
  writeState(next);
  console.log(JSON.stringify(next, null, 2));
}

function rollback() {
  const current = readState();
  if (!current.active) throw new Error('no active release is available to roll back');
  const currentNumber = releaseNumber(current.active);
  const requested = process.argv[3] ? releaseId(process.argv[3]) : null;
  const eligible = current.activatedReleases
    .filter((record) => record.releaseNumber < currentNumber)
    .sort((left, right) => right.releaseNumber - left.releaseNumber);
  const target = requested
    ? eligible.find((record) => record.releaseId === requested)
    : eligible[0];
  if (!target) {
    throw new Error(requested
      ? `${requested} is not a previously activated lower release and cannot be a rollback target`
      : 'no previously activated lower release is available');
  }
  const manifest = verify(target.releaseId, true);
  assertPinnedRelease(target, manifest);
  const timestamp = new Date().toISOString();
  const stateEvent = appendStateEvent(current, {
    action: 'rollback',
    from: current.active,
    to: target.releaseId,
    at: timestamp,
    contentSha256: manifest.contentSha256,
    manifestSha256: manifest.manifestSha256,
  });
  const next = {
    schemaVersion: 2,
    revision: stateEvent.sequence,
    active: target.releaseId,
    previous: current.active,
    activatedAt: timestamp,
    rollbackOf: current.active,
    contentSha256: manifest.contentSha256,
    manifestSha256: manifest.manifestSha256,
    ledgerVerifiedItems: target.ledgerVerifiedItems,
    activatedReleases: current.activatedReleases,
    history: stateEvent.history,
  };
  writeState(next);
  console.log(JSON.stringify(next, null, 2));
}

function status() {
  const stateResult = readState({ optional: true });
  const releaseIds = existsSync(releasesRoot)
    ? readdirSync(releasesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^r[1-5]-/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    : [];
  const releases = releaseIds.map((id) => {
    try {
      const manifest = verify(id, true);
      return {
        releaseId: id,
        releaseNumber: releaseNumber(id),
        integrity: 'verified',
        manifestSchemaVersion: manifest.schemaVersion,
        activationEligibleManifest: manifest.schemaVersion === 2,
        contentSha256: manifest.contentSha256,
        manifestSha256: manifest.manifestSha256,
        files: manifest.files.length,
        totalBytes: manifest.totalBytes,
      };
    } catch (error) {
      return { releaseId: id, integrity: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  });
  let state;
  if (stateResult.error) {
    state = { integrity: 'failed', error: stateResult.error, active: stateResult.raw?.active ?? null };
  } else {
    try {
      if (stateResult.active) {
        const manifest = verify(stateResult.active, true);
        const record = stateResult.activatedReleases.find((entry) => entry.releaseId === stateResult.active);
        assertPinnedRelease(record, manifest);
      }
      state = { integrity: 'verified', ...stateResult };
    } catch (error) {
      state = {
        integrity: 'failed',
        error: error instanceof Error ? error.message : String(error),
        active: stateResult.active,
      };
    }
  }
  console.log(JSON.stringify({ releasesRoot, state, releases }, null, 2));
}

function verifyAll() {
  const releaseIds = existsSync(releasesRoot)
    ? readdirSync(releasesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^r[1-5]-/.test(entry.name))
      .map((entry) => releaseId(entry.name))
      .sort()
    : [];
  const manifests = releaseIds.map((id) => verify(id, true));
  console.log(JSON.stringify({
    ok: true,
    releases: manifests.map((manifest) => ({
      releaseId: manifest.releaseId,
      releaseNumber: releaseNumber(manifest.releaseId),
      contentSha256: manifest.contentSha256,
      manifestSha256: manifest.manifestSha256,
    })),
  }, null, 2));
}

function serve() {
  const id = releaseId(process.argv[3]);
  const port = Number(process.argv[4] ?? 4173);
  const host = process.argv[5] ?? '127.0.0.1';
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('preview port must be an integer from 1024 through 65535');
  if (!['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(host)) throw new Error('preview host must be localhost or an explicit loopback/all-interface address');
  const manifest = verify(id, true);
  console.log(JSON.stringify({
    serving: id,
    releaseNumber: releaseNumber(id),
    contentSha256: manifest.contentSha256,
    manifestSha256: manifest.manifestSha256,
    url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
    activationState: 'staged-preview-only',
  }, null, 2));
  const child = spawn(process.execPath, [
    join(projectRoot, 'tools', 'serve-dist.mjs'),
    join(releasePath(id), 'client'),
    String(port),
    host,
    id,
  ], { cwd: projectRoot, stdio: 'inherit', windowsHide: true });
  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  const onInterrupt = () => forwardSignal('SIGINT');
  const onTerminate = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  child.once('error', (error) => fail(`preview failed: ${error.message}`));
  child.once('exit', (code, signal) => {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    if (signal) fail(`preview stopped by ${signal}`);
    else process.exitCode = code ?? 1;
  });
}

try {
  if (command === 'stage') stage();
  else if (command === 'activate') activate();
  else if (command === 'rollback') rollback();
  else if (command === 'verify') verify(releaseId(process.argv[3]));
  else if (command === 'verify-all') verifyAll();
  else if (command === 'serve') serve();
  else if (command === 'status') status();
  else throw new Error(`unknown command ${basename(command)}; use stage, verify, verify-all, serve, activate, rollback, or status`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
