import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROGRESS_PATH = resolve(
  PROJECT_ROOT,
  'output/playwright/contextfix-desktop-soak-headless/contextfix-desktop-soak-progress.json',
);
const FINAL_PATH = resolve(
  PROJECT_ROOT,
  'output/playwright/contextfix-desktop-soak-headless/contextfix-desktop-soak-raw-final.json',
);
const GOLDEN_DIRECTORY = resolve(PROJECT_ROOT, 'docs/production/goldens');
const GLOBAL_KEY = '__PAOPAO_CONTEXTFIX_SOAK_V2__';
const STORAGE_KEY = 'paopao:contextfix-desktop-soak:v2';

function compositorProof(buffer) {
  return {
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    byteDiversity: new Set(buffer).size,
    visualNonBlank: buffer.length >= 20_000 && new Set(buffer).size >= 128,
  };
}

async function pageState(page) {
  return page.evaluate((storageKey) => {
    const serialized = localStorage.getItem(storageKey);
    return serialized ? JSON.parse(serialized) : null;
  }, STORAGE_KEY);
}

async function persistProgress(page, orchestration) {
  const state = await pageState(page);
  await writeFile(PROGRESS_PATH, `${JSON.stringify({ orchestration, state }, null, 2)}\n`, 'utf8');
  return state;
}

export async function run(page) {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true });
  await mkdir(GOLDEN_DIRECTORY, { recursive: true });

  const browserConsole = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (browserConsole.length < 500) {
      browserConsole.push({ at: new Date().toISOString(), type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => {
    if (pageErrors.length < 100) pageErrors.push({ at: new Date().toISOString(), message: String(error) });
  });

  const initial = await page.evaluate((key) => {
    const state = window[key];
    if (!state || state.rows.length !== 1 || state.done) throw new Error('Fresh one-sample harness required');
    return { startedAt: state.startedAt, total: state.total, periodMs: state.periodMs };
  }, GLOBAL_KEY);

  const orchestration = {
    startedAt: initial.startedAt,
    startedAtIso: new Date(initial.startedAt).toISOString(),
    total: initial.total,
    periodMs: initial.periodMs,
    compositorSamples: 0,
    capturePaths: {},
    browserConsole,
    pageErrors,
  };
  const canvas = page.locator('#game canvas');

  for (let index = 0; index < initial.total; index += 1) {
    await page.waitForFunction(
      ({ key, expectedIndex }) => {
        const state = window[key];
        return Boolean(state && state.rows.length > expectedIndex);
      },
      { key: GLOBAL_KEY, expectedIndex: index },
      { timeout: index === 0 ? 30_000 : 90_000 },
    );

    let buffer;
    let compositor;
    try {
      buffer = await canvas.screenshot({ type: 'png', timeout: 30_000 });
      compositor = compositorProof(buffer);
    } catch (error) {
      compositor = {
        bytes: 0,
        sha256: null,
        byteDiversity: 0,
        visualNonBlank: false,
        error: String(error),
      };
    }

    await page.evaluate(({ key, expectedIndex, proof }) => {
      const state = window[key];
      if (!state || !state.rows[expectedIndex]) throw new Error(`Missing row ${expectedIndex}`);
      state.rows[expectedIndex].compositor = proof;
      if (!proof.visualNonBlank) {
        const existing = state.failures.find((failure) => failure.index === expectedIndex);
        if (existing) {
          if (!existing.reasons.includes('compositor')) existing.reasons.push('compositor');
        } else {
          state.failures.push({ index: expectedIndex, atMs: state.rows[expectedIndex].atMs, reasons: ['compositor'] });
        }
      }
      state.persist();
    }, { key: GLOBAL_KEY, expectedIndex: index, proof: compositor });
    orchestration.compositorSamples += 1;

    if (buffer && (index === 0 || index === 60 || index === 120)) {
      const label = index === 0 ? 'start' : index === 60 ? 'mid' : 'final';
      const path = resolve(GOLDEN_DIRECTORY, `r5-contextfix-desktop-soak-${label}-2026-07-22.png`);
      await writeFile(path, buffer);
      orchestration.capturePaths[label] = path;
    }

    const state = await persistProgress(page, orchestration);
    if (!state || state.rows.length <= index) throw new Error(`Progress persistence failed at ${index}`);
  }

  const final = await page.evaluate((key) => {
    const state = window[key];
    if (!state || !state.done || state.rows.length !== state.total) {
      throw new Error('Soak did not reach its exact terminal sample count');
    }
    return JSON.parse(localStorage.getItem('paopao:contextfix-desktop-soak:v2'));
  }, GLOBAL_KEY);
  orchestration.endedAt = Date.now();
  orchestration.endedAtIso = new Date(orchestration.endedAt).toISOString();
  orchestration.durationMs = orchestration.endedAt - orchestration.startedAt;
  const result = { orchestration, state: final };
  await writeFile(PROGRESS_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(FINAL_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return {
    progressPath: PROGRESS_PATH,
    finalPath: FINAL_PATH,
    samples: final.rows.length,
    failures: final.failures.length,
    durationMs: orchestration.durationMs,
    captures: orchestration.capturePaths,
  };
}
