# Phaser-only implementation status

Status captured: 2026-07-23 (Asia/Karachi).

## Deployed production state

- Phaser 3.90.0 is the only gameplay runtime. There is no Unity project,
  Unity route, Unity build, native desktop binary or Android APK in this
  release.
- `/` is the launcher, `/classic/` is the independently runnable Phaser game,
  and `/downloads/` is the PWA/install hub. `/3d` and `/3d/*` return HTTP 410.
- Fastify serves the active immutable client on `127.0.0.1:8189`; the live
  readiness and health responses report database schema 20.
- The active artifact is
  `r5-level100-production-contextfix-20260722`. Its content SHA-256 is
  `10694cddc96bc9fa393601e94830825ac02f97864aecf48761199c9eb4630996`,
  its manifest SHA-256 is
  `30d19f859c0fc6e1a7a051744a9224b7bb2e9308a198da521fe9e5d4fa06d8b9`,
  and its complete manifest covers 853 files.
- The immutable state is at revision 7 after the exercised R5 to R4 rollback
  and R4 to R5 reactivation. All five context-fix releases remain separately
  verifiable and runnable.
- PlayerSaveV4 migration, revisioned progress, signed bootstrap/content/live
  configuration, versioned progress/run/telemetry APIs and the V3 arena
  WebSocket are implemented. Wallet, purchase, inventory, signed live rewards
  and arena settlement retain server authority.
- The MediaPipe worker keeps camera frames on-device. Gesture recognition is
  bounded and fail-closed, and graphics loss cannot allow a gesture to continue
  across a renderer interruption.
- WebGL loss is observed through Phaser events, browser canvas events and a
  direct context probe. Gameplay, pointer input, video and active hand capture
  pause during loss; they resume only after Phaser restores GPU resources.
  Failure to restore within 10 seconds permits one guarded automatic reload
  into Canvas compatibility mode per browser-tab session.

## Closed release and evidence gates

- `docs/production/upgrade-ledger.json` contains exactly 3,710 unique records.
- All five releases are closed at exactly 742/742 verified records.
- The evidence registry contains 7,160 claims and 7,160 current machine
  receipts. The ledger SHA-256 is
  `dd34635a75f44a7ff3cd754a6dfb0eb9ef7b1fdc544edceeed8240d7c79c07f3`;
  the receipt SHA-256 is
  `46f55dc792b5d23394e2a9e321291c32cade18475c71afbff7bf8bd3f16021d2`.
- The final automated regression run passed 63/63 test files and 7,479/7,479
  tests. Release activation also revalidated the exact ledger split, evidence
  receipts, release ordering and every manifest file hash.
- The fresh fixed-R5 desktop WebGL soak passed for 2.000 hours with 121/121
  compositor samples, a 40.4 FPS floor, 22 ms maximum p95 frame time and
  968.75 MiB peak browser private memory. The fixed-R5 mobile-browser emulation
  soak passed for 45 minutes with 46/46 samples, a 72.3 FPS floor, 14.3 ms
  maximum p95 frame time and 1041.50 MiB peak browser private memory. Both had
  zero WebGL context losses, terminal resource-growth flags false and exact R5
  artifact identity; see the two `performance-soak-*-contextfix-2026-07-22`
  reports.
- The corrected 18-second H.264/AAC hand-control guide is 2,108,153 bytes with
  SHA-256
  `048d5cd0ffd6a908ceab995ae1c0ce5c1301a7a27231944672d575d550582c3f`.

## Delivery and validation boundary

- Windows and Android delivery is the same installable Phaser PWA. PWA support
  is not evidence of a native installer, APK, Android Keystore integration or
  Windows Credential Manager integration.
- Automated landmark corpora, browser emulation and deterministic recovery
  tests do not replace physical-camera testing across real lighting, distance,
  blur and angle conditions. No completed physical-camera matrix is claimed.
- Desktop/mobile browser emulation is not a physical Android device result.
- The complete public source archive and its `/dl` checksum publication remain
  pending until the no-overwrite archive build and full local/remote hash
  verification finish. No completed public archive is claimed here.

## Rollout rule

Never bypass `tools/release-manager.mjs`. A release can activate only after its
exact predecessor is active, its immutable manifest verifies and all 742
assigned ledger records have current machine receipts. A pointer rollback does
not rewind SQLite; mutable data restoration remains a separate encrypted,
offline operation.
