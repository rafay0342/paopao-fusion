# Mobile-browser emulation context-fix soak

Result: **PASS** for `r5-level100-production-contextfix-20260722` (schema 20).

| Check | Measured | Result |
|---|---:|---|
| Wall-clock duration | 0.750 h | pass |
| Samples | 46 | pass |
| Cadence gap | 59990-60018 ms | pass |
| Minimum FPS | 72.3 | pass |
| Maximum p95 frame time | 14.3 ms | pass |
| Peak JS heap | 47.50 MiB | pass |
| Peak browser private memory | 1041.50 MiB | pass |
| WebGL context losses/restores | 0/0 | pass |
| Compositor pixel sentinels | 46 | pass |
| Camera attempts | 0 | pass |

Immutable R5 manifest SHA-256: `30d19f859c0fc6e1a7a051744a9224b7bb2e9308a198da521fe9e5d4fa06d8b9`; content SHA-256: `10694cddc96bc9fa393601e94830825ac02f97864aecf48761199c9eb4630996`; app-bundle SHA-256: `b875a53195f430cf33796ea7f5a0fe01c8e1d82a62489c244271ef2f1004f003`. Artifact identity acceptance: **pass**.

Start, midpoint and final compositor captures are in `docs/production/goldens/` and their SHA-256 values are recorded in the JSON report. Early load history may report bounded texture/object growth; acceptance requires the terminal rolling growth flags to be false.

Limitation: Microsoft Edge desktop mobile emulation; not physical Android hardware, thermals, battery, camera or hand-condition certification.
