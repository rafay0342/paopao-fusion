# Desktop WebGL soak — 2026-07-22

**Verdict: FAIL.** The timed diagnostics and numeric performance limits passed, but the final WebGL context was lost and both final screenshots rendered a blank white canvas. This run cannot close the long-session production gate.

## Run identity

- Release: `r5-level100-production-20260722`
- API schema: `20`
- URL: `https://rafayamir-1.tail372a9e.ts.net/classic/`
- Browser: Microsoft Edge Chromium through the mandatory Playwright CLI wrapper, headless
- Viewport: 1440×900; game canvas: 720×1280 (506×900 CSS pixels)
- Session: `paopao-final-desktop-soak`; Playwright daemon PID `19404`; Edge root PID `7384`
- Scene/renderer: `Game` / WebGL
- Camera: permissions cleared and `getUserMedia` guarded fail-closed; observed camera attempts: `0`
- Input: bounded pointer movement only; no shots

## Timed result

- Started: `2026-07-22T12:33:47.708Z`
- Ended: `2026-07-22T14:51:33.475Z`
- Duration: `8,265,767 ms` (2 h 17 m 45.767 s)
- Samples: exactly `121`, indices `0..120`
- Minimum sampled average FPS: `31.2` at index 89
- Maximum sampled p95 frame time: `31.8 ms` at index 82
- Final: `34.5 FPS`, `29.4 ms` p95, `0` long frames, performance tier
- Every diagnostic sample reported budget `pass`, `Game`, WebGL, R5/schema 20, and camera attempts `0`
- Frame window never exceeded `600`
- Peak JS heap: `43,084,905 bytes`
- Browser-only Edge private-memory peak: `1,125,552,128 bytes`, below the `1,200,000,000`-byte limit
- Final texture, object, and JS-heap growth flags: all `false`; only the first two warm-up samples flagged texture growth
- Adaptive quality changed from ultra to performance at index 75, `2026-07-22T14:06:33.429Z`

## Blocking failure

Post-run visual verification produced two blank final captures. Direct canvas inspection then returned:

- `WebGLRenderingContext.isContextLost() === true`
- `getError() === 37442`
- `CONTEXT_LOST_WEBGL === 37442`

The diagnostics loop nevertheless continued to report `Game`, `webgl`, and budget `pass`. This is a monitoring blind spot: frame counters alone did not prove that pixels were still renderable.

The exact loss instant is unknown because context and framebuffer health were not sampled each minute. A WMIC process-tree observation returned zero rows at `2026-07-22T19:04:00+05:00` (invalid as a memory sample), and the first sustained FPS/quality drop appeared at `2026-07-22T14:06:33.429Z`; this is only a likely interval, not an exact timestamp.

## Harness recovery and continuity

The per-minute wrapper failed outside the browser, first from transient Windows Node/WSL launch failures and then from a recovery-script `ReferenceError` before its loop. The browser itself remained open on the same URL and `Game` scene.

- Sample 47: `2026-07-22T13:20:49.272Z`, runtime counter `558,572`
- Sample 48: `2026-07-22T13:39:33.282Z`, runtime counter `755,166`
- Instrumentation gap: `1,124,010 ms`
- Counter increase across the gap: `196,594`
- Diagnostics `startedAt` remained `1784723310150`

The original clock was preserved and the remaining samples resumed at 60-second cadence. The gap is disclosed and is not represented as continuous per-minute instrumentation.

A separate headed-browser pre-evidence attempt also ended under system paging pressure. It is not counted in this acceptance run because its exact start was not retained.

## Captures

- Start, non-blank Game board: `output/playwright/r5-final-desktop-soak-continuous-start-2026-07-22.png`
- Final, blank: `output/playwright/r5-final-desktop-soak-final-2026-07-22.png`
- Final verification, blank: `output/playwright/r5-final-desktop-soak-final-verified-2026-07-22.png`

## Required recovery acceptance

1. Add `webglcontextlost` / `webglcontextrestored` handling and expose `contextLost`, `contextLossCount`, and `lastLossAt` in production diagnostics.
2. Fail closed on loss: pause input and timers, preserve deterministic board/seed/state, rebuild the renderer/textures/pipelines, verify a non-blank framebuffer, then resume or present a recovery action.
3. Add a cheap framebuffer/pixel sentinel to each soak sample so a blank canvas cannot report `pass`.
4. Rerun a clean two-hour desktop soak with 121 cadence samples, no instrumentation gap, zero spontaneous context loss, and non-blank start/mid/final captures.
5. Retain the numeric gates: at least 30 FPS, p95 no more than 33 ms, frame window no more than 600, browser private memory no more than 1.2 GB, no final resource growth, stable R5/schema 20, and camera off.

The machine-readable evidence, all 121 compact sample rows, process-memory observations, recovery record, and acceptance booleans are in `performance-soak-desktop-2026-07-22.json`.

## Scope limits

- This was headless desktop Edge Chromium on Windows, not a physical Android result.
- Camera was intentionally disabled; no physical hand-tracking condition matrix was exercised.
- One WMIC zero-row observation is marked invalid and excluded from aggregates.
- The context-loss instant is inferred, not directly sampled.
