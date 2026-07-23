import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvidenceClaims } from './ledger-evidence-lib.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ledgerPath = resolve(projectRoot, 'docs/production/upgrade-ledger.json');
const claimsPath = resolve(projectRoot, 'docs/production/evidence/claims.json');
const command = process.argv[2] ?? 'check';
const suite = 'production hand and MediaPipe ledger evidence';
const testPath = 'tests/hand-ledger-evidence.test.ts';

const implementationPaths = new Map([
  ['landmark acquisition', {
    shared: ['src/game/handreliability.ts', 'src/game/handcontrol.ts', 'src/game/handgeometry.ts', 'src/game/handvision.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handtracking.worker.ts', 'src/game/handreliability.ts', 'src/game/handvision.ts'],
  }],
  ['hand identity', {
    shared: ['src/game/handreliability.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handreliability.ts', 'src/game/handcontrol.ts'],
  }],
  ['palm orientation', {
    shared: ['src/game/handgeometry.ts', 'src/game/handcontrol.ts', 'src/game/handvision.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handgeometry.ts', 'src/game/handcontrol.ts'],
  }],
  ['finger geometry', {
    shared: ['src/game/handgeometry.ts', 'src/game/handcontrol.ts', 'src/game/handvision.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handgeometry.ts', 'src/game/handcontrol.ts'],
  }],
  ['pinch contact', {
    shared: ['src/game/handcontrol.ts', 'src/game/handgeometry.ts', 'src/game/handreliability.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handcontrol.ts', 'src/game/handreliability.ts'],
  }],
  ['pinch release', {
    shared: ['src/game/handcontrol.ts', 'src/game/handgeometry.ts', 'src/game/handreliability.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handcontrol.ts', 'src/game/handreliability.ts'],
  }],
  ['pointer projection', {
    shared: ['src/game/handcontrol.ts', 'src/game/handreliability.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handcontrol.ts'],
  }],
  ['depth compensation', {
    shared: ['src/game/handgeometry.ts', 'src/game/handreliability.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handgeometry.ts'],
  }],
  ['confidence state', {
    shared: ['src/game/handreliability.ts', 'src/game/handvision.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handreliability.ts', 'src/game/handvision.ts'],
  }],
  ['camera lifecycle', {
    shared: ['src/game/handreliability.ts', 'src/game/handvision.ts'],
    phaser: ['src/game/handtracking.ts', 'src/game/handreliability.ts', 'src/game/handvision.ts'],
  }],
]);

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

function emptyRegistry(ledger) {
  return {
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
}

function handClaims(ledger) {
  const items = ledger.items.filter((item) => item.category === 'hand');
  if (items.length !== 100) throw new Error(`expected exactly 100 hand ledger items, found ${items.length}`);
  return items.flatMap((item) => {
    const [subject, facet] = item.title.split(' — ');
    const paths = implementationPaths.get(subject);
    if (!paths || !facet) throw new Error(`unmapped hand acceptance title ${item.id}: ${item.title}`);
    return ['shared', 'phaser'].map((target) => ({
      claimId: `EC-${item.id}-${target}`,
      assertionId: `AE-${item.acceptanceTest.id}-${target}`,
      itemId: item.id,
      acceptanceId: item.acceptanceTest.id,
      target,
      implementationPaths: paths[target],
      test: {
        path: testPath,
        fullName: `${suite} [${item.acceptanceTest.id}][${target}] ${item.title} executes its ${target} behavior contract`,
      },
      note: `${subject} ${facet} is exercised against deterministic landmarks, timing and fail-closed Phaser output for the ${target} contract.`,
    }));
  });
}

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const registry = existsSync(claimsPath)
  ? JSON.parse(readFileSync(claimsPath, 'utf8'))
  : emptyRegistry(ledger);
const handIds = new Set(ledger.items.filter((item) => item.category === 'hand').map((item) => item.id));
registry.claims = registry.claims.filter((claim) => !handIds.has(claim.itemId));
registry.claims.push(...handClaims(ledger));
const globalOrdinal = new Map(ledger.items.map((item) => [item.id, item.globalOrdinal]));
registry.claims.sort((left, right) => (globalOrdinal.get(left.itemId) - globalOrdinal.get(right.itemId))
  || left.target.localeCompare(right.target));
validateEvidenceClaims({ ledger, projectRoot, claims: registry });

if (command === 'map') atomicJson(claimsPath, registry);
else if (command !== 'check') throw new Error('use check or map');

console.log(JSON.stringify({
  ok: true,
  command,
  mappedHandItems: 100,
  mappedHandClaims: 200,
  totalClaims: registry.claims.length,
}, null, 2));
