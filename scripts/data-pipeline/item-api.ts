#!/usr/bin/env node
/**
 * CLI for Wynncraft v3 item API utilities.
 *
 * Usage:
 *   node --experimental-strip-types scripts/data-pipeline/item-api.ts update-items <file>
 *   node --experimental-strip-types scripts/data-pipeline/item-api.ts update-metadata <file>
 *   node --experimental-strip-types scripts/data-pipeline/item-api.ts search [-keyword ...] ...
 */
import {
  itemSearchParam,
  updateItems,
  updateMetadata,
} from './lib/item-api.ts';

const [, , command, ...rest] = process.argv;

function parseFlag(name: string): string | undefined {
  const idx = rest.indexOf(name);
  if (idx === -1 || idx + 1 >= rest.length) return undefined;
  return rest[idx + 1];
}

async function main(): Promise<void> {
  if (command === 'update-items') {
    const file = rest[0];
    if (!file) {
      console.error('Usage: item-api.ts update-items <file>');
      process.exit(1);
    }
    await updateItems(file);
    return;
  }
  if (command === 'update-metadata') {
    const file = rest[0];
    if (!file) {
      console.error('Usage: item-api.ts update-metadata <file>');
      process.exit(1);
    }
    await updateMetadata(file);
    return;
  }
  if (command === 'search') {
    const lvlMaxIdx = rest.indexOf('-lvlRange');
    let lvlRange: [number, number] | undefined;
    if (lvlMaxIdx !== -1 && lvlMaxIdx + 2 < rest.length) {
      lvlRange = [parseInt(rest[lvlMaxIdx + 1], 10), parseInt(rest[lvlMaxIdx + 2], 10)];
    }
    await itemSearchParam({
      keyword: parseFlag('-keyword'),
      itemType: parseFlag('-itemType'),
      itemTier: parseFlag('-itemTier'),
      atkSpeed: parseFlag('-atkSpeed'),
      lvlRange,
      prof: parseFlag('-prof'),
      ids: parseFlag('-ids'),
      majorId: parseFlag('-majorId'),
    });
    return;
  }

  console.error(`Unknown command: ${command ?? '(none)'}`);
  console.error('Commands: update-items, update-metadata, search');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
