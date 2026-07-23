import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile, sha256File } from './ledger-evidence-lib.mjs';
import {
  canonicalJsonText,
  inspectRuntimePng,
  PRODUCTION_RUNTIME_BUDGETS,
  PRODUCTION_RUNTIME_GENERATOR_VERSION,
  PRODUCTION_RUNTIME_MANIFEST,
  sha256Buffer,
  validateProductionRuntime,
} from './production-runtime-lib.mjs';
import {
  PRODUCTION_MASTER_MANIFEST,
  validateProductionMasterManifest,
} from './production-master-evidence-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs', 'production', 'upgrade-ledger.json');
const manifestPath = resolve(projectRoot, PRODUCTION_RUNTIME_MANIFEST);
const itemsRoot = resolve(projectRoot, 'public', 'assets', 'production', 'items');
const command = process.argv[2] ?? 'build';

function atomicWrite(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, contents, { flag: 'wx' });
  renameSync(temporary, path);
}

function oldRuntimeEntries() {
  if (!existsSync(manifestPath)) return new Map();
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return new Map((Array.isArray(manifest.entries) ? manifest.entries : []).map((entry) => [entry.id, entry]));
  } catch { return new Map(); }
}

function ffmpegRaster(sourcePath, destinationPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    mkdirSync(dirname(destinationPath), { recursive: true });
    const temporary = `${destinationPath}.${process.pid}.${Date.now()}.png`;
    const windowsPathToWsl = (path) => {
      const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
      return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}` : path;
    };
    const ffmpegArguments = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1',
      '-width', String(PRODUCTION_RUNTIME_BUDGETS.imageMaxDimension),
      '-height', String(PRODUCTION_RUNTIME_BUDGETS.imageMaxDimension),
      '-keep_ar', '1', '-i', process.platform === 'win32' ? windowsPathToWsl(sourcePath) : sourcePath,
      '-frames:v', '1', '-compression_level', '9', '-pred', 'mixed', '-y',
      process.platform === 'win32' ? windowsPathToWsl(temporary) : temporary,
    ];
    const child = spawn(process.platform === 'win32' ? 'wsl.exe' : 'ffmpeg', [
      ...(process.platform === 'win32' ? ['-e', '/usr/bin/ffmpeg'] : []),
      ...ffmpegArguments,
    ], { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`ffmpeg rasterization failed for ${sourcePath}: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      renameSync(temporary, destinationPath);
      resolvePromise();
    });
  });
}

async function concurrentMap(items, concurrency, task) {
  let cursor = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function build() {
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const sourceAudit = validateProductionMasterManifest({ ledger, projectRoot, requireComplete: true });
  const itemById = new Map(ledger.items.filter(({ category }) => category === 'asset').map((item) => [item.id, item]));
  const previous = oldRuntimeEntries();
  const imageEntries = sourceAudit.manifest.entries.filter(({ format }) => format === 'svg');
  const jsonEntries = sourceAudit.manifest.entries.filter(({ format }) => format === 'json');
  let reused = 0;
  let rendered = 0;

  for (const source of jsonEntries) {
    const path = resolve(itemsRoot, `${source.id}.json`);
    const canonical = canonicalJsonText(JSON.parse(readFileSync(resolve(projectRoot, source.path), 'utf8')));
    const expectedHash = sha256Buffer(canonical);
    const prior = previous.get(source.id);
    if (prior?.source?.sha256 === source.sha256 && prior?.runtime?.sha256 === expectedHash
      && existsSync(path) && sha256File(path) === expectedHash) reused += 1;
    else atomicWrite(path, canonical);
  }

  const workers = Math.min(6, Math.max(1, Number.parseInt(process.env.PAOPAO_RASTER_WORKERS ?? '4', 10) || 4));
  await concurrentMap(imageEntries, workers, async (source) => {
    const path = resolve(itemsRoot, `${source.id}.png`);
    const prior = previous.get(source.id);
    if (prior?.source?.sha256 === source.sha256 && existsSync(path)
      && prior?.runtime?.sha256 === sha256File(path)) {
      inspectRuntimePng(readFileSync(path), source.id);
      reused += 1;
      return;
    }
    await ffmpegRaster(resolve(projectRoot, source.path), path);
    const bytes = readFileSync(path);
    inspectRuntimePng(bytes, source.id);
    if (bytes.length > PRODUCTION_RUNTIME_BUDGETS.imageMaxBytes) {
      throw new Error(`${source.id} runtime raster is ${bytes.length} bytes, above ${PRODUCTION_RUNTIME_BUDGETS.imageMaxBytes}`);
    }
    rendered += 1;
  });

  const entries = sourceAudit.manifest.entries.map((source) => {
    const image = source.format === 'svg';
    const extension = image ? 'png' : 'json';
    const path = resolve(itemsRoot, `${source.id}.${extension}`);
    const buffer = readFileSync(path);
    const dimensions = image ? inspectRuntimePng(buffer, source.id) : null;
    return {
      id: source.id,
      title: itemById.get(source.id).title,
      allocation: source.allocation,
      release: source.release,
      source: {
        path: source.path,
        format: source.format,
        bytes: source.bytes,
        sha256: source.sha256,
      },
      runtime: {
        path: `/assets/production/items/${source.id}.${extension}`,
        format: extension,
        kind: image ? 'image' : 'semantic-json',
        mimeType: image ? 'image/png' : 'application/json',
        bytes: buffer.length,
        sha256: sha256Buffer(buffer),
        byteBudget: image ? PRODUCTION_RUNTIME_BUDGETS.imageMaxBytes : PRODUCTION_RUNTIME_BUDGETS.jsonMaxBytes,
        ...(dimensions ?? {}),
      },
    };
  });
  const runtimeBytes = entries.reduce((sum, entry) => sum + entry.runtime.bytes, 0);
  const manifest = {
    schemaVersion: 1,
    generatorVersion: PRODUCTION_RUNTIME_GENERATOR_VERSION,
    sourceManifest: {
      path: PRODUCTION_MASTER_MANIFEST,
      sha256: sourceAudit.manifestSha256,
      total: sourceAudit.total,
      sourceBytes: sourceAudit.manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
    policies: {
      oneRuntimeEntryPerMaster: true,
      derivedVariantsDoNotCountAsMasters: true,
      lazyOnly: true,
      webCryptoSha256Required: true,
      failClosedOnIntegrityMismatch: true,
    },
    budgets: { ...PRODUCTION_RUNTIME_BUDGETS },
    total: entries.length,
    runtimeBytes,
    entries,
  };
  atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const verified = validateProductionRuntime({ ledger, projectRoot, requireComplete: true });
  console.log(JSON.stringify({
    command: 'build', total: verified.total, sourceBytes: manifest.sourceManifest.sourceBytes,
    runtimeBytes: verified.runtimeBytes, rendered, reused, manifestSha256: verified.manifestSha256,
  }, null, 2));
}

function verify() {
  const ledger = readJsonFile(ledgerPath, 'upgrade ledger');
  const audit = validateProductionRuntime({ ledger, projectRoot, requireComplete: true });
  console.log(JSON.stringify({
    command: 'verify', total: audit.total, runtimeBytes: audit.runtimeBytes,
    byteBudget: PRODUCTION_RUNTIME_BUDGETS.totalRuntimeBytes, manifestSha256: audit.manifestSha256,
  }, null, 2));
}

try {
  if (command === 'build') await build();
  else if (command === 'verify') verify();
  else throw new Error('use build or verify');
} catch (error) {
  console.error(`production-runtime: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
