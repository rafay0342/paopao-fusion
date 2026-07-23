import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvidenceClaims } from './ledger-evidence-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs/production/upgrade-ledger.json');
const claimsPath = resolve(projectRoot, 'docs/production/evidence/claims.json');

const evidence = new Map([
  [1, {
    paths: ['server/platform.mjs'],
    testPath: 'tests/platform-backend.test.ts',
    fullName: 'server-authoritative platform [AT-PF-security-001][shared] enforces the session CSRF boundary and wallet transaction limits',
    note: 'Authenticated session state, CSRF rejection and bounded wallet mutation are exercised against the real Fastify routes.',
  }],
  [2, {
    paths: ['server/platform.mjs', 'src/game/contracts.ts'],
    testPath: 'tests/backend-v4-contract.test.ts',
    fullName: 'Phaser-only V4 backend contract [AT-PF-security-002][shared] publishes a signed bootstrap with an explicit compatible Phaser client',
    note: 'The bootstrap, content hash, signature and sole supported Phaser compatibility declaration are verified together.',
  }],
  [3, {
    paths: ['server/platform.mjs', 'src/game/contracts.ts', 'src/game/save-v4.ts'],
    testPath: 'tests/backend-v4-contract.test.ts',
    fullName: 'Phaser-only V4 backend contract [AT-PF-security-003][shared] enforces save revisions, normalized migration and entitlement anti-rollback',
    note: 'V4 normalization, stale revision rejection and server-owned entitlement boundaries are exercised with persisted state.',
  }],
  [4, {
    paths: ['server/platform.mjs'],
    testPath: 'tests/platform-backend.test.ts',
    fullName: 'server-authoritative platform [AT-PF-security-004][shared] settles an atomic purchase exactly once for an idempotency key',
    note: 'One transactional purchase debits the authoritative wallet and grants inventory exactly once under replay.',
  }],
  [5, {
    paths: ['server/signing-keyring.mjs', 'server/platform.mjs'],
    testPath: 'tests/security-admin.test.ts',
    fullName: 'persistent content signing keyring [AT-PF-security-005][shared] rotates signed content manifests while retaining bounded verification overlap',
    note: 'Atomic signing-key rotation changes new manifest signatures while retained overlap verifies prior live-event tokens.',
  }],
  [6, {
    paths: ['server/index.mjs', 'server/platform.mjs', 'src/game/handtracking.ts'],
    testPath: 'tests/contracts-v3.test.ts',
    fullName: 'classic-client V3 contract [AT-PF-security-006][shared] keeps camera frames private and enforces CSP plus strict API input validation',
    note: 'Privacy headers, local-only frame transport and strict telemetry schema rejection are asserted at their production boundaries.',
  }],
  [7, {
    paths: ['server/platform.mjs'],
    testPath: 'tests/platform-backend.test.ts',
    fullName: 'server-authoritative platform [AT-PF-security-007][shared] rate limits OTP recovery requests by source IP even when emails differ',
    note: 'The OTP abuse limiter is exercised across attacker-controlled email variation and returns an explicit retry window.',
  }],
  [8, {
    paths: ['server/platform.mjs', 'shared/runtime/endless-replay.mjs'],
    testPath: 'tests/platform-arena-hardening.test.ts',
    fullName: 'arena transport hardening [AT-PF-security-008][shared] authoritatively persists arena results and rejects invalid replay traces',
    note: 'The live arena finalizer persists one immutable result while the shared replay oracle rejects impossible trace cadence.',
  }],
  [9, {
    paths: ['server/security-admin.mjs', 'server/signing-keyring.mjs'],
    testPath: 'tests/security-admin.test.ts',
    fullName: 'tailnet-only WebAuthn admin security [AT-PF-security-009][shared] performs tailnet-only P-256 WebAuthn and rejects replay',
    note: 'A real P-256 credential ceremony enforces tailnet origin, user verification, challenge replay, counters and admin CSRF.',
  }],
  [10, {
    paths: ['tools/backup.mjs', 'server/signing-keyring.mjs'],
    testPath: 'tests/operational-hardening.test.ts',
    fullName: 'Phaser-only operational hardening [AT-PF-security-010][shared] runs an encrypted create verify and isolated SQLite restore drill',
    note: 'AES-GCM backup creation, hashed audit evidence, SQLite restore and signing-keyring restoration complete in isolation.',
  }],
]);

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const registry = existsSync(claimsPath)
  ? JSON.parse(readFileSync(claimsPath, 'utf8'))
  : {
    schemaVersion: 1,
    ledgerSchemaVersion: ledger.schemaVersion,
    policy: {
      oneClaimPerItemTarget: true,
      uniqueAssertionPerClaim: true,
      exactTestCaseRequired: true,
      sourceHashesRequired: true,
    },
    claims: [],
  };

const securityIds = new Set(Array.from({ length: 10 }, (_, index) => `PF-security-${String(index + 1).padStart(3, '0')}`));
registry.claims = registry.claims.filter((claim) => !(securityIds.has(claim.itemId) && claim.target === 'shared'));
for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
  const suffix = String(ordinal).padStart(3, '0');
  const itemId = `PF-security-${suffix}`;
  const acceptanceId = `AT-PF-security-${suffix}`;
  const entry = evidence.get(ordinal);
  registry.claims.push({
    claimId: `EC-${itemId}-shared`,
    assertionId: `AE-${acceptanceId}-shared`,
    itemId,
    acceptanceId,
    target: 'shared',
    implementationPaths: entry.paths,
    test: { path: entry.testPath, fullName: entry.fullName },
    note: entry.note,
  });
}

const globalOrdinal = new Map(ledger.items.map((item) => [item.id, item.globalOrdinal]));
registry.claims.sort((left, right) => (globalOrdinal.get(left.itemId) - globalOrdinal.get(right.itemId))
  || left.target.localeCompare(right.target));
validateEvidenceClaims({ ledger, projectRoot, claims: registry });
atomicJson(claimsPath, registry);
console.log(JSON.stringify({ ok: true, mappedSecurityClaims: 10, totalClaims: registry.claims.length }, null, 2));
