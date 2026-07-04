#!/usr/bin/env node
/**
 * Pretty-print JSON for human editing.
 *
 * Usage: node --experimental-strip-types scripts/data-pipeline/clean-json.ts <infile> <outfile>
 */
import { readJson, writeJsonPretty } from './lib/json-io.ts';

const [, , infile, outfile] = process.argv;
if (!infile || !outfile) {
  console.error('Usage: clean-json.ts <infile> <outfile>');
  process.exit(1);
}

writeJsonPretty(outfile, readJson(infile));
