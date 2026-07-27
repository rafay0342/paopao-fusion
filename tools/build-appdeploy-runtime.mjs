import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryAssetBase =
  'https://cdn.jsdelivr.net/gh/rafay0342/paopao-fusion@5c512ae0749f3678798ca6476e02d4686092c9fd/public';
const sourceDirectory = resolve('dist', 'assets');
const destinationDirectory = resolve('public', 'appdeploy', 'v1');

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
  ['"/assets/', `"${repositoryAssetBase}/assets/`],
  ['"assets/', `"${repositoryAssetBase}/assets/`],
  ['`assets/', `\`${repositoryAssetBase}/assets/`],
  ['"mediapipe/', `"${repositoryAssetBase}/mediapipe/`],
  ['fetch("/api/v3/telemetry/batch"', 'fetch("data:application/json,%7B%22duplicate%22%3Atrue%7D"'],
  ['fetch("/api/telemetry/batch"', 'fetch("data:application/json,%7B%7D"'],
  ['"/dl/', '"./guide.html#'],
  ['register("/sw.js",{scope:"/"', 'register("./sw.js",{scope:"./"'],
  [`"${handWorkerFile}"`, `location.origin+"/${handWorkerFile}"`],
  ['paopao-opening-final-light-1080.mp4', 'paopao-opening-v2.mp4'],
]) {
  runtime = replaceRequired(runtime, from, to);
}

const unsafeRuntimePatterns = [
  /fetch\(["']\//,
  /location\.assign\(["']\//,
  /register\(["']\//,
  /scope:["']\//,
  /["'`]\/?(?:assets|mediapipe)\//,
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
