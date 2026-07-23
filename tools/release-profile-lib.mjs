const releaseSlugs = Object.freeze([
  'foundation-and-migration',
  'complete-gameplay-coverage',
  'cinematic-presentation',
  'endless-live-operations',
  'production-hardening',
]);

const featureNames = Object.freeze([
  'foundation',
  'completeGameplay',
  'cinematicPresentation',
  'endlessLiveOperations',
  'productionHardening',
]);

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function parsePhaserReleaseGate(value, label = 'release gate') {
  const gate = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(gate) || gate < 1 || gate > 5) {
    throw new Error(`${label} must be an integer from 1 through 5`);
  }
  return gate;
}

export function phaserReleaseProfile(value) {
  const releaseGate = parsePhaserReleaseGate(value);
  return Object.freeze({
    schemaVersion: 1,
    client: 'phaser',
    releaseGate,
    releaseSlug: releaseSlugs[releaseGate - 1],
    features: Object.freeze({
      foundation: true,
      completeGameplay: releaseGate >= 2,
      cinematicPresentation: releaseGate >= 3,
      endlessLiveOperations: releaseGate >= 4,
      productionHardening: releaseGate >= 5,
    }),
  });
}

export function assertPhaserReleaseProfile(value, expectedGate) {
  const gate = parsePhaserReleaseGate(expectedGate, 'expected release gate');
  const expected = phaserReleaseProfile(gate);
  if (!exactKeys(value, ['schemaVersion', 'client', 'releaseGate', 'releaseSlug', 'features'])
    || value.schemaVersion !== expected.schemaVersion
    || value.client !== expected.client
    || value.releaseGate !== expected.releaseGate
    || value.releaseSlug !== expected.releaseSlug
    || !exactKeys(value.features, featureNames)
    || featureNames.some((name) => value.features[name] !== expected.features[name])) {
    throw new Error(`Phaser release profile does not exactly match gate ${gate}`);
  }
  return expected;
}

