import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { isSafeRelativePath, resolveEvidenceFile, sha256File } from './ledger-evidence-lib.mjs';

export const PRODUCTION_MASTER_MANIFEST = 'art-source/production-masters/manifest.json';
export const PRODUCTION_MASTER_TEST = 'tests/production-master-evidence.test.ts';

const allowedFormats = new Set(['svg', 'png', 'webp', 'avif', 'wav', 'mp3', 'ogg', 'mp4', 'webm', 'json', 'glb']);
const assetIdPattern = /^PF-asset-(\d{3})$/;
const shaPattern = /^[a-f0-9]{64}$/;

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) throw new Error(`${label} has unexpected or missing fields`);
}

function u32le(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function inspectMaster(format, buffer, path) {
  if (buffer.length < 32) throw new Error(`${path} is too small to be a production master`);
  const text = ['svg', 'json'].includes(format) ? buffer.toString('utf8') : '';
  if (/\b(?:placeholder|lorem ipsum|todo|implement later|sample asset)\b/i.test(text)) throw new Error(`${path} contains placeholder language`);
  if (format === 'svg') {
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text) || !/<\/svg>\s*$/i.test(text)) throw new Error(`${path} is not a complete SVG document`);
    const opening = /<svg\b([^>]*)>/i.exec(text)?.[1] ?? '';
    const dimension = (name) => Number(new RegExp(`\\b${name}\\s*=\\s*["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`, 'i').exec(opening)?.[1]);
    const width = dimension('width');
    const height = dimension('height');
    const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(opening)?.[1]
      ?.trim().split(/[\s,]+/).map(Number);
    if (!(width > 0) || !(height > 0) || viewBox?.length !== 4 || !viewBox.every(Number.isFinite) || !(viewBox[2] > 0) || !(viewBox[3] > 0)) {
      throw new Error(`${path} has no measurable SVG width, height and viewBox canvas`);
    }
    if (!/<metadata\b[^>]*>[\s\S]*?\S[\s\S]*?<\/metadata>/i.test(text)
      || !/<title\b[^>]*>\s*[^<\s][\s\S]*?<\/title>/i.test(text)
      || !/<desc\b[^>]*>\s*[^<\s][\s\S]*?<\/desc>/i.test(text)) {
      throw new Error(`${path} is missing non-empty metadata, title or description provenance`);
    }
    const authoredPrimitives = text.match(/<(?:path|rect|circle|ellipse|polygon|polyline|line|text|image|use)\b/gi) ?? [];
    if (authoredPrimitives.length < 3) throw new Error(`${path} needs at least three authored drawing primitives`);
    return { format, bytes: buffer.length, validation: ['non-placeholder-content', 'svg-authored-drawing', 'svg-document', 'svg-measurable-canvas'] };
  }
  if (format === 'json') {
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error(`${path} is not valid JSON`); }
    if (parsed === null || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) throw new Error(`${path} is an empty JSON master`);
    return { format, bytes: buffer.length, validation: ['json-parse', 'json-nonempty', 'non-placeholder-content'] };
  }
  if (format === 'png') {
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${path} has an invalid PNG signature`);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width < 16 || height < 16 || !buffer.includes(Buffer.from('IDAT')) || !buffer.includes(Buffer.from('IEND'))) throw new Error(`${path} is not a complete production PNG`);
    return { format, bytes: buffer.length, width, height, validation: ['png-ihdr-dimensions', 'png-image-data', 'png-signature'] };
  }
  if (format === 'webp') {
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`${path} has an invalid WebP signature`);
    return { format, bytes: buffer.length, validation: ['webp-riff-signature'] };
  }
  if (format === 'avif') {
    const brand = buffer.toString('ascii', 4, 32);
    if (!brand.includes('ftyp') || !/(?:avif|avis)/.test(brand)) throw new Error(`${path} has an invalid AVIF signature`);
    return { format, bytes: buffer.length, validation: ['avif-ftyp-brand'] };
  }
  if (format === 'wav') {
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || !buffer.includes(Buffer.from('fmt ')) || !buffer.includes(Buffer.from('data'))) {
      throw new Error(`${path} is not a complete WAVE master`);
    }
    return { format, bytes: buffer.length, validation: ['wav-data-chunk', 'wav-format-chunk', 'wav-riff-signature'] };
  }
  if (format === 'mp3') {
    const id3 = buffer.toString('ascii', 0, 3) === 'ID3';
    const frame = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
    if (!id3 && !frame) throw new Error(`${path} has an invalid MP3 signature`);
    return { format, bytes: buffer.length, validation: ['mp3-stream-signature'] };
  }
  if (format === 'ogg') {
    if (buffer.toString('ascii', 0, 4) !== 'OggS') throw new Error(`${path} has an invalid Ogg signature`);
    return { format, bytes: buffer.length, validation: ['ogg-stream-signature'] };
  }
  if (format === 'mp4') {
    const header = buffer.toString('ascii', 0, Math.min(buffer.length, 64));
    if (!header.includes('ftyp') || !buffer.includes(Buffer.from('mdat'))) throw new Error(`${path} is not a complete MP4 master`);
    return { format, bytes: buffer.length, validation: ['mp4-ftyp-box', 'mp4-media-data'] };
  }
  if (format === 'webm') {
    if (!buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) || !buffer.includes(Buffer.from('webm'))) throw new Error(`${path} has an invalid WebM signature`);
    return { format, bytes: buffer.length, validation: ['webm-ebml-signature', 'webm-doc-type'] };
  }
  if (format === 'glb') {
    if (buffer.toString('ascii', 0, 4) !== 'glTF' || u32le(buffer, 4) !== 2 || u32le(buffer, 8) !== buffer.length) throw new Error(`${path} is not a valid GLB 2 master`);
    return { format, bytes: buffer.length, validation: ['glb-declared-length', 'glb-v2-header'] };
  }
  throw new Error(`${path} uses unsupported production-master format ${format}`);
}

function listedMasterFiles(root, current = root) {
  const result = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`production masters cannot contain symbolic links: ${path}`);
    if (entry.isDirectory()) result.push(...listedMasterFiles(root, path));
    else if (entry.isFile() && /^PF-asset-\d{3}-/.test(entry.name)) result.push(relative(root, path).split(sep).join('/'));
  }
  return result.sort();
}

export function productionMasterTestFullName(id) {
  return `production master evidence [AT-${id}][shared] validates unique authored source bytes and declared media structure`;
}

export function validateProductionMasterManifest({ ledger, projectRoot, manifestPath = PRODUCTION_MASTER_MANIFEST, requireComplete = true }) {
  if (!isSafeRelativePath(manifestPath)) throw new Error('production master manifest path is unsafe');
  const absoluteManifest = resolveEvidenceFile(projectRoot, manifestPath);
  const mastersRoot = resolve(projectRoot, 'art-source', 'production-masters');
  if (!inside(realpathSync(projectRoot), realpathSync(mastersRoot))) throw new Error('production masters root escaped the project');
  let manifest;
  try { manifest = JSON.parse(readFileSync(absoluteManifest, 'utf8')); } catch { throw new Error('production master manifest is not valid JSON'); }
  exactKeys(manifest, ['schemaVersion', 'total', 'entries'], 'production master manifest');
  if (manifest.schemaVersion !== 1 || !Number.isInteger(manifest.total) || !Array.isArray(manifest.entries) || manifest.total !== manifest.entries.length) {
    throw new Error('production master manifest count contract is invalid');
  }
  if (requireComplete && manifest.total !== 500) throw new Error(`production master manifest has ${manifest.total}/500 entries`);

  const assetItems = ledger.items.filter(({ category }) => category === 'asset');
  const itemById = new Map(assetItems.map((item) => [item.id, item]));
  const ids = new Set();
  const paths = new Set();
  const hashes = new Set();
  const entryById = new Map();
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `production master entry ${index + 1}`;
    exactKeys(entry, ['id', 'allocation', 'release', 'path', 'format', 'bytes', 'sha256', 'validation'], label);
    const match = assetIdPattern.exec(entry.id);
    const item = itemById.get(entry.id);
    if (!match || !item) throw new Error(`${label} references unknown asset ledger ID ${String(entry.id)}`);
    if (entry.allocation !== item.assetAllocation || entry.release !== item.release) throw new Error(`${entry.id} allocation or release does not match the ledger`);
    if (!isSafeRelativePath(entry.path) || !entry.path.startsWith('art-source/production-masters/')) throw new Error(`${entry.id} path is outside production masters`);
    const filename = entry.path.split('/').at(-1);
    if (!filename.startsWith(`${entry.id}-`)) throw new Error(`${entry.id} filename must begin ${entry.id}-`);
    const format = extname(entry.path).slice(1).toLowerCase();
    if (!allowedFormats.has(entry.format) || entry.format !== format) throw new Error(`${entry.id} format does not match its supported extension`);
    const absolute = resolveEvidenceFile(projectRoot, entry.path);
    if (!inside(realpathSync(mastersRoot), realpathSync(absolute))) throw new Error(`${entry.id} resolves outside production masters`);
    if (!Number.isInteger(entry.bytes) || entry.bytes !== statSync(absolute).size) throw new Error(`${entry.id} byte count does not match its source file`);
    if (!shaPattern.test(entry.sha256) || entry.sha256 !== sha256File(absolute)) throw new Error(`${entry.id} SHA-256 does not match its source file`);
    if (ids.has(entry.id)) throw new Error(`duplicate production master ID ${entry.id}`);
    if (paths.has(entry.path)) throw new Error(`duplicate production master path ${entry.path}`);
    if (hashes.has(entry.sha256)) throw new Error(`duplicate production master content hash ${entry.sha256}`);
    const inspection = inspectMaster(entry.format, readFileSync(absolute), entry.path);
    if (!Array.isArray(entry.validation) || entry.validation.some((check) => typeof check !== 'string') || new Set(entry.validation).size !== entry.validation.length) {
      throw new Error(`${entry.id} validation must be a unique string array`);
    }
    const requiredValidation = ['exact-byte-count', 'sha256-match', 'unique-content-sha256', ...inspection.validation].sort();
    if ([...entry.validation].sort().join('\0') !== requiredValidation.join('\0')) {
      throw new Error(`${entry.id} validation checks do not match the ${entry.format} validator`);
    }
    ids.add(entry.id);
    paths.add(entry.path);
    hashes.add(entry.sha256);
    entryById.set(entry.id, entry);
  }
  if (requireComplete) {
    if (ids.size !== assetItems.length || assetItems.some(({ id }) => !ids.has(id))) throw new Error('production master manifest does not cover all 500 asset ledger IDs');
    const diskFiles = listedMasterFiles(mastersRoot).map((path) => `art-source/production-masters/${path}`);
    if (diskFiles.length !== paths.size || diskFiles.some((path) => !paths.has(path))) throw new Error('production master tree contains an unlisted or missing PF-asset source file');
  }
  return {
    total: manifest.entries.length,
    manifest,
    manifestSha256: createHash('sha256').update(readFileSync(absoluteManifest)).digest('hex'),
    entryById,
  };
}
