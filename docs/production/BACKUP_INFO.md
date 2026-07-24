# PaoPao Fusion Phaser backup

The public source archive is named
`paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz`. It contains
the complete Phaser project, final production `dist`, tests, fixtures, shared
contracts, server/tools, authored source masters, runtime assets, evidence,
documentation, media outputs and the exact five verified
`releases-level100-final/` rollback artifacts. It intentionally excludes
dependency caches, logs, browser automation state, temporary databases,
account data, session secrets and obsolete deployment copies.

The archive does not contain:

- `node_modules/`, `.git/` or package-manager credentials;
- `data*/`, `backups/`, SQLite files, `.env*` or server secrets;
- legacy `releases/` previews and `output/release-builds/`; the final five-release rollback tree is retained;
- `.playwright-cli/`, bulk `output/playwright/` captures or test-report scratch files;
- logs, caches, temporary range files, key stores or operating-system junk;
- `unity/`, `public/3d/` or any native-engine artifact.

The hand-control tutorial is included in the archive and is also published as
a direct download at:

`https://rafayamir-1.tail372a9e.ts.net/dl/paopao-handtracking-double-tap-guide-v3.mp4`

The verified 18-second single-pinch/release H.264/AAC file is 2,117,853 bytes.
Its SHA-256 is
`a8b8037b5ea9aa423dca8945640eb4c823402d7052aeb6b53b2839c687a2fcc9`.

## Verify and restore on Windows

Download both the archive and its adjacent
`paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz.sha256`
file. Before extraction, run this one-line CMD command from their folder:

```cmd
certutil -hashfile paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz SHA256 && type paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz.sha256
```

The two 64-character SHA-256 values must match. The canonical download paths
are:

`https://rafayamir-1.tail372a9e.ts.net/dl/paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz`

`https://rafayamir-1.tail372a9e.ts.net/dl/paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz.sha256`

After verification, extract and validate the project:

```cmd
tar -xzf paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz
```

```cmd
cd paopao-phaser && npm ci && npm run validate:ledger && npm test && npm run build
```

```cmd
npm run serve:live
```

To serve the restored immutable R5 pointer instead of rebuilding it, use:

```cmd
set "PAOPAO_RELEASES_DIR=releases-level100-final"&& npm run release:verify-all && npm run release:status && npm run serve:live
```

In a second CMD window:

```cmd
cd paopao-phaser && npm run serve:downloads
```

Restore account data separately from the encrypted private database recovery
snapshot; neither account data nor its Windows-user DPAPI-protected recovery
key is ever published on `/dl`. That private backup is reference-only; the
public archive's exact `releases-level100-final/` tree supplies the separately
restorable immutable artifacts named by its R5 reference.
