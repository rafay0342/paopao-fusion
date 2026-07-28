# V14 reviewed-source promotion

Runtime compilation and source approval are separate operations.

- `art:v14:build` reads approved sources, verifies their recorded byte counts and SHA-256 hashes, and writes only derived runtime bundles/evidence.
- `art:v14:verify` performs the same immutable-source guard before checking runtime files.
- Neither command changes `art-source/v14/manifest.json` or writes under `art-source/v14/masters/`.
- `art:v14:promote` is the only compiler command allowed to add one newly reviewed source. It never updates an existing approved entry or overwrites a master path.

## Reviewer receipt

The reviewer creates a JSON receipt only after candidate, contact-sheet and in-engine review. The receipt is evidence, not a generated approval. It requires:

- `schemaVersion: 1`, `approvalAcknowledged: true` and one `pfId`;
- explicit `reviewer`, `reviewedAt`, `generatedAt`, `finalPrompt`, `actualTool`, `mode` and `approvalNotes`;
- a durable `contactSheetPath`;
- one or more durable `referenceImages`, each with role, path and SHA-256;
- exactly one `files` member with `role: "primary"` and optional companion members with concrete roles;
- each file's ignored review `sourcePath`, new master `destinationPath` and exact `expectedSha256`;
- authored `technical`, `dependencies` and at least one concrete runtime `usageReferences` record;
- `model`, `seed` and `outputId` set to actual returned values or `null`.

Candidate paths must remain under `art-source/v14/review/`. New destination paths must remain under `art-source/v14/masters/`, start with their PF ID and not exist. Durable references cannot point into the disposable review tree.

Run:

```text
npm run art:v14:promote -- --record art-source/v14/review/PF-asset-NNN-promotion.json
npm run art:v14:build
npm run art:v14:verify
```

Promotion writes candidate bytes with create-only semantics, atomically updates the source manifest, runs briefing validation, then rechecks the complete approved-master tree. Any failure restores the original manifest and removes newly created destination files.

An approved source is immutable. A corrected version must receive a new reviewed identity/workflow; it must never be silently replaced by build, verify or a second promotion.
