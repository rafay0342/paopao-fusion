import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertPhaserReleaseProfile, parsePhaserReleaseGate } from './release-profile-lib.mjs';

let gate;
try {
  gate = parsePhaserReleaseGate(process.argv[2], 'release gate');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('usage: node tools/build-release.mjs <1..5> <output-directory>');
  process.exit(1);
}
const output = process.argv[3];
if (typeof output !== 'string' || output.trim() === '') {
  console.error('usage: node tools/build-release.mjs <1..5> <output-directory>');
  process.exit(1);
}
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = resolve(projectRoot, output);

const outputRelative = relative(projectRoot, outputDirectory);
if (outputRelative === '' || outputRelative === '..' || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative)) {
  throw new Error('release output must be a dedicated directory inside the project root');
}
const protectedRoots = new Set([
  '.git', 'art-source', 'backups', 'data', 'docs', 'node_modules', 'public', 'releases',
  'server', 'shared', 'src', 'tests', 'tools',
]);
if (protectedRoots.has(outputRelative.split(sep)[0].toLowerCase())) {
  throw new Error(`release output cannot overlap protected project directory ${outputRelative.split(sep)[0]}`);
}
let outputAncestor = projectRoot;
for (const part of outputRelative.split(sep)) {
  outputAncestor = join(outputAncestor, part);
  if (existsSync(outputAncestor) && lstatSync(outputAncestor).isSymbolicLink()) {
    throw new Error('release output cannot traverse a symbolic link');
  }
}

const node = process.execPath;
const environment = {
  ...process.env,
  PAOPAO_RELEASE_GATE: String(gate),
  PAOPAO_OUT_DIR: outputDirectory,
};

for (const [script, args] of [
  ['node_modules/typescript/bin/tsc', ['--noEmit']],
  ['node_modules/vite/bin/vite.js', ['build']],
]) {
  const result = spawnSync(node, [resolve(projectRoot, script), ...args], {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const profilePath = resolve(outputDirectory, 'release-profile.json');
if (!existsSync(profilePath)) throw new Error('release build did not emit release-profile.json');
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
assertPhaserReleaseProfile(profile, gate);

const requiredFiles = [
  'index.html', 'classic/index.html', 'downloads/index.html', 'sw.js', 'manifest.webmanifest',
];
for (const path of requiredFiles) {
  const absolute = resolve(outputDirectory, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`release build is missing required Phaser file ${path}`);
  }
}
if (existsSync(resolve(outputDirectory, '3d'))) {
  throw new Error('release build contains the excluded /3d client tree');
}
const expectedMeta = `<meta name="paopao-release-gate" content="${gate}"`;
for (const path of ['index.html', 'classic/index.html']) {
  const html = readFileSync(resolve(outputDirectory, path), 'utf8');
  if (!html.includes(expectedMeta)) throw new Error(`${path} is not stamped for release gate ${gate}`);
}
const launcher = readFileSync(resolve(outputDirectory, 'index.html'), 'utf8');
if (!launcher.includes('/classic/') || !launcher.includes('/downloads/') || launcher.includes('/3d')) {
  throw new Error('release launcher must expose only the Phaser and downloads routes');
}

function filesUnder(root, current = root) {
  return readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(current, entry.name);
      const details = lstatSync(path);
      if (details.isSymbolicLink()) throw new Error(`release output contains symbolic link ${relative(root, path)}`);
      if (details.isDirectory()) return filesUnder(root, path);
      if (details.isFile()) return [path];
      throw new Error(`release output contains unsupported entry ${relative(root, path)}`);
    });
}

const files = filesUnder(outputDirectory).map((path) => {
  const bytes = statSync(path).size;
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  return { path: relative(outputDirectory, path).split(sep).join('/'), bytes, sha256 };
});
const contentSha256 = createHash('sha256')
  .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''))
  .digest('hex');

console.log(JSON.stringify({
  gate,
  output: outputDirectory,
  contentSha256,
  files: files.length,
  totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  profile,
}, null, 2));
