import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string): string => readFileSync(
  fileURLToPath(new URL(`../${path}`, import.meta.url)),
  'utf8',
);

describe('Phaser-only production delivery', () => {
  it('keeps the Phaser build at /classic and publishes the smart launcher at root', () => {
    const vite = readProjectFile('vite.config.ts');
    expect(vite).toContain("resolve(classicDirectory, 'index.html')");
    expect(vite).toContain("builtHtml.replace('<head>', '<head>\\n    <base href=\"/\">')");
    expect(vite).toContain("resolve(source, 'choose', 'index.html')");
    expect(vite.indexOf("resolve(classicDirectory, 'index.html')"))
      .toBeLessThan(vite.indexOf("resolve(destination, 'index.html'), launcherHtml"));
  });

  it('copies only the downloads UI manifest into the latency-sensitive client bundle', () => {
    const vite = readProjectFile('vite.config.ts');
    expect(vite).toContain("['index.html', 'release-manifest.json']");
    expect(vite).not.toContain("cpSync(resolve(source, 'downloads')");
  });

  it('fails the retired /3d route closed in production and preview servers', () => {
    const server = readProjectFile('server/index.mjs');
    const preview = readProjectFile('tools/serve-dist.mjs');
    expect(server).toContain("app.get('/3d'");
    expect(server).toContain("app.get('/3d/*'");
    expect(server).toContain("reply.code(410).send({ error: 'client-retired', supportedClient: '/classic/' })");
    expect(preview).toContain("pathname === '/3d' || pathname.startsWith('/3d/')");
    expect(preview).toContain('sendError(response, 410');
  });

  it('caches the root launcher and Phaser /classic shell independently', () => {
    const worker = readProjectFile('public/sw.js');
    expect(worker).toContain('const LAUNCHER_URL = SCOPE_URL.href');
    expect(worker).toContain("const INDEX_URL = new URL('classic/', SCOPE_URL).href");
    expect(worker).toContain('await cache.put(launcherRequest, launcherResponse)');
    expect(worker).toContain('await cache.put(indexRequest, indexResponse)');
    expect(worker).toContain("url.pathname.startsWith(`${SCOPE_PATH}classic`)");
  });

  it('supports immutable Phaser releases, verified activation and one-command rollback', () => {
    const manager = readProjectFile('tools/release-manager.mjs');
    const server = readProjectFile('server/index.mjs');
    expect(manager).toContain('immutable releases are never overwritten');
    expect(manager).toContain('function verify(');
    expect(manager).toContain('function activate()');
    expect(manager).toContain('function rollback()');
    expect(manager).toContain('contentSha256');
    expect(manager).toContain('production releases are Phaser-only');
    expect(manager).toContain('verified.length !== 742');
    expect(manager).toContain('requires an active release');
    expect(server).toContain("resolve(releasesDirectory, state.active, 'client')");
    expect(server).toContain("reply.header('X-PaoPao-Release', selectedRelease.release)");
  });

  it('backs up SQLite online with authenticated encryption and makes restore explicit and recoverable', () => {
    const backup = readProjectFile('tools/backup.mjs');
    expect(backup).toContain("createCipheriv('aes-256-gcm'");
    expect(backup).toContain('await database.backup(snapshot)');
    expect(backup).toContain('PAOPAO_BACKUP_PASSPHRASE');
    expect(backup).toContain("process.env.PAOPAO_RESTORE_OFFLINE !== '1'");
    expect(backup).toContain('--confirm-paopao-restore');
    expect(backup).toContain('.pre-restore-${timestamp}');
    expect(backup).toContain("packedFile(serverSecret, 'data/.session-secret')");
    expect(backup).toContain("packedFile(signingKeyring, 'data/.content-signing-keyring.json')");
    expect(backup).toContain("appendFileSync(path, `${JSON.stringify(entry)}\\n`");
    expect(backup).toContain("releaseStatePolicy: 'reference-only'");
    expect(backup).toContain("drill: 'isolated-create-verify-restore'");
    expect(backup).toContain('releaseStateRestored: false');
  });

  it('uses a durable random installation secret when production injection is absent', () => {
    const server = readProjectFile('server/index.mjs');
    expect(server).toContain("resolve(dataDir, '.session-secret')");
    expect(server).toContain("randomBytes(48).toString('base64url')");
    expect(server).toContain("{ flag: 'wx', mode: 0o600 }");
    expect(server).not.toContain('paopao-local-${dataDir}');
  });
});
