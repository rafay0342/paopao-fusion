import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createSigningKeyring } from '../server/signing-keyring.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const script = (name: string): string => join(projectRoot, 'tools', name);
const run = (name: string, args: string[], env: Record<string, string> = {}) => spawnSync(
  process.execPath,
  [script(name), ...args],
  {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    windowsHide: true,
  },
);
function write(path: string, contents: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function phaserReleaseClient(root: string, gate: number): void {
  const slugs = [
    'foundation-and-migration',
    'complete-gameplay-coverage',
    'cinematic-presentation',
    'endless-live-operations',
    'production-hardening',
  ];
  const meta = `<meta name="paopao-release-gate" content="${gate}" />`;
  write(join(root, 'index.html'), `${meta}<a href="/classic/">Play Phaser</a><a href="/downloads/">Downloads</a>`);
  write(join(root, 'classic', 'index.html'), `<!doctype html>${meta}<title>PaoPao Phaser</title>`);
  write(join(root, 'downloads', 'index.html'), '<!doctype html><title>Downloads</title>');
  write(join(root, 'sw.js'), "const CACHE_VERSION = 'test-build';\n");
  write(join(root, 'manifest.webmanifest'), JSON.stringify({
    name: 'PaoPao Fusion', start_url: './', scope: './', display: 'standalone', icons: [],
  }));
  write(join(root, 'release-profile.json'), JSON.stringify({
    schemaVersion: 1, client: 'phaser', releaseGate: gate, releaseSlug: slugs[gate - 1],
    features: {
      foundation: true,
      completeGameplay: gate >= 2,
      cinematicPresentation: gate >= 3,
      endlessLiveOperations: gate >= 4,
      productionHardening: gate >= 5,
    },
  }));
}

describe('Phaser-only operational hardening', () => {
  it('keeps retired client sources, build scripts and native artifacts outside the product tree', () => {
    const packageJson = readFileSync(join(projectRoot, 'package.json'), 'utf8');
    const downloads = readFileSync(join(projectRoot, 'server', 'downloads.mjs'), 'utf8');
    expect(existsSync(join(projectRoot, 'unity'))).toBe(false);
    expect(existsSync(join(projectRoot, 'public', '3d'))).toBe(false);
    expect(existsSync(script('build-unity.mjs'))).toBe(false);
    expect(existsSync(script('sync-unity-webgl.mjs'))).toBe(false);
    expect(packageJson).not.toMatch(/build:unity|publish:unity|build:dual/i);
    expect(downloads).not.toMatch(/PaoPaoFusion3D|\.apk/i);
  });

  it('fails the retired /3d route closed instead of returning the Phaser SPA shell', () => {
    const server = readFileSync(join(projectRoot, 'server', 'index.mjs'), 'utf8');
    const preview = readFileSync(script('serve-dist.mjs'), 'utf8');
    expect(server).toContain("app.get('/3d'");
    expect(server).toContain("app.get('/3d/*'");
    expect(server).toContain("reply.code(410)");
    expect(preview).toContain("pathname === '/3d'");
    expect(preview).toContain("sendError(response, 410");
  });

  it('refuses release activation without the exact predecessor and 742 verified ledger records', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-gate-'));
    try {
      const client = join(root, 'client-r1');
      const clientTwo = join(root, 'client-r2');
      const clientWith3d = join(root, 'client-with-3d');
      const releases = join(root, 'releases');
      const ledgerPath = join(root, 'upgrade-ledger.json');
      phaserReleaseClient(client, 1);
      phaserReleaseClient(clientTwo, 2);
      phaserReleaseClient(clientWith3d, 1);
      write(join(clientWith3d, '3d', 'index.html'), '<!doctype html><title>Excluded tree</title>');
      const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs', 'production', 'upgrade-ledger.json'), 'utf8'));
      const foundationGate = ledger.releases.find((entry: { release?: number }) => entry.release === 1);
      if (!foundationGate) throw new Error('fixture ledger has no foundation gate');
      foundationGate.state = 'planned';
      write(ledgerPath, `${JSON.stringify(ledger)}\n`);
      const env = { PAOPAO_RELEASES_DIR: releases, PAOPAO_UPGRADE_LEDGER: ledgerPath };
      const excluded = run('release-manager.mjs', ['stage', 'r1-excluded3d', clientWith3d], env);
      expect(excluded.status).toBe(1);
      expect(excluded.stderr).toContain('contains an excluded /3d tree');
      const stageOne = run('release-manager.mjs', ['stage', 'r1-foundation', client], env);
      expect(stageOne.status, stageOne.stderr).toBe(0);
      const stageTwo = run('release-manager.mjs', ['stage', 'r2-gameplay', clientTwo], env);
      expect(stageTwo.status, stageTwo.stderr).toBe(0);

      const skipped = run('release-manager.mjs', ['activate', 'r2-gameplay'], env);
      expect(skipped.status).toBe(1);
      expect(skipped.stderr).toContain('requires an active release 1 predecessor');
      const unverified = run('release-manager.mjs', ['activate', 'r1-foundation'], env);
      expect(unverified.status).toBe(1);
      expect(unverified.stderr).toContain('gate must be closed with exactly 742 assigned records');
      expect(existsSync(join(releases, 'state.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('[AT-PF-security-010][shared] runs an encrypted create verify and isolated SQLite restore drill', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-backup-drill-test-'));
    try {
      const data = join(root, 'data');
      const releases = join(root, 'releases');
      const backups = join(root, 'backups');
      mkdirSync(data, { recursive: true });
      const database = new Database(join(data, 'paopao.sqlite'));
      database.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO evidence(value) VALUES (\'restore-me\')');
      database.close();
      write(join(data, '.session-secret'), 'test-session-secret-with-adequate-length');
      createSigningKeyring({
        path: join(data, '.content-signing-keyring.json'),
        seedSecret: 'test-content-signing-key-for-restore-drill',
      });
      write(join(releases, 'state.json'), JSON.stringify({ active: 'r1-foundation', contentSha256: 'a'.repeat(64) }));
      write(join(releases, 'r1-foundation', 'release-manifest.json'), JSON.stringify({ releaseId: 'r1-foundation', contentSha256: 'a'.repeat(64) }));
      const output = join(backups, 'drill.pbackup');
      const result = run('backup.mjs', ['drill', output], {
        PAOPAO_DATA_DIR: data,
        PAOPAO_RELEASES_DIR: releases,
        PAOPAO_BACKUP_DIR: backups,
        PAOPAO_BACKUP_PASSPHRASE: 'test-only-restore-drill-passphrase',
        PAOPAO_BACKUP_KEY_ID: 'test-key',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('isolated-create-verify-restore');
      expect(result.stdout).toContain('"releaseStateRestored": false');
      expect(result.stdout).toContain('"signingKeyringVerified": true');
      expect(existsSync(output)).toBe(true);
      expect(readFileSync(join(releases, 'state.json'), 'utf8')).toContain('r1-foundation');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('publishes SHA-256 for each downloadable artifact and matches it in the downloads gate', () => {
    const downloads = readFileSync(join(projectRoot, 'server', 'downloads.mjs'), 'utf8');
    const page = readFileSync(join(projectRoot, 'public', 'downloads', 'index.html'), 'utf8');
    expect(downloads).toContain("const hash = createHash('sha256')");
    expect(downloads).toContain('sha256: await digestFile(path)');
    expect(page).toContain("/^[a-f0-9]{64}$/.test(item.sha256)");
    expect(page).toContain('hash.textContent=`SHA-256 ${item.sha256}`');
  });

  it('publishes only the current illustrated double-tap hand guide', () => {
    const downloads = readFileSync(join(projectRoot, 'server', 'downloads.mjs'), 'utf8');
    const setup = readFileSync(join(projectRoot, 'src', 'scenes', 'HandSetupScene.ts'), 'utf8');
    const guidePath = join(projectRoot, 'outputs', 'handtracking-tutorial', 'paopao-handtracking-double-tap-guide-v3.mp4');
    const guide = readFileSync(guidePath);
    expect(guide.length).toBeGreaterThan(1_000_000);
    expect(guide.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(downloads).toContain('paopao-handtracking-double-tap-guide-v3.mp4');
    expect(downloads).not.toContain('paopao-handtracking-complete-guide-v2.mp4');
    expect(downloads).not.toContain('paopao-handtracking-controls-short.mp4');
    expect(setup).toContain("window.location.assign('/dl/paopao-handtracking-double-tap-guide-v3.mp4')");
  });
});
