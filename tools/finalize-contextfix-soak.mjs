import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';

const EXPECTED_RELEASE = Object.freeze({
  releaseId: 'r5-level100-production-contextfix-20260722',
  schemaVersion: 20,
  productionSchema: 2,
  manifestSha256: '30d19f859c0fc6e1a7a051744a9224b7bb2e9308a198da521fe9e5d4fa06d8b9',
  contentSha256: '10694cddc96bc9fa393601e94830825ac02f97864aecf48761199c9eb4630996',
  appBundle: Object.freeze({
    path: '/assets/index-DyRX5DCM.js',
    bytes: 932_176,
    sha256: 'b875a53195f430cf33796ea7f5a0fe01c8e1d82a62489c244271ef2f1004f003',
  }),
});

const [mode, rawArgument, memoryArgument, jsonArgument, markdownArgument] = process.argv.slice(2);
if (!['desktop', 'mobile-emulated'].includes(mode)
  || !rawArgument || !memoryArgument || !jsonArgument || !markdownArgument) {
  throw new Error('Usage: node tools/finalize-contextfix-soak.mjs <desktop|mobile-emulated> <raw.json> <memory.jsonl> <report.json> <report.md>');
}

const rawPath = resolve(rawArgument);
const memoryPath = resolve(memoryArgument);
const jsonPath = resolve(jsonArgument);
const markdownPath = resolve(markdownArgument);
const rawBytes = await readFile(rawPath);
const state = JSON.parse(rawBytes.toString('utf8'));
const memory = (await readFile(memoryPath, 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const settings = mode === 'desktop'
  ? {
      title: 'Desktop WebGL context-fix soak',
      requiredSamples: 121,
      minimumDurationMs: 7_200_000,
      requiredMemorySamples: 25,
      testId: 'desktop-webgl-soak-contextfix-2026-07-22',
      viewport: { width: 1_440, height: 900 },
      capturePrefix: 'r5-contextfix-desktop-soak',
      limitation: 'Headless Microsoft Edge on Windows ANGLE D3D11 WARP; camera disabled. This is not a physical-camera or Android result.',
    }
  : {
      title: 'Mobile-browser emulation context-fix soak',
      requiredSamples: 46,
      minimumDurationMs: 2_700_000,
      requiredMemorySamples: 10,
      testId: 'mobile-emulated-webgl-soak-contextfix-2026-07-22',
      viewport: { width: 390, height: 844 },
      capturePrefix: 'r5-contextfix-mobile-emulated-soak',
      limitation: 'Microsoft Edge desktop mobile emulation; not physical Android hardware, thermals, battery, camera or hand-condition certification.',
    };

const rows = Array.isArray(state.rows) ? state.rows : [];
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const maximum = (values) => values.length ? Math.max(...values) : null;
const minimum = (values) => values.length ? Math.min(...values) : null;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validMemory = memory.filter((row) => row.valid);
const gaps = rows.slice(1).map((row) => finite(row.gapMs));
const memoryGaps = memory.slice(1).map((row, index) => finite(row.elapsedMs) - finite(memory[index].elapsedMs));
const memoryRootPids = new Set(memory.map((row) => row.rootPid));
const releaseRoot = resolve('releases-level100-final', EXPECTED_RELEASE.releaseId);
const releaseManifestPath = resolve(releaseRoot, 'release-manifest.json');
const releaseManifestBytes = await readFile(releaseManifestPath);
const releaseManifest = JSON.parse(releaseManifestBytes.toString('utf8'));
const appBundlePath = resolve(releaseRoot, 'client', EXPECTED_RELEASE.appBundle.path.slice(1));
const appBundleBytes = await readFile(appBundlePath);
const appBundleManifestEntry = releaseManifest.files?.find(
  (entry) => entry.path === EXPECTED_RELEASE.appBundle.path.slice(1),
);
const releaseArtifact = {
  manifest: {
    path: relative(process.cwd(), releaseManifestPath).replaceAll('\\', '/'),
    bytes: releaseManifestBytes.length,
    sha256: sha256(releaseManifestBytes),
    contentSha256: releaseManifest.contentSha256,
  },
  appBundle: {
    path: EXPECTED_RELEASE.appBundle.path,
    localPath: relative(process.cwd(), appBundlePath).replaceAll('\\', '/'),
    bytes: appBundleBytes.length,
    sha256: sha256(appBundleBytes),
  },
};
const captureLabels = ['start', 'mid', 'final'];
const captures = {};
for (const label of captureLabels) {
  const path = resolve(`docs/production/goldens/${settings.capturePrefix}-${label}-2026-07-22.png`);
  const bytes = await readFile(path);
  captures[label] = {
    path: relative(process.cwd(), path).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

const summary = {
  sampleCount: rows.length,
  durationMs: finite(state.endedAt) - finite(state.startedAt),
  minimumFps: minimum(rows.map((row) => finite(row.fps, Number.POSITIVE_INFINITY))),
  maximumP95Ms: maximum(rows.map((row) => finite(row.p95Ms))),
  minimumGapMs: minimum(gaps),
  maximumGapMs: maximum(gaps),
  maximumAbsoluteLatenessMs: maximum(rows.map((row) => Math.abs(finite(row.latenessMs)))),
  peakJsHeapBytes: maximum(rows.map((row) => finite(row.peakJsHeapBytes))),
  peakBrowserPrivateBytes: maximum(validMemory.map((row) => finite(row.privateBytes))),
  peakBrowserWorkingSetBytes: maximum(validMemory.map((row) => finite(row.workingSetBytes))),
  finalGrowth: rows.at(-1)?.growth ?? null,
  growthSamples: {
    texture: rows.filter((row) => row.growth?.textureCount).length,
    objects: rows.filter((row) => row.growth?.gameObjectCount).length,
    heap: rows.filter((row) => row.growth?.jsHeapBytes).length,
  },
  contextLossMaximum: maximum(rows.map((row) => finite(row.contextLossCount))),
  contextRestoreMaximum: maximum(rows.map((row) => finite(row.contextRestoredCount))),
  cameraAttempts: maximum(rows.map((row) => finite(row.cameraAttempts))),
  compositorMinimumBytes: minimum(rows.map((row) => finite(row.compositor?.bytes))),
  compositorMinimumDiversity: minimum(rows.map((row) => finite(row.compositor?.byteDiversity))),
  memorySamples: memory.length,
  validMemorySamples: validMemory.length,
  minimumMemoryGapMs: minimum(memoryGaps),
  maximumMemoryGapMs: maximum(memoryGaps),
};

const acceptance = {
  terminalState: state.evidenceVersion === 2
    && state.testId === settings.testId
    && state.total === settings.requiredSamples
    && state.periodMs === 60_000
    && state.done === true
    && isFiniteNumber(state.startedAt)
    && isFiniteNumber(state.endedAt)
    && state.endedAt >= state.startedAt,
  exactSampleCount: rows.length === settings.requiredSamples,
  contiguousIndices: rows.every((row, index) => row.index === index),
  metricShape: rows.every((row) => [
    row.atMs,
    row.scheduledAt,
    row.gapMs,
    row.latenessMs,
    row.elapsedMs,
    row.fps,
    row.p95Ms,
    row.longFrames,
    row.frameWindow,
    row.peakJsHeapBytes,
    row.contextLossCount,
    row.contextRestoredCount,
    row.cameraAttempts,
    row.compositor?.atMs,
    row.compositor?.bytes,
    row.compositor?.byteDiversity,
  ].every(isFiniteNumber)),
  duration: summary.durationMs >= settings.minimumDurationMs,
  cadence: state.cadenceBroken === false && gaps.every((gap) => gap >= 55_000 && gap <= 65_000),
  fpsFloor: summary.minimumFps != null && summary.minimumFps >= 30,
  p95FrameTime: summary.maximumP95Ms != null && summary.maximumP95Ms <= 33,
  allBudgetsPass: rows.every((row) => row.budget === 'pass'),
  boundedFrameWindow: rows.every((row) => finite(row.frameWindow) <= 600),
  jsHeap: summary.peakJsHeapBytes != null && summary.peakJsHeapBytes <= 1_200_000_000,
  browserPrivateMemory: summary.peakBrowserPrivateBytes != null && summary.peakBrowserPrivateBytes <= 1_200_000_000,
  memoryCoverage: memory.length === settings.requiredMemorySamples
    && memory.every((row, index) => row.valid === true
      && row.index === index
      && Number.isInteger(row.rootPid)
      && row.rootPid > 0
      && Number.isInteger(row.processCount)
      && row.processCount > 0
      && isFiniteNumber(row.elapsedMs)
      && isFiniteNumber(row.privateBytes)
      && row.privateBytes > 0
      && isFiniteNumber(row.workingSetBytes)
      && row.workingSetBytes > 0)
    && memoryRootPids.size === 1
    && memoryGaps.every((gap) => gap >= 240_000 && gap <= 360_000)
    && finite(memory.at(-1)?.elapsedMs) >= (settings.requiredMemorySamples - 1) * 300_000 - 60_000,
  finalResourceGrowth: Boolean(summary.finalGrowth)
    && !summary.finalGrowth.textureCount
    && !summary.finalGrowth.gameObjectCount
    && !summary.finalGrowth.jsHeapBytes,
  stableScene: rows.every((row) => row.scenes?.length === 1 && row.scenes[0] === 'Game'),
  webgl: rows.every((row) => row.renderer === 'webgl'),
  contextContinuity: summary.contextLossMaximum === 0
    && summary.contextRestoreMaximum === 0
    && rows.every((row) => !row.contextLost && row.contextStatus === 'ready'),
  compositor: rows.every((row) => row.compositor?.visualNonBlank === true
    && row.compositor.bytes >= 20_000
    && row.compositor.byteDiversity >= 64),
  goldenCaptures: Object.values(captures).every((capture) => capture.bytes >= 20_000
    && /^[a-f0-9]{64}$/.test(capture.sha256)),
  visible: rows.every((row) => row.visibility === 'visible'),
  cameraOff: summary.cameraAttempts === 0,
  profileIdentity: state.identity?.viewport?.width === settings.viewport.width
    && state.identity?.viewport?.height === settings.viewport.height
    && (mode !== 'mobile-emulated' || /Android.*Mobile/.test(state.identity?.userAgent ?? '')),
  buildIdentity: state.identity?.releaseId === EXPECTED_RELEASE.releaseId
    && state.identity?.schemaVersion === EXPECTED_RELEASE.schemaVersion
    && state.identity?.productionSchema === EXPECTED_RELEASE.productionSchema,
  releaseArtifactIdentity: releaseArtifact.manifest.sha256 === EXPECTED_RELEASE.manifestSha256
    && releaseManifest.releaseId === EXPECTED_RELEASE.releaseId
    && releaseManifest.client === 'phaser'
    && releaseManifest.engine === 'phaser-3.90.0'
    && releaseArtifact.manifest.contentSha256 === EXPECTED_RELEASE.contentSha256
    && releaseArtifact.appBundle.bytes === EXPECTED_RELEASE.appBundle.bytes
    && releaseArtifact.appBundle.sha256 === EXPECTED_RELEASE.appBundle.sha256
    && appBundleManifestEntry?.bytes === EXPECTED_RELEASE.appBundle.bytes
    && appBundleManifestEntry?.sha256 === EXPECTED_RELEASE.appBundle.sha256,
  noRuntimeFailures: Array.isArray(state.failures) && state.failures.length === 0,
};
acceptance.overall = Object.values(acceptance).every(Boolean);

const report = {
  evidenceVersion: 2,
  mode,
  verdict: acceptance.overall ? 'pass' : 'fail',
  generatedAt: new Date().toISOString(),
  environment: {
    ...state.identity,
    browser: 'Microsoft Edge 150 via Playwright CLI',
    graphics: 'Phaser WebGL on Windows ANGLE D3D11 WARP',
    appBundle: releaseArtifact.appBundle,
    releaseArtifact,
  },
  progress: {
    startedAt: new Date(state.startedAt).toISOString(),
    endedAt: new Date(state.endedAt).toISOString(),
    durationMs: summary.durationMs,
  },
  summary,
  acceptance,
  captures,
  limitations: [settings.limitation],
  source: {
    rawPath: basename(rawPath),
    rawBytes: rawBytes.length,
    rawSha256: sha256(rawBytes),
    memoryPath: basename(memoryPath),
    memoryBytes: (await stat(memoryPath)).size,
  },
  memory,
  rows,
  renderEvents: state.renderEvents ?? [],
  failures: state.failures ?? [],
};
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const mib = (bytes) => bytes == null ? 'n/a' : `${(bytes / 1_048_576).toFixed(2)} MiB`;
const result = acceptance.overall ? 'PASS' : 'FAIL';
const markdown = `# ${settings.title}\n\n`+
  `Result: **${result}** for \`${state.identity?.releaseId}\` (schema ${state.identity?.schemaVersion}).\n\n`+
  `| Check | Measured | Result |\n|---|---:|---|\n`+
  `| Wall-clock duration | ${(summary.durationMs / 3_600_000).toFixed(3)} h | ${acceptance.duration ? 'pass' : 'fail'} |\n`+
  `| Samples | ${summary.sampleCount} | ${acceptance.exactSampleCount && acceptance.contiguousIndices ? 'pass' : 'fail'} |\n`+
  `| Cadence gap | ${summary.minimumGapMs}-${summary.maximumGapMs} ms | ${acceptance.cadence ? 'pass' : 'fail'} |\n`+
  `| Minimum FPS | ${summary.minimumFps} | ${acceptance.fpsFloor ? 'pass' : 'fail'} |\n`+
  `| Maximum p95 frame time | ${summary.maximumP95Ms} ms | ${acceptance.p95FrameTime ? 'pass' : 'fail'} |\n`+
  `| Peak JS heap | ${mib(summary.peakJsHeapBytes)} | ${acceptance.jsHeap ? 'pass' : 'fail'} |\n`+
  `| Peak browser private memory | ${mib(summary.peakBrowserPrivateBytes)} | ${acceptance.browserPrivateMemory ? 'pass' : 'fail'} |\n`+
  `| WebGL context losses/restores | ${summary.contextLossMaximum}/${summary.contextRestoreMaximum} | ${acceptance.contextContinuity ? 'pass' : 'fail'} |\n`+
  `| Compositor pixel sentinels | ${summary.sampleCount} | ${acceptance.compositor ? 'pass' : 'fail'} |\n`+
  `| Camera attempts | ${summary.cameraAttempts} | ${acceptance.cameraOff ? 'pass' : 'fail'} |\n\n`+
  `Immutable R5 manifest SHA-256: \`${releaseArtifact.manifest.sha256}\`; content SHA-256: \`${releaseArtifact.manifest.contentSha256}\`; app-bundle SHA-256: \`${releaseArtifact.appBundle.sha256}\`. Artifact identity acceptance: **${acceptance.releaseArtifactIdentity ? 'pass' : 'fail'}**.\n\n`+
  `Start, midpoint and final compositor captures are in \`docs/production/goldens/\` and their SHA-256 values are recorded in the JSON report. Early load history may report bounded texture/object growth; acceptance requires the terminal rolling growth flags to be false.\n\n`+
  `Limitation: ${settings.limitation}\n`;
await writeFile(markdownPath, markdown, 'utf8');

console.log(JSON.stringify({ jsonPath, markdownPath, verdict: report.verdict, summary, acceptance }, null, 2));
