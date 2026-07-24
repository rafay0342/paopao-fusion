# PaoPao Fusion OpenAI Sites wrapper

This Vinext worker publishes the production Phaser build from the repository's
root `dist/` directory. The root route immediately opens
`/classic/index.html`; all game assets, the MediaPipe worker and models are
served by OpenAI Sites instead of a local server.

## Build

Use Node.js 22 or newer. Build the Phaser client first so the wrapper can never
copy a stale bundle:

```bash
npm run build
npm --prefix openai-site ci
npm --prefix openai-site run build
```

`tools/sync-game.mjs` copies the exact root build and creates a cloud-only,
sub-25 MB encode of the source-locked opening cinematic. The original master
is never modified, and generated assets remain ignored.

## Scope

Campaign gameplay, local saves, touch, pointer, keyboard and on-device
hand-tracking run from Sites. The separate Fastify, SQLite and WebSocket server
is not embedded in this static cloud release; server-authoritative accounts,
wallet, arena and live-event services require a dedicated Workers/D1 port.
