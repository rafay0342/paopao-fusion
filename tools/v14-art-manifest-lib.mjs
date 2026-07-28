import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';

export const V14_MANIFEST_PATH = 'art-source/v14/manifest.json';
export const V14_LEDGER_PATH = 'docs/production/upgrade-ledger.json';
export const V14_STYLE_BIBLE_PATH = 'docs/art/v14/style-bible.md';
export const V14_BRIEFS_PATH = 'art-source/v14/gate-briefs.json';

export const V14_MASTER_KINDS = Object.freeze([
  'image',
  'layered',
  'atlas',
  'rig',
  'audio',
  'video',
  'semantic',
]);

export const V14_APPROVAL_STATES = Object.freeze([
  'briefed',
  'candidate-review',
  'approved',
  'rejected',
]);

export const V14_GATES = Object.freeze([
  { id: 'A1', release: 1, firstOrdinal: 1, lastOrdinal: 100, count: 100 },
  { id: 'A2', release: 2, firstOrdinal: 101, lastOrdinal: 200, count: 100 },
  { id: 'A3', release: 3, firstOrdinal: 201, lastOrdinal: 300, count: 100 },
  { id: 'A4', release: 4, firstOrdinal: 301, lastOrdinal: 400, count: 100 },
  { id: 'A5', release: 5, firstOrdinal: 401, lastOrdinal: 500, count: 100 },
]);

const ALLOWED_ACTUAL_TOOLS = new Set([
  'built-in-image-generation',
  'local-authoring',
  'local-post-processing',
]);
const ALLOWED_GENERATION_MODES = new Set([
  'generate',
  'edit',
  'strip-edit',
  'layer-compose',
  'local-authoring',
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^PF-asset-(\d{3})$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SAFE_RELATIVE_PATH_PATTERN = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/;
const FIGHTING_PATTERN = /(?:^|[\\/])fighting(?:[\\/]|$)|fighting[-_\s]?game/i;
const NON_VALUE_PATTERN = /^(?:unknown|n\/a|none|not[- ]returned|not[- ]available|tbd)$/i;
const FORBIDDEN_MASTER_TEXT = /\b(?:placeholder|lorem ipsum|todo|implement later|sample asset|generic geometric|procedural(?:ly)? generated|procedural[-_\s]?(?:sheet|master|art)|documentation sheet|labelled sheet|labeled sheet|random json)\b/i;
const DETERMINISTIC_UI_PRIMITIVE_PATTERN = /\b(?:panel(?:\s+frame)?|button(?:\s+state)?|icon(?:\s+family)?|badge|progress|simple\s+typography|typography)\b/i;
const CANDIDATE_REVIEW_STATES = new Set(['pending', 'reviewed', 'rejected']);
const CANDIDATE_FORMATS = new Set(['png', 'webp', 'avif', 'jpg', 'jpeg', 'svg', 'json', 'wav', 'mp4', 'webm']);

const KIND_FORMATS = Object.freeze({
  image: new Set(['png', 'webp', 'avif', 'jpg', 'jpeg', 'svg']),
  layered: new Set(['json']),
  atlas: new Set(['png', 'webp']),
  rig: new Set(['json']),
  audio: new Set(['wav']),
  video: new Set(['mp4', 'webm']),
  semantic: new Set(['json']),
});

const DEFAULT_NEGATIVE_CONSTRAINTS = Object.freeze([
  'no copied franchise character or proprietary studio design',
  'no photoreal human styling',
  'no fighting-game content',
  'no watermark, signature, logo or baked typography',
  'no malformed anatomy, ornament, crop, alpha fringe or chroma spill',
]);

const RIGHTS_STATEMENT = 'Original PaoPao Fusion production art; no copied franchise characters, proprietary film designs or fighting-game content.';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelativePath(path) {
  return typeof path === 'string'
    && SAFE_RELATIVE_PATH_PATTERN.test(path.replaceAll('\\', '/'))
    && !FIGHTING_PATTERN.test(path);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableHonestValue(value) {
  return value === null || (isNonEmptyString(value) && !NON_VALUE_PATTERN.test(value.trim()));
}

function isNullableHonestSeed(value) {
  return value === null
    || (Number.isSafeInteger(value) && value >= 0)
    || (isNonEmptyString(value) && !NON_VALUE_PATTERN.test(value.trim()));
}

function ordinalFromId(id) {
  const match = ID_PATTERN.exec(id);
  return match ? Number(match[1]) : Number.NaN;
}

function gateForOrdinal(ordinal) {
  return V14_GATES.find(({ firstOrdinal, lastOrdinal }) => ordinal >= firstOrdinal && ordinal <= lastOrdinal);
}

function splitLedgerTitle(title) {
  const [subject, deliverable, ...extra] = String(title).split(' — ');
  assert(subject && deliverable && extra.length === 0, `invalid asset ledger title ${String(title)}`);
  return { subject, deliverable };
}

function isDeterministicUiPrimitive(allocation, deliverable) {
  return allocation === 'ui-icons-illustrations'
    && DETERMINISTIC_UI_PRIMITIVE_PATTERN.test(deliverable);
}

function legacyPlannedToolFor(kind) {
  return ['image', 'layered', 'atlas', 'video'].includes(kind)
    ? 'built-in-image-generation'
    : 'local-authoring';
}

function plannedToolFor(kind, allocation, deliverable) {
  return isDeterministicUiPrimitive(allocation, deliverable)
    ? 'local-authoring'
    : legacyPlannedToolFor(kind);
}

function legacyPlannedModeFor(kind, deliverable) {
  if (kind === 'atlas') return 'strip-edit';
  if (kind === 'layered' || /storyboard/i.test(deliverable)) return 'layer-compose';
  if (kind === 'image' || kind === 'video') return 'generate';
  return 'local-authoring';
}

function plannedModeFor(kind, allocation, deliverable) {
  return isDeterministicUiPrimitive(allocation, deliverable)
    ? 'local-authoring'
    : legacyPlannedModeFor(kind, deliverable);
}

export function inferV14MasterKind(item) {
  const { deliverable } = splitLedgerTitle(item.title);
  const allocation = item.assetAllocation;

  if (allocation === 'music-ambience-sfx') return 'audio';
  if (allocation === 'cinematic-sequences') {
    if (/runtime delivery/i.test(deliverable)) return 'video';
    if (/storyboard/i.test(deliverable)) return 'layered';
    return 'semantic';
  }
  if (allocation === 'tutorial-accessibility-promotion') {
    if (/motion/i.test(deliverable)) return 'video';
    if (/illustration/i.test(deliverable)) return 'image';
    return 'semantic';
  }
  if (allocation === 'characters-orbs-bosses-rigs') {
    if (/runtime sprite/i.test(deliverable)) return 'atlas';
    if (/rig|expression|pose|damage-state/i.test(deliverable)) return 'rig';
    return 'image';
  }
  if (allocation === 'environment-models-props') {
    if (/hero environment|gameplay plane|presentation panorama/i.test(deliverable)) return 'layered';
    if (/collision map/i.test(deliverable)) return 'semantic';
    return 'image';
  }
  if (allocation === 'material-texture-vfx-packs') {
    if (/quality-tier atlas/i.test(deliverable)) return 'atlas';
    if (/shader/i.test(deliverable)) return 'semantic';
    return 'image';
  }
  if (allocation === 'ui-icons-illustrations') {
    if (/icon family|button state|badge|progress/i.test(deliverable)) return 'atlas';
    return 'image';
  }
  throw new Error(`cannot infer a V14 master kind for ${item.id}`);
}

function briefIntent(subject, deliverable, kind) {
  const delivery = kind === 'semantic'
    ? 'authored production data'
    : kind === 'rig'
      ? 'runtime-ready motion data'
      : kind === 'audio'
        ? 'mixed source audio'
        : kind === 'video'
          ? 'continuously animated delivery'
          : kind === 'layered'
            ? 'editable layered composition'
            : kind === 'atlas'
              ? 'anchor-consistent runtime atlas'
              : 'finished visual master';
  return `Create the ${subject} ${deliverable} as ${delivery} in the locked V14 mascot-cinematic style.`;
}

export function createV14BriefEntry(item) {
  const ordinal = ordinalFromId(item.id);
  const gate = gateForOrdinal(ordinal);
  const { subject, deliverable } = splitLedgerTitle(item.title);
  const kind = inferV14MasterKind(item);
  const plannedTool = plannedToolFor(kind, item.assetAllocation, deliverable);
  assert(gate, `asset ${item.id} is outside the V14 gate ranges`);
  assert(item.ordinal === ordinal, `asset ${item.id} ordinal does not match its PF ID`);
  assert(item.release === gate.release, `asset ${item.id} release does not match ${gate.id}`);

  return {
    id: item.id,
    ordinal,
    gate: gate.id,
    release: gate.release,
    allocation: item.assetAllocation,
    kind,
    brief: {
      title: item.title,
      subject,
      deliverable,
      intent: briefIntent(subject, deliverable, kind),
      ledgerAcceptanceId: item.acceptanceTest?.id ?? `AT-${item.id}`,
      plannedTool,
      plannedMode: plannedModeFor(kind, item.assetAllocation, deliverable),
      policyBindings: [
        'style-bible-v14',
        'original-paopao-only',
        'accessibility-shape-symbol-cues',
        'no-fighting-content',
      ],
    },
    provenance: {
      state: 'not-generated',
      actualTool: null,
      mode: null,
      generatedAt: null,
      finalPrompt: null,
      negativeConstraints: [...DEFAULT_NEGATIVE_CONSTRAINTS],
      referenceImages: [],
      model: null,
      seed: null,
      outputId: null,
      rightsStatement: RIGHTS_STATEMENT,
      sourceSha256: null,
    },
    approval: {
      state: 'briefed',
      reviewer: null,
      reviewedAt: null,
      contactSheetPath: null,
      notes: null,
    },
    primary: null,
    companions: [],
    technical: {},
    dependencies: [],
    usageReferences: [],
  };
}

function assetItemsFromLedger(ledger) {
  assert(isRecord(ledger) && Array.isArray(ledger.items), 'upgrade ledger must expose an items array');
  const items = ledger.items.filter(({ category }) => category === 'asset');
  assert(items.length === 500, `V14 requires exactly 500 asset ledger items; received ${items.length}`);
  return [...items].sort((left, right) => left.ordinal - right.ordinal);
}

export function createV14BriefManifest(ledger) {
  const entries = assetItemsFromLedger(ledger).map(createV14BriefEntry);
  return {
    schemaVersion: 2,
    manifestType: 'ProductionMasterManifestV2',
    project: 'PaoPao Fusion',
    artVersion: 'V14',
    status: 'briefing',
    sourceLedger: V14_LEDGER_PATH,
    styleBible: V14_STYLE_BIBLE_PATH,
    gateBriefs: V14_BRIEFS_PATH,
    masterRoot: 'art-source/v14/masters',
    reviewRoot: 'art-source/v14/review',
    rightsStatement: RIGHTS_STATEMENT,
    countingPolicy: 'Only one approved primary source per PF ID counts. Derived colours, quality tiers, atlases and compressed copies never add masters.',
    legacyPolicy: {
      frozenVersions: 'V2-V13',
      legacyMasterRoot: 'art-source/production-masters',
      legacyGenerator: 'tools/generate-production-masters.mjs',
      finalArtProducer: false,
    },
    gates: V14_GATES.map((gate) => ({
      ...gate,
      status: 'briefing',
    })),
    total: entries.length,
    entries,
  };
}

function validateLedgerBinding(entry, ledgerItem) {
  const expected = createV14BriefEntry(ledgerItem);
  assert(entry.id === expected.id, `V14 entry ${entry.id} does not match its ledger ID`);
  assert(entry.ordinal === expected.ordinal, `${entry.id} ordinal does not match the ledger`);
  assert(entry.gate === expected.gate && entry.release === expected.release, `${entry.id} gate or release does not match its fixed 100-item range`);
  assert(entry.allocation === expected.allocation, `${entry.id} allocation does not match the ledger`);
  assert(entry.kind === expected.kind, `${entry.id} kind does not match its ledger deliverable`);
  assert(isRecord(entry.brief), `${entry.id} brief must be an object`);
  for (const key of ['title', 'subject', 'deliverable', 'intent', 'ledgerAcceptanceId', 'plannedTool', 'plannedMode']) {
    assert(isNonEmptyString(entry.brief[key]), `${entry.id} brief.${key} must be non-empty`);
  }
  assert(entry.brief.title === expected.brief.title, `${entry.id} brief title does not match the ledger`);
  assert(entry.brief.subject === expected.brief.subject && entry.brief.deliverable === expected.brief.deliverable, `${entry.id} subject or deliverable does not match the ledger`);
  assert(entry.brief.ledgerAcceptanceId === expected.brief.ledgerAcceptanceId, `${entry.id} acceptance binding does not match the ledger`);
  const expectedRoute = entry.brief.plannedTool === expected.brief.plannedTool
    && entry.brief.plannedMode === expected.brief.plannedMode;
  const legacyBriefOnlyRoute = isDeterministicUiPrimitive(entry.allocation, entry.brief.deliverable)
    && entry.approval?.state === 'briefed'
    && entry.provenance?.state === 'not-generated'
    && entry.brief.plannedTool === legacyPlannedToolFor(entry.kind)
    && entry.brief.plannedMode === legacyPlannedModeFor(entry.kind, entry.brief.deliverable);
  assert(expectedRoute || legacyBriefOnlyRoute, `${entry.id} planned authoring route does not match its media kind`);
  assert(Array.isArray(entry.brief.policyBindings) && entry.brief.policyBindings.includes('no-fighting-content'), `${entry.id} is missing the fighting-content exclusion policy`);
  assert(!FIGHTING_PATTERN.test(entry.brief.title) && !FIGHTING_PATTERN.test(entry.brief.subject) && !FIGHTING_PATTERN.test(entry.brief.deliverable), `${entry.id} brief contains fighting content`);
  assert(!FORBIDDEN_MASTER_TEXT.test(entry.brief.intent), `${entry.id} brief contains forbidden non-production language`);
}

function validateReferenceImageList(owner, referenceImages, projectRoot) {
  assert(Array.isArray(referenceImages), `${owner} referenceImages must be an array`);
  const paths = new Set();
  for (const [index, reference] of referenceImages.entries()) {
    assert(isRecord(reference), `${owner} reference image ${index + 1} must be an object`);
    assert(isNonEmptyString(reference.role), `${owner} reference image ${index + 1} has no role`);
    assert(!FIGHTING_PATTERN.test(reference.role), `${owner} reference image ${index + 1} role contains fighting content`);
    assert(isSafeRelativePath(reference.path), `${owner} reference image ${index + 1} has an unsafe or fighting path`);
    assert(SHA256_PATTERN.test(reference.sha256), `${owner} reference image ${index + 1} has no valid SHA-256`);
    assert(!paths.has(reference.path), `${owner} repeats reference image path ${reference.path}`);
    paths.add(reference.path);
    if (projectRoot) {
      const absolute = resolveInside(projectRoot, reference.path, `${owner} reference image`);
      assert(existsSync(absolute) && statSync(absolute).isFile(), `${owner} reference image does not exist: ${reference.path}`);
      assert(sha256File(absolute) === reference.sha256, `${owner} reference image SHA-256 does not match ${reference.path}`);
    }
  }
}

function validateReferenceImages(entry, projectRoot) {
  validateReferenceImageList(entry.id, entry.provenance.referenceImages, projectRoot);
}

function expectedActualToolFor(entry) {
  return plannedToolFor(entry.kind, entry.allocation, entry.brief.deliverable);
}

function validateActualToolAgainstRoute(entry, actualTool, owner) {
  const plannedTool = expectedActualToolFor(entry);
  if (plannedTool === 'local-authoring') {
    assert(actualTool === 'local-authoring', `${owner} deterministic or structured source must use local authoring`);
    return;
  }
  assert(
    actualTool === 'built-in-image-generation' || actualTool === 'local-post-processing',
    `${owner} cannot silently replace built-in image generation with a CLI or API route`,
  );
}

function validateProvenance(entry, projectRoot) {
  const provenance = entry.provenance;
  assert(isRecord(provenance), `${entry.id} provenance must be an object`);
  assert(['not-generated', 'generated'].includes(provenance.state), `${entry.id} provenance state is invalid`);
  assert(Array.isArray(provenance.negativeConstraints) && provenance.negativeConstraints.length >= 5, `${entry.id} needs explicit negative constraints`);
  assert(provenance.negativeConstraints.every(isNonEmptyString), `${entry.id} negative constraints must be non-empty strings`);
  assert(provenance.negativeConstraints.some((value) => /fighting/i.test(value)), `${entry.id} negative constraints must exclude fighting content`);
  assert(provenance.rightsStatement === RIGHTS_STATEMENT, `${entry.id} rights statement is missing or altered`);
  for (const field of ['model', 'outputId']) {
    assert(isNullableHonestValue(provenance[field]), `${entry.id} provenance.${field} must be null when not actually returned`);
  }
  assert(isNullableHonestSeed(provenance.seed), `${entry.id} provenance.seed must be null when not actually returned`);
  validateReferenceImages(entry, projectRoot);

  if (provenance.state === 'not-generated') {
    for (const field of ['actualTool', 'mode', 'generatedAt', 'finalPrompt', 'model', 'seed', 'outputId', 'sourceSha256']) {
      assert(provenance[field] === null, `${entry.id} cannot populate provenance.${field} before generation`);
    }
    return;
  }

  assert(ALLOWED_ACTUAL_TOOLS.has(provenance.actualTool), `${entry.id} actual generation tool is invalid`);
  assert(ALLOWED_GENERATION_MODES.has(provenance.mode), `${entry.id} generation mode is invalid`);
  assert(ISO_DATE_PATTERN.test(provenance.generatedAt), `${entry.id} generation date must be an ISO UTC timestamp`);
  assert(isNonEmptyString(provenance.finalPrompt), `${entry.id} final prompt is required for an approved source`);
  assert(!FORBIDDEN_MASTER_TEXT.test(provenance.finalPrompt), `${entry.id} final prompt contains forbidden non-production language`);
  assert(SHA256_PATTERN.test(provenance.sourceSha256), `${entry.id} generated source needs a valid SHA-256`);
  validateActualToolAgainstRoute(entry, provenance.actualTool, entry.id);
  if (provenance.actualTool === 'local-post-processing') {
    assert(
      provenance.referenceImages.some(({ role }) => /approved-seed|generated-source/i.test(role)),
      `${entry.id} local post-processing must bind the built-in generated source or approved seed`,
    );
  }
}

function validateCandidateReviews(entry, projectRoot, reviewRoot) {
  const candidates = entry.candidateReviews ?? [];
  assert(Array.isArray(candidates), `${entry.id} candidateReviews must be an array`);
  const ids = new Set();
  const paths = new Set();
  const hashes = new Set();
  let reviewed = 0;
  for (const [index, candidate] of candidates.entries()) {
    const owner = `${entry.id} candidate ${index + 1}`;
    assert(isRecord(candidate), `${owner} must be an object`);
    assert(isNonEmptyString(candidate.id), `${owner} has no candidate ID`);
    assert(!ids.has(candidate.id), `${entry.id} repeats candidate ID ${candidate.id}`);
    ids.add(candidate.id);

    const source = candidate.source;
    assert(isRecord(source), `${owner} source must be an object`);
    assert(
      isSafeRelativePath(source.path)
        && source.path.startsWith(`${reviewRoot}/`)
        && source.path.split('/').at(-1).startsWith(`${entry.id}-`),
      `${owner} source must stay under ${reviewRoot} and begin with its PF ID`,
    );
    const format = extname(source.path).slice(1).toLowerCase();
    assert(source.format === format && CANDIDATE_FORMATS.has(format), `${owner} source format is invalid`);
    assert(Number.isInteger(source.bytes) && source.bytes > 0, `${owner} source byte count is invalid`);
    assert(SHA256_PATTERN.test(source.sha256), `${owner} source SHA-256 is invalid`);
    assert(!paths.has(source.path), `${entry.id} repeats candidate path ${source.path}`);
    assert(!hashes.has(source.sha256), `${entry.id} repeats candidate content hash ${source.sha256}`);
    paths.add(source.path);
    hashes.add(source.sha256);
    assert(isRecord(source.authoredResolution), `${owner} must preserve its true authored resolution`);
    for (const dimension of ['width', 'height']) {
      assert(
        source.authoredResolution[dimension] === null
          || (Number.isInteger(source.authoredResolution[dimension]) && source.authoredResolution[dimension] > 0),
        `${owner} authored ${dimension} is invalid`,
      );
    }
    assert(source.durationMs === null || (Number.isInteger(source.durationMs) && source.durationMs > 0), `${owner} duration is invalid`);

    const provenance = candidate.provenance;
    assert(isRecord(provenance), `${owner} provenance must be an object`);
    assert(ALLOWED_ACTUAL_TOOLS.has(provenance.actualTool), `${owner} actual generation tool is invalid`);
    assert(ALLOWED_GENERATION_MODES.has(provenance.mode), `${owner} generation mode is invalid`);
    assert(ISO_DATE_PATTERN.test(provenance.generatedAt), `${owner} generation date must be an ISO UTC timestamp`);
    assert(isNonEmptyString(provenance.finalPrompt), `${owner} final prompt is required`);
    assert(!FORBIDDEN_MASTER_TEXT.test(provenance.finalPrompt), `${owner} final prompt contains forbidden non-production language`);
    assert(Array.isArray(provenance.negativeConstraints) && provenance.negativeConstraints.length >= 5, `${owner} needs explicit negative constraints`);
    assert(provenance.negativeConstraints.every(isNonEmptyString), `${owner} negative constraints must be non-empty strings`);
    assert(provenance.negativeConstraints.some((value) => /fighting/i.test(value)), `${owner} negative constraints must exclude fighting content`);
    assert(provenance.rightsStatement === RIGHTS_STATEMENT, `${owner} rights statement is missing or altered`);
    assert(provenance.sourceSha256 === source.sha256, `${owner} source and provenance SHA-256 differ`);
    for (const field of ['model', 'outputId']) {
      assert(isNullableHonestValue(provenance[field]), `${owner} provenance.${field} must be null when not actually returned`);
    }
    assert(isNullableHonestSeed(provenance.seed), `${owner} provenance.seed must be null when not actually returned`);
    validateReferenceImageList(owner, provenance.referenceImages, projectRoot);
    validateActualToolAgainstRoute(entry, provenance.actualTool, owner);
    if (provenance.actualTool === 'local-post-processing') {
      assert(
        provenance.referenceImages.some(({ role }) => /approved-seed|generated-source/i.test(role)),
        `${owner} local post-processing must bind the built-in generated source or approved seed`,
      );
    }

    const review = candidate.review;
    assert(isRecord(review) && CANDIDATE_REVIEW_STATES.has(review.state), `${owner} review state is invalid`);
    assert(Array.isArray(review.defects) && review.defects.every(isNonEmptyString), `${owner} review defects must be an array of non-empty strings`);
    for (const field of ['reviewer', 'reviewedAt', 'notes']) {
      assert(review[field] === null || isNonEmptyString(review[field]), `${owner} review.${field} must be null or a non-empty string`);
    }
    if (review.state === 'pending') {
      assert(review.reviewer === null && review.reviewedAt === null, `${owner} pending review cannot claim reviewer evidence`);
    } else {
      assert(isNonEmptyString(review.reviewer), `${owner} completed review has no reviewer`);
      assert(ISO_DATE_PATTERN.test(review.reviewedAt), `${owner} completed review has no ISO review timestamp`);
      assert(isNonEmptyString(review.notes), `${owner} completed review has no notes`);
      if (review.state === 'reviewed') reviewed += 1;
    }

    if (projectRoot) {
      const absolute = resolveInside(projectRoot, source.path, `${owner} source`);
      assert(existsSync(absolute) && statSync(absolute).isFile(), `${owner} source does not exist: ${source.path}`);
      const buffer = readFileSync(absolute);
      assert(buffer.length === source.bytes, `${owner} source byte count does not match its file`);
      assert(sha256File(absolute) === source.sha256, `${owner} source SHA-256 does not match its file`);
      const inspected = inspectCandidateBuffer(format, buffer, owner);
      if (inspected?.width) {
        assert(
          source.authoredResolution.width === inspected.width
            && source.authoredResolution.height === inspected.height,
          `${owner} authored resolution does not match its source`,
        );
      }
    }
  }
  return { count: candidates.length, reviewed, paths, hashes };
}

function validateEvidencePath(path, label, projectRoot) {
  assert(isSafeRelativePath(path), `${label} path is unsafe or contains fighting content`);
  if (!projectRoot) return;
  const absolute = resolveInside(projectRoot, path, label);
  assert(existsSync(absolute) && statSync(absolute).isFile(), `${label} does not exist: ${path}`);
  assert(statSync(absolute).size > 0, `${label} is empty: ${path}`);
}

function validateApproval(entry, projectRoot, candidateSummary) {
  const approval = entry.approval;
  assert(isRecord(approval), `${entry.id} approval must be an object`);
  assert(V14_APPROVAL_STATES.includes(approval.state), `${entry.id} approval state is invalid`);
  for (const field of ['reviewer', 'reviewedAt', 'contactSheetPath', 'notes']) {
    assert(approval[field] === null || isNonEmptyString(approval[field]), `${entry.id} approval.${field} must be null or a non-empty string`);
  }
  if (approval.contactSheetPath !== null) {
    assert(/\.(?:png|webp|jpe?g)$/i.test(approval.contactSheetPath), `${entry.id} contact sheet must be a review image`);
    validateEvidencePath(approval.contactSheetPath, `${entry.id} contact sheet`, projectRoot);
  }
  if (approval.state === 'approved') {
    assert(entry.primary !== null, `${entry.id} cannot be approved without a primary master`);
    assert(isNonEmptyString(approval.reviewer), `${entry.id} approved source has no reviewer`);
    assert(ISO_DATE_PATTERN.test(approval.reviewedAt), `${entry.id} approved source has no ISO review timestamp`);
    assert(isSafeRelativePath(approval.contactSheetPath), `${entry.id} approved source has no safe contact-sheet path`);
  } else if (approval.state === 'candidate-review') {
    assert(entry.primary === null, `${entry.id} cannot bind a primary master while approval is candidate-review`);
    assert(candidateSummary.reviewed > 0, `${entry.id} candidate-review state needs at least one truthfully reviewed candidate record`);
    assert(isNonEmptyString(approval.reviewer), `${entry.id} candidate review has no reviewer`);
    assert(ISO_DATE_PATTERN.test(approval.reviewedAt), `${entry.id} candidate review has no ISO review timestamp`);
    assert(isSafeRelativePath(approval.contactSheetPath), `${entry.id} candidate review has no safe contact-sheet path`);
    assert(isNonEmptyString(approval.notes), `${entry.id} candidate review has no notes`);
  } else {
    assert(entry.primary === null, `${entry.id} cannot bind a primary master while approval is ${approval.state}`);
  }
}

function resolveInside(projectRoot, path, label) {
  assert(isSafeRelativePath(path), `${label} path is unsafe or contains fighting content`);
  const root = realpathSync(projectRoot);
  const absolute = resolve(projectRoot, path);
  const parent = existsSync(absolute) ? realpathSync(absolute) : realpathSync(resolve(absolute, '..'));
  const relativePath = relative(root, parent);
  assert(relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !relativePath.startsWith(sep)), `${label} escapes the project root`);
  return absolute;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJsonEvidenceFile(projectRoot, path, label) {
  const absolute = resolveInside(projectRoot, path, label);
  assert(existsSync(absolute) && statSync(absolute).isFile(), `${label} does not exist: ${path}`);
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function validateGateEvidenceArtifact(artifact, label, manifest, projectRoot) {
  assert(isRecord(artifact), `${label} must be an object`);
  assert(isSafeRelativePath(artifact.path), `${label} path is unsafe or contains fighting content`);
  assert(
    !artifact.path.startsWith(`${manifest.reviewRoot}/`),
    `${label} cannot use ignored candidate-review output as gate-close evidence`,
  );
  assert(SHA256_PATTERN.test(artifact.sha256), `${label} has no valid SHA-256`);
  const absolute = resolveInside(projectRoot, artifact.path, label);
  assert(existsSync(absolute) && statSync(absolute).isFile(), `${label} does not exist: ${artifact.path}`);
  assert(statSync(absolute).size > 0, `${label} is empty: ${artifact.path}`);
  assert(sha256File(absolute) === artifact.sha256, `${label} SHA-256 does not match ${artifact.path}`);
}

function validateGateClosureEvidence(manifest, projectRoot, gateId) {
  assert(projectRoot, `${gateId} gate-close validation requires a project root for evidence checks`);
  const gateBriefs = readJsonEvidenceFile(projectRoot, manifest.gateBriefs, 'V14 gate briefs');
  assert(isRecord(gateBriefs) && Array.isArray(gateBriefs.gates), 'V14 gate briefs must expose a gates array');
  const gate = manifest.gates.find(({ id }) => id === gateId);
  const brief = gateBriefs.gates.find(({ id }) => id === gateId);
  assert(brief, `${gateId} is absent from the authoritative gate briefs`);
  assert(
    brief.release === gate.release
      && brief.count === gate.count
      && brief.firstId === `PF-asset-${String(gate.firstOrdinal).padStart(3, '0')}`
      && brief.lastId === `PF-asset-${String(gate.lastOrdinal).padStart(3, '0')}`,
    `${gateId} gate brief does not match the fixed manifest range`,
  );
  assert(Array.isArray(brief.exitEvidence) && brief.exitEvidence.length > 0, `${gateId} gate brief has no exit-evidence contract`);
  assert(isRecord(gate.evidence), `${gateId} cannot close without structured gate evidence`);
  assert(Array.isArray(gate.evidence.requirements), `${gateId} gate evidence requirements must be an array`);
  assert(Array.isArray(gate.evidence.verticalSlice), `${gateId} vertical-slice evidence must be an array`);

  const expectedRequirements = new Set(brief.exitEvidence);
  const actualRequirements = new Set();
  const requirementPaths = new Set();
  for (const [index, record] of gate.evidence.requirements.entries()) {
    const label = `${gateId} gate evidence requirement ${index + 1}`;
    assert(isRecord(record) && isNonEmptyString(record.requirement), `${label} is invalid`);
    assert(expectedRequirements.has(record.requirement), `${label} is not declared by the authoritative gate brief`);
    assert(!actualRequirements.has(record.requirement), `${gateId} repeats gate evidence requirement ${record.requirement}`);
    actualRequirements.add(record.requirement);
    assert(Array.isArray(record.artifacts) && record.artifacts.length > 0, `${label} needs at least one evidence artifact`);
    for (const [artifactIndex, artifact] of record.artifacts.entries()) {
      validateGateEvidenceArtifact(artifact, `${label} artifact ${artifactIndex + 1}`, manifest, projectRoot);
      assert(!requirementPaths.has(artifact.path), `${gateId} repeats gate evidence path ${artifact.path}`);
      requirementPaths.add(artifact.path);
    }
  }
  assert(
    actualRequirements.size === expectedRequirements.size
      && [...expectedRequirements].every((requirement) => actualRequirements.has(requirement)),
    `${gateId} gate evidence does not cover every authoritative exit requirement`,
  );

  const expectedSurfaces = Array.isArray(brief.verticalSlice) ? new Set(brief.verticalSlice) : new Set();
  const actualSurfaces = new Set();
  const verticalPaths = new Set();
  for (const [index, record] of gate.evidence.verticalSlice.entries()) {
    const label = `${gateId} vertical-slice evidence ${index + 1}`;
    assert(isRecord(record) && isNonEmptyString(record.surface), `${label} is invalid`);
    assert(expectedSurfaces.has(record.surface), `${label} surface is not declared by the authoritative gate brief`);
    assert(!actualSurfaces.has(record.surface), `${gateId} repeats vertical-slice surface ${record.surface}`);
    actualSurfaces.add(record.surface);
    for (const viewport of ['desktop', 'mobile']) {
      validateGateEvidenceArtifact(record[viewport], `${label} ${viewport}`, manifest, projectRoot);
      assert(!verticalPaths.has(record[viewport].path), `${gateId} repeats vertical-slice evidence path ${record[viewport].path}`);
      verticalPaths.add(record[viewport].path);
    }
  }
  assert(
    actualSurfaces.size === expectedSurfaces.size
      && [...expectedSurfaces].every((surface) => actualSurfaces.has(surface)),
    `${gateId} vertical-slice evidence does not cover every authoritative surface`,
  );
}

function u32le(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function inspectPng(buffer, label) {
  assert(buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${label} has an invalid PNG signature`);
  assert(buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.includes(Buffer.from('IDAT')) && buffer.includes(Buffer.from('IEND')), `${label} is not a complete PNG`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert(width >= 16 && height >= 16, `${label} PNG dimensions are too small`);
  return { width, height };
}

function inspectWebp(buffer, label) {
  assert(buffer.length >= 32 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP', `${label} has an invalid WebP signature`);
}

function inspectAvif(buffer, label) {
  const header = buffer.toString('ascii', 0, Math.min(buffer.length, 64));
  assert(buffer.length >= 32 && header.includes('ftyp') && /(?:avif|avis)/.test(header), `${label} has an invalid AVIF signature`);
}

function inspectJpeg(buffer, label) {
  assert(buffer.length >= 32 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9, `${label} has an invalid JPEG stream`);
}

function inspectSvg(buffer, label) {
  const text = buffer.toString('utf8');
  assert(/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text) && /<\/svg>\s*$/i.test(text), `${label} is not a complete SVG`);
  assert(!FORBIDDEN_MASTER_TEXT.test(text), `${label} contains forbidden non-production content`);
}

function parseStructuredJson(buffer, label) {
  const text = buffer.toString('utf8');
  assert(!FORBIDDEN_MASTER_TEXT.test(text), `${label} contains forbidden non-production content`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  assert(isRecord(parsed) && Object.keys(parsed).length > 0, `${label} is an empty JSON master`);
  return parsed;
}

function inspectWav(buffer, label) {
  assert(
    buffer.length >= 44
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WAVE'
      && u32le(buffer, 4) + 8 <= buffer.length,
    `${label} is not a complete WAV source`,
  );
  let format = null;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkBytes = u32le(buffer, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkBytes;
    assert(dataEnd <= buffer.length, `${label} WAV chunk ${chunkId} is truncated`);
    if (chunkId === 'fmt ') {
      assert(chunkBytes >= 16, `${label} WAV fmt chunk is too small`);
      format = {
        audioFormat: buffer.readUInt16LE(dataStart),
        channels: buffer.readUInt16LE(dataStart + 2),
        sampleRate: u32le(buffer, dataStart + 4),
        byteRate: u32le(buffer, dataStart + 8),
        blockAlign: buffer.readUInt16LE(dataStart + 12),
        bitsPerSample: buffer.readUInt16LE(dataStart + 14),
      };
    } else if (chunkId === 'data') {
      dataBytes += chunkBytes;
    }
    offset = dataEnd + (chunkBytes % 2);
  }
  assert(format && dataBytes > 0, `${label} WAV source needs fmt and non-empty data chunks`);
  assert([1, 3].includes(format.audioFormat), `${label} WAV source must use PCM or IEEE float samples`);
  assert(format.channels >= 1 && format.channels <= 2, `${label} WAV channel count is unsupported`);
  assert(format.sampleRate >= 22050 && format.byteRate > 0 && format.blockAlign > 0, `${label} WAV format metadata is invalid`);
  assert(format.bitsPerSample >= 8 && format.bitsPerSample <= 32, `${label} WAV bit depth is invalid`);
  const expectedByteRate = format.sampleRate * format.blockAlign;
  assert(format.byteRate === expectedByteRate, `${label} WAV byte rate does not match its sample layout`);
  return {
    ...format,
    dataBytes,
    durationMs: Math.max(1, Math.round((dataBytes * 1000) / format.byteRate)),
  };
}

function mp4Boxes(buffer, start = 0, end = buffer.length, label = 'MP4') {
  const boxes = [];
  for (let offset = start; offset + 8 <= end;) {
    let bytes = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerBytes = 8;
    if (bytes === 1) {
      assert(offset + 16 <= end, `${label} ${type} box has a truncated large-size header`);
      const largeBytes = buffer.readBigUInt64BE(offset + 8);
      assert(largeBytes <= BigInt(Number.MAX_SAFE_INTEGER), `${label} ${type} box is too large`);
      bytes = Number(largeBytes);
      headerBytes = 16;
    } else if (bytes === 0) {
      bytes = end - offset;
    }
    assert(bytes >= headerBytes && offset + bytes <= end, `${label} ${type} box is truncated`);
    boxes.push({
      type,
      start: offset,
      dataStart: offset + headerBytes,
      end: offset + bytes,
    });
    offset += bytes;
  }
  return boxes;
}

function inspectMp4(buffer, label) {
  assert(buffer.length >= 64, `${label} is not a complete MP4 source`);
  const topLevel = mp4Boxes(buffer, 0, buffer.length, label);
  assert(topLevel.some(({ type }) => type === 'ftyp') && topLevel.some(({ type }) => type === 'mdat'), `${label} is not a complete MP4 source`);
  const moov = topLevel.find(({ type }) => type === 'moov');
  assert(moov, `${label} MP4 source has no movie metadata`);
  const movieBoxes = mp4Boxes(buffer, moov.dataStart, moov.end, label);
  const mvhd = movieBoxes.find(({ type }) => type === 'mvhd');
  assert(mvhd && mvhd.dataStart + 20 <= mvhd.end, `${label} MP4 source has no movie timing metadata`);
  const mvhdVersion = buffer[mvhd.dataStart];
  const timescaleOffset = mvhd.dataStart + (mvhdVersion === 1 ? 20 : 12);
  const durationOffset = mvhd.dataStart + (mvhdVersion === 1 ? 24 : 16);
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const durationUnits = mvhdVersion === 1
    ? Number(buffer.readBigUInt64BE(durationOffset))
    : buffer.readUInt32BE(durationOffset);
  assert(timescale > 0 && durationUnits > 0, `${label} MP4 duration metadata is invalid`);

  let dimensions = null;
  for (const track of movieBoxes.filter(({ type }) => type === 'trak')) {
    const trackBoxes = mp4Boxes(buffer, track.dataStart, track.end, label);
    const tkhd = trackBoxes.find(({ type }) => type === 'tkhd');
    const mdia = trackBoxes.find(({ type }) => type === 'mdia');
    if (!tkhd || !mdia) continue;
    const mediaBoxes = mp4Boxes(buffer, mdia.dataStart, mdia.end, label);
    const hdlr = mediaBoxes.find(({ type }) => type === 'hdlr');
    if (!hdlr || hdlr.dataStart + 12 > hdlr.end || buffer.toString('ascii', hdlr.dataStart + 8, hdlr.dataStart + 12) !== 'vide') continue;
    assert(tkhd.end - tkhd.dataStart >= 8, `${label} MP4 video-track dimensions are truncated`);
    const width = Math.round(buffer.readUInt32BE(tkhd.end - 8) / 65536);
    const height = Math.round(buffer.readUInt32BE(tkhd.end - 4) / 65536);
    if (width > 0 && height > 0 && (!dimensions || width * height > dimensions.width * dimensions.height)) {
      dimensions = { width, height };
    }
  }
  assert(dimensions, `${label} MP4 source has no measurable video track`);
  return {
    ...dimensions,
    durationMs: Math.max(1, Math.round((durationUnits * 1000) / timescale)),
  };
}

function readEbmlSize(buffer, offset, label) {
  assert(offset < buffer.length, `${label} has a truncated EBML size`);
  const first = buffer[offset];
  let length = 1;
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length += 1;
  assert(length <= 8 && offset + length <= buffer.length, `${label} has an invalid EBML size`);
  let value = first & (0xff >> length);
  for (let index = 1; index < length; index += 1) value = (value * 256) + buffer[offset + index];
  return { length, value };
}

function findEbmlPayload(buffer, id, label) {
  const offset = buffer.indexOf(id);
  if (offset < 0) return null;
  const size = readEbmlSize(buffer, offset + id.length, label);
  const start = offset + id.length + size.length;
  const end = start + size.value;
  assert(end <= buffer.length, `${label} has a truncated EBML element`);
  return buffer.subarray(start, end);
}

function readUnsignedBuffer(buffer) {
  let value = 0;
  for (const byte of buffer) value = (value * 256) + byte;
  return value;
}

function inspectWebm(buffer, label) {
  assert(buffer.length >= 32 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && buffer.includes(Buffer.from('webm')), `${label} is not a complete WebM source`);
  const widthPayload = findEbmlPayload(buffer, Buffer.from([0xb0]), label);
  const heightPayload = findEbmlPayload(buffer, Buffer.from([0xba]), label);
  const durationPayload = findEbmlPayload(buffer, Buffer.from([0x44, 0x89]), label);
  const scalePayload = findEbmlPayload(buffer, Buffer.from([0x2a, 0xd7, 0xb1]), label);
  assert(widthPayload && heightPayload && durationPayload, `${label} WebM source has no measurable video metadata`);
  const width = readUnsignedBuffer(widthPayload);
  const height = readUnsignedBuffer(heightPayload);
  const durationUnits = durationPayload.length === 4
    ? durationPayload.readFloatBE(0)
    : durationPayload.length === 8
      ? durationPayload.readDoubleBE(0)
      : Number.NaN;
  const timecodeScale = scalePayload ? readUnsignedBuffer(scalePayload) : 1_000_000;
  assert(width > 0 && height > 0 && Number.isFinite(durationUnits) && durationUnits > 0 && timecodeScale > 0, `${label} WebM video metadata is invalid`);
  return {
    width,
    height,
    durationMs: Math.max(1, Math.round((durationUnits * timecodeScale) / 1_000_000)),
  };
}

function inspectCandidateBuffer(format, buffer, label) {
  if (format === 'png') return inspectPng(buffer, label);
  if (format === 'webp') return inspectWebp(buffer, label);
  if (format === 'avif') return inspectAvif(buffer, label);
  if (format === 'jpg' || format === 'jpeg') return inspectJpeg(buffer, label);
  if (format === 'svg') return inspectSvg(buffer, label);
  if (format === 'json') return parseStructuredJson(buffer, label);
  if (format === 'wav') return inspectWav(buffer, label);
  if (format === 'mp4') return inspectMp4(buffer, label);
  if (format === 'webm') return inspectWebm(buffer, label);
  throw new Error(`${label} candidate format is unsupported`);
}

function validateNormalizedRect(rect, label) {
  assert(isRecord(rect), `${label} must be an object`);
  for (const field of ['x', 'y', 'width', 'height']) {
    assert(Number.isFinite(rect[field]), `${label}.${field} must be finite`);
  }
  assert(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0, `${label} has invalid normalized bounds`);
  assert(rect.x + rect.width <= 1 && rect.y + rect.height <= 1, `${label} exceeds its normalized canvas`);
}

function validateLayeredStructure(parsed, label) {
  assert(isRecord(parsed.canvas), `${label} layered master needs an authored canvas`);
  assert(Number.isInteger(parsed.canvas.width) && parsed.canvas.width > 0, `${label} layered canvas width is invalid`);
  assert(Number.isInteger(parsed.canvas.height) && parsed.canvas.height > 0, `${label} layered canvas height is invalid`);
  assert(Array.isArray(parsed.layers) && parsed.layers.length >= 2, `${label} layered master needs at least two authored layers`);
  const layerIds = new Set();
  const layerSources = new Set();
  for (const [index, layer] of parsed.layers.entries()) {
    const layerLabel = `${label} layer ${index + 1}`;
    assert(isRecord(layer) && isNonEmptyString(layer.id), `${layerLabel} needs an ID`);
    assert(!layerIds.has(layer.id), `${label} repeats layer ID ${layer.id}`);
    layerIds.add(layer.id);
    assert(isNonEmptyString(layer.role), `${layerLabel} needs an authored role`);
    assert(isSafeRelativePath(layer.source) && layer.source.startsWith('art-source/v14/masters/'), `${layerLabel} source is unsafe`);
    assert(!layerSources.has(layer.source), `${label} repeats layer source ${layer.source}`);
    layerSources.add(layer.source);
  }
  assert(isRecord(parsed.safeZones) && Object.keys(parsed.safeZones).length >= 3, `${label} layered master needs explicit safe zones`);
  for (const [name, rect] of Object.entries(parsed.safeZones)) validateNormalizedRect(rect, `${label} safe zone ${name}`);
}

function validateRigStructure(parsed, label) {
  assert(isRecord(parsed.rig), `${label} rig master needs a rig object`);
  assert(Array.isArray(parsed.rig.bones) && parsed.rig.bones.length >= 2, `${label} rig needs authored bones`);
  const bones = new Map();
  for (const [index, bone] of parsed.rig.bones.entries()) {
    const boneLabel = `${label} bone ${index + 1}`;
    assert(isRecord(bone), `${boneLabel} must be an object`);
    const id = bone.id ?? bone.name;
    assert(isNonEmptyString(id), `${boneLabel} needs an ID`);
    assert(!bones.has(id), `${label} repeats bone ID ${id}`);
    assert(bone.parent === null || isNonEmptyString(bone.parent), `${boneLabel} parent must be null or a bone ID`);
    assert(bone.parent !== id, `${boneLabel} cannot parent itself`);
    bones.set(id, bone.parent);
  }
  const roots = [...bones.values()].filter((parent) => parent === null);
  assert(roots.length === 1, `${label} rig must have exactly one root bone`);
  for (const [id, parent] of bones) {
    if (parent !== null) assert(bones.has(parent), `${label} bone ${id} references unknown parent ${parent}`);
    const visited = new Set([id]);
    let ancestor = parent;
    while (ancestor !== null) {
      assert(bones.has(ancestor), `${label} bone ${id} references unknown parent ${ancestor}`);
      assert(!visited.has(ancestor), `${label} rig contains a bone-parent cycle at ${ancestor}`);
      visited.add(ancestor);
      ancestor = bones.get(ancestor);
    }
  }

  assert(Array.isArray(parsed.rig.animations) && parsed.rig.animations.length >= 1, `${label} rig needs authored animation data`);
  const animationIds = new Set();
  for (const [index, animation] of parsed.rig.animations.entries()) {
    const animationLabel = `${label} animation ${index + 1}`;
    assert(isRecord(animation), `${animationLabel} must be an object`);
    const id = animation.id ?? animation.name;
    assert(isNonEmptyString(id), `${animationLabel} needs an ID`);
    assert(!animationIds.has(id), `${label} repeats animation ID ${id}`);
    animationIds.add(id);
    assert(Number.isInteger(animation.durationMs) && animation.durationMs > 0, `${animationLabel} needs a positive measured duration`);
    assert(Array.isArray(animation.tracks) && animation.tracks.length > 0, `${animationLabel} needs authored bone tracks`);
    const trackBones = new Set();
    for (const [trackIndex, track] of animation.tracks.entries()) {
      const trackLabel = `${animationLabel} track ${trackIndex + 1}`;
      assert(isRecord(track) && isNonEmptyString(track.bone), `${trackLabel} needs a bone ID`);
      assert(bones.has(track.bone), `${trackLabel} references unknown bone ${String(track.bone)}`);
      assert(!trackBones.has(track.bone), `${animationLabel} repeats track for bone ${track.bone}`);
      trackBones.add(track.bone);
      assert(Array.isArray(track.keyframes) && track.keyframes.length >= 2, `${trackLabel} needs at least two keyframes`);
      let previousTime = -1;
      for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
        assert(isRecord(keyframe), `${trackLabel} keyframe ${keyframeIndex + 1} must be an object`);
        assert(
          Number.isInteger(keyframe.timeMs)
            && keyframe.timeMs >= 0
            && keyframe.timeMs <= animation.durationMs
            && keyframe.timeMs > previousTime,
          `${trackLabel} keyframe times must be strictly increasing and within the animation duration`,
        );
        previousTime = keyframe.timeMs;
      }
    }
  }
}

function validateStructuredKind(kind, parsed, label) {
  if (kind === 'layered') {
    validateLayeredStructure(parsed, label);
  } else if (kind === 'rig') {
    validateRigStructure(parsed, label);
  } else if (kind === 'semantic') {
    assert(isNonEmptyString(parsed.semanticType), `${label} semantic master needs a semanticType`);
    assert(isRecord(parsed.data) && Object.keys(parsed.data).length > 0, `${label} semantic master needs non-empty authored data`);
  }
}

function validatePrimary(entry, projectRoot) {
  const primary = entry.primary;
  if (primary === null) {
    assert(entry.provenance.state === 'not-generated', `${entry.id} generated provenance has no primary source`);
    return null;
  }
  assert(entry.approval.state === 'approved', `${entry.id} primary source is unapproved`);
  assert(entry.provenance.state === 'generated', `${entry.id} primary source has no generated provenance`);
  assert(isRecord(primary), `${entry.id} primary must be an object`);
  assert(isSafeRelativePath(primary.path) && primary.path.startsWith('art-source/v14/masters/'), `${entry.id} primary path must stay under art-source/v14/masters`);
  assert(primary.path.split('/').at(-1).startsWith(`${entry.id}-`), `${entry.id} primary filename must begin with its PF ID`);
  const format = extname(primary.path).slice(1).toLowerCase();
  assert(primary.format === format && KIND_FORMATS[entry.kind].has(format), `${entry.id} ${entry.kind} master does not support ${String(primary.format)}`);
  assert(Number.isInteger(primary.bytes) && primary.bytes > 0, `${entry.id} primary byte count is invalid`);
  assert(SHA256_PATTERN.test(primary.sha256), `${entry.id} primary SHA-256 is invalid`);
  assert(primary.sha256 === entry.provenance.sourceSha256, `${entry.id} primary and provenance SHA-256 differ`);
  assert(isRecord(primary.authoredResolution), `${entry.id} must preserve its true authored resolution`);
  for (const dimension of ['width', 'height']) {
    assert(primary.authoredResolution[dimension] === null || (Number.isInteger(primary.authoredResolution[dimension]) && primary.authoredResolution[dimension] > 0), `${entry.id} authored ${dimension} is invalid`);
  }
  assert(primary.durationMs === null || (Number.isInteger(primary.durationMs) && primary.durationMs > 0), `${entry.id} duration is invalid`);
  if (!projectRoot) return primary;

  const absolute = resolveInside(projectRoot, primary.path, `${entry.id} primary`);
  assert(existsSync(absolute) && statSync(absolute).isFile(), `${entry.id} primary source does not exist: ${primary.path}`);
  const buffer = readFileSync(absolute);
  assert(buffer.length === primary.bytes, `${entry.id} primary byte count does not match its file`);
  assert(sha256File(absolute) === primary.sha256, `${entry.id} primary SHA-256 does not match its file`);

  if (format === 'png') {
    const dimensions = inspectPng(buffer, entry.id);
    assert(primary.authoredResolution.width === dimensions.width && primary.authoredResolution.height === dimensions.height, `${entry.id} authored PNG resolution does not match its source`);
  } else if (format === 'webp') inspectWebp(buffer, entry.id);
  else if (format === 'avif') inspectAvif(buffer, entry.id);
  else if (format === 'jpg' || format === 'jpeg') inspectJpeg(buffer, entry.id);
  else if (format === 'svg') inspectSvg(buffer, entry.id);
  else if (format === 'wav') inspectWav(buffer, entry.id);
  else if (format === 'mp4') inspectMp4(buffer, entry.id);
  else if (format === 'webm') inspectWebm(buffer, entry.id);
  else if (format === 'json') validateStructuredKind(entry.kind, parseStructuredJson(buffer, entry.id), entry.id);
  return primary;
}

function validateCompanions(entry, projectRoot) {
  assert(Array.isArray(entry.companions), `${entry.id} companions must be an array`);
  if (entry.approval.state !== 'approved') {
    assert(entry.companions.length === 0, `${entry.id} cannot bind companion masters while approval is ${entry.approval.state}`);
  }
  const paths = new Set();
  const hashes = new Set();
  for (const [index, companion] of entry.companions.entries()) {
    assert(isRecord(companion), `${entry.id} companion ${index + 1} must be an object`);
    assert(isNonEmptyString(companion.role), `${entry.id} companion ${index + 1} has no role`);
    assert(!FIGHTING_PATTERN.test(companion.role), `${entry.id} companion ${index + 1} role contains fighting content`);
    assert(isSafeRelativePath(companion.path) && companion.path.startsWith('art-source/v14/masters/'), `${entry.id} companion ${index + 1} has an unsafe path`);
    assert(companion.path.split('/').at(-1).startsWith(`${entry.id}-`), `${entry.id} companion filename must begin with its PF ID`);
    const format = extname(companion.path).slice(1).toLowerCase();
    assert(companion.format === format && CANDIDATE_FORMATS.has(format), `${entry.id} companion format does not match its path`);
    assert(Number.isInteger(companion.bytes) && companion.bytes > 0 && SHA256_PATTERN.test(companion.sha256), `${entry.id} companion integrity metadata is invalid`);
    assert(!paths.has(companion.path), `${entry.id} repeats companion path ${companion.path}`);
    assert(!hashes.has(companion.sha256), `${entry.id} repeats companion content hash ${companion.sha256}`);
    assert(companion.path !== entry.primary?.path, `${entry.id} companion cannot reuse its primary path`);
    paths.add(companion.path);
    hashes.add(companion.sha256);
    if (projectRoot) {
      const absolute = resolveInside(projectRoot, companion.path, `${entry.id} companion`);
      assert(existsSync(absolute) && statSync(absolute).isFile(), `${entry.id} companion does not exist: ${companion.path}`);
      const buffer = readFileSync(absolute);
      assert(buffer.length === companion.bytes && sha256File(absolute) === companion.sha256, `${entry.id} companion integrity does not match ${companion.path}`);
      inspectCandidateBuffer(format, buffer, `${entry.id} companion ${index + 1}`);
    }
  }
  if (entry.kind === 'atlas' && entry.primary !== null) {
    const atlasData = entry.companions.filter(({ role }) => role === 'atlas-data');
    assert(atlasData.length === 1 && atlasData[0].format === 'json', `${entry.id} atlas master needs exactly one JSON atlas-data companion`);
  }
}

function validateUsage(entry) {
  assert(Array.isArray(entry.dependencies) && entry.dependencies.every((id) => ID_PATTERN.test(id)), `${entry.id} dependencies must contain only PF IDs`);
  assert(new Set(entry.dependencies).size === entry.dependencies.length && !entry.dependencies.includes(entry.id), `${entry.id} dependencies must be unique and cannot self-reference`);
  assert(Array.isArray(entry.usageReferences), `${entry.id} usageReferences must be an array`);
  for (const [index, usage] of entry.usageReferences.entries()) {
    assert(isRecord(usage), `${entry.id} usage reference ${index + 1} must be an object`);
    assert(['runtime', 'production'].includes(usage.kind), `${entry.id} usage reference ${index + 1} kind is invalid`);
    assert(isNonEmptyString(usage.target) && !FIGHTING_PATTERN.test(usage.target), `${entry.id} usage reference ${index + 1} is empty or contains fighting content`);
  }
  if (entry.approval.state === 'approved') {
    assert(entry.usageReferences.some(({ kind }) => kind === 'runtime'), `${entry.id} approved output is unreferenced by the runtime`);
  }
}

function validateTechnical(entry) {
  assert(isRecord(entry.technical), `${entry.id} technical metadata must be an object`);
  assert(!FIGHTING_PATTERN.test(JSON.stringify(entry.technical)), `${entry.id} technical metadata contains fighting content`);
  if (entry.primary === null) return;
  if (entry.kind === 'atlas') {
    assert(Number.isInteger(entry.technical.frameCount) && entry.technical.frameCount > 0, `${entry.id} atlas needs a positive frame count`);
    assert(isRecord(entry.technical.pivot), `${entry.id} atlas needs a pivot`);
    assert(
      Number.isFinite(entry.technical.pivot.x)
        && Number.isFinite(entry.technical.pivot.y)
        && entry.technical.pivot.x >= 0
        && entry.technical.pivot.x <= 1
        && entry.technical.pivot.y >= 0
        && entry.technical.pivot.y <= 1,
      `${entry.id} atlas pivot is invalid`,
    );
  } else if (entry.kind === 'audio') {
    assert(Number.isInteger(entry.technical.sampleRate) && entry.technical.sampleRate >= 22050, `${entry.id} audio source needs a valid sample rate`);
    assert([1, 2].includes(entry.technical.channels), `${entry.id} audio source channel count is invalid`);
    assert(Number.isInteger(entry.technical.bitsPerSample) && entry.technical.bitsPerSample >= 8 && entry.technical.bitsPerSample <= 32, `${entry.id} audio bit depth is invalid`);
    assert(Number.isInteger(entry.technical.durationMs) && entry.technical.durationMs > 0, `${entry.id} audio source needs a measured duration`);
    assert(entry.primary.durationMs !== null, `${entry.id} audio source descriptor needs a measured duration`);
  } else if (entry.kind === 'video') {
    assert(Number.isInteger(entry.technical.width) && entry.technical.width > 0 && Number.isInteger(entry.technical.height) && entry.technical.height > 0, `${entry.id} video needs authored dimensions`);
    assert(Number.isInteger(entry.technical.durationMs) && entry.technical.durationMs > 0, `${entry.id} video needs a measured technical duration`);
    assert(entry.primary.durationMs !== null, `${entry.id} video needs a measured duration`);
    assert(
      entry.primary.authoredResolution.width === entry.technical.width
        && entry.primary.authoredResolution.height === entry.technical.height,
      `${entry.id} video technical dimensions must match its source descriptor`,
    );
    assert(Math.abs(entry.primary.durationMs - entry.technical.durationMs) <= 2, `${entry.id} video duration metadata disagrees`);
  } else if (entry.kind === 'layered') {
    assert(Array.isArray(entry.technical.safeZones) && entry.technical.safeZones.length >= 3, `${entry.id} layered composition needs HUD, playfield and launcher safe zones`);
    assert(new Set(entry.technical.safeZones).size === entry.technical.safeZones.length && entry.technical.safeZones.every(isNonEmptyString), `${entry.id} layered safe-zone labels must be unique`);
    assert(
      isRecord(entry.technical.sourceCanvas)
        && Number.isInteger(entry.technical.sourceCanvas.width)
        && entry.technical.sourceCanvas.width > 0
        && Number.isInteger(entry.technical.sourceCanvas.height)
        && entry.technical.sourceCanvas.height > 0,
      `${entry.id} layered composition needs measured source-canvas dimensions`,
    );
  } else if (entry.kind === 'rig') {
    assert(isNonEmptyString(entry.technical.coordinateSpace), `${entry.id} rig needs a coordinate space`);
  } else if (entry.kind === 'semantic') {
    assert(isNonEmptyString(entry.technical.schema), `${entry.id} semantic master needs a schema identifier`);
  }
}

function atlasFrameRecords(parsed, label) {
  assert(isRecord(parsed), `${label} atlas data must be an object`);
  if (Array.isArray(parsed.frames)) {
    return parsed.frames.map((frame, index) => ({
      name: frame?.name ?? frame?.id,
      value: frame,
      label: `${label} frame ${index + 1}`,
    }));
  }
  assert(isRecord(parsed.frames), `${label} atlas data needs a frames array or object`);
  return Object.entries(parsed.frames).map(([name, value]) => ({
    name,
    value,
    label: `${label} frame ${name}`,
  }));
}

function validateAtlasBindings(entry, projectRoot) {
  const atlasCompanion = entry.companions.find(({ role }) => role === 'atlas-data');
  const absolute = resolveInside(projectRoot, atlasCompanion.path, `${entry.id} atlas data`);
  const parsed = parseStructuredJson(readFileSync(absolute), `${entry.id} atlas data`);
  const frames = atlasFrameRecords(parsed, `${entry.id} atlas data`);
  assert(frames.length === entry.technical.frameCount, `${entry.id} atlas frame count does not match its atlas-data companion`);
  const names = new Set();
  const width = entry.primary.authoredResolution.width;
  const height = entry.primary.authoredResolution.height;
  assert(Number.isInteger(width) && Number.isInteger(height), `${entry.id} atlas needs measured source dimensions`);
  for (const frame of frames) {
    assert(isNonEmptyString(frame.name) && !names.has(frame.name), `${frame.label} has no unique name`);
    names.add(frame.name);
    assert(isRecord(frame.value), `${frame.label} must be an object`);
    const sourceRect = frame.value.rect ?? frame.value.frame;
    assert(isRecord(sourceRect), `${frame.label} needs a source rectangle`);
    const rect = {
      x: sourceRect.x,
      y: sourceRect.y,
      width: sourceRect.width ?? sourceRect.w,
      height: sourceRect.height ?? sourceRect.h,
    };
    assert(
      Number.isInteger(rect.x)
        && Number.isInteger(rect.y)
        && Number.isInteger(rect.width)
        && Number.isInteger(rect.height)
        && rect.x >= 0
        && rect.y >= 0
        && rect.width > 0
        && rect.height > 0,
      `${frame.label} source rectangle is invalid`,
    );
    assert(rect.x + rect.width <= width && rect.y + rect.height <= height, `${frame.label} source rectangle exceeds the atlas`);
    const pivot = frame.value.pivot;
    assert(
      isRecord(pivot)
        && Number.isFinite(pivot.x)
        && Number.isFinite(pivot.y)
        && pivot.x >= 0
        && pivot.x <= 1
        && pivot.y >= 0
        && pivot.y <= 1,
      `${frame.label} needs a normalized pivot`,
    );
  }
}

function validateLayeredBindings(entry, projectRoot) {
  const absolute = resolveInside(projectRoot, entry.primary.path, `${entry.id} layered primary`);
  const parsed = parseStructuredJson(readFileSync(absolute), entry.id);
  validateLayeredStructure(parsed, entry.id);
  assert(
    parsed.canvas.width === entry.technical.sourceCanvas.width
      && parsed.canvas.height === entry.technical.sourceCanvas.height,
    `${entry.id} layered canvas does not match its measured technical dimensions`,
  );
  const layerSources = new Set(parsed.layers.map(({ source }) => source));
  const companionPaths = new Set(entry.companions.map(({ path }) => path));
  assert(
    layerSources.size === companionPaths.size
      && [...layerSources].every((path) => companionPaths.has(path))
      && [...companionPaths].every((path) => layerSources.has(path)),
    `${entry.id} layered source paths must bind exactly to its companion descriptors`,
  );
  for (const companion of entry.companions) {
    const format = extname(companion.path).slice(1).toLowerCase();
    if (format !== 'png') continue;
    const dimensions = inspectPng(
      readFileSync(resolveInside(projectRoot, companion.path, `${entry.id} layer companion`)),
      `${entry.id} layer companion`,
    );
    assert(
      dimensions.width === parsed.canvas.width && dimensions.height === parsed.canvas.height,
      `${entry.id} layer companion dimensions do not match the authored canvas`,
    );
  }
}

function validateMeasuredMedia(entry, projectRoot) {
  const absolute = resolveInside(projectRoot, entry.primary.path, `${entry.id} media primary`);
  const buffer = readFileSync(absolute);
  if (entry.kind === 'audio') {
    const measured = inspectWav(buffer, entry.id);
    assert(measured.sampleRate === entry.technical.sampleRate, `${entry.id} measured WAV sample rate does not match technical metadata`);
    assert(measured.channels === entry.technical.channels, `${entry.id} measured WAV channels do not match technical metadata`);
    assert(measured.bitsPerSample === entry.technical.bitsPerSample, `${entry.id} measured WAV bit depth does not match technical metadata`);
    assert(Math.abs(measured.durationMs - entry.technical.durationMs) <= 1, `${entry.id} measured WAV duration does not match technical metadata`);
    assert(Math.abs(measured.durationMs - entry.primary.durationMs) <= 1, `${entry.id} measured WAV duration does not match its source descriptor`);
  } else if (entry.kind === 'video') {
    const format = extname(entry.primary.path).slice(1).toLowerCase();
    const measured = format === 'mp4' ? inspectMp4(buffer, entry.id) : inspectWebm(buffer, entry.id);
    assert(
      measured.width === entry.technical.width && measured.height === entry.technical.height,
      `${entry.id} measured video dimensions do not match technical metadata`,
    );
    assert(Math.abs(measured.durationMs - entry.technical.durationMs) <= 2, `${entry.id} measured video duration does not match technical metadata`);
    assert(Math.abs(measured.durationMs - entry.primary.durationMs) <= 2, `${entry.id} measured video duration does not match its source descriptor`);
  }
}

function validateStructuredMediaBindings(entry, projectRoot) {
  if (!projectRoot || entry.primary === null) return;
  if (entry.kind === 'atlas') validateAtlasBindings(entry, projectRoot);
  else if (entry.kind === 'layered') validateLayeredBindings(entry, projectRoot);
  else if (entry.kind === 'audio' || entry.kind === 'video') validateMeasuredMedia(entry, projectRoot);
}

function listFiles(root, current = root) {
  if (!existsSync(current)) return [];
  const output = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = resolve(current, entry.name);
    assert(!entry.isSymbolicLink() && !lstatSync(absolute).isSymbolicLink(), `V14 master tree cannot contain symbolic links: ${absolute}`);
    if (entry.isDirectory()) output.push(...listFiles(root, absolute));
    else if (entry.isFile()) output.push(relative(root, absolute).split(sep).join('/'));
  }
  return output.sort();
}

function validateMasterTree(manifest, projectRoot) {
  const root = resolveInside(projectRoot, manifest.masterRoot, 'V14 master root');
  const listed = new Set();
  for (const entry of manifest.entries) {
    if (entry.primary) listed.add(relative(manifest.masterRoot, entry.primary.path).split(sep).join('/'));
    for (const companion of entry.companions) listed.add(relative(manifest.masterRoot, companion.path).split(sep).join('/'));
  }
  const disk = listFiles(root);
  const unlisted = disk.filter((path) => !listed.has(path));
  const missing = [...listed].filter((path) => !disk.includes(path));
  assert(unlisted.length === 0, `V14 master tree contains unreferenced output: ${unlisted[0]}`);
  assert(missing.length === 0, `V14 manifest references missing master output: ${missing[0]}`);
}

function validateTopLevel(manifest) {
  assert(isRecord(manifest), 'V14 manifest must be an object');
  assert(manifest.schemaVersion === 2 && manifest.manifestType === 'ProductionMasterManifestV2', 'V14 manifest must use ProductionMasterManifestV2');
  assert(manifest.project === 'PaoPao Fusion' && manifest.artVersion === 'V14', 'V14 manifest project identity is invalid');
  assert(['briefing', 'production'].includes(manifest.status), 'V14 manifest status is invalid');
  for (const field of ['sourceLedger', 'styleBible', 'gateBriefs', 'masterRoot', 'reviewRoot']) {
    assert(isSafeRelativePath(manifest[field]), `V14 manifest ${field} is unsafe or contains fighting content`);
  }
  assert(manifest.sourceLedger === V14_LEDGER_PATH && manifest.styleBible === V14_STYLE_BIBLE_PATH && manifest.gateBriefs === V14_BRIEFS_PATH, 'V14 manifest source bindings are invalid');
  assert(manifest.masterRoot === 'art-source/v14/masters' && manifest.reviewRoot === 'art-source/v14/review', 'V14 manifest source roots are invalid');
  assert(manifest.rightsStatement === RIGHTS_STATEMENT, 'V14 manifest rights statement is invalid');
  assert(isRecord(manifest.legacyPolicy) && manifest.legacyPolicy.finalArtProducer === false, 'legacy procedural generator must be marked non-final');
  assert(Array.isArray(manifest.gates) && manifest.gates.length === 5, 'V14 manifest must declare five approval gates');
  for (const expected of V14_GATES) {
    const actual = manifest.gates.find(({ id }) => id === expected.id);
    assert(actual && actual.release === expected.release && actual.firstOrdinal === expected.firstOrdinal && actual.lastOrdinal === expected.lastOrdinal && actual.count === 100, `${expected.id} gate contract is invalid`);
    assert(['briefing', 'approved'].includes(actual.status), `${expected.id} gate status is invalid`);
    assert(actual.evidence === undefined || isRecord(actual.evidence), `${expected.id} gate evidence must be an object when declared`);
  }
  assert(Array.isArray(manifest.entries) && manifest.total === manifest.entries.length && manifest.total === 500, `V14 manifest must contain exactly 500 entries; received ${manifest.entries?.length ?? 0}`);
}

export function validateV14Manifest({
  ledger,
  manifest,
  projectRoot,
  phase = 'briefing',
  gate = null,
  scanMasterTree,
} = {}) {
  assert(['briefing', 'gate', 'release'].includes(phase), `unknown V14 validation phase ${String(phase)}`);
  if (phase === 'gate') assert(V14_GATES.some(({ id }) => id === gate), 'gate validation requires A1, A2, A3, A4 or A5');
  validateTopLevel(manifest);
  const claimedApprovedGates = manifest.gates.filter(({ status }) => status === 'approved').map(({ id }) => id);
  if (claimedApprovedGates.length > 0) {
    assert(projectRoot, 'approved V14 gate claims require project-root evidence verification');
    for (const approvedGate of claimedApprovedGates) validateGateClosureEvidence(manifest, projectRoot, approvedGate);
  }
  const assetItems = assetItemsFromLedger(ledger);
  const ledgerById = new Map(assetItems.map((item) => [item.id, item]));
  const ids = new Set();
  const primaryPaths = new Set();
  const primaryHashes = new Set();
  const candidatePaths = new Set();
  const candidateHashes = new Set();
  let candidateReviewCount = 0;
  const gateCounts = new Map(V14_GATES.map(({ id }) => [id, 0]));
  const kindCounts = new Map(V14_MASTER_KINDS.map((kind) => [kind, 0]));

  for (const [index, entry] of manifest.entries.entries()) {
    assert(isRecord(entry), `V14 entry ${index + 1} must be an object`);
    assert(ID_PATTERN.test(entry.id) && ledgerById.has(entry.id), `V14 entry ${index + 1} has unknown PF ID ${String(entry.id)}`);
    assert(!ids.has(entry.id), `duplicate V14 PF ID ${entry.id}`);
    ids.add(entry.id);
    validateLedgerBinding(entry, ledgerById.get(entry.id));
    assert(V14_MASTER_KINDS.includes(entry.kind), `${entry.id} uses unsupported master kind ${String(entry.kind)}`);
    gateCounts.set(entry.gate, gateCounts.get(entry.gate) + 1);
    kindCounts.set(entry.kind, kindCounts.get(entry.kind) + 1);
    validateProvenance(entry, projectRoot);
    const candidateSummary = validateCandidateReviews(entry, projectRoot, manifest.reviewRoot);
    candidateReviewCount += candidateSummary.count;
    for (const path of candidateSummary.paths) {
      assert(!candidatePaths.has(path), `duplicate V14 candidate path ${path}`);
      candidatePaths.add(path);
    }
    for (const hash of candidateSummary.hashes) {
      assert(!candidateHashes.has(hash), `duplicate V14 candidate content hash ${hash}`);
      candidateHashes.add(hash);
    }
    validateApproval(entry, projectRoot, candidateSummary);
    const primary = validatePrimary(entry, projectRoot);
    validateCompanions(entry, projectRoot);
    validateTechnical(entry);
    validateStructuredMediaBindings(entry, projectRoot);
    validateUsage(entry);
    if (primary) {
      assert(!primaryPaths.has(primary.path), `duplicate V14 primary path ${primary.path}`);
      assert(!primaryHashes.has(primary.sha256), `duplicate V14 primary content hash ${primary.sha256}`);
      primaryPaths.add(primary.path);
      primaryHashes.add(primary.sha256);
    }
  }

  assert(assetItems.every(({ id }) => ids.has(id)), 'V14 manifest does not cover all 500 ledger asset IDs');
  for (const { id } of V14_GATES) assert(gateCounts.get(id) === 100, `${id} must contain exactly 100 V14 entries`);
  for (const kind of V14_MASTER_KINDS) assert(kindCounts.get(kind) > 0, `V14 manifest does not exercise the ${kind} master kind`);

  if (phase === 'gate') {
    const gateEntries = manifest.entries.filter((entry) => entry.gate === gate);
    assert(gateEntries.every((entry) => entry.approval.state === 'approved' && entry.primary !== null), `${gate} cannot close with unapproved or missing masters`);
    const declaredGate = manifest.gates.find(({ id }) => id === gate);
    assert(declaredGate.status === 'approved', `${gate} cannot close while its manifest status is ${declaredGate.status}`);
  }
  if (phase === 'release') {
    assert(manifest.status === 'production', 'V14 release validation requires production manifest status');
    assert(manifest.gates.every(({ status }) => status === 'approved'), 'V14 release cannot close with an unapproved gate');
    assert(manifest.entries.every((entry) => entry.approval.state === 'approved' && entry.primary !== null), 'V14 release cannot close with unapproved or missing masters');
  }
  const shouldScanMasterTree = scanMasterTree ?? Boolean(projectRoot);
  if (projectRoot && shouldScanMasterTree) validateMasterTree(manifest, projectRoot);

  return {
    total: manifest.entries.length,
    approved: manifest.entries.filter(({ approval }) => approval.state === 'approved').length,
    gates: Object.fromEntries(gateCounts),
    kinds: Object.fromEntries(kindCounts),
    primaryHashes: primaryHashes.size,
    candidateReviews: candidateReviewCount,
  };
}

export function readV14Manifest(projectRoot, manifestPath = V14_MANIFEST_PATH) {
  assert(isSafeRelativePath(manifestPath), 'V14 manifest path is unsafe');
  const absolute = resolveInside(projectRoot, manifestPath, 'V14 manifest');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    throw new Error('V14 manifest is not valid JSON');
  }
  return manifest;
}

export function readV14Ledger(projectRoot, ledgerPath = V14_LEDGER_PATH) {
  assert(isSafeRelativePath(ledgerPath), 'V14 ledger path is unsafe');
  const absolute = resolveInside(projectRoot, ledgerPath, 'V14 ledger');
  return JSON.parse(readFileSync(absolute, 'utf8'));
}

export function manifestDigest(manifest) {
  return createHash('sha256').update(`${JSON.stringify(manifest, null, 2)}\n`).digest('hex');
}
