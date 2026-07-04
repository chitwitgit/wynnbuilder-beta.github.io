#!/usr/bin/env node
/**
 * CLI wrapper for json-diff.
 *
 * Usage: node --experimental-strip-types scripts/data-pipeline/json-diff.ts <file1> <file2>
 */
import { readJson } from './lib/json-io.ts';
import { jsonDiff, JSON_DIFF_PRINTER } from './lib/json-diff.ts';

const [, , file1, file2] = process.argv;
if (!file1 || !file2) {
  console.error('Usage: json-diff.ts <file1> <file2>');
  process.exit(1);
}

const changed = jsonDiff(readJson(file1), readJson(file2), JSON_DIFF_PRINTER);
process.exit(changed ? 1 : 0);
