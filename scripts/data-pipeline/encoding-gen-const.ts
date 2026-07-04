#!/usr/bin/env node
/**
 * Generate encoding_consts.json for build URL encoding.
 *
 * Usage:
 *   node --experimental-strip-types scripts/data-pipeline/encoding-gen-const.ts <version> [--write] [--override] [--preview]
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AspectDatabase } from '../../src/types/aspect.ts';
import type { EncodingConstants, EncodingFlagMap } from '../../src/types/build.ts';
import type { ItemRemotePayload, TomeRemotePayload } from '../../src/types/item.ts';
import { DATA_DIR, TEMP_DIR } from './lib/paths.ts';
import { readJson, writeJsonPretty } from './lib/json-io.ts';
import { assertEncodingConstants } from './lib/validate-output.ts';

function getBitlen(num: number, signed = false): number {
  if (num === 1) return 1 + Number(signed);
  return Math.floor(Math.log(num - Number(signed)) / Math.LN2) + 1 + Number(signed);
}

function generateIdMap<const T extends string>(
  arr: readonly T[],
): EncodingFlagMap & Record<T | 'BITLEN', number> {
  const m = Object.fromEntries(arr.map((v, i) => [v, i])) as Record<T, number>;
  const withBitlen = { ...m, BITLEN: getBitlen(arr.length - 1) };
  return withBitlen as EncodingFlagMap & Record<T | 'BITLEN', number>;
}

function parseVersion(v: string): number[] {
  return v.split('.').map((x) => parseInt(x, 10) || 0);
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return db - da;
  }
  return 0;
}

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('-'));
const override = args.includes('--override');
let writePermission = args.includes('--write');
const preview = args.includes('--preview') || !writePermission;

if (!version) {
  console.error('Usage: encoding-gen-const.ts <version> [--write] [--override] [--preview]');
  process.exit(1);
}

/** Mutable builder; validated as EncodingConstants before write. */
const bitLenMap: Partial<EncodingConstants> = {};

bitLenMap.EQUIPMENT_KIND = generateIdMap(['NORMAL', 'CRAFTED', 'CUSTOM']);
bitLenMap.EQUIPMENT_POWDERS_FLAG = generateIdMap(['NO_POWDERS', 'HAS_POWDERS']);
bitLenMap.EQUIPMENT_NUM = 9;
bitLenMap.POWDERABLE_EQUIPMENT_NUM = 5;

bitLenMap.POWDER_ELEMENTS = ['E', 'T', 'W', 'F', 'A'];
bitLenMap.POWDER_TIERS = 6;
bitLenMap.POWDER_WRAPPER_BITLEN = getBitlen(bitLenMap.POWDER_ELEMENTS.length - 1 - 1);
bitLenMap.POWDER_ID_BITLEN = getBitlen(
  bitLenMap.POWDER_ELEMENTS.length * (bitLenMap.POWDER_TIERS as number),
);
bitLenMap.POWDER_REPEAT_OP = generateIdMap(['REPEAT', 'NO_REPEAT']);
bitLenMap.POWDER_REPEAT_TIER_OP = generateIdMap(['REPEAT_TIER', 'CHANGE_POWDER']);
bitLenMap.POWDER_CHANGE_OP = generateIdMap(['NEW_POWDER', 'NEW_ITEM']);

bitLenMap.TOMES_FLAG = generateIdMap(['NO_TOMES', 'HAS_TOMES']);
bitLenMap.TOME_SLOT_FLAG = generateIdMap(['UNUSED', 'USED']);
bitLenMap.TOME_NUM = 14;

bitLenMap.ASPECT_TIERS = 4;
bitLenMap.NUM_ASPECTS = 5;
bitLenMap.ASPECT_TIER_BITLEN = getBitlen((bitLenMap.ASPECT_TIERS as number) - 1);
bitLenMap.ASPECTS_FLAG = generateIdMap(['NO_ASPECTS', 'HAS_ASPECTS']);
bitLenMap.ASPECT_SLOT_FLAG = generateIdMap(['UNUSED', 'USED']);

bitLenMap.MAX_SP = 2 ** 11;
bitLenMap.SP_TYPES = 5;
bitLenMap.MAX_SP_BITLEN = getBitlen(bitLenMap.MAX_SP as number, true);
bitLenMap.SP_FLAG = generateIdMap(['ASSIGNED', 'AUTOMATIC']);
bitLenMap.SP_ELEMENT_FLAG = generateIdMap(['ELEMENT_UNASSIGNED', 'ELEMENT_ASSIGNED']);

bitLenMap.LEVEL_FLAG = generateIdMap(['MAX', 'OTHER']);
bitLenMap.MAX_LEVEL = 106;
bitLenMap.LEVEL_BITLEN = getBitlen(bitLenMap.MAX_LEVEL as number);

function getMaxId(lst: Array<{ id?: number }>): number {
  let maxId = 0;
  let zeroId = false;
  for (const x of lst) {
    if ((x.id ?? -1) > maxId) maxId = x.id ?? maxId;
    if (x.id === 0) zeroId = true;
  }
  if (lst.length - 1 > maxId || (lst.length - 1 === maxId && !zeroId)) {
    console.log(
      `WARNING: There are more items in the list (${lst.length}) than there are IDs (${maxId}).`,
    );
    console.log(
      'WARNING: Encoding bitlen for len(lst) instead of item IDs. This could be an error - check manually.',
    );
    maxId = lst.length;
  }
  return maxId;
}

function genItems(): void {
  const data = readJson<ItemRemotePayload>(join(DATA_DIR, version, 'items.json'));
  bitLenMap.ITEM_ID_BITLEN = getBitlen(getMaxId(data.items) + 1);
}

function genTomes(): void {
  const data = readJson<TomeRemotePayload>(join(DATA_DIR, version, 'tomes.json'));
  bitLenMap.TOME_ID_BITLEN = getBitlen(getMaxId(data.tomes));
}

function genAspects(): void {
  const data = readJson<AspectDatabase>(join(DATA_DIR, version, 'aspects.json'));
  let maxId = 0;
  for (const aspects of Object.values(data)) {
    const m = getMaxId(aspects);
    if (m > maxId) maxId = m;
  }
  bitLenMap.ASPECT_ID_BITLEN = maxId !== 0 ? getBitlen(maxId) : 0;
}

function getDataVersions(): string[] {
  return readdirSync(DATA_DIR)
    .filter((d) => d !== 'baseline' && d !== 'temp')
    .sort(compareVersionsDesc);
}

function diffVersions(
  prev: EncodingConstants,
  curr: EncodingConstants,
  path = '',
): boolean {
  let diff = false;
  for (const k of Object.keys(prev) as (keyof EncodingConstants)[]) {
    if (k in curr) {
      const currVal = curr[k];
      const prevVal = prev[k];
      if (JSON.stringify(currVal) !== JSON.stringify(prevVal)) {
        if (typeof currVal === 'number' && typeof prevVal === 'number' && currVal < prevVal) {
          console.log(
            'ERROR: Numeric values should not shrink between versions unless something fundamental about the game changed.',
          );
          console.log(
            'If this is intended, take great care to make sure backwards compatability is retained, then change it manually.',
          );
          writePermission = false;
        } else if (Array.isArray(currVal) && Array.isArray(prevVal) && currVal.length < prevVal.length) {
          console.log(
            'WARNING: list in recent data is shorter than previous data. This either indicates a bug or requires an encoder change.',
          );
        }
        diff = true;
        console.log(
          [
            path ? `${path}:` : 'TOP_LEVEL:',
            ` - ${k} : ${JSON.stringify(prevVal)}`,
            ` + ${k} : ${JSON.stringify(currVal)}`,
          ].join('\n'),
        );
      }
    } else {
      console.log(
        `WARNING: Adding new key '${k}' to encoding data. If this is intended, ignore this warning.`,
      );
    }
  }
  return diff;
}

const allDataVersions = getDataVersions();
if (!allDataVersions.includes(version)) {
  console.error(
    `INVALID VERSION ${version}: if this is indeed the version you meant to use please create a folder in data/.`,
  );
  process.exit(1);
}

const currVersionIdx = allDataVersions.indexOf(version);
if (currVersionIdx !== 0 && !override) {
  console.error(
    'WARNING: You are trying to modify an older encoding version. this could break backwards compatability. to override pass the --override flag.',
  );
  process.exit(1);
}

genItems();
genTomes();
genAspects();

assertEncodingConstants(bitLenMap);
const encodingConstants = bitLenMap as EncodingConstants;

if (preview) {
  console.log(JSON.stringify(encodingConstants, null, 2) + '\n');
  console.log('NOTE: Make sure to review errors and warnings.\n');
}

if (currVersionIdx < allDataVersions.length - 1) {
  const prevVersion = allDataVersions[currVersionIdx + 1];
  const prevVersionData = readJson<EncodingConstants>(
    join(DATA_DIR, prevVersion, 'encoding_consts.json'),
  );
  if (diffVersions(prevVersionData, encodingConstants)) {
    console.log(
      "\nWARNING: There's a change in data between old and new data. please make sure that this is intended before writing.",
    );
  }
}

if (writePermission) {
  writeJsonPretty(join(TEMP_DIR, 'encoding_consts.json'), encodingConstants);
  writeJsonPretty(join(DATA_DIR, version, 'encoding_consts.json'), encodingConstants);
}
