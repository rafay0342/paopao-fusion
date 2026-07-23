# Context-fix R5 initial payload

Fresh Microsoft Edge profiles measured the deployed launcher and Phaser client for `r5-level100-production-contextfix-20260722`.

| Surface | Entries | Encoded payload | Result |
|---|---:|---:|---|
| Launcher `/` | 7 | 2,827,720 bytes | recorded |
| Phaser `/classic/` measured resources | 51 | 13,727,217 bytes | recorded |
| Phaser plus full bundled cinematic | conservative | 59,682,046 bytes (56.92 MiB) | pass |

The conservative total is 18,961,154 bytes below the 75 MiB ceiling. The browser loaded the cinematic through media/range behavior that did not expose its bytes as a Resource Timing row in this run, so the complete 45,954,829-byte file was added rather than treating the missing timing row as zero.

The deployed Classic HTML, application bundle and hand-tracking worker match the immutable R5 copies byte-for-byte. This capture proves payload and integrity only; the separate soak report owns FPS, memory and growth acceptance.

