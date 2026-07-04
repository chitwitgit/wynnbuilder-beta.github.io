#!/usr/bin/env node
/**
 * Validate an items JSON file for duplicate names.
 *
 * Usage: node --experimental-strip-types scripts/data-pipeline/validate-items.ts <items.json>
 */
import { readJson } from './lib/json-io.ts';

const [, , infile] = process.argv;
if (!infile) {
  console.error('Usage: validate-items.ts <items.json>');
  process.exit(1);
}

const data = readJson<{ items: Array<{ id: number; name: string }> }>(infile);
const duplicateMap = new Map<string, { id: number; name: string }>();

for (const item of data.items) {
  const existing = duplicateMap.get(item.name);
  if (existing) {
    console.log(`DUPLICATE: ${item.id} <-> ${existing.id}`);
  } else {
    duplicateMap.set(item.name, item);
  }
}
