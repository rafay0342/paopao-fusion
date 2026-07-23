(() => {
  'use strict';

  const requested = window.__PAOPAO_SOAK_CONFIG__ ?? {};
  const GLOBAL_KEY = String(requested.globalKey ?? '__PAOPAO_CONTEXTFIX_SOAK_V2__');
  const PROMISE_KEY = String(requested.promiseKey ?? '__PAOPAO_CONTEXTFIX_SOAK_INSTALL_PROMISE__');
  const STORAGE_KEY = String(requested.storageKey ?? 'paopao:contextfix-desktop-soak:v2');
  const TEST_ID = String(requested.testId ?? 'desktop-webgl-soak-contextfix-2026-07-22');
  const SAMPLE_TOTAL = Number.isInteger(requested.total) && requested.total >= 1 && requested.total <= 1_000
    ? requested.total
    : 121;
  const PERIOD_MS = Number.isInteger(requested.periodMs) && requested.periodMs >= 10_000
    ? requested.periodMs
    : 60_000;

  if (window[GLOBAL_KEY]) {
    window[PROMISE_KEY] = Promise.resolve({
      alreadyInstalled: true,
      count: window[GLOBAL_KEY].rows.length,
      startedAt: window[GLOBAL_KEY].startedAt,
    });
    return;
  }

  window[PROMISE_KEY] = (async () => {
    const production = window.__PAOPAO_PRODUCTION__;
    if (!production || typeof production.report !== 'function') {
      throw new Error('Production diagnostics unavailable');
    }

    const initial = production.report();
    if (!initial.activeScenes.includes('Game')
      || initial.renderer !== 'webgl'
      || initial.contextLost
      || initial.contextLossCount !== 0
      || initial.snapshot.averageFps < 30
      || initial.snapshot.p95FrameMs > 33
      || initial.snapshot.budget !== 'pass') {
      throw new Error('Clean passing Game/WebGL preflight required');
    }

    const healthResponse = await fetch('/api/health', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!healthResponse.ok) throw new Error(`Health preflight failed: ${healthResponse.status}`);
    const health = await healthResponse.json();
    const canvas = document.querySelector('#game canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Game canvas unavailable');

    const state = {
      evidenceVersion: 2,
      testId: TEST_ID,
      startedAt: Date.now(),
      periodMs: PERIOD_MS,
      total: SAMPLE_TOTAL,
      rows: [],
      done: false,
      endedAt: null,
      cadenceBroken: false,
      maxGapMs: 0,
      maxLatenessMs: 0,
      cameraAttempts: 0,
      cameraPatchInstalled: false,
      renderEvents: [],
      failures: [],
      identity: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        releaseId: healthResponse.headers.get('x-paopao-release'),
        schemaVersion: health.schemaVersion,
        productionSchema: production.schemaVersion ?? 2,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvas: {
          width: canvas.width,
          height: canvas.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
        },
      },
      timer: 0,
    };

    const media = navigator.mediaDevices;
    if (media && typeof media.getUserMedia === 'function') {
      const originalGetUserMedia = media.getUserMedia.bind(media);
      try {
        media.getUserMedia = (...args) => {
          state.cameraAttempts += 1;
          return originalGetUserMedia(...args);
        };
        state.cameraPatchInstalled = true;
      } catch {
        state.cameraPatchInstalled = false;
      }
    }

    const recordEvent = (type, detail = null) => {
      state.renderEvents.push({ type, at: Date.now(), detail });
    };
    canvas.addEventListener('webglcontextlost', (event) => {
      recordEvent('webglcontextlost', { defaultPrevented: event.defaultPrevented });
    });
    canvas.addEventListener('webglcontextrestored', () => recordEvent('webglcontextrestored'));
    window.addEventListener('paopao:render-context-boundary', (event) => {
      recordEvent('paopao:render-context-boundary', event.detail ?? null);
    });

    const hashBytes = (bytes) => {
      let hash = 2_166_136_261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16_777_619);
      return hash >>> 0;
    };

    const pixelProof = () => {
      try {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl || gl.isContextLost()) {
          return { present: true, lost: true, error: 'context-unavailable' };
        }

        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const center = new Uint8Array(16 * 16 * 4);
        gl.readPixels(
          Math.max(0, (width - 16) >> 1),
          Math.max(0, (height - 16) >> 1),
          16,
          16,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          center,
        );

        const probe = document.createElement('canvas');
        probe.width = 18;
        probe.height = 32;
        const context2d = probe.getContext('2d', { willReadFrequently: true });
        if (!context2d) {
          return {
            present: true,
            lost: false,
            width,
            height,
            centerHash: hashBytes(center),
            error: '2d-probe-unavailable',
          };
        }

        context2d.drawImage(canvas, 0, 0, probe.width, probe.height);
        const bytes = context2d.getImageData(0, 0, probe.width, probe.height).data;
        const colors = new Set();
        let nonTransparent = 0;
        let nonBlack = 0;
        let minLuma = 255;
        let maxLuma = 0;

        for (let offset = 0; offset < bytes.length; offset += 4) {
          const red = bytes[offset];
          const green = bytes[offset + 1];
          const blue = bytes[offset + 2];
          const alpha = bytes[offset + 3];
          if (alpha > 8) nonTransparent += 1;
          const luma = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
          if (alpha > 8 && luma > 12) nonBlack += 1;
          minLuma = Math.min(minLuma, luma);
          maxLuma = Math.max(maxLuma, luma);
          colors.add(((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3));
        }

        return {
          present: true,
          lost: false,
          width,
          height,
          centerHash: hashBytes(center),
          visualHash: hashBytes(bytes),
          uniqueColors: colors.size,
          nonTransparent,
          nonBlack,
          minLuma,
          maxLuma,
          inPageCaptureLimitation: nonBlack === 0 && colors.size === 1,
        };
      } catch (error) {
        return {
          present: true,
          lost: true,
          error: String(error),
        };
      }
    };

    const persist = () => {
      const serial = {
        evidenceVersion: state.evidenceVersion,
        testId: state.testId,
        startedAt: state.startedAt,
        periodMs: state.periodMs,
        total: state.total,
        rows: state.rows,
        done: state.done,
        endedAt: state.endedAt,
        cadenceBroken: state.cadenceBroken,
        maxGapMs: state.maxGapMs,
        maxLatenessMs: state.maxLatenessMs,
        cameraAttempts: state.cameraAttempts,
        cameraPatchInstalled: state.cameraPatchInstalled,
        renderEvents: state.renderEvents,
        failures: state.failures,
        identity: state.identity,
      };
      const serialized = JSON.stringify(serial);
      localStorage.setItem(STORAGE_KEY, serialized);
      sessionStorage.setItem(STORAGE_KEY, serialized);
    };

    const tick = () => {
      if (state.done) return;
      const index = state.rows.length;
      const atMs = Date.now();
      const scheduledAt = state.startedAt + index * state.periodMs;
      const previous = state.rows.at(-1);
      const gapMs = previous ? atMs - previous.atMs : 0;
      const latenessMs = atMs - scheduledAt;
      if (previous && (gapMs < 55_000 || gapMs > 65_000)) state.cadenceBroken = true;
      state.maxGapMs = Math.max(state.maxGapMs, gapMs);
      state.maxLatenessMs = Math.max(state.maxLatenessMs, Math.abs(latenessMs));

      const report = production.report();
      const snapshot = report.snapshot;
      const pixel = pixelProof();
      const row = {
        index,
        at: new Date(atMs).toISOString(),
        atMs,
        scheduledAt,
        gapMs,
        latenessMs,
        elapsedMs: atMs - state.startedAt,
        fps: snapshot.averageFps,
        p95Ms: snapshot.p95FrameMs,
        longFrames: snapshot.longFrames,
        frameWindow: snapshot.frameSamples,
        budget: snapshot.budget,
        quality: snapshot.quality,
        jsHeapBytes: snapshot.jsHeapBytes,
        peakJsHeapBytes: snapshot.peakJsHeapBytes,
        textures: snapshot.textureCount,
        objects: snapshot.gameObjectCount,
        growth: report.resourceGrowth,
        scenes: report.activeScenes,
        renderer: report.renderer,
        contextStatus: report.contextStatus,
        contextLost: report.contextLost,
        contextLossCount: report.contextLossCount,
        contextRestoredCount: report.contextRestoredCount,
        visibility: document.visibilityState,
        cameraAttempts: state.cameraAttempts,
        pixel,
      };
      state.rows.push(row);

      const reasons = [];
      if (row.fps < 30) reasons.push('fps');
      if (row.p95Ms > 33) reasons.push('p95');
      if (row.budget !== 'pass') reasons.push('budget');
      if (!row.scenes.includes('Game')) reasons.push('scene');
      if (row.renderer !== 'webgl') reasons.push('renderer');
      if (row.contextLost || row.contextLossCount !== 0 || row.contextRestoredCount !== 0) reasons.push('context');
      if (row.visibility !== 'visible') reasons.push('visibility');
      if (row.cameraAttempts !== 0) reasons.push('camera');
      if (reasons.length) state.failures.push({ index, atMs, reasons });

      if (state.rows.length === state.total) {
        state.done = true;
        state.endedAt = Date.now();
        state.timer = 0;
      } else {
        const nextAt = state.startedAt + state.rows.length * state.periodMs;
        state.timer = window.setTimeout(tick, Math.max(0, nextAt - Date.now()));
      }
      persist();
    };

    window[GLOBAL_KEY] = state;
    state.persist = persist;
    tick();
    return {
      installed: true,
      startedAt: state.startedAt,
      startedAtIso: new Date(state.startedAt).toISOString(),
      count: state.rows.length,
      first: state.rows[0],
      identity: state.identity,
    };
  })();
})();
