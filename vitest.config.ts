import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'openai-site/**', 'dist/**', 'releases/**'],
    // Backend, encrypted-backup and release-integrity suites perform real
    // SQLite/filesystem work. Cap concurrency on mounted Windows volumes so
    // those integration tests retain deterministic deadlines under a full run.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
