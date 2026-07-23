import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);
const host = process.argv[4] ?? '127.0.0.1';
const releaseId = process.argv[5] ?? 'working';

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.wasm', 'application/wasm'],
  ['.task', 'application/octet-stream'],
  ['.ico', 'image/x-icon'],
]);
const compressible = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm', '.task']);

function sendError(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

createServer(async (request, response) => {
  try {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    sendError(response, 400, 'Bad request');
    return;
  }

  if (pathname === '/3d' || pathname.startsWith('/3d/')) {
    sendError(response, 410, 'Client retired; use /classic/.');
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';
  let file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    sendError(response, 403, 'Forbidden');
    return;
  }
  let fileStat = await stat(file).catch(() => null);
  if (!fileStat?.isFile()) {
    file = resolve(root, 'index.html');
    fileStat = await stat(file).catch(() => null);
  }
  if (!fileStat?.isFile()) {
    sendError(response, 404, 'Not found');
    return;
  }

  const extension = extname(file).toLowerCase();
  const acceptsGzip = String(request.headers['accept-encoding'] ?? '').includes('gzip');
  const useGzip = acceptsGzip && compressible.has(extension) && request.method !== 'HEAD';
  const isHashedBundle = /\/[\w.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(file);
  response.setHeader('Content-Type', mime.get(extension) ?? 'application/octet-stream');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-PaoPao-Release', releaseId);
  response.setHeader('Cache-Control', extension === '.html'
    ? 'no-store'
    : isHashedBundle
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600');

  if (useGzip) {
    response.setHeader('Content-Encoding', 'gzip');
    response.setHeader('Vary', 'Accept-Encoding');
  } else {
    response.setHeader('Content-Length', fileStat.size);
  }
  response.writeHead(200);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  if (useGzip) stream.pipe(createGzip({ level: 6 })).pipe(response);
  else stream.pipe(response);
  } catch {
    if (!response.headersSent) sendError(response, 500, 'Internal server error');
    else response.destroy();
  }
}).listen(port, host, () => {
  console.log(`PaoPao preview serving ${releaseId} from ${root} on http://${host}:${port}`);
});
