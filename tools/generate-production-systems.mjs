import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const ledgerPath = resolve(projectRoot, 'docs/production/upgrade-ledger.json');
const outputPath = resolve(projectRoot, 'shared/fixtures/production-systems-v1.json');
const categories = ['upgrade', 'improvement', 'ui', 'frontend', 'flow', 'rendering', 'control'];
const categoryKind = {
  upgrade: 'platform',
  improvement: 'measurement',
  ui: 'interface-system',
  frontend: 'client-capability',
  flow: 'journey-flow',
  rendering: 'graphics-pipeline',
  control: 'input-control',
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, path);
}

function splitTitle(title) {
  const separator = title.indexOf(' — ');
  if (separator <= 0) throw new Error(`invalid production-system title ${title}`);
  return [title.slice(0, separator), title.slice(separator + 3)];
}

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const selected = ledger.items.filter((item) => categories.includes(item.category));
if (selected.length !== 850) throw new Error(`expected 850 production-system ledger items, received ${selected.length}`);

const subjectOrdinals = new Map();
const facetOrdinals = new Map();
const entries = selected.map((item) => {
  const [subject, facet] = splitTitle(item.title);
  const subjectKey = `${item.category}:${subject}`;
  const facetKey = `${item.category}:${facet}`;
  if (!subjectOrdinals.has(subjectKey)) subjectOrdinals.set(subjectKey, subjectOrdinals.size + 1);
  if (!facetOrdinals.has(facetKey)) facetOrdinals.set(facetKey, facetOrdinals.size + 1);
  const ordinal = item.ordinal;
  const base = {
    id: item.id,
    acceptanceId: item.acceptanceTest.id,
    category: item.category,
    kind: categoryKind[item.category],
    release: item.release,
    ordinal,
    subject,
    facet,
    contract: {
      schemaVersion: 1,
      ownership: item.category === 'upgrade' ? 'launcher-runtime' : item.category === 'control' ? 'input-runtime' : 'classic-client',
      failureMode: 'fail-closed-with-recovery',
      stateBudget: 16 + (ordinal % 17),
      frameBudgetMs: Number((2.25 + (ordinal % 12) * 0.35).toFixed(2)),
      memoryBudgetKb: 24 + (ordinal % 16) * 8,
      durationMs: 90 + (ordinal % 15) * 18,
      accentHue: (ordinal * 47 + categories.indexOf(item.category) * 31) % 360,
      accessibilityRole: item.category === 'ui' ? 'region' : item.category === 'control' ? 'application' : 'status',
      telemetryKey: `production.${item.category}.${String(ordinal).padStart(3, '0')}`,
      reducedMotion: item.category === 'rendering' || item.category === 'ui' || item.category === 'flow',
      deterministicSeed: (0x9e3779b9 ^ (ordinal * 2654435761) ^ (item.release * 2246822519)) >>> 0,
    },
  };
  return { ...base, contractSha256: sha256(base) };
});

const byCategory = Object.fromEntries(categories.map((category) => [category, entries.filter((entry) => entry.category === category).length]));
const byRelease = Object.fromEntries([1, 2, 3, 4, 5].map((release) => [release, entries.filter((entry) => entry.release === release).length]));
const manifestBase = {
  schemaVersion: 1,
  title: 'PaoPao Fusion Phaser Production Systems',
  policy: {
    primaryLedgerCategoryOnly: true,
    variantsDoNotCreateEntries: true,
    deterministicExecutionRequired: true,
    invalidInputFailsClosed: true,
    reducedMotionIsABehaviorNotADuplicate: true,
  },
  total: entries.length,
  byCategory,
  byRelease,
  entries,
};
atomicJson(outputPath, { ...manifestBase, manifestSha256: sha256(manifestBase) });
console.log(JSON.stringify({ output: outputPath, total: entries.length, byCategory, byRelease, manifestSha256: sha256(manifestBase) }, null, 2));
