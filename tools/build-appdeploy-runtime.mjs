import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function gitValue(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function repositorySlug(remote) {
  const match = /github\.com(?::|\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(remote);
  if (!match) throw new Error('AppDeploy asset base requires a GitHub origin or PAOPAO_APPDEPLOY_ASSET_BASE.');
  return match[1];
}

function defaultRepositoryAssetBase() {
  const revision = (process.env.PAOPAO_APPDEPLOY_REVISION || gitValue(['rev-parse', 'HEAD'])).trim();
  if (!/^[a-f0-9]{40}$/i.test(revision)) {
    throw new Error('PAOPAO_APPDEPLOY_REVISION must be a complete Git commit SHA.');
  }
  const remote = gitValue(['remote', 'get-url', 'origin']);
  return `https://cdn.jsdelivr.net/gh/${repositorySlug(remote)}@${revision}/public`;
}

function safeAssetBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PAOPAO_APPDEPLOY_ASSET_BASE must be an absolute HTTP URL.');
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new Error('PAOPAO_APPDEPLOY_ASSET_BASE is not a safe public asset URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || /\/(?:fight|fighting)(?:\/|$)/i.test(decodedPath)) {
    throw new Error('PAOPAO_APPDEPLOY_ASSET_BASE is not a safe public asset URL.');
  }
  return url.href.replace(/\/+$/, '');
}

const repositoryAssetBase = safeAssetBase(
  process.env.PAOPAO_APPDEPLOY_ASSET_BASE?.trim() || defaultRepositoryAssetBase(),
);
const sourceDirectory = resolve(process.env.PAOPAO_APPDEPLOY_SOURCE_DIR || 'dist/assets');
const destinationDirectory = resolve(process.env.PAOPAO_APPDEPLOY_OUTPUT_DIR || 'public/appdeploy/v1');

function exactlyOne(prefix) {
  const matches = readdirSync(sourceDirectory)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith('.js'));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${prefix}*.js build artifact, found ${matches.length}.`);
  }
  return matches[0];
}

function replaceRequired(source, from, to) {
  if (!source.includes(from)) {
    throw new Error(`Required AppDeploy runtime token is missing: ${from}`);
  }
  return source.split(from).join(to);
}

const mainFile = exactlyOne('main-');
const phaserFile = exactlyOne('phaser-');
const handWorkerFile = exactlyOne('handtracking.worker-');
let runtime = readFileSync(resolve(sourceDirectory, mainFile), 'utf8');

for (const [from, to] of [
  ['fetch("/api/v3/telemetry/batch"', 'fetch("data:application/json,%7B%22duplicate%22%3Atrue%7D"'],
  ['fetch("/api/telemetry/batch"', 'fetch("data:application/json,%7B%7D"'],
  ['"/dl/', '"./guide.html#'],
  ['register("/sw.js",{scope:"/"', 'register("./sw.js",{scope:"./"'],
  [`"${handWorkerFile}"`, `location.origin+"/${handWorkerFile}"`],
  ['paopao-opening-final-light-1080.mp4', 'paopao-opening-v2.mp4'],
]) {
  runtime = replaceRequired(runtime, from, to);
}

// This assignment executes before the bundled modules initialize. Every
// shipped asset consumer resolves through hostedAssetUrl in source, so the
// compiled program remains untouched by asset-string rewriting.
runtime = `globalThis.__PAOPAO_ASSET_BASE__=${JSON.stringify(repositoryAssetBase)};\n${runtime}`;

const unsafeRuntimePatterns = [
  /fetch\(["']\//,
  /location\.assign\(["']\//,
  /register\(["']\//,
  /scope:["']\//,
  /["'`](?:https?:\/\/[^"'`]+)?\/?(?:assets|mediapipe)\/(?:fight|fighting)(?:\/|["'`?#])/i,
];
for (const pattern of unsafeRuntimePatterns) {
  if (pattern.test(runtime)) {
    throw new Error(`Unsafe AppDeploy runtime path remains: ${pattern}`);
  }
}

mkdirSync(destinationDirectory, { recursive: true });
writeFileSync(resolve(destinationDirectory, 'main-appdeploy.js'), runtime);
copyFileSync(resolve(sourceDirectory, phaserFile), resolve(destinationDirectory, phaserFile));
copyFileSync(resolve(sourceDirectory, handWorkerFile), resolve(destinationDirectory, handWorkerFile));

console.log(JSON.stringify({
  main: 'main-appdeploy.js',
  phaser: phaserFile,
  handWorker: handWorkerFile,
  assetBase: repositoryAssetBase,
}, null, 2));
