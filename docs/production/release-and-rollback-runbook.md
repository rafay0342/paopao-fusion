# Phaser 3.90.0 release and rollback runbook

This runbook controls the five permanent Phaser production gates. A staged
artifact is independently runnable, but staging or previewing it does not mark
the release shipped. Only `release:activate` changes the live release pointer,
and activation always requires exactly 742 machine-receipted ledger items for
that release.

## Immutable release boundary

Each final release lives at `releases-level100-final/<release-id>/` and contains:

- `client/` — the complete static root launcher, `/classic/` Phaser game and
  `/downloads/` install hub;
- `release-manifest.json` — schema-v2 Phaser metadata, every client file's byte
  count and SHA-256, the complete-tree content SHA-256, exact
  `phaser-3.90.0` engine identity and the release number.

During staging, the copied service worker receives a release-specific cache
namespace before hashes are calculated. A rollback therefore installs the
target release's shell/cache generation instead of reusing a newer release's
cached launcher or Phaser entry bundle.

Release IDs use `r1-...` through `r5-...`. The manager refuses an existing
destination instead of replacing it. Verification rejects missing, changed,
extra, duplicate, linked or out-of-tree files and any `/3d` tree. Old schema-v1
preview artifacts remain inspectable but cannot activate.

The five production artifacts must come from their actual gate builds. Do not
stage the same incomplete build five times and do not rename a preview to make
it look shipped.

## Deployed immutable pins

The final root contains these five independently runnable context-fix
artifacts. Each complete manifest has 853 files.

| Gate | Release ID | Content SHA-256 | Manifest SHA-256 | Bytes |
|---:|---|---|---|---:|
| 1 | `r1-level100-foundation-contextfix-20260722` | `5d58473c781b269bf0cca05d1e0135df924032d22b2e4e1bcf3b49d5c949c58c` | `fc1c4a86ba330db3f795deb16d6bae485f61f049e0e2b49b7d58a6357607daa1` | 174,052,925 |
| 2 | `r2-level100-gameplay-contextfix-20260722` | `ed5b7a5f8029eb2a2c3cdad3fa9388f8d1ac94151234295b0e0dca84d941918c` | `4af15dc04a3a0023f0001f58364c58642a626d2b5f86bb2e0d8181ea34fc8f5f` | 174,052,924 |
| 3 | `r3-level100-cinematic-contextfix-20260722` | `1e8d32495bb51da7c85de1ea6c5c9c277a0606fbcca5a469334a9fe64fa69335` | `c632ae4f0ecbbdc00ca92d91a0cf117478cdbafc7ad84c97df66d8cbc02e1e58` | 174,052,920 |
| 4 | `r4-level100-liveops-contextfix-20260722` | `4930172981cdcb5f9961fb59eff68a4b71c1f9d882e4c3ae65675a8fc131fbb8` | `b474b6e0969c99e6e706cc7cdddfe2adb40f0e3913f266a0860fcfe19bdbcbd6` | 174,052,918 |
| 5 | `r5-level100-production-contextfix-20260722` | `10694cddc96bc9fa393601e94830825ac02f97864aecf48761199c9eb4630996` | `30d19f859c0fc6e1a7a051744a9224b7bb2e9308a198da521fe9e5d4fa06d8b9` | 174,052,917 |

All five activation pins use ledger SHA-256
`dd34635a75f44a7ff3cd754a6dfb0eb9ef7b1fdc544edceeed8240d7c79c07f3`
and evidence-receipt SHA-256
`46f55dc792b5d23394e2a9e321291c32cade18475c71afbff7bf8bd3f16021d2`.
The active state is revision 7 with R5 selected after an R5 to R4 rollback and
R4 to R5 reactivation.

## Build, stage and inspect

Run from the Phaser project directory after the relevant gate tests pass. Build
the selected gate explicitly; the normal `npm run build` command intentionally
produces the current Gate 5 profile and must not be relabeled as an earlier
release:

```cmd
set "PAOPAO_RELEASES_DIR=releases-level100-final"
```

When Windows Node is launched from WSL, a plain Bash environment assignment is
not forwarded in this environment. Export the variable through `WSLENV`, or
invoke the command through PowerShell. Otherwise the manager silently uses its
default `releases/` root:

```bash
export PAOPAO_RELEASES_DIR=releases-level100-final
export WSLENV="${WSLENV:+$WSLENV:}PAOPAO_RELEASES_DIR"
WIN_NODE='/mnt/c/Program Files/nodejs/node.exe'
"$WIN_NODE" tools/release-manager.mjs status
```

```cmd
npm run build:release -- 1 dist
npm run release:stage -- r1-foundation-<build-id> dist
npm run release:verify -- r1-foundation-<build-id>
npm run release:status
```

Use `build:release -- 2 dist` through `build:release -- 5 dist` with the
matching `r2-` through `r5-` prefix for later gates. The build command verifies
the exact profile, both release-gate HTML stamps, Phaser-only route boundary and
complete build-tree content hash before it succeeds. Inspect every retained
artifact in one pass with:

```cmd
npm run release:verify-all
```

`release:status` is read-only. It reports each artifact's content and manifest
hash and reports state or active-pin corruption without rewriting anything.

## Run any staged artifact independently

The verified preview command binds to loopback by default and labels responses
with `X-PaoPao-Release`:

```cmd
npm run release:serve -- r1-foundation-<build-id> 4173 127.0.0.1
```

This is a staged preview only. It neither activates the artifact nor grants
ledger credit. A non-loopback bind must be an explicit operator choice.

## Close and activate a gate

Before activation, run the evidence pipeline and full regression suite:

```cmd
npm run evidence:run && npm run evidence:apply && npm run validate:ledger && npm test
npm run release:activate -- r1-foundation-<build-id>
```

Activation fails unless all of these are true:

1. the release tree and complete manifest verify;
2. the manifest is schema v2 and Phaser-only;
3. the ledger has exactly 3,710 unique IDs and five groups of 742;
4. the selected gate is `closed` with 742/742 verified records;
5. all 742 records have current machine receipts and required shared/Phaser
   evidence;
6. Release 1 has no predecessor, while Releases 2–5 have the exact immediately
   preceding active release.

The first successful activation pins one immutable artifact to that release
number. A different artifact cannot later replace the same gate. Activation
state stores the content hash, manifest hash, ledger hash, evidence-receipt
hash, 742 count and a bounded hash-chained transition history.

## Roll back

Rollback can target only an exact artifact that previously passed activation.
It never accepts a merely staged artifact and never manufactures a ledger
history record.

The completed production sequence used these exact immutable IDs:

```cmd
npm run release:activate -- r1-level100-foundation-contextfix-20260722
npm run release:activate -- r2-level100-gameplay-contextfix-20260722
npm run release:activate -- r3-level100-cinematic-contextfix-20260722
npm run release:activate -- r4-level100-liveops-contextfix-20260722
npm run release:activate -- r5-level100-production-contextfix-20260722
```

Roll back one gate:

```cmd
npm run release:rollback
```

Roll back directly to a particular previously activated lower gate:

```cmd
npm run release:rollback -- r2-level100-gameplay-contextfix-20260722
```

The recorded rollback/reactivation drill produced state revision 7:

```cmd
set "PAOPAO_RELEASES_DIR=releases-level100-final"
npm run release:rollback -- r4-level100-liveops-contextfix-20260722
npm run release:status
npm run release:activate -- r5-level100-production-contextfix-20260722
npm run release:status
```

Before changing the pointer, rollback re-verifies the complete target tree and
matches both hashes against its original activation pin. The state file is
written atomically only after those checks pass. Restart the application server
after a successful pointer change because the selected static root is resolved
at process startup, then verify `/`, `/classic/`, `/downloads/`, `/api/health`
and the `X-PaoPao-Release` response header.

Rollback changes only the verified immutable client pointer. It never rewinds
SQLite. Restore mutable data only through the offline encrypted-backup
procedure when a real data-recovery event requires it.

## Production route boundary

| Boundary | Target |
|---|---|
| Public HTTPS 443 `/`, `/classic/`, `/downloads/`, non-admin game APIs | Fastify `127.0.0.1:8189` |
| Public `/dl/*` | Download server `127.0.0.1:3005` |
| Tailnet-only HTTPS 8444 transport | Fastify `127.0.0.1:8189` |
| `/admin` and admin APIs on either proxy | Application additionally requires a Tailscale source address |
| Non-tailnet request to `/admin` | HTTP 403 |
| `/3d` and `/3d/*` | HTTP 410 |

The public 443 root proxy forwards every path, including `/admin`; it is the
Fastify source-address gate that rejects ordinary Funnel clients. A same-tailnet
operator may receive HTTP 200 even when using the 443 hostname, so that probe
must not be described as public Internet access. Port 8444 adds an independent
Tailscale transport boundary. Automatic WebAuthn origin discovery accepts only
the canonical HTTPS port; using ceremonies on `:8444` requires an explicit
matching `PAOPAO_ADMIN_ORIGIN` and RP ID. Zero credentials are currently
enrolled, so enrollment remains `bootstrap-required`.

The application server must inherit the same final release root:

```cmd
set "PAOPAO_RELEASES_DIR=releases-level100-final"&& npm run serve:live
```

After every restart, verify `/`, `/classic/`, `/downloads/`, `/api/health`
schema 20, `/api/ready`, the signed `/api/v3/content/manifest`, public admin
rejection from a genuinely non-tailnet address and
`X-PaoPao-Release: r5-level100-production-contextfix-20260722`. Also verify
that `/3d` returns 410. Do not infer the non-tailnet result from a same-tailnet
probe through the public hostname.

## Renderer-loss recovery

R5 listens to Phaser renderer loss/restore events, browser canvas events and a
direct `isContextLost()` probe. On loss it pauses the game loop, pointer input,
video and active hand capture, resets gesture continuity and exposes an
accessible DOM recovery overlay. It resumes only after Phaser reports that GPU
resources were rebuilt. If recovery does not complete within 10 seconds, the
client may reload once per tab session with
`?paopao-renderer=canvas`; the query parameter and session key prevent a reload
loop. Canvas compatibility mode cannot be reported as a passing WebGL sample.

This mechanism has deterministic-test evidence plus the completed fixed-R5
desktop and mobile-emulation reports in
`performance-soak-desktop-contextfix-2026-07-22.*` and
`performance-soak-mobile-emulated-contextfix-2026-07-22.*`. Those runs passed
their WebGL, cadence, frame-time, memory, compositor and resource-growth gates.
They used headless Edge on Windows ANGLE D3D11 WARP and desktop mobile
emulation respectively; physical GPU, Android, camera and hand-condition
validation remain separate evidence and must not be inferred from activation
or these emulated runs.

Encrypted backup creation must also inherit
`PAOPAO_RELEASES_DIR=releases-level100-final` so its reference points to the
final R5 pin. The encrypted bundle contains SQLite and server secrets; release
artifacts remain immutable reference-only inputs.

If state integrity or a pin fails, stop. Recover the exact immutable release
directory from the verified complete public archive or another separately
retained release-artifact copy and re-run `release:status`; never hand-edit
hashes to silence the failure. The encrypted data backup is reference-only and
intentionally cannot manufacture a missing release tree.
