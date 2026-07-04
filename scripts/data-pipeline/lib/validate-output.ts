/**
 * Runtime checks that pipeline output matches app types in src/types/.
 */
import type { EncodingConstants } from '../../../src/types/build.ts';
import type {
  ItemRemotePayload,
  ItemStatMap,
  MajorIdDatabase,
  TomeRemotePayload,
} from '../../../src/types/item.ts';
import type { Ingredient } from '../../../src/types/ingredient.ts';

const ENCODING_REQUIRED_KEYS: (keyof EncodingConstants)[] = [
  'EQUIPMENT_KIND',
  'EQUIPMENT_POWDERS_FLAG',
  'EQUIPMENT_NUM',
  'POWDERABLE_EQUIPMENT_NUM',
  'POWDER_ELEMENTS',
  'POWDER_TIERS',
  'POWDER_WRAPPER_BITLEN',
  'POWDER_ID_BITLEN',
  'POWDER_REPEAT_OP',
  'POWDER_REPEAT_TIER_OP',
  'POWDER_CHANGE_OP',
  'TOMES_FLAG',
  'TOME_SLOT_FLAG',
  'TOME_NUM',
  'ASPECT_TIERS',
  'NUM_ASPECTS',
  'ASPECT_TIER_BITLEN',
  'ASPECTS_FLAG',
  'ASPECT_SLOT_FLAG',
  'MAX_SP',
  'SP_TYPES',
  'MAX_SP_BITLEN',
  'SP_FLAG',
  'SP_ELEMENT_FLAG',
  'LEVEL_FLAG',
  'MAX_LEVEL',
  'LEVEL_BITLEN',
  'ITEM_ID_BITLEN',
  'TOME_ID_BITLEN',
  'ASPECT_ID_BITLEN',
];

function assertFlagMap(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null || !('BITLEN' in value)) {
    throw new TypeError(`${label}: expected flag map with BITLEN`);
  }
}

/** Validate encoding_consts.json before writing to data/. */
export function assertEncodingConstants(value: unknown): asserts value is EncodingConstants {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('encoding constants: expected object');
  }
  const obj = value as Record<string, unknown>;
  for (const key of ENCODING_REQUIRED_KEYS) {
    if (!(key in obj)) {
      throw new TypeError(`encoding constants: missing required key "${key}"`);
    }
  }
  for (const flagKey of [
    'EQUIPMENT_KIND',
    'EQUIPMENT_POWDERS_FLAG',
    'TOMES_FLAG',
    'TOME_SLOT_FLAG',
    'ASPECTS_FLAG',
    'ASPECT_SLOT_FLAG',
    'SP_FLAG',
    'SP_ELEMENT_FLAG',
    'LEVEL_FLAG',
    'POWDER_REPEAT_OP',
    'POWDER_REPEAT_TIER_OP',
    'POWDER_CHANGE_OP',
  ] as const) {
    assertFlagMap(obj[flagKey], flagKey);
  }
  if (!Array.isArray(obj.POWDER_ELEMENTS)) {
    throw new TypeError('encoding constants: POWDER_ELEMENTS must be an array');
  }
}

function assertItemStatMap(item: ItemStatMap, index: number): void {
  if (typeof item.name !== 'string' || item.name.length === 0) {
    throw new TypeError(`items[${index}]: missing name`);
  }
  if (typeof item.id !== 'number') {
    throw new TypeError(`items[${index}] "${item.name}": missing numeric id`);
  }
}

/** Validate clean.json / item_out.json shape before promotion. */
export function validateItemRemotePayload(payload: ItemRemotePayload): void {
  if (!Array.isArray(payload.items)) {
    throw new TypeError('items payload: expected items array');
  }
  if (typeof payload.sets !== 'object' || payload.sets === null) {
    throw new TypeError('items payload: expected sets object');
  }
  payload.items.forEach(assertItemStatMap);
}

export function validateIngredientList(ingreds: Ingredient[]): void {
  ingreds.forEach((ing, index) => {
    if (typeof ing.name !== 'string' || ing.name.length === 0) {
      throw new TypeError(`ingreds[${index}]: missing name`);
    }
    if (typeof ing.id !== 'number') {
      throw new TypeError(`ingreds[${index}] "${ing.name}": missing numeric id`);
    }
  });
}

export function validateTomeRemotePayload(payload: TomeRemotePayload): void {
  if (!Array.isArray(payload.tomes)) {
    throw new TypeError('tomes payload: expected tomes array');
  }
  payload.tomes.forEach(assertItemStatMap);
}

export function validateMajorIdDatabase(db: MajorIdDatabase): void {
  for (const [key, entry] of Object.entries(db)) {
    if (typeof entry.displayName !== 'string') {
      throw new TypeError(`majorIds["${key}"]: missing displayName`);
    }
    if (typeof entry.description !== 'string') {
      throw new TypeError(`majorIds["${key}"]: missing description`);
    }
    if (!Array.isArray(entry.abilities)) {
      throw new TypeError(`majorIds["${key}"]: missing abilities array`);
    }
  }
}
