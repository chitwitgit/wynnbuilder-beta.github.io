#!/usr/bin/env node
/**
 * Smoke-test TypeScript data-pipeline scripts with safe local defaults.
 *
 * Usage:
 *   npm run data:all
 *   npm run data:all -- --online
 *
 * Offline (default): read-only or temp-only scripts.
 * With --online: also runs API scripts (get-aspects, v3-process-items, item-api).
 * process-recipes is always skipped here — it reads local files and mutates maps.
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_DIR, DATA_DIR, TEMP_DIR } from './lib/paths.ts';

const here = dirname(fileURLToPath(import.meta.url));
const runTs = join(here, 'run.ts');

function latestDataVersion(): string | null {
  const versions = readdirSync(DATA_DIR)
    .filter((d) => d !== 'baseline' && d !== 'temp' && /^\d/.test(d))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return versions[0] ?? null;
}

function runJob(name: string, args: string[]): boolean {
  const label = `${name}${args.length ? ' ' + args.join(' ') : ''}`;
  process.stdout.write(`- ${label} ... `);
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', runTs, name, ...args],
    { stdio: 'pipe', encoding: 'utf-8' },
  );
  if (result.status === 0) {
    console.log('ok');
    return true;
  }
  console.log('FAILED');
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return false;
}

type Job = { name: string; args: string[] };

const jobs: Job[] = [
  { name: 'atree-generate-id', args: [] },
  { name: 'validate-items', args: [join(BASELINE_DIR, 'clean.json')] },
  {
    name: 'compress-json',
    args: [join(BASELINE_DIR, 'maps/tome_map.json'), join(TEMP_DIR, '_smoke_compress.json')],
  },
  {
    name: 'clean-json',
    args: [join(BASELINE_DIR, 'maps/tome_map.json'), join(TEMP_DIR, '_smoke_clean.json')],
  },
  {
    name: 'json-diff',
    args: [
      join(BASELINE_DIR, 'maps/id_map.json'),
      join(BASELINE_DIR, 'maps/id_map.json'),
    ],
  },
];

const ver = latestDataVersion();
if (ver) {
  jobs.push({ name: 'encoding-gen-const', args: [ver] });
}

const online = process.argv.includes('--online');

/** Scripts that call api.wynncraft.com (also update some baseline maps). */
const apiJobs: Job[] = [
  { name: 'get-aspects', args: [] },
  { name: 'v3-process-items', args: [] },
  {
    name: 'item-api',
    args: ['update-metadata', join(TEMP_DIR, '_smoke_metadata.json')],
  },
];

const allJobs = online ? [...jobs, ...apiJobs] : jobs;

console.log(
  online
    ? 'Running data-pipeline smoke tests (offline + API)...\n'
    : 'Running data-pipeline smoke tests (temp/read-only)...\n',
);

let failed = 0;
for (const job of allJobs) {
  if (!runJob(job.name, job.args)) failed += 1;
}

console.log('\nSkipped (run manually):');
console.log('  npm run data -- process-recipes data/baseline/recipes.json data/temp/recipes_clean.json');
if (!online) {
  console.log('  npm run data -- get-aspects');
  console.log('  npm run data -- v3-process-items');
  console.log('  npm run data -- item-api update-items data/temp/dump.json');
  console.log('  npm run data:all -- --online   # run API scripts above');
}
if (existsSync(join(TEMP_DIR, 'dump.json'))) {
  console.log('  npm run data -- v3-process-items data/temp/dump.json  # offline re-run');
}

console.log(`\nDone: ${allJobs.length - failed}/${allJobs.length} passed.`);
process.exit(failed > 0 ? 1 : 0);
