import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const manager = join(projectRoot, 'tools', 'release-manager.mjs');
const slugs = [
  'foundation-and-migration',
  'complete-gameplay-coverage',
  'cinematic-presentation',
  'endless-live-operations',
  'production-hardening',
];

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function createClient(root: string, marker: string, gate: number): void {
  const meta = `<meta name="paopao-release-gate" content="${gate}" />`;
  write(join(root, 'index.html'), `${meta}<a href="/classic/">Play</a><a href="/downloads/">Downloads</a><p>${marker}</p>`);
  write(join(root, 'classic', 'index.html'), `<!doctype html>${meta}<title>Phaser ${marker}</title>`);
  write(join(root, 'downloads', 'index.html'), '<!doctype html><title>Downloads</title>');
  write(join(root, 'assets', 'runtime.js'), `globalThis.release=${JSON.stringify(marker)};`);
  write(join(root, 'sw.js'), "const CACHE_VERSION = 'working-build';\n");
  write(join(root, 'manifest.webmanifest'), JSON.stringify({
    name: 'PaoPao Fusion', start_url: './', scope: './', display: 'standalone', icons: [],
  }));
  write(join(root, 'release-profile.json'), JSON.stringify({
    schemaVersion: 1,
    client: 'phaser',
    releaseGate: gate,
    releaseSlug: slugs[gate - 1],
    features: {
      foundation: true,
      completeGameplay: gate >= 2,
      cinematicPresentation: gate >= 3,
      endlessLiveOperations: gate >= 4,
      productionHardening: gate >= 5,
    },
  }));
}

function run(args: string[], releases: string) {
  return spawnSync(process.execPath, [manager, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PAOPAO_RELEASES_DIR: releases },
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readManifest(releases: string, id: string) {
  const path = join(releases, id, 'release-manifest.json');
  const raw = readFileSync(path, 'utf8');
  return { path, raw, value: JSON.parse(raw), sha256: sha256(raw) };
}

function event(core: Record<string, unknown>) {
  return { ...core, eventSha256: sha256(JSON.stringify(core)) };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function writeActivatedState(releases: string): void {
  const one = readManifest(releases, 'r1-foundation');
  const two = readManifest(releases, 'r2-gameplay');
  const atOne = '2026-07-22T10:00:00.000Z';
  const atTwo = '2026-07-22T11:00:00.000Z';
  const first = event({
    sequence: 1,
    action: 'activate',
    from: null,
    to: 'r1-foundation',
    at: atOne,
    contentSha256: one.value.contentSha256,
    manifestSha256: one.sha256,
    previousEventSha256: null,
  });
  const second = event({
    sequence: 2,
    action: 'activate',
    from: 'r1-foundation',
    to: 'r2-gameplay',
    at: atTwo,
    contentSha256: two.value.contentSha256,
    manifestSha256: two.sha256,
    previousEventSha256: first.eventSha256,
  });
  const receipt = 'b'.repeat(64);
  const ledger = 'a'.repeat(64);
  write(join(releases, 'state.json'), `${JSON.stringify({
    schemaVersion: 2,
    revision: 2,
    active: 'r2-gameplay',
    previous: 'r1-foundation',
    activatedAt: atTwo,
    contentSha256: two.value.contentSha256,
    manifestSha256: two.sha256,
    ledgerVerifiedItems: 742,
    activatedReleases: [
      {
        releaseId: 'r1-foundation', releaseNumber: 1,
        contentSha256: one.value.contentSha256, manifestSha256: one.sha256,
        ledgerVerifiedItems: 742, ledgerSha256: ledger, evidenceReceiptSha256: receipt,
        firstActivatedAt: atOne,
      },
      {
        releaseId: 'r2-gameplay', releaseNumber: 2,
        contentSha256: two.value.contentSha256, manifestSha256: two.sha256,
        ledgerVerifiedItems: 742, ledgerSha256: ledger, evidenceReceiptSha256: receipt,
        firstActivatedAt: atTwo,
      },
    ],
    history: [first, second],
  }, null, 2)}\n`);
}

describe('immutable Phaser five-release pipeline', () => {
  it('[AT-PF-upgrade-004][phaser] pins the exact Phaser production engine', () => {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
    const publicManifest = JSON.parse(readFileSync(join(projectRoot, 'public', 'downloads', 'release-manifest.json'), 'utf8'));
    const managerSource = readFileSync(manager, 'utf8');
    const platformSource = readFileSync(join(projectRoot, 'server', 'platform.mjs'), 'utf8');

    expect(packageJson.dependencies.phaser).toBe('3.90.0');
    expect(packageLock.packages[''].dependencies.phaser).toBe('3.90.0');
    expect(packageLock.packages['node_modules/phaser'].version).toBe('3.90.0');
    expect(publicManifest.engine).toBe('phaser-3.90.0');
    expect(managerSource).toContain("engine: 'phaser-3.90.0'");
    expect(managerSource).toContain("manifest.engine !== 'phaser-3.90.0'");
    expect(platformSource).toContain("engine: 'phaser-3.90.0'");
  });

  it('stages a complete schema-v2 Phaser artifact and reports both immutable hashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-v2-'));
    try {
      const source = join(root, 'dist');
      const releases = join(root, 'releases');
      createClient(source, 'foundation', 1);
      const staged = run(['stage', 'r1-foundation', source], releases);
      expect(staged.status, staged.stderr).toBe(0);
      const output = JSON.parse(staged.stdout);
      expect(output).toMatchObject({
        staged: 'r1-foundation',
        releaseNumber: 1,
        activation: 'blocked-until-742-machine-receipted-items',
      });
      expect(output.contentSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(output.manifestSha256).toMatch(/^[a-f0-9]{64}$/);

      const manifest = readManifest(releases, 'r1-foundation').value;
      expect(manifest).toMatchObject({
        schemaVersion: 2,
        releaseId: 'r1-foundation',
        releaseNumber: 1,
        client: 'phaser',
        engine: 'phaser-3.90.0',
        routes: ['/', '/classic/', '/downloads/'],
        cacheNamespace: 'paopao-fusion-release-r1-foundation',
      });
      expect(manifest.files.map(({ path }: { path: string }) => path)).toEqual([
        'assets/runtime.js', 'classic/index.html', 'downloads/index.html', 'index.html',
        'manifest.webmanifest', 'release-profile.json', 'sw.js',
      ]);
      expect(readFileSync(join(releases, 'r1-foundation', 'client', 'sw.js'), 'utf8'))
        .toContain("const CACHE_VERSION = 'release-r1-foundation';");

      const verified = run(['verify', 'r1-foundation'], releases);
      expect(verified.status, verified.stderr).toBe(0);
      expect(JSON.parse(verified.stdout)).toMatchObject({
        ok: true,
        releaseId: 'r1-foundation',
        manifestSchemaVersion: 2,
        contentSha256: output.contentSha256,
        manifestSha256: output.manifestSha256,
      });
      const status = JSON.parse(run(['status'], releases).stdout);
      expect(status.state).toMatchObject({ integrity: 'verified', active: null });
      expect(status.releases[0]).toMatchObject({
        releaseId: 'r1-foundation', integrity: 'verified', activationEligibleManifest: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects changed, added and omitted files instead of accepting a partial manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-tamper-'));
    try {
      const source = join(root, 'dist');
      const releases = join(root, 'releases');
      createClient(source, 'tamper', 3);
      expect(run(['stage', 'r3-presentation', source], releases).status).toBe(0);
      write(join(releases, 'r3-presentation', 'client', 'assets', 'unlisted.js'), 'tampered');
      const verified = run(['verify', 'r3-presentation'], releases);
      expect(verified.status).toBe(1);
      expect(verified.stderr).toContain('complete manifest');
      const all = run(['verify-all'], releases);
      expect(all.status).toBe(1);
      expect(all.stderr).toContain('complete manifest');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a profile whose slug or exact feature contract does not match its gate', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-profile-'));
    try {
      const releases = join(root, 'releases');
      const wrongSlug = join(root, 'wrong-slug');
      createClient(wrongSlug, 'wrong-slug', 1);
      const slugProfilePath = join(wrongSlug, 'release-profile.json');
      const slugProfile = JSON.parse(readFileSync(slugProfilePath, 'utf8'));
      slugProfile.releaseSlug = 'production-hardening';
      write(slugProfilePath, JSON.stringify(slugProfile));
      const slugResult = run(['stage', 'r1-wrong-slug', wrongSlug], releases);
      expect(slugResult.status).toBe(1);
      expect(slugResult.stderr).toContain('release profile does not exactly match gate 1');

      const extraFeature = join(root, 'extra-feature');
      createClient(extraFeature, 'extra-feature', 5);
      const featureProfilePath = join(extraFeature, 'release-profile.json');
      const featureProfile = JSON.parse(readFileSync(featureProfilePath, 'utf8'));
      featureProfile.features.unreleasedClient = true;
      write(featureProfilePath, JSON.stringify(featureProfile));
      const featureResult = run(['stage', 'r5-extra-feature', extraFeature], releases);
      expect(featureResult.status).toBe(1);
      expect(featureResult.stderr).toContain('release profile does not exactly match gate 5');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a retired /3d launcher route even when no retired tree is present', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-retired-route-'));
    try {
      const source = join(root, 'client');
      const releases = join(root, 'releases');
      createClient(source, 'retired-route', 1);
      write(join(source, 'index.html'), readFileSync(join(source, 'index.html'), 'utf8')
        .replace('</p>', '</p><a href="/3d">Retired</a>'));
      const result = run(['stage', 'r1-retired-route', source], releases);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('launcher must expose only the permanent Phaser and downloads routes');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serves any verified staged artifact independently without activating it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-serve-'));
    let child: ReturnType<typeof spawn> | null = null;
    try {
      const source = join(root, 'dist');
      const releases = join(root, 'releases');
      createClient(source, 'independent', 4);
      expect(run(['stage', 'r4-liveops', source], releases).status).toBe(0);
      const port = await freePort();
      child = spawn(process.execPath, [manager, 'serve', 'r4-liveops', String(port), '127.0.0.1'], {
        cwd: projectRoot,
        windowsHide: true,
        env: { ...process.env, PAOPAO_RELEASES_DIR: releases },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let errors = '';
      child.stdout?.on('data', (chunk) => { output += String(chunk); });
      child.stderr?.on('data', (chunk) => { errors += String(chunk); });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`preview start timeout: ${errors}`)), 5_000);
        const inspect = () => {
          if (output.includes('PaoPao preview serving r4-liveops')) {
            clearTimeout(timeout);
            resolve();
          }
        };
        child?.stdout?.on('data', inspect);
        child?.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`preview exited ${code}: ${errors}`));
        });
      });
      const response = await fetch(`http://127.0.0.1:${port}/classic/`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-paopao-release')).toBe('r4-liveops');
      expect(await response.text()).toContain('Phaser independent');
      expect(JSON.parse(run(['status'], releases).stdout).state.active).toBeNull();
    } finally {
      if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 2_000);
          child?.once('exit', () => { clearTimeout(timeout); resolve(); });
        });
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  it('rolls back only to a previously activated lower gate with its exact pinned manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-rollback-'));
    try {
      const releases = join(root, 'releases');
      for (const [id, marker] of [['r1-foundation', 'one'], ['r2-gameplay', 'two']] as const) {
        const source = join(root, marker);
        createClient(source, marker, Number(id[1]));
        expect(run(['stage', id, source], releases).status).toBe(0);
      }
      writeActivatedState(releases);
      const rolledBack = run(['rollback'], releases);
      expect(rolledBack.status, rolledBack.stderr).toBe(0);
      const state = JSON.parse(readFileSync(join(releases, 'state.json'), 'utf8'));
      expect(state).toMatchObject({
        schemaVersion: 2,
        revision: 3,
        active: 'r1-foundation',
        previous: 'r2-gameplay',
        rollbackOf: 'r2-gameplay',
        ledgerVerifiedItems: 742,
      });
      expect(state.history.at(-1)).toMatchObject({
        sequence: 3, action: 'rollback', from: 'r2-gameplay', to: 'r1-foundation',
      });
      expect(state.history.at(-1).eventSha256).toMatch(/^[a-f0-9]{64}$/);

      const notActivated = run(['rollback', 'r1-another'], releases);
      expect(notActivated.status).toBe(1);
      expect(notActivated.stderr).toContain('not a previously activated lower release');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a previously activated manifest is rewritten and leaves state untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-pin-'));
    try {
      const releases = join(root, 'releases');
      for (const [id, marker] of [['r1-foundation', 'one'], ['r2-gameplay', 'two']] as const) {
        const source = join(root, marker);
        createClient(source, marker, Number(id[1]));
        expect(run(['stage', id, source], releases).status).toBe(0);
      }
      writeActivatedState(releases);
      const before = readFileSync(join(releases, 'state.json'), 'utf8');
      const first = readManifest(releases, 'r1-foundation');
      first.value.createdAt = '2030-01-01T00:00:00.000Z';
      write(first.path, `${JSON.stringify(first.value, null, 2)}\n`);

      const rollback = run(['rollback'], releases);
      expect(rollback.status).toBe(1);
      expect(rollback.stderr).toContain('no longer matches its immutable activation pin');
      expect(readFileSync(join(releases, 'state.json'), 'utf8')).toBe(before);

      const state = JSON.parse(run(['status'], releases).stdout).state;
      expect(state).toMatchObject({ integrity: 'verified', active: 'r2-gameplay' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an active pin failure read-only without rewriting activation state', () => {
    const root = mkdtempSync(join(tmpdir(), 'paopao-release-status-'));
    try {
      const releases = join(root, 'releases');
      for (const [id, marker] of [['r1-foundation', 'one'], ['r2-gameplay', 'two']] as const) {
        const source = join(root, marker);
        createClient(source, marker, Number(id[1]));
        expect(run(['stage', id, source], releases).status).toBe(0);
      }
      writeActivatedState(releases);
      expect(run(['rollback'], releases).status).toBe(0);
      const statePath = join(releases, 'state.json');
      const before = readFileSync(statePath, 'utf8');
      const first = readManifest(releases, 'r1-foundation');
      first.value.createdAt = '2030-01-01T00:00:00.000Z';
      write(first.path, `${JSON.stringify(first.value, null, 2)}\n`);

      const result = run(['status'], releases);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).state).toMatchObject({
        integrity: 'failed', active: 'r1-foundation',
      });
      expect(JSON.parse(result.stdout).state.error).toContain('immutable activation pin');
      expect(readFileSync(statePath, 'utf8')).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
