# PaoPao Fusion V14 Sources

`manifest.json` is the sole V14 production-master source of truth. It is deterministically projected from the existing 500 PF ledger items and carries the honest approval and provenance state for every source.

Only approved sources belong in `masters/`. Candidate generation and contact-sheet review use the ignored `review/` directory. Rejected candidates are removed when their gate closes.

The current staged preview contains eight genuinely generated and reviewed source masters: Lumi, Aurora Crown, Crystal Realm, Emerald Realm, Prism Warden, the Nexus corruption environment, Keeper/launcher and the six-Pao family. Their compressed runtime output is generated under `public/assets/v14/` and bound to 89 stable runtime keys: nine direct gameplay keys, 72 derived orb keys and eight integrity-verified Production Archive previews. The remaining 492 entries stay honestly `briefed`; no gate is closed early and no model, seed or output identifier is invented.

Run `npm run art:v14:build` to reproduce the approved A1 runtime slice and `npm run art:v14:verify` before candidate work. Both commands treat the production manifest and every approved primary/companion hash as immutable input: they cannot create, overwrite or approve a source master.

Candidate approval is a separate reviewer action. A reviewer-authored promotion receipt must name the exact candidate and destination hashes, durable references, contact sheet, reviewer, generation/review timestamps, final prompt, actual tool/mode, technical metadata and runtime usage. Promote exactly one reviewed source with `npm run art:v14:promote -- --record <receipt.json>`; the command refuses existing approved entries and existing master paths, validates the resulting manifest, and rolls back on failure. The receipt contract is documented in `docs/art/v14/promotion-receipt.md`.

Run the relevant gate validation only when all 100 assigned sources and their required evidence are genuinely complete.
