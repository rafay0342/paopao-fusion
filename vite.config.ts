import { defineConfig } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePhaserReleaseGate, phaserReleaseProfile } from './tools/release-profile-lib.mjs';

const releaseGate = parsePhaserReleaseGate(
  process.env.PAOPAO_RELEASE_GATE ?? 5,
  'PAOPAO_RELEASE_GATE',
) as 1 | 2 | 3 | 4 | 5;
const outputDirectory = resolve(process.env.PAOPAO_OUT_DIR ?? 'dist');
const releaseProfile = phaserReleaseProfile(releaseGate);
const releaseFeatures = releaseProfile.features;

function injectReleaseMeta(html: string): string {
  return html.replace('<head>', `<head>\n    <meta name="paopao-release-gate" content="${releaseGate}" />`);
}

function copyRuntimePublic() {
  return {
    name: 'copy-phaser-runtime-public-without-download-archives',
    writeBundle() {
      const source = resolve('public'); const destination = outputDirectory;
      mkdirSync(destination, { recursive: true });
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        // Never allow a stale retired-client tree or the source-only launcher
        // folder to leak into the Phaser runtime bundle.
        if (entry.name === '3d' || entry.name === 'choose') continue;
        if (entry.name === 'downloads') {
          const downloadsTarget = resolve(destination, entry.name);
          for (const fileName of ['index.html', 'release-manifest.json']) {
            const sourceFile = resolve(source, entry.name, fileName);
            if (existsSync(sourceFile)) {
              mkdirSync(downloadsTarget, { recursive: true });
              cpSync(sourceFile, resolve(downloadsTarget, fileName));
            }
          }
          continue;
        }
        const target = resolve(destination, entry.name);
        // Merge public/assets into Vite's existing hashed dist/assets folder;
        // replacing the folder would erase the freshly generated JS chunks.
        cpSync(resolve(source, entry.name), target, { recursive: true });
      }
      const classicDirectory = resolve(destination, 'classic');
      mkdirSync(classicDirectory, { recursive: true });
      const builtHtml = injectReleaseMeta(readFileSync(resolve(destination, 'index.html'), 'utf8'));
      writeFileSync(resolve(classicDirectory, 'index.html'), builtHtml.replace('<head>', '<head>\n    <base href="/">'));

      // Preserve the independently runnable Phaser game at /classic before
      // publishing the single-client capability launcher at the root.
      const launcherHtml = injectReleaseMeta(readFileSync(resolve(source, 'choose', 'index.html'), 'utf8'));
      writeFileSync(resolve(destination, 'index.html'), launcherHtml);
      writeFileSync(resolve(destination, 'release-profile.json'), `${JSON.stringify(releaseProfile, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  define: {
    __PAOPAO_RELEASE_GATE__: JSON.stringify(releaseGate),
    __PAOPAO_RELEASE_FEATURES__: JSON.stringify(releaseFeatures),
  },
  plugins: [copyRuntimePublic()],
  build: {
    target: 'es2020',
    outDir: outputDirectory,
    // Download archives and sales collateral are served by the dedicated /dl
    // Tailscale route, never copied into the latency-sensitive game build.
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        fight: resolve('fight/index.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          if (id.includes('@mediapipe')) return 'mediapipe';
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    allowedHosts: ['rafays-macbook-pro-1.tail372a9e.ts.net'],
  },
});
