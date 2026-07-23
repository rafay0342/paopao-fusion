# WebGL context-recovery smoke

The deployed `r5-level100-production-contextfix-20260722` release was exercised in Microsoft Edge with the browser's `WEBGL_lose_context` extension.

- Loss was detected immediately: diagnostics changed to `contextLost=true`, `lossCount=1` and performance budget `fail`.
- Native restoration completed in 804 ms. Diagnostics returned to `ready`, `restoredCount=1`, and the same `Intro` scene and URL remained active.
- Before/after screenshots are visually nonblank and show continued cinematic rendering.
- In a separate branch, restoration was deliberately withheld. The bounded 10-second timeout reloaded once with `?paopao-renderer=canvas`; the query/session guard prevented a reload loop and the Canvas session remained active.

This proves both fast native restoration and the one-attempt Canvas escape path. It is a fault-injection smoke, not a substitute for the separate spontaneous-loss long-session soak.

