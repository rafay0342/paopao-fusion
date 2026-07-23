#!/usr/bin/env bash
set -Eeuo pipefail

# Run the fixed-R5 45-minute mobile-browser emulation soak as one Playwright
# run-code RPC. Keeping the 46 compositor samples in one RPC avoids CLI
# reconnect latency changing the absolute 60-second in-page cadence.

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

for command_name in mkdir npx powershell.exe seq sleep tr wc wslpath; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "required command is unavailable: ${command_name}"
done

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PROJECT_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd -P)"
readonly RUN_DIRECTORY="${PROJECT_ROOT}/output/playwright/contextfix-mobile-soak"
readonly CONFIG_PATH="${RUN_DIRECTORY}/.playwright/cli.config.json"
readonly HARNESS_PATH="${PROJECT_ROOT}/tools/contextfix-desktop-soak-harness.js"
readonly NAVIGATION_RUN_CODE_PATH="${PROJECT_ROOT}/tools/contextfix-mobile-navigation-run-code.js"
readonly SOAK_RUN_CODE_PATH="${PROJECT_ROOT}/tools/contextfix-mobile-soak-run-code.js"
readonly MEMORY_SCRIPT_PATH="${PROJECT_ROOT}/tools/measure-browser-process-memory.ps1"
readonly FINALIZER_PATH="${PROJECT_ROOT}/tools/finalize-contextfix-soak.mjs"
readonly PLAYWRIGHT_WRAPPER="/mnt/c/Users/SPHF/.codex/skills/playwright/scripts/playwright_cli.sh"
readonly WINDOWS_NODE="/mnt/c/Program Files/nodejs/node.exe"
readonly PUBLIC_URL="${PAOPAO_MOBILE_SOAK_URL:-https://rafayamir-1.tail372a9e.ts.net/classic/}"
readonly SESSION_NAME="${PAOPAO_MOBILE_SOAK_SESSION:-paopao-contextfix-mobile-unlimited-20260722}"

[[ "${SESSION_NAME}" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'mobile soak session name contains unsupported characters'

readonly DESKTOP_RAW_PATH="${PROJECT_ROOT}/output/playwright/contextfix-desktop-soak-headless/contextfix-desktop-soak-raw-final.json"
readonly DESKTOP_MEMORY_PATH="${PROJECT_ROOT}/output/playwright/contextfix-desktop-soak-headless/contextfix-desktop-process-memory.jsonl"
readonly RAW_PATH="${RUN_DIRECTORY}/contextfix-mobile-soak-raw-final.json"
readonly MEMORY_PATH="${RUN_DIRECTORY}/contextfix-mobile-process-memory.jsonl"
readonly REPORT_JSON_PATH="${PROJECT_ROOT}/docs/production/performance-soak-mobile-emulated-contextfix-2026-07-22.json"
readonly REPORT_MARKDOWN_PATH="${PROJECT_ROOT}/docs/production/performance-soak-mobile-emulated-contextfix-2026-07-22.md"
readonly START_GOLDEN_PATH="${PROJECT_ROOT}/docs/production/goldens/r5-contextfix-mobile-emulated-soak-start-2026-07-22.png"
readonly MID_GOLDEN_PATH="${PROJECT_ROOT}/docs/production/goldens/r5-contextfix-mobile-emulated-soak-mid-2026-07-22.png"
readonly FINAL_GOLDEN_PATH="${PROJECT_ROOT}/docs/production/goldens/r5-contextfix-mobile-emulated-soak-final-2026-07-22.png"
readonly MONITOR_STDOUT_PATH="${PROJECT_ROOT}/logs/contextfix-mobile-memory-monitor.out.log"
readonly MONITOR_STDERR_PATH="${PROJECT_ROOT}/logs/contextfix-mobile-memory-monitor.err.log"

[[ -f "${CONFIG_PATH}" ]] || fail "mobile Playwright config is missing: ${CONFIG_PATH}"
[[ -f "${HARNESS_PATH}" ]] || fail "soak harness is missing: ${HARNESS_PATH}"
[[ -f "${NAVIGATION_RUN_CODE_PATH}" ]] || fail "mobile navigation run-code is missing: ${NAVIGATION_RUN_CODE_PATH}"
[[ -f "${SOAK_RUN_CODE_PATH}" ]] || fail "mobile soak run-code is missing: ${SOAK_RUN_CODE_PATH}"
[[ -f "${MEMORY_SCRIPT_PATH}" ]] || fail "memory monitor is missing: ${MEMORY_SCRIPT_PATH}"
[[ -f "${FINALIZER_PATH}" ]] || fail "soak finalizer is missing: ${FINALIZER_PATH}"
[[ -x "${PLAYWRIGHT_WRAPPER}" ]] || fail "Playwright CLI wrapper is unavailable: ${PLAYWRIGHT_WRAPPER}"
[[ -x "${WINDOWS_NODE}" ]] || fail "Windows Node.js is unavailable: ${WINDOWS_NODE}"

# The mobile evidence is deliberately sequential. This prevents a second WARP
# renderer from invalidating either long-session performance result.
[[ -f "${DESKTOP_RAW_PATH}" ]] || fail 'official desktop raw soak evidence is not complete yet'
[[ -f "${DESKTOP_MEMORY_PATH}" ]] || fail 'official desktop memory evidence is not complete yet'
desktop_memory_rows="$(wc -l < "${DESKTOP_MEMORY_PATH}")"
[[ "${desktop_memory_rows}" == '25' ]] || fail "desktop memory evidence must contain exactly 25 rows; found ${desktop_memory_rows}"

blocking_soak_roots="$(powershell.exe -NoProfile -Command '
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "msedge.exe" -and
      $_.CommandLine -like "*playwright_chromiumdev_profile-*" -and
      $_.CommandLine -like "*--remote-debugging-pipe*" -and
      $_.CommandLine -like "*--use-angle=d3d11*" -and
      $_.CommandLine -like "*--disable-frame-rate-limit*" -and
      $_.CommandLine -notlike "*--type=*"
    } |
    ForEach-Object { $_.ProcessId }
' | tr -d '\r')"
[[ -z "${blocking_soak_roots}" ]] || fail "close the existing D3D11 soak browser before mobile soak: ${blocking_soak_roots//$'\n'/, }"

for output_path in \
  "${RAW_PATH}" \
  "${MEMORY_PATH}" \
  "${REPORT_JSON_PATH}" \
  "${REPORT_MARKDOWN_PATH}" \
  "${START_GOLDEN_PATH}" \
  "${MID_GOLDEN_PATH}" \
  "${FINAL_GOLDEN_PATH}"; do
  [[ ! -e "${output_path}" ]] || fail "refusing to overwrite existing evidence: ${output_path}"
done

mkdir -p -- "${RUN_DIRECTORY}" "${PROJECT_ROOT}/docs/production/goldens" "${PROJECT_ROOT}/logs"

windows_path() {
  wslpath -w "$1" | tr '\\' '/'
}

readonly PROJECT_ROOT_WINDOWS="$(windows_path "${PROJECT_ROOT}")"
readonly CONFIG_PATH_WINDOWS="$(windows_path "${CONFIG_PATH}")"
readonly HARNESS_PATH_WINDOWS="$(windows_path "${HARNESS_PATH}")"
readonly NAVIGATION_RUN_CODE_PATH_WINDOWS="$(windows_path "${NAVIGATION_RUN_CODE_PATH}")"
readonly SOAK_RUN_CODE_PATH_WINDOWS="$(windows_path "${SOAK_RUN_CODE_PATH}")"
readonly MEMORY_SCRIPT_PATH_WINDOWS="$(windows_path "${MEMORY_SCRIPT_PATH}")"
readonly FINALIZER_PATH_WINDOWS="$(windows_path "${FINALIZER_PATH}")"
readonly RAW_PATH_WINDOWS="$(windows_path "${RAW_PATH}")"
readonly MEMORY_PATH_WINDOWS="$(windows_path "${MEMORY_PATH}")"
readonly REPORT_JSON_PATH_WINDOWS="$(windows_path "${REPORT_JSON_PATH}")"
readonly REPORT_MARKDOWN_PATH_WINDOWS="$(windows_path "${REPORT_MARKDOWN_PATH}")"
readonly START_GOLDEN_PATH_WINDOWS="$(windows_path "${START_GOLDEN_PATH}")"
readonly MID_GOLDEN_PATH_WINDOWS="$(windows_path "${MID_GOLDEN_PATH}")"
readonly FINAL_GOLDEN_PATH_WINDOWS="$(windows_path "${FINAL_GOLDEN_PATH}")"
readonly MONITOR_STDOUT_PATH_WINDOWS="$(windows_path "${MONITOR_STDOUT_PATH}")"
readonly MONITOR_STDERR_PATH_WINDOWS="$(windows_path "${MONITOR_STDERR_PATH}")"

"${WINDOWS_NODE}" -e "
  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');
  const config = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const project = process.argv[2];
  const browser = config.browser ?? {};
  const launch = browser.launchOptions ?? {};
  const context = browser.contextOptions ?? {};
  const args = new Set(launch.args ?? []);
  const requiredArgs = [
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ];
  const valid = browser.browserName === 'chromium'
    && launch.channel === 'msedge'
    && launch.headless === true
    && context.viewport?.width === 390
    && context.viewport?.height === 844
    && context.screen?.width === 390
    && context.screen?.height === 844
    && context.deviceScaleFactor === 1
    && context.isMobile === true
    && context.hasTouch === true
    && Array.isArray(context.permissions)
    && context.permissions.length === 0
    && /Android.*Mobile/.test(context.userAgent ?? '')
    && requiredArgs.every((argument) => args.has(argument))
    && config.outputDir === '.playwright-cli';
  if (!valid) throw new Error('Mobile Playwright configuration drifted from the certified profile');
  const release = 'r5-level100-production-contextfix-20260722';
  const releaseRoot = path.join(project, 'releases-level100-final', release);
  const manifestBytes = fs.readFileSync(path.join(releaseRoot, 'release-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const bundleBytes = fs.readFileSync(path.join(releaseRoot, 'client', 'assets', 'index-DyRX5DCM.js'));
  const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest(manifestBytes) !== '30d19f859c0fc6e1a7a051744a9224b7bb2e9308a198da521fe9e5d4fa06d8b9'
    || manifest.contentSha256 !== '10694cddc96bc9fa393601e94830825ac02f97864aecf48761199c9eb4630996'
    || bundleBytes.length !== 932176
    || digest(bundleBytes) !== 'b875a53195f430cf33796ea7f5a0fe01c8e1d82a62489c244271ef2f1004f003') {
    throw new Error('Immutable fixed-R5 release artifact identity check failed');
  }
" "${CONFIG_PATH_WINDOWS}" "${PROJECT_ROOT_WINDOWS}"

pwcli() {
  (
    cd -- "${RUN_DIRECTORY}"
    "${PLAYWRIGHT_WRAPPER}" --session "${SESSION_NAME}" "$@"
  )
}

# The Playwright CLI currently exits zero for tool-level failures such as
# `### Error`. Treat that marker as a real command failure so a bad navigation
# or capture can never fall through into apparently valid soak evidence.
pwcli_checked() {
  local output
  if ! output="$(pwcli "$@" 2>&1)"; then
    printf '%s\n' "${output}" >&2
    return 1
  fi
  printf '%s\n' "${output}"
  if [[ "${output}" == *'### Error'* || "${output}" == *'"isError":true'* ]]; then
    printf 'ERROR: Playwright reported a tool-level failure.\n' >&2
    return 1
  fi
}

browser_opened=0
monitor_pid=''
browser_root_pid=''

close_isolated_session() {
  powershell.exe -NoProfile -Command "
    \$ErrorActionPreference = 'SilentlyContinue';
    \$rootPidText = '${browser_root_pid}';
    if (\$rootPidText -match '^[1-9][0-9]*$') {
      \$rootPid = [int]\$rootPidText;
      \$root = Get-CimInstance Win32_Process -Filter \"ProcessId=\$rootPid\";
      if (\$root -and \$root.Name -eq 'msedge.exe' -and \$root.CommandLine -like '*playwright_chromiumdev_profile-*') {
        Stop-Process -Id \$rootPid -Force;
      }
    }
    \$daemons = Get-CimInstance Win32_Process |
      Where-Object {
        \$_.Name -eq 'node.exe' -and
        \$_.CommandLine -like '*cliDaemon.js ${SESSION_NAME}*'
      };
    foreach (\$daemon in \$daemons) {
      Stop-Process -Id \$daemon.ProcessId -Force;
    }
  " >/dev/null 2>&1 || true
  browser_opened=0
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "${monitor_pid}" ]]; then
    powershell.exe -NoProfile -Command \
      "Stop-Process -Id ${monitor_pid} -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
  fi

  close_isolated_session
  exit "${status}"
}
trap cleanup EXIT INT TERM

close_isolated_session
printf 'Opening isolated mobile-emulated Edge session %s...\n' "${SESSION_NAME}"
launch_epoch_ms="$(powershell.exe -NoProfile -Command '[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()' | tr -d '\r')"
[[ "${launch_epoch_ms}" =~ ^[0-9]+$ ]] || fail 'could not record the browser launch timestamp'
pwcli_checked open "${PUBLIC_URL}" || fail 'mobile Edge session failed to open'
browser_opened=1

readonly NAVIGATION_CODE="async (page) => {
  const expectedRelease = 'r5-level100-production-contextfix-20260722';
  const expectedSchema = 20;
  const canvas = page.locator('#game canvas');
  await page.bringToFront();

  const readReport = async () => page.evaluate(() => {
    const diagnostics = window.__PAOPAO_PRODUCTION__;
    return diagnostics && typeof diagnostics.report === 'function'
      ? diagnostics.report()
      : null;
  });
  const waitScene = async (scene, timeout = 120000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const report = await readReport();
      if (report?.activeScenes?.includes(scene)) return report;
      await page.waitForTimeout(250);
    }
    throw new Error('Timed out waiting for scene ' + scene);
  };
  const clickCanvasPoint = async (x, y) => {
    const box = await canvas.boundingBox();
    const intrinsic = await canvas.evaluate((element) => ({ width: element.width, height: element.height }));
    if (!box || !intrinsic.width || !intrinsic.height) throw new Error('Canvas geometry unavailable');
    await page.mouse.click(
      box.x + x * box.width / intrinsic.width,
      box.y + y * box.height / intrinsic.height,
    );
  };

  let preflightReloads = 0;
  let cleanIntro = null;
  for (let attempt = 0; attempt < 3 && !cleanIntro; attempt += 1) {
    if (attempt > 0) {
      preflightReloads += 1;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    }
    await canvas.waitFor({ state: 'visible', timeout: 180000 });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const report = await readReport();
      if (report?.contextLossCount > 0 || report?.contextRestoredCount > 0) break;
      if (report?.activeScenes?.includes('Intro')
        && report.renderer === 'webgl'
        && report.contextStatus === 'ready'
        && !report.contextLost) {
        cleanIntro = report;
        break;
      }
      await page.waitForTimeout(500);
    }
  }
  if (!cleanIntro) throw new Error('A clean zero-loss Intro preflight could not be established');

  await clickCanvasPoint(643, 48);
  await waitScene('Menu');
  await clickCanvasPoint(360, 322);
  await waitScene('ModeSelect');
  await clickCanvasPoint(548, 438);
  await waitScene('WorldMap');
  await page.waitForTimeout(900);
  await clickCanvasPoint(236, 420);
  await waitScene('Story');
  await page.keyboard.press('Space');
  await waitScene('Game');

  let passingReport = null;
  const passingDeadline = Date.now() + 180000;
  while (Date.now() < passingDeadline) {
    const report = await readReport();
    if (report?.contextLossCount > 0 || report?.contextRestoredCount > 0 || report?.contextLost) {
      throw new Error('WebGL context continuity failed during mobile preflight');
    }
    if (report?.activeScenes?.length === 1
      && report.activeScenes[0] === 'Game'
      && report.renderer === 'webgl'
      && report.contextStatus === 'ready'
      && report.snapshot.averageFps >= 30
      && report.snapshot.p95FrameMs <= 33
      && report.snapshot.budget === 'pass') {
      passingReport = report;
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (!passingReport) throw new Error('Mobile Game/WebGL performance preflight timed out');

  const deployment = await page.evaluate(async () => {
    const response = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
    const health = await response.json();
    return {
      ok: response.ok,
      status: response.status,
      release: response.headers.get('x-paopao-release'),
      schemaVersion: health.schemaVersion,
    };
  });
  if (!deployment.ok) throw new Error('Health preflight failed: ' + deployment.status);
  if (deployment.release !== expectedRelease || deployment.schemaVersion !== expectedSchema) {
    throw new Error('Unexpected deployment identity: ' + deployment.release + ' / schema ' + deployment.schemaVersion);
  }
  return {
    url: page.url(),
    release: deployment.release,
    schemaVersion: deployment.schemaVersion,
    preflightReloads,
    diagnostic: passingReport,
  };
}"

printf 'Navigating deterministic campaign flow and waiting for a passing Game/WebGL preflight...\n'
pwcli_checked --raw run-code --filename="${NAVIGATION_RUN_CODE_PATH_WINDOWS}" \
  || fail 'mobile campaign navigation or WebGL preflight failed'

# Resolve only the newly-created Playwright Edge root. Child renderer/GPU
# processes carry --type= and are excluded; unrelated user Edge windows do not
# use a playwright_chromiumdev_profile plus remote-debugging pipe.
browser_root_pid="$(powershell.exe -NoProfile -Command "
  \$ErrorActionPreference = 'Stop';
  \$cutoff = [DateTimeOffset]::FromUnixTimeMilliseconds(${launch_epoch_ms}).LocalDateTime;
  \$root = \$null;
  for (\$attempt = 0; \$attempt -lt 40 -and -not \$root; \$attempt += 1) {
    \$root = Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" |
      Where-Object {
        \$_.CreationDate -ge \$cutoff -and
        \$_.CommandLine -like '*playwright_chromiumdev_profile-*' -and
        \$_.CommandLine -like '*--remote-debugging-pipe*' -and
        \$_.CommandLine -notlike '*--type=*'
      } |
      Sort-Object CreationDate -Descending |
      Select-Object -First 1;
    if (-not \$root) { Start-Sleep -Milliseconds 500 }
  }
  if (-not \$root) { throw 'Could not resolve the isolated Playwright Edge root process' }
  [Console]::Write(\$root.ProcessId)
" | tr -d '\r')"
[[ "${browser_root_pid}" =~ ^[1-9][0-9]*$ ]] || fail "invalid Edge root PID: ${browser_root_pid}"
printf 'Resolved isolated Edge root PID %s.\n' "${browser_root_pid}"

monitor_pid="$(powershell.exe -NoProfile -Command "
  \$ErrorActionPreference = 'Stop';
  \$arguments = @(
    '-NoProfile',
    '-File', '${MEMORY_SCRIPT_PATH_WINDOWS}',
    '-RootPid', '${browser_root_pid}',
    '-OutputPath', '${MEMORY_PATH_WINDOWS}',
    '-Samples', '10',
    '-PeriodSeconds', '300'
  );
  \$monitor = Start-Process powershell.exe -ArgumentList \$arguments -WorkingDirectory '${PROJECT_ROOT_WINDOWS}' -WindowStyle Hidden -PassThru;
  [Console]::Write(\$monitor.Id)
" | tr -d '\r')"
[[ "${monitor_pid}" =~ ^[1-9][0-9]*$ ]] || fail "invalid memory monitor PID: ${monitor_pid}"

for _ in $(seq 1 60); do
  [[ -s "${MEMORY_PATH}" ]] && break
  sleep 0.25
done
[[ -s "${MEMORY_PATH}" ]] || fail "memory monitor did not create its first row; inspect ${MONITOR_STDERR_PATH}"

readonly SOAK_CODE="async (page) => {
  const key = '__PAOPAO_CONTEXTFIX_MOBILE_SOAK_V2__';
  const promiseKey = '__PAOPAO_CONTEXTFIX_MOBILE_SOAK_INSTALL_PROMISE__';
  const storage = 'paopao:contextfix-mobile-soak:v2';
  const config = {
    globalKey: key,
    promiseKey,
    storageKey: storage,
    testId: 'mobile-emulated-webgl-soak-contextfix-2026-07-22',
    total: 46,
    periodMs: 60000,
  };
  await page.evaluate(({ key, promiseKey, storage, config }) => {
    const old = window[key];
    if (old?.timer) clearTimeout(old.timer);
    delete window[key];
    delete window[promiseKey];
    localStorage.removeItem(storage);
    sessionStorage.removeItem(storage);
    window.__PAOPAO_SOAK_CONFIG__ = config;
  }, { key, promiseKey, storage, config });
  await page.addScriptTag({ path: '${HARNESS_PATH_WINDOWS}' });
  const installed = await page.evaluate((name) => window[name], promiseKey);
  const canvas = page.locator('#game canvas');
  const captures = {
    0: '${START_GOLDEN_PATH_WINDOWS}',
    23: '${MID_GOLDEN_PATH_WINDOWS}',
    45: '${FINAL_GOLDEN_PATH_WINDOWS}',
  };

  for (let index = 0; index < 46; index += 1) {
    await page.waitForFunction(
      ({ key, index }) => Boolean(window[key]?.rows?.[index]),
      { key, index },
      { timeout: index === 0 ? 30000 : 90000 },
    );
    let proof;
    try {
      const options = { type: 'png', timeout: 30000 };
      if (captures[index]) options.path = captures[index];
      const bytes = await canvas.screenshot(options);
      const step = Math.max(1, Math.floor(bytes.length / 16384));
      const diversity = new Set();
      let hash = 2166136261;
      for (let offset = 0; offset < bytes.length; offset += step) {
        const value = bytes[offset];
        diversity.add(value);
        hash = Math.imul(hash ^ value, 16777619);
      }
      proof = {
        atMs: Date.now(),
        bytes: bytes.length,
        fnv1a: hash >>> 0,
        byteDiversity: diversity.size,
        visualNonBlank: bytes.length >= 20000 && diversity.size >= 64,
      };
    } catch (error) {
      proof = {
        atMs: Date.now(),
        bytes: 0,
        fnv1a: null,
        byteDiversity: 0,
        visualNonBlank: false,
        error: String(error),
      };
    }
    await page.evaluate(({ key, index, proof }) => {
      const state = window[key];
      const row = state?.rows?.[index];
      if (!row) throw new Error('Missing mobile soak row ' + index);
      row.compositor = { ...proof, offsetMs: proof.atMs - row.atMs };
      if (!proof.visualNonBlank) {
        const existing = state.failures.find((failure) => failure.index === index);
        if (existing) {
          if (!existing.reasons.includes('compositor')) existing.reasons.push('compositor');
        } else {
          state.failures.push({ index, atMs: row.atMs, reasons: ['compositor'] });
        }
      }
      state.persist();
    }, { key, index, proof });
  }

  const finalState = await page.evaluate(({ key, storage }) => {
    const state = window[key];
    if (!state || !state.done || state.rows.length !== 46) {
      throw new Error('Mobile soak did not reach exactly 46 terminal samples');
    }
    return JSON.parse(localStorage.getItem(storage));
  }, { key, storage });
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(({ storage }) => {
    const serialized = localStorage.getItem(storage);
    const blob = new Blob([serialized], { type: 'application/json' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = 'contextfix-mobile-soak-raw-final.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, { storage });
  const download = await downloadPromise;
  await download.saveAs('${RAW_PATH_WINDOWS}');

  const fps = finalState.rows.map((row) => row.fps);
  const p95 = finalState.rows.map((row) => row.p95Ms);
  return {
    installed,
    startedAt: finalState.startedAt,
    endedAt: finalState.endedAt,
    durationMs: finalState.endedAt - finalState.startedAt,
    rows: finalState.rows.length,
    failures: finalState.failures,
    cadenceBroken: finalState.cadenceBroken,
    maxGapMs: finalState.maxGapMs,
    maxLatenessMs: finalState.maxLatenessMs,
    minFps: Math.min(...fps),
    maxP95Ms: Math.max(...p95),
    contextLossMax: Math.max(...finalState.rows.map((row) => row.contextLossCount)),
    compositorPass: finalState.rows.every((row) => row.compositor?.visualNonBlank === true),
    cameraAttempts: finalState.cameraAttempts,
    identity: finalState.identity,
  };
}"

printf 'Running 46 absolute-cadence samples (about 45 minutes); do not suspend or hide this session...\n'
pwcli_checked --raw run-code --filename="${SOAK_RUN_CODE_PATH_WINDOWS}" || fail 'mobile soak RPC failed'

for _ in $(seq 1 240); do
  memory_rows="$(wc -l < "${MEMORY_PATH}")"
  [[ "${memory_rows}" == '10' ]] && break
  sleep 0.5
done
memory_rows="$(wc -l < "${MEMORY_PATH}")"
[[ "${memory_rows}" == '10' ]] || fail "memory monitor must produce exactly 10 rows; found ${memory_rows}"

"${WINDOWS_NODE}" "${FINALIZER_PATH_WINDOWS}" mobile-emulated \
  "${RAW_PATH_WINDOWS}" \
  "${MEMORY_PATH_WINDOWS}" \
  "${REPORT_JSON_PATH_WINDOWS}" \
  "${REPORT_MARKDOWN_PATH_WINDOWS}"

"${WINDOWS_NODE}" -e \
  "const fs=require('fs');const report=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(report.verdict!=='pass'||report.acceptance?.overall!==true){throw new Error('Mobile context-fix soak acceptance failed')}" \
  "${REPORT_JSON_PATH_WINDOWS}"

close_isolated_session
monitor_pid=''
printf 'PASS: mobile-emulated context-fix soak, memory evidence, three goldens and final reports are complete.\n'
