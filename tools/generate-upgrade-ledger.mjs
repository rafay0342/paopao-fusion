import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadLedgerEvidenceFiles,
  materializeLedgerEvidence,
  plannedEvidence,
} from './ledger-evidence-lib.mjs';

const RELEASES = [
  {
    release: 1,
    slug: 'foundation-and-migration',
    title: 'Foundation and migration',
    objective: 'Harden the permanent Phaser web client, shared contracts, deterministic board, smart launcher, save migration, build provenance and automated verification.',
    rollback: 'Keep /classic/ and the V3 compatibility adapter active; restore the prior content manifest and route root directly to /classic/.',
  },
  {
    release: 2,
    slug: 'complete-gameplay-coverage',
    title: 'Complete gameplay coverage',
    objective: 'Close rule, timing, reward, state, story, inventory, campaign, boss and arena coverage across all 30 levels and six worlds in Phaser.',
    rollback: 'Pin the Phaser client to the Release 1 content hash and disable Release 2 configuration through the signed bootstrap.',
  },
  {
    release: 3,
    slug: 'cinematic-presentation',
    title: 'Cinematic presentation',
    objective: 'Ship cinematic Phaser presentation with lighting pipelines, shaders, cameras, particles, UI and optimized authored animation.',
    rollback: 'Select the Release 2 Phaser atlas and asset manifest while retaining identical deterministic gameplay configuration.',
  },
  {
    release: 4,
    slug: 'endless-live-operations',
    title: 'Endless live operations',
    objective: 'Enable deterministic endless seasons, rotating modifiers, signed challenges, event bosses, reward tracks, local administration and authoritative validation.',
    rollback: 'Disable live-event flags, reject new challenge signatures and settle already accepted rewards against the retained Release 3 ruleset.',
  },
  {
    release: 5,
    slug: 'production-hardening',
    title: 'Production hardening',
    objective: 'Complete accessibility, input-mode consistency, performance, soak stability, migration audits, backup restoration and smart-launcher rollout.',
    rollback: 'Restore the previous signed manifest, database snapshot and launcher compatibility window using the rehearsed recovery runbook.',
  },
];

const CATEGORY_DEFINITIONS = [
  { key: 'upgrade', title: 'Platform upgrades', total: 100, perRelease: 20, clientFacing: true },
  { key: 'improvement', title: 'Verified improvements', total: 100, perRelease: 20, clientFacing: true },
  { key: 'ui', title: 'UI systems', total: 100, perRelease: 20, clientFacing: true },
  { key: 'frontend', title: 'Frontend capabilities', total: 150, perRelease: 30, clientFacing: true },
  { key: 'backend', title: 'Backend capabilities', total: 250, perRelease: 50, clientFacing: false },
  { key: 'mechanism', title: 'Mechanisms and deterministic logic', total: 500, perRelease: 100, clientFacing: true },
  { key: 'flow', title: 'Functionality, realism and flow', total: 200, perRelease: 40, clientFacing: true },
  { key: 'security', title: 'Security and authentication gates', total: 10, perRelease: 2, clientFacing: false },
  { key: 'rendering', title: 'Rendering and graphics systems', total: 100, perRelease: 20, clientFacing: true },
  { key: 'ux-element', title: 'UI and UX elements', total: 500, perRelease: 100, clientFacing: true },
  { key: 'animated-element', title: 'Animated production elements', total: 500, perRelease: 100, clientFacing: true },
  { key: 'animation', title: 'Animation clips and effects', total: 500, perRelease: 100, clientFacing: true },
  { key: 'asset', title: 'Unique asset and media masters', total: 500, perRelease: 100, clientFacing: true },
  { key: 'control', title: 'Gameplay-control refinements', total: 100, perRelease: 20, clientFacing: true },
  { key: 'hand', title: 'MediaPipe and vision improvements', total: 100, perRelease: 20, clientFacing: true },
];

const matrices = {
  upgrade: [
    ['WebGL runtime', 'Windows packaged client', 'Android packaged client', 'Phaser runtime', 'Canvas fallback', 'shared content', 'save portability', 'build provenance', 'release rollback', 'device compatibility'],
    ['profile', 'bootstrap', 'packaging', 'version pin', 'cache policy', 'artifact signing', 'health probe', 'capability negotiation', 'migration boundary', 'support policy'],
  ],
  improvement: [
    ['cold start', 'frame pacing', 'memory lifetime', 'network recovery', 'content consistency', 'input response', 'save integrity', 'audio continuity', 'visual legibility', 'failure recovery'],
    ['baseline measurement', 'budget guard', 'regression fixture', 'fault injection', 'canonical replay', 'long-session audit', 'device matrix', 'golden comparison', 'rollback drill', 'production evidence'],
  ],
  ui: [
    ['launcher', 'account', 'campaign map', 'level select', 'game HUD', 'pause', 'results', 'inventory', 'store', 'accessibility'],
    ['layout contract', 'focus model', 'responsive state', 'loading state', 'empty state', 'error state', 'navigation state', 'input hints', 'telemetry boundary', 'canonical fixture'],
  ],
  frontend: [
    ['smart launch', 'client selection', 'bootstrap loading', 'content loading', 'save hydration', 'campaign navigation', 'game session', 'arena session', 'inventory browsing', 'store browsing', 'story playback', 'tutorial delivery', 'settings sync', 'telemetry queue', 'offline recovery'],
    ['typed model', 'state transition', 'error recovery', 'cancellation', 'cache invalidation', 'accessibility contract', 'responsive behavior', 'performance budget', 'analytics event', 'contract assertion'],
  ],
  backend: [
    ['bootstrap', 'content manifest', 'live configuration', 'progress', 'run intake', 'telemetry', 'arena gateway', 'account session', 'native token', 'refresh token', 'wallet', 'inventory', 'purchase', 'entitlement', 'campaign', 'endless season', 'live event', 'signed challenge', 'remote configuration', 'admin console', 'audit trail', 'backup', 'restore', 'compatibility adapter', 'health reporting'],
    ['schema contract', 'validation', 'authorization', 'idempotency', 'revision control', 'persistence', 'rate limit', 'observability', 'fault recovery', 'integration fixture'],
  ],
  mechanism: [
    ['hex coordinate', 'board occupancy', 'bubble spawn', 'aim ray', 'wall reflection', 'shot travel', 'cell attachment', 'color match', 'cluster removal', 'floating removal', 'ceiling descent', 'loss boundary', 'win objective', 'move budget', 'score multiplier', 'combo chain', 'power charge', 'bomb power', 'rainbow power', 'swap queue', 'level seed', 'obstacle state', 'boss state', 'artifact state', 'reward outcome'],
    ['canonical representation', 'input normalization', 'fixed-step transition', 'tie-break rule', 'seed consumption', 'invariant check', 'serialization', 'replay event', 'server-client oracle', 'property test', 'edge-case fixture', 'overflow guard', 'rollback snapshot', 'desync checksum', 'authoritative validation', 'prediction boundary', 'reconciliation', 'failure closure', 'performance bound', 'evidence capture'],
  ],
  flow: [
    ['first launch', 'returning launch', 'guest entry', 'account recovery', 'client switch', 'campaign start', 'level start', 'active aiming', 'shot resolution', 'level completion', 'level failure', 'boss encounter', 'story transition', 'reward claim', 'inventory equip', 'store purchase', 'arena matchmaking', 'arena recovery', 'season progression', 'camera interruption'],
    ['entry affordance', 'precondition', 'transition cue', 'state continuity', 'input handoff', 'feedback purpose', 'error recovery', 'persistence point', 'accessibility route', 'exit guarantee'],
  ],
  rendering: [
    ['world lighting', 'bubble material', 'environment material', 'character shading', 'shadow', 'reflection', 'particle', 'post-processing', 'camera composition', 'quality adaptation'],
    ['performance tier', 'balanced tier', 'ultra tier', 'WebGL fallback', 'color-space policy', 'texture residency', 'shader variant', 'overdraw budget', 'visual golden', 'runtime degradation'],
  ],
  'ux-element': [
    ['launcher', 'account', 'recovery', 'profile', 'campaign', 'world map', 'level detail', 'game HUD', 'aim guide', 'hand status', 'pause', 'results', 'rewards', 'inventory', 'store', 'story', 'arena lobby', 'arena match', 'season track', 'settings', 'accessibility', 'downloads', 'update notice', 'error recovery', 'admin status'],
    ['primary action', 'secondary action', 'status badge', 'progress indicator', 'focus target', 'keyboard hint', 'controller hint', 'touch hint', 'hand hint', 'loading skeleton', 'empty message', 'error message', 'confirmation', 'undo notice', 'tooltip', 'numeric readout', 'icon label', 'responsive container', 'reduced-motion state', 'screen-reader description'],
  ],
  'animated-element': [
    ['launcher portal', 'profile crest', 'world card', 'level medallion', 'HUD score', 'HUD moves', 'aim guide', 'launcher cannon', 'queued bubble', 'board bubble', 'match cluster', 'floating cluster', 'power meter', 'bomb orb', 'rainbow orb', 'boss portrait', 'artifact icon', 'reward chest', 'inventory card', 'story portrait', 'arena badge', 'season token', 'hand cursor', 'connection status', 'quality indicator'],
    ['idle behavior', 'focus response', 'hover response', 'press response', 'entry motion', 'exit motion', 'state change', 'success response', 'failure response', 'attention cue', 'progress response', 'loading response', 'disabled response', 'reduced-motion substitute', 'pause behavior', 'resume behavior', 'camera-relative behavior', 'offscreen culling', 'pool reset', 'canonical timing marker'],
  ],
  animation: [
    ['portal', 'crown', 'Lumi', 'bubble', 'launcher', 'aim trail', 'wall bounce', 'cell attach', 'match burst', 'floating fall', 'combo', 'power charge', 'bomb blast', 'rainbow convert', 'boss', 'artifact', 'reward', 'world transition', 'story', 'arena', 'season', 'hand reticle', 'UI panel', 'quality switch', 'error recovery'],
    ['intro clip', 'idle loop', 'anticipation clip', 'action clip', 'contact effect', 'release effect', 'success clip', 'failure clip', 'transition in', 'transition out', 'camera effect', 'light effect', 'material effect', 'particle effect', 'audio-synced cue', 'pause-safe variant', 'reduced-motion variant', 'low-tier variant', 'replay marker', 'golden capture'],
  ],
  control: [
    ['mouse', 'keyboard', 'touch', 'controller', 'single hand', 'two hand', 'camera pointer', 'assistive switch', 'replay input', 'input remapping'],
    ['acquisition latency', 'aim precision', 'dead-zone', 'smoothing', 'state transition', 'cancel action', 'pause safety', 'focus recovery', 'feedback timing', 'input-mode consistency'],
  ],
  hand: [
    ['landmark acquisition', 'hand identity', 'palm orientation', 'finger geometry', 'pinch contact', 'pinch release', 'pointer projection', 'depth compensation', 'confidence state', 'camera lifecycle'],
    ['cold-start path', 'temporal filter', 'angle normalization', 'distance normalization', 'blur handling', 'dark-scene handling', 'backlight handling', 'uncertainty closure', 'soak stability', 'corpus conformance'],
  ],
};

const securityGates = [
  'Session, CSRF and token lifecycle',
  'Signed bootstrap and client compatibility',
  'Save revision and anti-rollback',
  'Wallet and inventory authority with idempotency',
  'Signed content manifests and checksums',
  'Privacy, CSP and input validation',
  'OTP recovery and abuse limits',
  'Authoritative arena and replay validation',
  'Tailnet-only WebAuthn admin console',
  'Encrypted backups, audit trail and secret rotation',
];

const assetGroups = [
  {
    key: 'characters-orbs-bosses-rigs', total: 100, perRelease: 20,
    subjects: ['Lumi guide', 'Aurora Crown', 'Prism Warden', 'Heartwood Guardian', 'Inferno Sovereign', 'Astral Sentinel', 'Frost Regent', 'Nexus Architect', 'player launcher', 'fusion orb family'],
    forms: ['design turnaround', 'hero illustration master', 'runtime sprite master', 'skeleton rig', 'facial rig', 'surface source', 'expression set', 'gameplay pose set', 'damage-state set', 'presentation render'],
  },
  {
    key: 'environment-models-props', total: 100, perRelease: 20,
    subjects: ['Crystal realm', 'Emerald realm', 'Ember realm', 'Celestial realm', 'Frostbound realm', 'Nexus realm', 'Aurora hub', 'arena sanctum', 'season vault', 'event gateway'],
    forms: ['hero environment master', 'gameplay plane master', 'foreground prop kit', 'midground prop kit', 'background silhouette kit', 'interactive prop', 'destructible prop', 'lighting prop', 'collision map set', 'presentation panorama'],
  },
  {
    key: 'material-texture-vfx-packs', total: 100, perRelease: 20,
    subjects: ['crystal', 'heartwood', 'ember', 'celestial', 'frostglass', 'nexus', 'aurora energy', 'crown metal', 'fusion orb', 'portal'],
    forms: ['surface texture source', 'trim and decal source', 'mask texture source', 'normal detail source', 'emission source', 'particle texture source', 'Phaser shader source', 'impact VFX source', 'atmosphere VFX source', 'quality-tier atlas source'],
  },
  {
    key: 'ui-icons-illustrations', total: 80, perRelease: 16,
    subjects: ['launcher identity', 'campaign navigation', 'game HUD', 'hand controls', 'inventory', 'store', 'story', 'arena', 'season', 'accessibility'],
    forms: ['icon family master', 'panel frame master', 'button state master', 'badge master', 'progress master', 'instruction illustration', 'empty-state illustration', 'promotional key visual'],
  },
  {
    key: 'music-ambience-sfx', total: 60, perRelease: 12,
    subjects: ['Crystal realm', 'Emerald realm', 'Ember realm', 'Celestial realm', 'Frostbound realm', 'Nexus realm', 'Aurora hub', 'boss encounter', 'arena match', 'season event'],
    forms: ['music session master', 'ambient bed master', 'gameplay SFX palette', 'UI SFX palette', 'cinematic stem master', 'accessibility cue master'],
  },
  {
    key: 'cinematic-sequences', total: 40, perRelease: 8,
    subjects: ['crown shattering', 'Lumi awakening', 'Crystal restoration', 'Emerald restoration', 'Ember restoration', 'Celestial restoration', 'Frostbound restoration', 'Nexus confrontation', 'crown restored', 'season gateway'],
    forms: ['storyboard master', 'animation layout master', 'cinematic sequence master', 'runtime delivery master'],
  },
  {
    key: 'tutorial-accessibility-promotion', total: 20, perRelease: 4,
    subjects: ['core play tutorial', 'hand-control tutorial', 'input accessibility guide', 'client-selection guide', 'release promotion'],
    forms: ['script and storyboard master', 'illustration master', 'motion master', 'localized delivery master'],
  },
];

function cartesianRecords(categoryKey) {
  const [subjects, facets] = matrices[categoryKey];
  return subjects.flatMap((subject) => facets.map((facet) => ({ subject, facet })));
}

function assetRecordsByRelease() {
  const groupRecords = assetGroups.map((group) => ({
    group,
    records: group.subjects.flatMap((subject) => group.forms.map((form) => ({ subject, facet: form, allocation: group.key }))),
  }));
  for (const entry of groupRecords) {
    if (entry.records.length !== entry.group.total) throw new Error(`asset group ${entry.group.key} generated ${entry.records.length}`);
  }
  return RELEASES.flatMap((release, releaseIndex) => groupRecords.flatMap(({ group, records }) =>
    records.slice(releaseIndex * group.perRelease, (releaseIndex + 1) * group.perRelease)
      .map((record) => ({ ...record, release: release.release }))));
}

function makeItem(category, record, ordinal, release) {
  const id = `PF-${category.key}-${String(ordinal).padStart(3, '0')}`;
  const releaseTitle = RELEASES[release - 1].title;
  const title = `${record.subject} — ${record.facet}`;
  const implementationBoundary = category.clientFacing
    ? 'It is one Phaser production outcome; device, input, quality and packaging variants do not count as separate items.'
    : 'It is one authoritative shared-service outcome and is not duplicated by delivery channel.';
  return {
    id,
    category: category.key,
    ordinal,
    title,
    definition: `Deliver the ${record.facet} for ${record.subject} during ${releaseTitle}, with deterministic ownership, explicit failure behavior and measurable production bounds. ${implementationBoundary}`,
    release,
    clientFacing: category.clientFacing,
    acceptanceTest: {
      id: `AT-${id}`,
      procedure: category.clientFacing
        ? `Run the shared ${record.subject} fixture in the Phaser web client, exercise ${record.facet}, then compare the observed content, rules, timing, rewards, state transitions and feedback purpose with the canonical contract.`
        : `Exercise ${record.subject} through its versioned integration fixture, including valid, invalid, repeated and interrupted ${record.facet} paths.`,
      expected: category.clientFacing
        ? 'The Phaser client satisfies the canonical fixture with no rule or state delta; its visuals remain within the declared quality and performance budgets.'
        : 'The authoritative result is schema-valid, bounded, idempotent where applicable, auditable and recoverable without trusting client claims.',
    },
    evidence: plannedEvidence(category.clientFacing),
    ...(record.allocation ? { assetAllocation: record.allocation } : {}),
  };
}

const items = [];
for (const category of CATEGORY_DEFINITIONS) {
  let records;
  if (category.key === 'security') {
    records = securityGates.map((subject) => ({ subject, facet: 'enforced production gate' }));
  } else if (category.key === 'asset') {
    records = assetRecordsByRelease();
  } else {
    records = cartesianRecords(category.key);
  }
  if (records.length !== category.total) throw new Error(`${category.key} generated ${records.length}, expected ${category.total}`);
  records.forEach((record, index) => {
    const ordinal = index + 1;
    const release = record.release ?? Math.ceil(ordinal / category.perRelease);
    items.push(makeItem(category, record, ordinal, release));
  });
}

items.sort((a, b) => (a.release - b.release)
  || (CATEGORY_DEFINITIONS.findIndex(({ key }) => key === a.category) - CATEGORY_DEFINITIONS.findIndex(({ key }) => key === b.category))
  || (a.ordinal - b.ordinal));
items.forEach((item, index) => { item.globalOrdinal = index + 1; });

const ledger = {
  schemaVersion: 3,
  title: 'PaoPao Fusion Level-100 Phaser Production Ledger',
  countingPolicy: {
    primaryCategoryOnly: true,
    duplicateImplementationsDoNotCount: true,
    variantsAndCompressedCopiesDoNotCount: true,
    uniqueAcceptanceAssertionRequired: true,
    gateCredit: 'Only evidence.status=verified earns release-gate credit. Planned entries are commitments, never completion claims.',
  },
  total: 3710,
  releaseCount: 5,
  itemsPerRelease: 742,
  idFormat: 'PF-{category}-{three-digit ordinal}',
  statusPolicy: ['planned', 'implemented', 'verified', 'blocked'],
  evidenceStatePolicy: ['planned', 'implemented', 'verified', 'blocked', 'not-applicable'],
  evidenceRegistry: {
    schemaVersion: 1,
    claimsPath: 'docs/production/evidence/claims.json',
    receiptsPath: 'docs/production/evidence/receipts.json',
    binding: 'Every credited item target must have one unique acceptance-ID-bound test case and a current hashed runner receipt.',
  },
  categories: CATEGORY_DEFINITIONS,
  assetAllocation: assetGroups.map(({ key, total, perRelease }) => ({ key, total, perRelease })),
  releases: RELEASES.map((release) => ({
    ...release,
    state: 'planned',
    assignedItems: 742,
    requiredVerifiedItems: 742,
    entryCriteria: 'Prior release is verified or an explicit recovery baseline is selected.',
    exitCriteria: 'All assigned ledger items are verified with required shared and Phaser web evidence, builds, canonical fixtures, performance records and rollback drill.',
  })),
  items,
};

const projectRoot = resolve('.');
const { claims, receipt } = loadLedgerEvidenceFiles(projectRoot, ledger);
materializeLedgerEvidence({ ledger, projectRoot, claims, receipt });
writeFileSync(resolve('docs/production/upgrade-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`wrote ${items.length} literal ledger items`);
