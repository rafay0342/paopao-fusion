# PaoPao Fusion Phaser release gates

The source of truth is [`upgrade-ledger.json`](./upgrade-ledger.json). It contains 3,710 literal records rather than count ranges. Every record has one primary category, one release, one acceptance test and separate shared and Phaser web evidence slots. Device, input, quality, packaging and compressed delivery variants never create extra ledger items.

Run `npm run generate:ledger` after changing the deterministic generator, then `npm run validate:ledger`. The validator rejects missing or duplicate IDs, incorrect category totals, incorrect per-release splits, incomplete acceptance tests, unsafe evidence paths, missing Phaser evidence, excluded client evidence and any closed release with fewer than 742 verified records.

## Machine evidence binding

Ledger credit is derived from [`evidence/claims.json`](./evidence/claims.json) and [`evidence/receipts.json`](./evidence/receipts.json); paths written directly into a ledger record never create credit. One claim covers exactly one ledger item and one target (`shared` or `phaser`). Its assertion ID is derived from the item acceptance ID, and its exact Vitest full name must contain `[AT-PF-…][target]`. A test file may host multiple cases, but one generic case can never be reused by multiple claims.

The runner hashes the acceptance contract, every implementation file and the exact test source. Editing any of those invalidates the receipt. A client-facing item becomes verified only after separate shared and Phaser assertions pass. Non-client items require a passing shared assertion. The generator re-materializes these receipts instead of erasing or trusting hand-edited evidence.

Use these commands in order:

1. Add a dedicated acceptance case and one claim per required target.
2. Run `npm run evidence:run` to execute the named cases and write current SHA-256 receipts.
3. Run `npm run evidence:apply` to derive ledger states from those receipts.
4. Run `npm run validate:ledger` and the full test suite.

`npm run evidence:audit` is read-only. Release activation performs the same audit, so stale, duplicated, generic or manually inflated evidence cannot close a gate. The final registry contains 7,160 claims backed by 7,160 current passing receipts. Those receipts materialize all 3,710 ledger records as `verified`; every release gate is closed at exactly 742/742.

The 500 source masters pass `evidence:check-assets`; their optimized Phaser delivery passes `evidence:check-runtime`. `evidence:map-assets` and `evidence:map-runtime` bind the separate shared and Phaser claims. Both layers must remain current after any source or runtime asset edit.

## Gate states

All five final gates are closed at 742/742. `planned` and `implemented` remain valid intermediate states for a future evidence regeneration, but neither earns gate credit. A record earns gate credit only when `evidence.status` is `verified`; client-facing records also require verified `shared` and `phaser` evidence with implementation and test paths.

| Release | Gate | Assigned records | Required verified records | State | Rollback boundary |
|---:|---|---:|---:|---|---|
| 1 | Foundation and migration | 742 | 742 | closed · 742/742 | Keep `/classic/` and the V3 adapter active; restore the prior manifest and route root to Classic. |
| 2 | Complete gameplay coverage | 742 | 742 | closed · 742/742 | Pin Phaser to the Release 1 content hash and disable Release 2 configuration. |
| 3 | Cinematic presentation | 742 | 742 | closed · 742/742 | Select the Release 2 Phaser atlas and asset manifest. |
| 4 | Endless live operations | 742 | 742 | closed · 742/742 | Disable live-event flags, reject new challenge signatures and settle already accepted rewards. |
| 5 | Production hardening | 742 | 742 | closed · 742/742 | Restore the previously pinned signed client artifact. Restore mutable database state only through the separately verified encrypted-backup procedure when data recovery is required. |

Release-manager eligibility enforces artifact integrity, ledger closure, current receipts and activation order. Browser/device performance, soak and physical hand-condition matrices are separate handoff evidence and must be reported from actual measurements. A missing build, placeholder asset or contract delta keeps a release ineligible.

An immutable staged release must contain `index.html`, `/classic/index.html` and `/downloads/index.html`. Its launcher must link to `/classic/` and `/downloads/`, and the staged tree must not contain `/3d` content. Staging, verification and activation all enforce this boundary. Activation additionally requires the exact predecessor and 742/742 verified ledger records.

Operational commands, immutable schema-v2 hashes, independently runnable staged
artifacts, activation pins and rehearsed rollback procedures are documented in
[`release-and-rollback-runbook.md`](./release-and-rollback-runbook.md). Staging
never closes a gate, and rollback accepts only an exact artifact recorded by a
prior successful 742/742 activation.

## Final immutable artifact pins

The final release root is `releases-level100-final`. The active pointer is R5 after a verified R5 → R4 → R5 rollback/reactivation drill.

| Release artifact | Content SHA-256 | Manifest SHA-256 | Files |
|---|---|---|---:|
| `r1-level100-foundation-contextfix-20260722` | `5d58473c781b269bf0cca05d1e0135df924032d22b2e4e1bcf3b49d5c949c58c` | `fc1c4a86ba330db3f795deb16d6bae485f61f049e0e2b49b7d58a6357607daa1` | 853 |
| `r2-level100-gameplay-contextfix-20260722` | `ed5b7a5f8029eb2a2c3cdad3fa9388f8d1ac94151234295b0e0dca84d941918c` | `4af15dc04a3a0023f0001f58364c58642a626d2b5f86bb2e0d8181ea34fc8f5f` | 853 |
| `r3-level100-cinematic-contextfix-20260722` | `1e8d32495bb51da7c85de1ea6c5c9c277a0606fbcca5a469334a9fe64fa69335` | `c632ae4f0ecbbdc00ca92d91a0cf117478cdbafc7ad84c97df66d8cbc02e1e58` | 853 |
| `r4-level100-liveops-contextfix-20260722` | `4930172981cdcb5f9961fb59eff68a4b71c1f9d882e4c3ae65675a8fc131fbb8` | `b474b6e0969c99e6e706cc7cdddfe2adb40f0e3913f266a0860fcfe19bdbcbd6` | 853 |
| `r5-level100-production-contextfix-20260722` | `10694cddc96bc9fa393601e94830825ac02f97864aecf48761199c9eb4630996` | `30d19f859c0fc6e1a7a051744a9224b7bb2e9308a198da521fe9e5d4fa06d8b9` | 853 |

All pins use Phaser `3.90.0`, ledger SHA-256 `dd34635a75f44a7ff3cd754a6dfb0eb9ef7b1fdc544edceeed8240d7c79c07f3` and final evidence-receipt SHA-256 `46f55dc792b5d23394e2a9e321291c32cade18475c71afbff7bf8bd3f16021d2`.

## Exact category split

| Primary category | Total | Per release |
|---|---:|---:|
| Platform upgrades | 100 | 20 |
| Verified improvements | 100 | 20 |
| UI systems | 100 | 20 |
| Frontend capabilities | 150 | 30 |
| Backend capabilities | 250 | 50 |
| Mechanisms and deterministic logic | 500 | 100 |
| Functionality, realism and flow | 200 | 40 |
| Security and authentication gates | 10 | 2 |
| Rendering and graphics systems | 100 | 20 |
| UI and UX elements | 500 | 100 |
| Animated production elements | 500 | 100 |
| Animation clips and effects | 500 | 100 |
| Unique asset and media masters | 500 | 100 |
| Gameplay-control refinements | 100 | 20 |
| MediaPipe and vision improvements | 100 | 20 |
| **Total** | **3,710** | **742** |

## Asset-master allocation

The 500 asset records count authored source masters only. Runtime texture sizes, compressed copies, localization exports, quality variants and packaged delivery formats are evidence attached to a master, never extra masters.

| Master allocation | Total | Per release |
|---|---:|---:|
| Characters, orbs, bosses and rigs | 100 | 20 |
| Environment models and props | 100 | 20 |
| Material, texture and VFX source packs | 100 | 20 |
| UI, icon and illustration masters | 80 | 16 |
| Music, ambience and SFX masters | 60 | 12 |
| Cinematic sequences | 40 | 8 |
| Tutorial, accessibility and promotional assets | 20 | 4 |
| **Total** | **500** | **100** |

Original stylized art is required. Third-party film characters, copied studio designs, generated duplicates presented as unique masters and format conversions presented as new assets are not eligible for gate credit.
