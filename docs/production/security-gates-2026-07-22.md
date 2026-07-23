# Phaser Level-100 security gates

All ten ledger security records are machine-receipted and `verified`. They are
part of the closed 3,710-record ledger; each of the five releases is closed at
742/742. This table distinguishes implementation evidence from live operator
enrollment and physical-device evidence.

| ID | Gate | Production boundary | Acceptance evidence | State |
|---|---|---|---|---|
| `PF-security-001` | Session, CSRF and token lifecycle | HttpOnly same-site browser session, CSRF on mutations and bounded wallet operations | `tests/platform-backend.test.ts` | verified |
| `PF-security-002` | Signed bootstrap and compatibility | Ed25519-signed V3 bootstrap/content declaration with Phaser 3.90.0 as the sole client runtime | `tests/backend-v4-contract.test.ts` | verified |
| `PF-security-003` | Save revision and anti-rollback | Normalized V3 to PlayerSaveV4 migration, stale-revision rejection and server-owned entitlements | `tests/backend-v4-contract.test.ts` | verified |
| `PF-security-004` | Wallet/inventory authority and idempotency | Atomic wallet debit plus inventory grant; a replay returns its prior result and a conflicting replay fails | `tests/platform-backend.test.ts` | verified |
| `PF-security-005` | Signed manifests and checksums | Persistent Ed25519 keyring rotation with bounded retired-key verification overlap | `tests/security-admin.test.ts` | verified |
| `PF-security-006` | Privacy, CSP and validation | Camera frames remain in the browser worker; restrictive headers, strict API schemas and no frame-upload path | `tests/contracts-v3.test.ts` | verified |
| `PF-security-007` | OTP recovery and abuse limits | Source-IP limiting remains effective when an attacker varies email addresses | `tests/platform-backend.test.ts` | verified |
| `PF-security-008` | Authoritative arena/replay validation | Immutable arena result, ordered/cadenced observed inputs, reconnect replay and bounded match/finish/disconnect timeouts | `tests/platform-arena-hardening.test.ts` | verified |
| `PF-security-009` | Tailnet-source WebAuthn admin | P-256 registration/authentication, verified origin/RP/user presence, replay/counter rejection, admin session and CSRF | `tests/security-admin.test.ts` | verified |
| `PF-security-010` | Encrypted backup, audit and rotation | AES-256-GCM bundle, hashed audit chain, isolated SQLite restore and restored secret/keyring verification | `tests/operational-hardening.test.ts` | verified |

## Live operational facts

- The deployed artifact is Phaser-only
  `r5-level100-production-contextfix-20260722`; health and readiness return
  schema 20 and its `X-PaoPao-Release` header. `/3d` returns HTTP 410.
- Public HTTPS 443 and tailnet-only HTTPS 8444 both proxy to the same Fastify
  process on `127.0.0.1:8189`. Port 8444 has the stronger infrastructure
  boundary because Tailscale does not publish it through Funnel.
- The 443 root proxy technically forwards `/admin` too. The application then
  resolves the first non-loopback forwarded address and returns HTTP 403 unless
  it is inside the Tailscale IPv4 or IPv6 ranges. Consequently, a same-tailnet
  operator can receive HTTP 200 through the 443 hostname; that observation is
  not evidence that an ordinary Internet/Funnel client can cross the admin
  gate. The non-tailnet rejection is covered with explicit forwarded-address
  tests.
- A live same-tailnet probe on 2026-07-22 reached both admin routes. The
  canonical 443 status reported `configured: true`; the `:8444` status reported
  `configured: false` because automatic WebAuthn origin discovery accepts the
  canonical HTTPS port only. Therefore the dedicated 8444 transport is
  tailnet-only, but a WebAuthn ceremony on that port must not be claimed ready
  without an explicit matching `PAOPAO_ADMIN_ORIGIN`/RP configuration.
- Zero WebAuthn credentials are enrolled. The live state remains
  `bootstrap-required` and unauthenticated; no physical Windows Hello or
  hardware-security-key enrollment is claimed.
- Live bootstrap/content/live configuration uses Ed25519 signatures,
  PlayerSaveV4 and `framesUploaded: false`. Browser camera frames remain on the
  device.
- Windows and Android delivery is the same installable web PWA. There is no
  native refresh-token storage branch, APK, desktop executable or Unity
  runtime; browser authentication uses secure cookies and CSRF.
- The encrypted backup implementation and isolated restore procedure are
  verified. The separately recorded 1,443,027-byte context-fix R5 private
  backup has SHA-256
  `84565aea6222e0c383373676b3bea38687372ad4f47f857069cc0f5ba00cdcbd`;
  its random passphrase is Windows CurrentUser-DPAPI protected. Neither the
  encrypted database bundle nor its DPAPI sidecar is published.

## Authority boundary

Endless/live events use the shared deterministic replay validator. Classic
first-clear settlement instead uses a one-time signed ticket, chronological
server-observed shots, cadence/duration limits and a terminal challenge; it is
not represented as a second complete bubble-board simulation. Arena authority
covers its server-observed input protocol, immutable finalization, reconnect,
timeouts and deterministic replay constraints, but is likewise not claimed as
an independent full board simulation.

Automated corpora and browser tests do not constitute a physical-camera matrix
or a physical Android run. Lighting, blur, distance, angle, camera-driver and
real-device thermal behavior remain separate acceptance evidence.
