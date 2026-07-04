#!/usr/bin/env node
/**
 * Minify JSON (no whitespace). Used for shipped data assets.
 *
 * Usage: node --experimental-strip-types scripts/data-pipeline/compress-json.ts <infile> <outfile>
 */
import { readJson, writeJsonMinified } from './lib/json-io.ts';

const [, , infile, outfile] = process.argv;
if (!infile || !outfile) {
  console.error('Usage: compress-json.ts <infile> <outfile>');
  process.exit(1);
}

writeJsonMinified(outfile, readJson(infile));
