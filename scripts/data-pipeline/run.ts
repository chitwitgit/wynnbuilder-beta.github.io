#!/usr/bin/env node
/**
 * Run a data-pipeline TypeScript script by name.
 *
 * Usage:
 *   npm run data -- <script> [args...]
 *   npm run data -- list
 *
 * Examples:
 *   npm run data -- atree-generate-id
 *   npm run data -- compress-json data/baseline/clean.json data/temp/out.json
 *   npm run data -- v3-process-items data/temp/dump.json
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nodeArgs = ['--experimental-strip-types'];

/** kebab-case name -> script filename */
const SCRIPTS: Record<string, string> = {
  'atree-generate-id': 'atree-generate-id.ts',
  'clean-json': 'clean-json.ts',
  'compress-json': 'compress-json.ts',
  'encoding-gen-const': 'encoding-gen-const.ts',
  'get-aspects': 'get-aspects.ts',
  'item-api': 'item-api.ts',
  'json-diff': 'json-diff.ts',
  'process-recipes': 'process-recipes.ts',
  'validate-items': 'validate-items.ts',
  'v3-process-items': 'v3-process-items.ts',
};

/** Optional aliases matching py_script/*.py names */
const ALIASES: Record<string, string> = {
  'atree-generateID': 'atree-generate-id',
  'atree-generateID.py': 'atree-generate-id',
  'clean_json': 'clean-json',
  'compress_json': 'compress-json',
  'encoding_gen_const': 'encoding-gen-const',
  'get_aspects': 'get-aspects',
  'item_wrapper': 'item-api',
  'json_diff': 'json-diff',
  'process_recipes': 'process-recipes',
  'validate': 'validate-items',
  'v3_process_items': 'v3-process-items',
};

function printHelp(): void {
  console.log(`Usage: npm run data -- <script> [args...]

Scripts:
${Object.keys(SCRIPTS)
  .sort()
  .map((name) => `  ${name}`)
  .join('\n')}

Python-style aliases (e.g. v3_process_items) are also accepted.
Run \`npm run data:all\` to smoke-test every script locally.`);
}

const [, , rawName, ...args] = process.argv;

if (!rawName || rawName === 'help' || rawName === '-h' || rawName === '--help') {
  printHelp();
  process.exit(rawName ? 0 : 1);
}

if (rawName === 'list') {
  for (const name of Object.keys(SCRIPTS).sort()) {
    console.log(name);
  }
  process.exit(0);
}

const name = ALIASES[rawName] ?? rawName;
const scriptFile = SCRIPTS[name];
if (!scriptFile) {
  console.error(`Unknown script: ${rawName}`);
  printHelp();
  process.exit(1);
}

const scriptPath = join(here, scriptFile);
const result = spawnSync(process.execPath, [...nodeArgs, scriptPath, ...args], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
