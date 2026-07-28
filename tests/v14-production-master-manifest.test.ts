import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createV14BriefManifest,
  readV14Ledger,
  readV14Manifest,
  V14_MASTER_KINDS,
  validateV14Manifest,
} from '../tools/v14-art-manifest-lib.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const temporaryRoots: string[] = [];
const APPROVED_MASTER_IDS = [
  'PF-asset-002',
  'PF-asset-012',
  'PF-asset-021',
  'PF-asset-031',
  'PF-asset-102',
  'PF-asset-231',
  'PF-asset-402',
  'PF-asset-411',
];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paopao-v14-manifest-'));
  temporaryRoots.push(root);
  return root;
}

function freshBriefManifest(): any {
  return createV14BriefManifest(readV14Ledger(projectRoot));
}

function write(root: string, path: string, contents: string | Buffer): void {
  const absolute = join(root, ...path.split('/'));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function approveSemanticEntry(
  manifest: any,
  entryIndex: number,
  root: string,
  contents: string,
  withRuntimeReference = true,
): void {
  const entry = manifest.entries[entryIndex];
  const sha256 = createHash('sha256').update(contents).digest('hex');
  const path = `art-source/v14/masters/${entry.id}-authored-semantic.json`;
  write(root, path, contents);
  entry.provenance = {
    ...entry.provenance,
    state: 'generated',
    actualTool: 'local-authoring',
    mode: 'local-authoring',
    generatedAt: '2026-07-28T00:00:00Z',
    finalPrompt: `Author the production ${entry.brief.deliverable} for ${entry.brief.subject}.`,
    sourceSha256: sha256,
  };
  entry.approval = {
    state: 'approved',
    reviewer: 'V14 art review',
    reviewedAt: '2026-07-28T01:00:00Z',
    contactSheetPath: `docs/art/v14/review/${entry.id}.png`,
    notes: 'Source and actual-scale capture reviewed.',
  };
  write(root, entry.approval.contactSheetPath, Buffer.from('candidate contact sheet evidence'));
  entry.primary = {
    path,
    format: 'json',
    bytes: Buffer.byteLength(contents),
    sha256,
    authoredResolution: { width: null, height: null },
    durationMs: null,
  };
  entry.technical = { schema: 'paopao.v14.semantic.test.v1' };
  entry.usageReferences = withRuntimeReference
    ? [{ kind: 'runtime', target: `runtime:v14:${entry.id}` }]
    : [];
}

function attachReviewedCandidate(
  manifest: any,
  entryIndex: number,
  root: string,
  actualTool: 'built-in-image-generation' | 'local-authoring' = 'built-in-image-generation',
): any {
  const entry = manifest.entries[entryIndex];
  const source = readFileSync(join(projectRoot, 'art-source', 'v14', 'canon', 'approved', 'lumi-seed.png'));
  const sha256 = createHash('sha256').update(source).digest('hex');
  const path = `art-source/v14/review/generated/${entry.id}-candidate-a.png`;
  const contactSheetPath = `docs/art/v14/review/${entry.id}-candidate-contact.png`;
  write(root, path, source);
  write(root, contactSheetPath, source);
  entry.candidateReviews = [{
    id: `${entry.id}-candidate-a`,
    source: {
      path,
      format: 'png',
      bytes: source.length,
      sha256,
      authoredResolution: { width: 1254, height: 1254 },
      durationMs: null,
    },
    provenance: {
      actualTool,
      mode: actualTool === 'local-authoring' ? 'local-authoring' : 'generate',
      generatedAt: '2026-07-28T00:00:00Z',
      finalPrompt: `Create an original ${entry.brief.deliverable} candidate for review.`,
      negativeConstraints: [...entry.provenance.negativeConstraints],
      referenceImages: [],
      model: null,
      seed: null,
      outputId: null,
      rightsStatement: entry.provenance.rightsStatement,
      sourceSha256: sha256,
    },
    review: {
      state: 'reviewed',
      reviewer: 'V14 candidate review',
      reviewedAt: '2026-07-28T01:00:00Z',
      notes: 'Candidate inspected but not promoted.',
      defects: ['Requires actual-scale runtime review.'],
    },
  }];
  entry.approval = {
    state: 'candidate-review',
    reviewer: 'V14 candidate review',
    reviewedAt: '2026-07-28T01:00:00Z',
    contactSheetPath,
    notes: 'Review-only candidate; primary remains null.',
  };
  return entry;
}

function wavSource(sampleRate = 48000, channels = 2, bitsPerSample = 16, frameCount = 480): Buffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const dataBytes = frameCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function approveFileEntry(
  manifest: any,
  entryIndex: number,
  root: string,
  options: {
    suffix: string;
    format: string;
    contents: string | Buffer;
    actualTool: 'built-in-image-generation' | 'local-authoring';
    mode: 'generate' | 'strip-edit' | 'layer-compose' | 'local-authoring';
    resolution: { width: number | null; height: number | null };
    durationMs?: number | null;
    technical: Record<string, unknown>;
    companions?: Array<{
      role: string;
      suffix: string;
      format: string;
      contents: string | Buffer;
    }>;
  },
): any {
  const entry = manifest.entries[entryIndex];
  const source = Buffer.isBuffer(options.contents) ? options.contents : Buffer.from(options.contents);
  const sha256 = createHash('sha256').update(source).digest('hex');
  const path = `art-source/v14/masters/${entry.id}-${options.suffix}.${options.format}`;
  const contactSheetPath = `docs/art/v14/review/${entry.id}-contact.png`;
  write(root, path, source);
  write(root, contactSheetPath, Buffer.from('contact sheet evidence'));
  entry.provenance = {
    ...entry.provenance,
    state: 'generated',
    actualTool: options.actualTool,
    mode: options.mode,
    generatedAt: '2026-07-28T00:00:00Z',
    finalPrompt: `Author the production ${entry.brief.deliverable} for ${entry.brief.subject}.`,
    sourceSha256: sha256,
  };
  entry.approval = {
    state: 'approved',
    reviewer: 'V14 art review',
    reviewedAt: '2026-07-28T01:00:00Z',
    contactSheetPath,
    notes: 'Source and actual-scale capture reviewed.',
  };
  entry.primary = {
    path,
    format: options.format,
    bytes: source.length,
    sha256,
    authoredResolution: options.resolution,
    durationMs: options.durationMs ?? null,
  };
  entry.companions = (options.companions ?? []).map((companion) => {
    const contents = Buffer.isBuffer(companion.contents) ? companion.contents : Buffer.from(companion.contents);
    const companionPath = `art-source/v14/masters/${entry.id}-${companion.suffix}.${companion.format}`;
    write(root, companionPath, contents);
    return {
      role: companion.role,
      path: companionPath,
      format: companion.format,
      bytes: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  });
  entry.technical = options.technical;
  entry.usageReferences = [{ kind: 'runtime', target: `runtime:v14:${entry.id}` }];
  return entry;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ProductionMasterManifestV2', () => {
  it('binds 500 planned PF IDs to five exact gates and eight real approved masters', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = readV14Manifest(projectRoot);
    const planned = createV14BriefManifest(ledger);
    const result = validateV14Manifest({
      ledger,
      manifest,
      projectRoot,
      phase: 'briefing',
    });

    expect(manifest.entries.map(({ id }: any) => id)).toEqual(
      Array.from({ length: 500 }, (_, index) => `PF-asset-${String(index + 1).padStart(3, '0')}`),
    );
    expect(manifest.entries.map(({ id }: any) => id)).toEqual(
      planned.entries.map(({ id }: any) => id),
    );
    expect(new Set(manifest.entries.map(({ id }: any) => id)).size).toBe(500);
    expect(result.total).toBe(500);
    expect(result.approved).toBe(8);
    expect(result.primaryHashes).toBe(8);
    expect(result.candidateReviews).toBe(0);
    expect(result.gates).toEqual({ A1: 100, A2: 100, A3: 100, A4: 100, A5: 100 });
    expect(Object.keys(result.kinds).sort()).toEqual([...V14_MASTER_KINDS].sort());
    expect(Object.values(result.kinds).every((count) => count > 0)).toBe(true);

    const approved = manifest.entries.filter(({ approval }: any) => approval.state === 'approved');
    const briefed = manifest.entries.filter(({ approval }: any) => approval.state === 'briefed');
    expect(approved.map(({ id }: any) => id)).toEqual(APPROVED_MASTER_IDS);
    expect(briefed).toHaveLength(492);
    expect(briefed.every((entry: any) => (
      entry.primary === null
      && entry.provenance.state === 'not-generated'
      && entry.provenance.actualTool === null
      && entry.provenance.mode === null
      && entry.provenance.generatedAt === null
      && entry.provenance.finalPrompt === null
      && entry.provenance.sourceSha256 === null
    ))).toBe(true);
    expect(approved.every((entry: any) => (
      entry.primary !== null
      && entry.provenance.state === 'generated'
      && entry.provenance.sourceSha256 === entry.primary.sha256
      && statSync(resolve(projectRoot, entry.primary.path)).size === entry.primary.bytes
    ))).toBe(true);
    expect(manifest.entries.every((entry: any) => (
      entry.provenance.model === null
      && entry.provenance.seed === null
      && entry.provenance.outputId === null
    ))).toBe(true);
  });

  it('routes deterministic UI primitives to local authoring while keeping illustrated UI art on image generation', () => {
    const manifest = freshBriefManifest();
    for (const id of ['PF-asset-061', 'PF-asset-062', 'PF-asset-063', 'PF-asset-064', 'PF-asset-065']) {
      const entry = manifest.entries.find((candidate: any) => candidate.id === id);
      expect(entry.brief.plannedTool).toBe('local-authoring');
      expect(entry.brief.plannedMode).toBe('local-authoring');
    }
    for (const id of ['PF-asset-066', 'PF-asset-067', 'PF-asset-068']) {
      const entry = manifest.entries.find((candidate: any) => candidate.id === id);
      expect(entry.brief.plannedTool).toBe('built-in-image-generation');
      expect(entry.brief.plannedMode).toBe('generate');
    }
  });

  it('records a reviewed candidate without creating or counting an approved primary', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const root = temporaryRoot();
    const entry = attachReviewedCandidate(manifest, 0, root);

    const result = validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    });

    expect(entry.primary).toBeNull();
    expect(entry.provenance.state).toBe('not-generated');
    expect(entry.approval.state).toBe('candidate-review');
    expect(result.approved).toBe(0);
    expect(result.primaryHashes).toBe(0);
    expect(result.candidateReviews).toBe(1);
  });

  it('does not let deterministic UI candidates silently use image generation', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const root = temporaryRoot();
    const entryIndex = manifest.entries.findIndex(({ id }: any) => id === 'PF-asset-061');
    attachReviewedCandidate(manifest, entryIndex, root, 'built-in-image-generation');

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('must use local authoring');
  });

  it('rejects gate drift even when the total remains 500', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    manifest.entries[0].gate = 'A2';
    expect(() => validateV14Manifest({ ledger, manifest, phase: 'briefing' }))
      .toThrow('gate or release does not match');
  });

  it('rejects fighting source and usage paths', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    manifest.entries[0].usageReferences = [{ kind: 'runtime', target: 'src/fighting/arena.ts' }];
    expect(() => validateV14Manifest({ ledger, manifest, phase: 'briefing' }))
      .toThrow('contains fighting content');
  });

  it('does not permit a primary source before explicit approval', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    manifest.entries[0].primary = {
      path: 'art-source/v14/masters/PF-asset-001-source.png',
      format: 'png',
      bytes: 100,
      sha256: 'a'.repeat(64),
      authoredResolution: { width: 64, height: 64 },
      durationMs: null,
    };
    expect(() => validateV14Manifest({ ledger, manifest, phase: 'briefing' }))
      .toThrow('cannot bind a primary master while approval is briefed');
  });

  it('rejects two masters with the same primary source hash', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const semanticIndexes = manifest.entries
      .map((entry: any, index: number) => ({ entry, index }))
      .filter(({ entry }: any) => entry.kind === 'semantic')
      .slice(0, 2)
      .map(({ index }: any) => index);
    const root = temporaryRoot();
    const source = `${JSON.stringify({
      semanticType: 'cinematic-timeline',
      data: { cues: [{ atMs: 0, action: 'open' }, { atMs: 500, action: 'resolve' }] },
    })}\n`;
    approveSemanticEntry(manifest, semanticIndexes[0], root, source);
    approveSemanticEntry(manifest, semanticIndexes[1], root, source);

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('duplicate V14 primary content hash');
  });

  it('rejects generated geometric sheets and other non-production filler', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const entryIndex = manifest.entries.findIndex((entry: any) => entry.kind === 'semantic');
    const root = temporaryRoot();
    const source = `${JSON.stringify({
      semanticType: 'cinematic-timeline',
      data: { description: 'procedural generated geometric sheet' },
    })}\n`;
    approveSemanticEntry(manifest, entryIndex, root, source);

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('forbidden non-production content');
  });

  it('rejects approved output that has no runtime consumer', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const entryIndex = manifest.entries.findIndex((entry: any) => entry.kind === 'semantic');
    const root = temporaryRoot();
    const source = `${JSON.stringify({
      semanticType: 'cinematic-timeline',
      data: { cues: [{ atMs: 0, action: 'open' }] },
    })}\n`;
    approveSemanticEntry(manifest, entryIndex, root, source, false);

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('approved output is unreferenced by the runtime');
  });

  it('rejects an approved source whose claimed contact-sheet evidence does not exist', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const entryIndex = manifest.entries.findIndex((entry: any) => entry.kind === 'semantic');
    const root = temporaryRoot();
    const source = `${JSON.stringify({
      semanticType: 'cinematic-timeline',
      data: { cues: [{ atMs: 0, action: 'open' }] },
    })}\n`;
    approveSemanticEntry(manifest, entryIndex, root, source);
    manifest.entries[entryIndex].approval.contactSheetPath = 'docs/art/v14/review/missing-contact-sheet.png';

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('contact sheet does not exist');
  });

  it('rejects fabricated or missing evidence before accepting an approved gate claim', () => {
    const ledger = readV14Ledger(projectRoot);
    const gateBriefs = readFileSync(join(projectRoot, 'art-source', 'v14', 'gate-briefs.json'));
    const root = temporaryRoot();
    write(root, 'art-source/v14/gate-briefs.json', gateBriefs);
    const evidencePath = 'docs/art/v14/evidence/a1-proof.json';
    const evidence = Buffer.from('{"verified":true}\n');
    write(root, evidencePath, evidence);
    const artifact = {
      path: evidencePath,
      sha256: createHash('sha256').update(evidence).digest('hex'),
    };

    const fabricated = freshBriefManifest();
    fabricated.gates[0].status = 'approved';
    fabricated.gates[0].evidence = {
      requirements: [{ requirement: 'operator says A1 passed', artifacts: [artifact] }],
      verticalSlice: [],
    };
    expect(() => validateV14Manifest({
      ledger,
      manifest: fabricated,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('not declared by the authoritative gate brief');

    const missing = freshBriefManifest();
    missing.gates[0].status = 'approved';
    missing.gates[0].evidence = {
      requirements: [{
        requirement: 'approved source and provenance for all 100 IDs',
        artifacts: [{ path: 'docs/art/v14/evidence/missing.json', sha256: 'a'.repeat(64) }],
      }],
      verticalSlice: [],
    };
    expect(() => validateV14Manifest({
      ledger,
      manifest: missing,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('does not exist');
  });

  it('scans for approved-master orphans during standard project-root verification', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const root = temporaryRoot();
    write(root, 'art-source/v14/masters/PF-asset-999-orphan.png', Buffer.alloc(64, 1));

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('V14 master tree contains unreferenced output');
  });

  it('rejects atlas frame rectangles that exceed the measured primary canvas', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const root = temporaryRoot();
    const entryIndex = manifest.entries.findIndex(({ id }: any) => id === 'PF-asset-003');
    const atlas = readFileSync(join(projectRoot, 'art-source', 'v14', 'canon', 'approved', 'lumi-seed.png'));
    const atlasData = `${JSON.stringify({
      frames: [
        { name: 'idle', rect: { x: 0, y: 0, width: 256, height: 256 }, pivot: { x: 0.5, y: 1 } },
        { name: 'release', rect: { x: 1200, y: 0, width: 128, height: 256 }, pivot: { x: 0.5, y: 1 } },
      ],
    })}\n`;
    approveFileEntry(manifest, entryIndex, root, {
      suffix: 'runtime-atlas',
      format: 'png',
      contents: atlas,
      actualTool: 'built-in-image-generation',
      mode: 'strip-edit',
      resolution: { width: 1254, height: 1254 },
      technical: { frameCount: 2, pivot: { x: 0.5, y: 1 } },
      companions: [{
        role: 'atlas-data',
        suffix: 'runtime-atlas-data',
        format: 'json',
        contents: atlasData,
      }],
    });

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('source rectangle exceeds the atlas');
  });

  it('rejects rig animation tracks that reference unknown bones', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const root = temporaryRoot();
    const entryIndex = manifest.entries.findIndex(({ id }: any) => id === 'PF-asset-004');
    const rig = `${JSON.stringify({
      rig: {
        bones: [
          { id: 'root', parent: null },
          { id: 'left-fin', parent: 'root' },
        ],
        animations: [{
          id: 'idle',
          durationMs: 1000,
          tracks: [{
            bone: 'missing-fin',
            keyframes: [{ timeMs: 0 }, { timeMs: 1000 }],
          }],
        }],
      },
    })}\n`;
    approveFileEntry(manifest, entryIndex, root, {
      suffix: 'skeleton-rig',
      format: 'json',
      contents: rig,
      actualTool: 'local-authoring',
      mode: 'local-authoring',
      resolution: { width: null, height: null },
      technical: { coordinateSpace: 'normalized-character-local' },
    });

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('references unknown bone');
  });

  it('rejects layered sources whose authored layer paths are not bound to companions', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const root = temporaryRoot();
    const entryIndex = manifest.entries.findIndex(({ id }: any) => id === 'PF-asset-021');
    const background = readFileSync(join(projectRoot, 'art-source', 'v14', 'masters', 'PF-asset-021-crystal-realm-hero-background.png'));
    const atmosphere = readFileSync(join(projectRoot, 'art-source', 'v14', 'masters', 'PF-asset-021-crystal-realm-hero-atmosphere.png'));
    const layered = `${JSON.stringify({
      canvas: { width: 941, height: 1672 },
      safeZones: {
        topHud: { x: 0.08, y: 0, width: 0.84, height: 0.14 },
        playfield: { x: 0.09, y: 0.15, width: 0.82, height: 0.58 },
        launcher: { x: 0.12, y: 0.78, width: 0.76, height: 0.18 },
      },
      layers: [
        {
          id: 'environment',
          role: 'environment plate',
          source: 'art-source/v14/masters/PF-asset-021-environment.png',
        },
        {
          id: 'atmosphere',
          role: 'atmosphere overlay',
          source: 'art-source/v14/masters/PF-asset-021-unbound-atmosphere.png',
        },
      ],
    })}\n`;
    approveFileEntry(manifest, entryIndex, root, {
      suffix: 'layered',
      format: 'json',
      contents: layered,
      actualTool: 'built-in-image-generation',
      mode: 'layer-compose',
      resolution: { width: null, height: null },
      technical: {
        safeZones: ['top-hud', 'playfield', 'launcher'],
        sourceCanvas: { width: 941, height: 1672 },
      },
      companions: [
        {
          role: 'environment-plate',
          suffix: 'environment',
          format: 'png',
          contents: background,
        },
        {
          role: 'atmosphere-layer',
          suffix: 'atmosphere',
          format: 'png',
          contents: atmosphere,
        },
      ],
    });

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('must bind exactly to its companion descriptors');
  });

  it('measures WAV metadata instead of trusting declared sample-rate fields', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    const root = temporaryRoot();
    const entryIndex = manifest.entries.findIndex((entry: any) => entry.kind === 'audio');
    approveFileEntry(manifest, entryIndex, root, {
      suffix: 'source',
      format: 'wav',
      contents: wavSource(),
      actualTool: 'local-authoring',
      mode: 'local-authoring',
      resolution: { width: null, height: null },
      durationMs: 10,
      technical: {
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        durationMs: 10,
      },
    });

    expect(() => validateV14Manifest({
      ledger,
      manifest,
      projectRoot: root,
      phase: 'briefing',
    })).toThrow('measured WAV sample rate');
  });

  it('keeps production release closed while any source or gate is unapproved', () => {
    const ledger = readV14Ledger(projectRoot);
    const manifest = freshBriefManifest();
    expect(() => validateV14Manifest({ ledger, manifest, phase: 'release' }))
      .toThrow('production manifest status');
  });

  it('binds every public V14 runtime entry to one of the eight approved source hashes', () => {
    const sourceManifest = readV14Manifest(projectRoot);
    const runtimeManifest = JSON.parse(readFileSync(
      join(projectRoot, 'public/assets/v14/art-manifest.json'),
      'utf8',
    ));
    const approvedById = new Map(
      sourceManifest.entries
        .filter(({ approval }: any) => approval.state === 'approved')
        .map((entry: any) => [entry.id, entry]),
    );
    const runtimeIds = [...new Set(runtimeManifest.entries.map(({ pfId }: any) => pfId))].sort();

    expect(runtimeManifest.entries).toHaveLength(89);
    expect(runtimeManifest.entries.filter(({ stableKey }: any) => (
      stableKey.startsWith('archive.')
    ))).toHaveLength(8);
    expect(runtimeIds).toEqual(APPROVED_MASTER_IDS);
    expect(runtimeManifest.entries.every((entry: any) => {
      const source: any = approvedById.get(entry.pfId);
      return source
        && entry.provenance.approved === true
        && entry.provenance.manifest === 'art-source/v14/manifest.json'
        && entry.provenance.recordId === entry.pfId
        && entry.provenance.sourceSha256 === source.primary.sha256;
    })).toBe(true);
    expect(APPROVED_MASTER_IDS.every((id) => (
      runtimeManifest.entries.some(({ pfId }: any) => pfId === id)
    ))).toBe(true);
  });

  it('publishes a JSON schema with the exact V2 media-kind contract', () => {
    const schema = JSON.parse(readFileSync(
      join(projectRoot, 'docs/art/v14/production-master-manifest-v2.schema.json'),
      'utf8',
    ));
    expect(schema.title).toBe('ProductionMasterManifestV2');
    expect(schema.properties.total.const).toBe(500);
    expect(schema.$defs.entry.properties.kind.enum).toEqual(V14_MASTER_KINDS);
    expect(schema.$defs.gate.properties.evidence.$ref).toBe('#/$defs/gateEvidence');
    expect(schema.$defs.entry.properties.candidateReviews.items.$ref).toBe(
      '#/$defs/candidateReview',
    );
  });
});
