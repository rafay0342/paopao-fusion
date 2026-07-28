#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createV14BriefManifest,
  manifestDigest,
  readV14Ledger,
  readV14Manifest,
  V14_MANIFEST_PATH,
  validateV14Manifest,
} from './v14-art-manifest-lib.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const [command = 'validate', ...args] = process.argv.slice(2);

function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function usage() {
  console.error('Usage:');
  console.error('  node tools/v14-art-pipeline.mjs plan');
  console.error('  node tools/v14-art-pipeline.mjs validate [--phase briefing|gate|release] [--gate A1|A2|A3|A4|A5]');
  console.error('  node tools/v14-art-pipeline.mjs inspect --id PF-asset-001');
}

if (command === 'plan') {
  const manifest = createV14BriefManifest(readV14Ledger(projectRoot));
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} else if (command === 'validate') {
  const phase = option('--phase', 'briefing');
  const gate = option('--gate');
  const ledger = readV14Ledger(projectRoot);
  const manifest = readV14Manifest(projectRoot);
  const result = validateV14Manifest({
    ledger,
    manifest,
    projectRoot,
    phase,
    gate,
  });
  const planned = createV14BriefManifest(ledger);
  const resultLine = [
    `V14 ${phase} manifest valid`,
    `total=${result.total}`,
    `approved=${result.approved}`,
    `gates=${Object.entries(result.gates).map(([id, count]) => `${id}:${count}`).join(',')}`,
    `kinds=${Object.entries(result.kinds).map(([kind, count]) => `${kind}:${count}`).join(',')}`,
    `digest=${manifestDigest(manifest)}`,
  ];
  if (manifest.status === 'briefing' && JSON.stringify(manifest) !== JSON.stringify(planned)) {
    throw new Error(`${V14_MANIFEST_PATH} briefing projection has drifted from the 500-item ledger`);
  }
  console.log(resultLine.join(' '));
} else if (command === 'inspect') {
  const id = option('--id');
  if (!/^PF-asset-\d{3}$/.test(id ?? '')) {
    usage();
    process.exitCode = 2;
  } else {
    const manifest = readV14Manifest(projectRoot);
    const entry = manifest.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`unknown V14 PF ID ${id}`);
    process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`);
  }
} else if (command === 'schema') {
  process.stdout.write(readFileSync(resolve(projectRoot, 'docs/art/v14/production-master-manifest-v2.schema.json'), 'utf8'));
} else {
  usage();
  process.exitCode = 2;
}
