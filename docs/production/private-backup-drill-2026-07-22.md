# Final R5 private backup drill

The encrypted mutable-data backup was created, verified, restored into an isolated temporary directory and re-verified on 2026-07-22. SQLite `quick_check` passed, the restored database hash matched, and both the session secret and Ed25519 signing keyring matched their encrypted source records.

The backup references immutable `r5-level100-production-20260722` content SHA-256 `d09e06bcccf4c750802b536377304fc59d5617ab86986d2d1e202167af2cc1b3`. Release state is reference-only and was correctly not restored into the isolated data directory.

The random backup passphrase is not stored as plaintext. Its sidecar is protected with Windows CurrentUser DPAPI through PowerShell SecureString and was round-trip checked before the plaintext value was cleared. Neither private file is exposed through `/dl` or included in the public source archive.

Structured metadata is in [`private-backup-drill-2026-07-22.json`](./private-backup-drill-2026-07-22.json). The real append-only chain is `backups/audit.jsonl`; the entire `backups/` tree remains excluded from the public archive.
