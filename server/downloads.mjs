import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PAOPAO_DOWNLOAD_PORT ?? 3005);
const host = process.env.PAOPAO_DOWNLOAD_HOST ?? '127.0.0.1';
const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const externalNames = [
  'paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz',
  'paopao-fusion-level100-phaser-complete-backup-2026-07-22.tar.gz.sha256',
];
// A restored project normally has its source archive directly beside the
// paopao-phaser directory, while this workstation keeps public artifacts two
// levels above it. An explicit directory always has priority.
const externalRoots = [
  ...(process.env.PAOPAO_DOWNLOADS_DIR ? [resolve(process.env.PAOPAO_DOWNLOADS_DIR)] : []),
  resolve(projectRoot, '..', '..'),
  resolve(projectRoot, '..'),
  projectRoot,
];
const candidates = [
  ...externalRoots.flatMap((root) => externalNames.map((name) => resolve(root, name))),
  resolve(projectRoot, 'public', 'downloads', 'paopao-fusion-the-shattered-crown-client-pitch.pptx'),
  resolve(projectRoot, 'public', 'downloads', 'paopao-fusion-story-bible.md'),
  resolve(projectRoot, 'outputs', 'handtracking-tutorial', 'paopao-handtracking-double-tap-guide-v3.mp4'),
  resolve(projectRoot, 'outputs', 'paopao-fusion-the-shattered-crown-client-pitch.pptx'),
];
const files = new Map();
for (const path of candidates) {
  const name = basename(path);
  if (existsSync(path) && !files.has(name)) files.set(name, path);
}
const mime = { '.gz': 'application/gzip', '.sha256': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.md': 'text/markdown; charset=utf-8' };

async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Artifacts are immutable for the lifetime of this process. Hash once before the
// listener becomes reachable so /dl/manifest.json can never advertise an unhashed
// or partially-read candidate.
const artifactsPromise = Promise.all([...files.entries()].map(async ([name, path]) => ({
  name,
  bytes: statSync(path).size,
  sha256: await digestFile(path),
  url: `/dl/${encodeURIComponent(name)}`,
})));

function listing() {
  const links = [...files.entries()].map(([name, path]) => `<li><a href="${encodeURIComponent(name)}">${name}</a> <small>${(statSync(path).size / 1048576).toFixed(1)} MB</small></li>`).join('');
  return `<!doctype html><meta name="viewport" content="width=device-width"><title>PaoPao Downloads</title><style>body{font:16px system-ui;background:#030611;color:#f2e8d4;max-width:850px;margin:48px auto;padding:24px}a{color:#65dbe8}li{margin:18px 0}small{color:#8794a8}</style><h1>PaoPao Fusion Downloads</h1><p>Explicit release artifacts only. The live game bundle is served separately.</p><ul>${links}</ul>`;
}

async function artifactManifest() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    artifacts: await artifactsPromise,
  };
}

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }); response.end('Method not allowed'); return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^\/dl\/?/, '/');
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Bad request'); return;
  }
  if (pathname === '/manifest.json') {
    try {
      const body = `${JSON.stringify(await artifactManifest())}\n`;
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body); return;
    } catch {
      const body = 'Artifact integrity calculation failed';
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body); return;
    }
  }
  if (pathname === '/' || pathname === '') {
    const body = listing(); response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }); response.end(request.method === 'HEAD' ? undefined : body); return;
  }
  const name = basename(pathname); const path = files.get(name);
  if (!path || pathname.includes('..')) { response.writeHead(404, { 'content-type': 'text/plain' }); response.end('Not found'); return; }
  const stat = statSync(path); const range = request.headers.range;
  response.setHeader('accept-ranges', 'bytes'); response.setHeader('content-type', mime[extname(path)] ?? 'application/octet-stream');
  response.setHeader('content-disposition', `attachment; filename="${name}"`);
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) { response.writeHead(416, { 'content-range': `bytes */${stat.size}` }); response.end(); return; }
    const start = Number(match[1]); const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
      response.writeHead(416, { 'content-range': `bytes */${stat.size}` }); response.end(); return;
    }
    if (request.method === 'HEAD') { response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 }); response.end(); return; }
    response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 }); createReadStream(path, { start, end }).pipe(response); return;
  }
  response.writeHead(200, { 'content-length': stat.size, 'cache-control': 'private,max-age=300' });
  if (request.method === 'HEAD') response.end(); else createReadStream(path).pipe(response);
}).listen(port, host, () => console.log(`PaoPao downloads listening on http://${host}:${port}`));
