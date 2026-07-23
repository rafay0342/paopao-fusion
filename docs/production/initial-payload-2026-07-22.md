# Final R5 initial-payload evidence

Captured on 2026-07-22 from the public Tailscale URL in a fresh Microsoft Edge in-memory context.

| Surface | Entries | Transferred | Encoded payload | Result |
|---|---:|---:|---:|---|
| Smart launcher `/` | 7 | 2,829,820 bytes | 2,827,720 bytes | recorded |
| Phaser `/classic/` | 52 | 9,678,944 bytes | 58,183,826 bytes (55.49 MiB) | pass |

The Phaser load is below the 75 MiB (78,643,200-byte) limit by 20,459,374 bytes. The encoded total deliberately includes the 45,954,829-byte opening cinematic even when Resource Timing reports a cached transfer, so cache reuse does not artificially improve the acceptance result.

At capture, the Intro scene was running through WebGL with a bounded 600-frame diagnostic window, 177.2 average FPS, 5.6 ms p95 frame time, 17,224,973-byte peak JavaScript heap, 50 textures and 15 game objects. The runtime budget reported `pass`, with no texture or game-object growth.

The public R5 application bundle and hand-tracking worker matched their immutable release copies byte-for-byte. Full structured evidence is in [`initial-payload-2026-07-22.json`](./initial-payload-2026-07-22.json).

The only console entry classified as an error was MediaPipe's own `INFO: Created TensorFlow Lite XNNPACK delegate for CPU` log emitted through its error stream; it was not an application exception.
