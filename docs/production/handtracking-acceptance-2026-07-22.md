# Hand-tracking acceptance boundary

The shipped Phaser control uses one on-device MediaPipe worker and a fail-closed contact state machine. The player aims, touches thumb/index and separates the tips slightly to fire in one natural pinch/release. The whole palm does not need to open, and a small confirmed loss of fingertip contact is enough to register release.

Implemented protections include:

- first-launch camera-free model prewarm, parallel camera/model start and immediate first-frame scheduling;
- explicit 15/20/30 FPS input cadence independent of render quality;
- aspect-corrected image geometry plus world-landmark depth, yaw/pitch and palm-scale checks;
- close/far-hand bounds, stable palm anchors, dominant-hand continuity and hand-switch rejection;
- multi-frame raw/filtered contact confirmation and small-gap adaptive release;
- bounded adaptive result-age acceptance, duplicate/order rejection, tracking-loss cancellation and fresh-open rearm;
- one frame in flight, bitmap/inference watchdogs, worker/camera recovery and continuity generations;
- bounded 640×480 camera input, adaptive 512/384/320px inference and optional dark/backlit enhancement; preprocessing faults do not stop model inference, while blurred or uncertain gesture frames remain fail-closed;
- lifecycle handling for camera loss, pause/background/resume and delayed camera-start races;
- no camera-frame upload, recording or server transport.

Regression coverage is concentrated in:

- `tests/handtracking-latency.test.ts` — playable single pinch/release timing, legacy replay compatibility, noisy-frame rejection, depth/angle/scale gates, prewarm and recovery;
- `tests/handgeometry.test.ts` — roll, yaw, pitch, perspective, aspect ratio, world depth and malformed inputs;
- `tests/handsettings-contact.test.ts` — safe calibration and corrupt/legacy threshold repair;
- `tests/handvision.test.ts` — close/far acquisition, dark/backlit enhancement, blur and slow-device budgets;
- `tests/handmotion.test.ts` — jitter suppression, variable-FPS stability and long-session reset behavior.

The scripted timestamped landmark corpus permits no false shot in its negative cases, and incomplete/uncertain sequences fail closed. Browser long-session evidence keeps the camera disabled so it measures game/runtime resource stability without claiming a camera-condition test.

No physical camera matrix was run in this handoff. Angle, distance, blur, dark/backlit and camera-loss logic is covered by deterministic fixtures, but real-device certification across actual Android/Windows cameras, rooms and lighting remains a separate hardware QA activity. The mobile soak is browser emulation, not a physical Android result.
