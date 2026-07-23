async (page) => {
  const project = 'C:/Users/SPHF/Documents/paopao-fusion-v7-complete-game-backup-2026-07-20/paopao-phaser';
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
  await page.evaluate(({ key: globalKey, promiseKey: installKey, storageKey, soakConfig }) => {
    const old = window[globalKey];
    if (old?.timer) clearTimeout(old.timer);
    delete window[globalKey];
    delete window[installKey];
    localStorage.removeItem(storageKey);
    sessionStorage.removeItem(storageKey);
    window.__PAOPAO_SOAK_CONFIG__ = soakConfig;
  }, {
    key,
    promiseKey,
    storageKey: storage,
    soakConfig: config,
  });
  await page.addScriptTag({ path: project + '/tools/contextfix-desktop-soak-harness.js' });
  const installed = await page.evaluate((name) => window[name], promiseKey);
  const canvas = page.locator('#game canvas');
  const captures = {
    0: project + '/docs/production/goldens/r5-contextfix-mobile-emulated-soak-start-2026-07-22.png',
    23: project + '/docs/production/goldens/r5-contextfix-mobile-emulated-soak-mid-2026-07-22.png',
    45: project + '/docs/production/goldens/r5-contextfix-mobile-emulated-soak-final-2026-07-22.png',
  };

  for (let index = 0; index < 46; index += 1) {
    await page.waitForFunction(
      ({ globalKey, rowIndex }) => Boolean(window[globalKey]?.rows?.[rowIndex]),
      { globalKey: key, rowIndex: index },
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
    await page.evaluate(({ globalKey, rowIndex, compositorProof }) => {
      const state = window[globalKey];
      const row = state?.rows?.[rowIndex];
      if (!row) throw new Error('Missing mobile soak row ' + rowIndex);
      row.compositor = {
        ...compositorProof,
        offsetMs: compositorProof.atMs - row.atMs,
      };
      if (!compositorProof.visualNonBlank) {
        const existing = state.failures.find((failure) => failure.index === rowIndex);
        if (existing) {
          if (!existing.reasons.includes('compositor')) existing.reasons.push('compositor');
        } else {
          state.failures.push({
            index: rowIndex,
            atMs: row.atMs,
            reasons: ['compositor'],
          });
        }
      }
      state.persist();
    }, {
      globalKey: key,
      rowIndex: index,
      compositorProof: proof,
    });
  }

  const finalState = await page.evaluate(({ globalKey, storageKey }) => {
    const state = window[globalKey];
    if (!state || !state.done || state.rows.length !== 46) {
      throw new Error('Mobile soak did not reach exactly 46 terminal samples');
    }
    return JSON.parse(localStorage.getItem(storageKey));
  }, {
    globalKey: key,
    storageKey: storage,
  });
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(({ storageKey }) => {
    const serialized = localStorage.getItem(storageKey);
    const blob = new Blob([serialized], { type: 'application/json' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = 'contextfix-mobile-soak-raw-final.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, { storageKey: storage });
  const download = await downloadPromise;
  await download.saveAs(project
    + '/output/playwright/contextfix-mobile-soak/contextfix-mobile-soak-raw-final.json');

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
}
