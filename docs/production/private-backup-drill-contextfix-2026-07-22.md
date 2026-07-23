# Context-fix R5 encrypted backup drill

The private recovery bundle was created, decrypted, verified and restored into an isolated temporary data directory. SQLite `quick_check`, the database hash, session secret and content-signing keyring all matched.

The 1,443,027-byte AES-256-GCM backup has SHA-256 `84565aea6222e0c383373676b3bea38687372ad4f47f857069cc0f5ba00cdcbd`. Its random passphrase is protected in a 716-byte Windows CurrentUser DPAPI sidecar and passed a protection round trip. Neither file is published.

The backup references immutable `r5-level100-production-contextfix-20260722` content SHA-256 `10694cddc96bc9fa393601e94830825ac02f97864aecf48761199c9eb4630996`. Release state is reference-only and was correctly not installed by the isolated data restore.

