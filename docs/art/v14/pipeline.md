# V14 Art Production Pipeline

The authoritative flow is:

`ledger brief -> canon references -> candidates -> approval -> master -> normalization -> runtime variants -> integrity manifest -> in-engine review -> release gate`

## Source boundaries

- `docs/production/upgrade-ledger.json` owns the 500 PF IDs and allocation.
- `docs/art/v14/style-bible.md` owns visual canon.
- `art-source/v14/gate-briefs.json` owns gate-level intent and vertical-slice requirements.
- `art-source/v14/manifest.json` is the only ProductionMasterManifestV2 source of truth.
- `art-source/v14/masters/` may contain approved sources only.
- `art-source/v14/review/` is ignored and holds temporary candidates; rejected work is removed at gate close.
- Runtime colour variants, quality tiers, atlases and compressed copies never become additional PF masters.

The V2-V13 trees are frozen legacy inputs. `tools/generate-production-masters.mjs` is explicitly a historical scaffold and is not a V14 final-art producer. It must never write into `art-source/v14/`.

## Honest staged state

The V14 manifest was initialized with all 500 entries in `briefed` state. The current A1 vertical-slice preview has seven approved real masters (`PF-asset-002`, `012`, `021`, `031`, `102`, `402` and `411`) and 493 entries still `briefed`. `primary` and actual provenance fields remain `null` until art is genuinely generated, reviewed and approved. No model, seed or output ID is invented.

Candidate files stay outside `masters/`. Approval is an atomic source-of-truth update: the approved source moves into `masters/`, its exact descriptor and provenance are recorded, a contact sheet and reviewer are bound, and at least one runtime consumer is declared.

An entry may declare `candidateReviews` while its approved `primary` stays
`null`. Each candidate record binds a review-root file descriptor, exact
generation provenance and a pending, reviewed or rejected QA result. Setting
`approval.state` to `candidate-review` requires a real reviewed candidate,
reviewer, timestamp, notes and an existing contact sheet. Candidate hashes are
reported separately and never increase the approved-primary count.

The approved A1 slice is reproducible:

```text
npm run art:v14:build
npm run art:v14:verify
```

The compiler preserves the seven true master identities while deriving 72 colour/skin runtime textures from the one approved neutral Pao family. Those derivatives, quality tiers and fallback formats never inflate the PF count.

## Manifest commands

```text
node tools/v14-art-pipeline.mjs plan
node tools/v14-art-pipeline.mjs validate --phase briefing
node tools/v14-art-pipeline.mjs inspect --id PF-asset-001
node tools/v14-art-pipeline.mjs validate --phase gate --gate A1
node tools/v14-art-pipeline.mjs validate --phase release
```

`plan` writes the deterministic ledger projection to standard output; it does not overwrite approved sources. Briefing validation also proves the committed projection has not drifted from the ledger.

Gate validation requires exactly 100 approved primaries in the selected gate,
approved gate status, unique source hashes, real media structure, provenance,
contact-sheet evidence and runtime usage. A claimed approved gate also needs a
structured `gate.evidence` record whose requirement strings exactly match the
authoritative `gate-briefs.json` contract. Every evidence artifact is a
repository-relative path plus SHA-256 and must exist outside the ignored
candidate-review root. A1 additionally binds every declared vertical-slice
surface to distinct desktop and mobile evidence. Free-form completion claims
cannot replace those files. Release validation requires all five gates and all
500 primaries.

Project-root validation scans `art-source/v14/masters/` even during the normal
briefing/verify phase. An approved-master orphan therefore fails the standard
verify command instead of waiting for gate-close validation.

## Media contracts

- `image`: PNG, WebP, AVIF, JPEG or authored SVG source.
- `layered`: JSON composition with at least two authored layers and explicit safe zones; layer files are integrity-bound companions.
- `atlas`: PNG or WebP primary plus exactly one JSON `atlas-data` companion.
  Every named frame has an in-bounds pixel rectangle and normalized pivot, and
  the authored frame count must match.
- `rig`: JSON with one coherent bone root, valid parent references, no parent
  cycles, unique animations, known-bone tracks and increasing keyframe times.
- `audio`: WAV source whose sample rate, channels, bit depth and duration are
  measured from the RIFF chunks and match both technical and source metadata.
- `video`: MP4 or WebM source whose container dimensions and duration match
  both technical and source metadata.
- `semantic`: JSON with an explicit semantic type and non-empty authored data.

Textual masters containing non-production filler, generated geometric-sheet claims or random semantic data are rejected. Binary formats are signature checked. All files are byte-counted, SHA-256 checked and confined to the V14 master root.

## Reference and output controls

Every reference image has a role, safe repository-relative path and SHA-256. Fighting directories are rejected in source, reference, evidence and usage paths. Every approved source has a concrete runtime usage reference; the validator rejects orphaned files in the master tree.

The validator does not infer visual approval from a valid file. Contact sheets and human review remain required, and image QA continues through actual-scale in-engine captures.

Panels, panel frames, button states, simple icon families, badges, progress
art and simple typography are deterministic UI primitives. New ledger
projections route them to `local-authoring`, not image generation. Existing
untouched briefing-only records retain a narrow migration allowance, but the
first candidate or approved source must use the corrected local-authoring
route. Illustrated instructions, empty states and promotional key art remain
eligible for built-in image generation.

## Runtime delivery boundary

`src/game/hostedAsset.ts` is the single base-URL resolver for self-hosting,
AppDeploy and Sites. Boot art, scene-local legacy recovery art, music,
cinematics, MediaPipe and content-hashed V14 manifest files all pass through
that source-level resolver. The AppDeploy packager only injects the immutable
asset base before module startup; it does not rewrite asset strings inside the
minified bundle and it does not contain a hard-coded repository revision.

V14 bundle files are cache-first only when their paths contain the declared
SHA-256 prefix. The mutable V14 manifest is network-first with the last valid
cached response as bounded offline recovery. Fighting path segments are denied
at both the resolver and service-worker boundaries.
