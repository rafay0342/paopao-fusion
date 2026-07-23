# PaoPao Fusion R5 mobile-browser emulation soak

Date: 2026-07-22  
Release: `r5-level100-production-20260722`  
API schema: `20`  
Result: wall-clock soak completed; instrumented rolling performance checks passed, with a late shared-host scheduling limitation described below.

## Scope and method

- Microsoft Edge Chromium `150.0.4078.83`, running Playwright's mobile-browser emulation.
- Pixel 10 class mobile UA, `360x732` CSS viewport, DPR `3`, coarse pointer and one emulated touch point.
- Live launcher was opened first, then `/classic/` was entered through the launcher and the touch flow reached the actual `Game` scene.
- The camera button was never pressed. The final audit found zero active media streams and zero live video tracks.
- The official run used one isolated Playwright CLI session, 46 timestamped samples (`0..45`) and bounded in-canvas pointer movement at every sample.
- Start: `2026-07-22T12:35:01.719Z`; finish: `2026-07-22T13:20:12.021Z`; measured sample span: `2,710,302 ms` (45m 10.302s). The supervising shell span was `2,713,000 ms`.

This evidence is desktop browser emulation. It is not a physical Android or camera/hand-condition certification.

## Instrumented result

| Check | Result |
|---|---:|
| Samples | 46 / 46 |
| Scene / renderer | `Game` / `webgl` for every sample |
| Release health | HTTP 200, R5 header and schema 20 for every sample |
| Warmed mean of rolling average FPS | 175.57 FPS |
| Minimum warmed rolling average FPS | 109 FPS |
| Mean warmed rolling p95 | 5.66 ms |
| Maximum warmed rolling p95 | 6.0 ms |
| Long frames | 0 at every sample |
| Frame window | 600 / 600, bounded at every sample |
| JS heap peak | 41,828,424 bytes (39.89 MiB) |
| Final JS heap | 16,110,332 bytes |
| Final textures / objects | 63 / 76 |
| Warmed resource-growth flags | all false from sample 4 through sample 45 |
| Runtime counter delta | 444,304 samples |
| Counter delta over wall time | 163.93 samples/s |

The in-app performance budget reported `pass` for all 46 samples. The rolling 30 FPS floor, p95 33 ms ceiling, 600-frame bound and 1.2 GB JS-heap ceiling were all satisfied.

## Late host-scheduling observation

From sample 42, the shared Windows host heavily throttled the headed emulated window despite `document.visibilityState === "visible"` and the anti-background launch flags. The rolling diagnostic remained above 30 FPS and the page did not crash, reset or recover, but the visible canvas run clock advanced to roughly `42:32` rather than a continuously active 45 minutes.

Accordingly, this report proves a real 45-minute browser wall-clock session and passing in-app rolling counters; it does not claim a dedicated-device, continuously foregrounded physical Android result. A physical Android run with the camera and hand-condition matrix remains a separate acceptance activity.

## Visual evidence

- [Launcher start](./goldens/r5-mobile-emulated-soak-launcher-start-edge.png)
- [Game start](./goldens/r5-mobile-emulated-soak-game-start.png)
- [Game final](./goldens/r5-mobile-emulated-soak-game-final.png)

Both game captures show level 1's live board intact in the same gameplay scene. The final capture shows the advanced run clock and stable presentation.

## Evidence boundaries

- No camera permission was requested and no camera stream ran.
- No physical Android hardware, thermal, battery, blur, darkness, backlight or hand-landmark condition was tested.
- Per-process private memory could not be isolated honestly from other concurrent Edge sessions. The recorded memory evidence is the app's JS heap counter.
- Two preflight contexts were rejected before the official clock: cached headless Chromium crashed on the classic load, and an early headed context was invalidated when its runtime counter stopped. Neither was included in the 46 official samples.

The exact sample corpus and machine-readable summary are in [`performance-soak-mobile-emulated-2026-07-22.json`](./performance-soak-mobile-emulated-2026-07-22.json).
