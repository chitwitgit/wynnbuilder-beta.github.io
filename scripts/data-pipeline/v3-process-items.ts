#!/usr/bin/env node
/**
 * Process raw item data from the Wynncraft v3 API into Wynnbuilder schema.
 *
 * Usage:
 *   node --experimental-strip-types scripts/data-pipeline/v3-process-items.ts [infile]
 *
 * Without infile, fetches from the API and writes data/temp/dump.json.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASELINE_DIR,
  MAPS_DIR,
  TEMP_DIR,
  TRANSLATE_MAPPINGS_PATH,
} from './lib/paths.ts';
import { readJson, writeJsonMinified, writeJsonPretty } from './lib/json-io.ts';
import { Items } from './lib/item-api.ts';
import {
  validateIngredientList,
  validateItemRemotePayload,
  validateMajorIdDatabase,
  validateTomeRemotePayload,
} from './lib/validate-output.ts';
import type { Ingredient, IngredientRemotePayload } from '../../src/types/ingredient.ts';
import type {
  ItemRemotePayload,
  ItemStatMap,
  MajorId,
  MajorIdDatabase,
  TomeRemotePayload,
} from '../../src/types/item.ts';

/** Raw Wynncraft API object before field translation. */
type ApiEntry = Record<string, unknown>;
type TranslateMappings = Record<string, Record<string, string>>;

const translateMappings = readJson<TranslateMappings>(TRANSLATE_MAPPINGS_PATH);

const armorTypes = ['helmet', 'chestplate', 'leggings', 'boots'];
const tomeTypeTranslation: Record<string, string> = {
  marathon_tome: 'gatherXpTome',
  mysticism_tome: 'dungeonXpTome',
  expertise_tome: 'mobXpTome',
  guild_tome: 'guildTome',
  armour_tome: 'armorTome',
  weapon_tome: 'weaponTome',
  lootrun_tome: 'lootrunTome',
};
const knownStaticIds = new Set([
  'rawStrength',
  'rawDexterity',
  'rawIntelligence',
  'rawDefence',
  'rawAgility',
]);

function translateSingleItem(
  key: string,
  entry: ApiEntry,
  name: string,
  directives: string[],
  accumulate: ItemStatMap,
): unknown {
  let ret: unknown = entry;
  try {
    if ('min' in entry && 'max' in entry) {
      if ('raw' in entry) ret = entry.raw;
      else ret = [entry.min, entry.max];
    }
  } catch {
    /* pass */
  }

  for (const directive of directives) {
    if (directive === 'DELETE') ret = null;
    else if (directive === 'CAPS' && typeof ret === 'string')
      ret = ret[0].toUpperCase() + ret.slice(1);
    else if (directive === 'ALLCAPS' && typeof ret === 'string') ret = ret.toUpperCase();
    else if (directive === 'STR_RANGE') {
      if ('min' in entry && 'max' in entry) ret = `${entry.min}-${entry.max}`;
    } else if (directive === 'UNWRAP') {
      recursiveTranslate(entry, accumulate, name, translateSingleItem);
      ret = null;
    }
  }
  return ret;
}

function translateSingleIng(
  key: string,
  entry: ApiEntry,
  name: string,
  directives: string[],
  accumulate: Ingredient,
): unknown {
  let ret: unknown = entry;
  try {
    if ('min' in entry && 'max' in entry) {
      ret = { minimum: entry.min, maximum: entry.max };
    }
  } catch {
    /* pass */
  }

  for (const directive of directives) {
    if (directive === 'DELETE') ret = null;
    else if (directive === 'UNWRAP') {
      recursiveTranslate(entry, accumulate, name, translateSingleIng);
      ret = null;
    } else if (directive.startsWith('RECURSE_')) {
      ret = recursiveTranslate(entry, {}, directive.slice(8), translateSingleIng);
    }
  }
  return ret;
}

type TranslateFn = (
  key: string,
  entry: ApiEntry,
  name: string,
  directives: string[],
  accumulate: ItemStatMap | Ingredient,
) => unknown;

function recursiveTranslate<T extends ItemStatMap | Ingredient>(
  entry: ApiEntry,
  result: T,
  path: string,
  translateSingle: TranslateFn,
): T {
  const mapping = translateMappings[path];
  for (const [k, v] of Object.entries(entry)) {
    if (k in mapping) {
      const tmp = mapping[k].split(';');
      const directives = tmp.slice(0, -1);
      const translatedName = tmp[tmp.length - 1];
      const res = translateSingle(k, v as ApiEntry, translatedName, directives, result);
      if (res !== null) (result as Record<string, unknown>)[translatedName] = res;
      continue;
    }
    (result as Record<string, unknown>)[k] = v;
  }
  return result;
}

function translateEntry(entry: ApiEntry): [ItemStatMap | Ingredient | null, string | null] {
  if (!('type' in entry)) return [null, null];

  if ('identifications' in entry && !('identified' in entry)) {
    const ids = entry.identifications as Record<string, unknown>;
    for (const [id, value] of Object.entries(ids)) {
      if (
        typeof value !== 'object' &&
        Math.abs(value as number) > 1 &&
        !knownStaticIds.has(id)
      ) {
        ids[id] = { static: true, raw: value };
      }
    }
  }

  const type = entry.type as string;
  if (type === 'weapon' || type === 'armour') {
    const res = recursiveTranslate(entry, {} as ItemStatMap, 'item', translateSingleItem);
    if (armorTypes.includes(res.type as string)) {
      res.category = 'armor';
    } else {
      res.category = 'weapon';
      for (const element of 'netwfa') {
        const damageKey = element + 'Dam';
        if (!(damageKey in res)) res[damageKey] = '0-0';
      }
    }
    return [res, 'item'];
  }
  if (type === 'accessory') {
    return [
      recursiveTranslate(entry, { category: 'accessory' } as ItemStatMap, 'item', translateSingleItem),
      'item',
    ];
  }
  if (type === 'ingredient') {
    return [recursiveTranslate(entry, {} as Ingredient, 'ingredient', translateSingleIng), 'ingredient'];
  }
  if (type === 'tome') {
    const res = recursiveTranslate(entry, {} as ItemStatMap, 'tome', translateSingleItem);
    res.category = 'tome';
    res.fixID = false;
    console.log(res);
    res.type = tomeTypeTranslation[res.type as string];
    return [res, 'tome'];
  }
  if (type === 'material') return [null, 'material'];

  return [null, null];
}

async function main(): Promise<void> {
  const infile = process.argv[2];
  let apiData: ApiEntry[];

  if (!infile) {
    console.log('Grabbing json data from wynn api');
    apiData = (await new Items().getAllItems()) as ApiEntry[];
    writeJsonPretty(join(TEMP_DIR, 'dump.json'), apiData);
  } else {
    apiData = readJson<ApiEntry[]>(infile);
  }

  const idMap = readJson<Record<string, number>>(join(MAPS_DIR, 'id_map.json'));
  const usedIds = new Set(Object.values(idMap));
  let maxId = 0;

  const ingMap = readJson<Record<string, number>>(join(MAPS_DIR, 'ing_map.json'));
  const tomeMap = readJson<Record<string, number>>(join(MAPS_DIR, 'tome_map.json'));

  const items: ItemStatMap[] = [];
  const ingreds: Ingredient[] = [];
  const tomes: ItemStatMap[] = [];

  for (const entry of apiData) {
    const [res, entryType] = translateEntry(entry);
    console.log(`Parsed ${entry.displayName}, type ${entryType}`);
    if (res === null) continue;
    if (entryType === 'item') items.push(res as ItemStatMap);
    else if (entryType === 'ingredient') ingreds.push(res as Ingredient);
    else if (entryType === 'tome') tomes.push(res as ItemStatMap);
  }

  const oldData = readJson<ItemRemotePayload>(join(BASELINE_DIR, 'clean.json'));
  const oldItems = oldData.items;
  const oldIngreds = readJson<IngredientRemotePayload>(join(BASELINE_DIR, 'ingreds_clean.json'));
  const oldTomeData = readJson<TomeRemotePayload>(join(BASELINE_DIR, 'tomes.json'));
  const oldTomes = oldTomeData.tomes;

  const knownItemNames = new Set(items.map((i) => i.name as string));
  const knownIngredNames = new Set(ingreds.map((i) => i.name as string));
  const knownTomeNames = new Set(tomes.map((i) => i.name as string));

  const tomeValueMap: Record<string, ItemStatMap> = {};
  for (const item of oldItems) {
    if ('persistent' in item) {
      console.log(`Old API hidden item: ${item.name}`);
      items.push(item);
    } else if (!knownItemNames.has(item.name as string)) {
      console.log(`Unknown old item: ${item.name}!!!`);
    }
  }
  for (const ingred of oldIngreds) {
    if (!knownIngredNames.has(ingred.name as string)) {
      console.log(`Unknown old ingred: ${ingred.name}!!!`);
    }
  }
  for (const tome of oldTomes) {
    if (!knownTomeNames.has(tome.name as string)) {
      console.log(`Unknown old tome: ${tome.name}!!!`);
    }
    tomeValueMap[tome.name as string] = tome;
  }

  const majorIdsMap = readJson<MajorIdDatabase>(join(BASELINE_DIR, 'major_ids_clean.json'));
  const majorIdsReverseMap: Record<string, string> = Object.fromEntries(
    Object.entries(majorIdsMap).map(([k, v]) => [v.displayName as string, k]),
  );

  const replaceStrings: Record<string, string> = {
    '\ue005': '[neutral]',
    '\ue004': '[water]',
    '\ue003': '[thunder]',
    '\ue002': '[fire]',
    '\ue001': '[earth]',
    '\ue000': '[air]',
  };

  const attackSpeedDict: Record<string, string> = {
    SUPERSLOW: 'SUPER_SLOW',
    VERYSLOW: 'VERY_SLOW',
    VERYFAST: 'VERY_FAST',
    SUPERFAST: 'SUPER_FAST',
  };

  const ingTierDict: Record<string, number> = {
    TIER_0: 0,
    TIER_1: 1,
    TIER_2: 2,
    TIER_3: 3,
  };

  const displayNames = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if ('displayName' in item) {
      const dn = item.displayName as string;
      if (displayNames.has(dn)) duplicates.add(dn);
      else displayNames.add(dn);
    }
  }

  for (const item of items) {
    if ('majorIds' in item && !('persistent' in item)) {
      const majorIdsRaw = item.majorIds as Record<string, string>;
      const majorIds: string[] = [];
      for (const [majidName, majidDesc] of Object.entries(majorIdsRaw)) {
        let desc: string;
        try {
          desc = (majidDesc as string).replace(/<[^<]+?>/g, '').trim();
        } catch {
          console.log(`Exception occured!: name = ${majidName} | desc = ${majidDesc}`);
          continue;
        }
        for (const [k, v] of Object.entries(replaceStrings)) {
          desc = desc.replace(new RegExp(k, 'g'), v);
        }
        if (!(majidName in majorIdsReverseMap)) {
          let capsName = majidName.toUpperCase().replace(/ /g, '_');
          capsName = capsName.replace(/[^0-9A-Z_]/g, '');
          const newMajorId: MajorId = {
            displayName: majidName,
            description: desc,
            abilities: [],
          };
          majorIdsMap[capsName] = newMajorId;
          console.log(`New Major ID: ${majidName} (${capsName})`);
          majorIdsReverseMap[majidName] = capsName;
        } else {
          majorIdsMap[majorIdsReverseMap[majidName]].description = desc;
        }
        majorIds.push(majorIdsReverseMap[majidName]);
      }
      item.majorIds = majorIds;
    }

    if ('atkSpd' in item && attackSpeedDict[item.atkSpd as string]) {
      item.atkSpd = attackSpeedDict[item.atkSpd as string];
    }
    if ('lore' in item && typeof item.lore === 'string') {
      item.lore = item.lore.replace(/<[^<]+?>/g, '').trim();
    }
    if ('restrict' in item && item.restrict === 'none') {
      delete item.restrict;
    }
    if ('displayName' in item && duplicates.has(item.displayName as string)) {
      item.displayName = item.name;
    }

    const itemName = item.name as string;
    if (!(itemName in idMap)) {
      while (usedIds.has(maxId)) maxId += 1;
      usedIds.add(maxId);
      idMap[itemName] = maxId;
      console.log(`New item: ${itemName} (id: ${maxId})`);
    }
    item.id = idMap[itemName];
  }

  for (const ingred of ingreds) {
    const itemIDs = ingred.itemIDs!;
    itemIDs.dura = Math.trunc((itemIDs.dura ?? 0) / 1000);
    ingred.skills = (ingred.skills ?? []).map((x) => x.toUpperCase());
    if (ingred.posMods) {
      const posMods = ingred.posMods as Ingredient['posMods'] & { not_touching?: number };
      if (posMods.not_touching !== undefined) {
        posMods.notTouching = posMods.not_touching;
        delete posMods.not_touching;
      }
    }
    if (!ingred.ids) {
      ingred.ids = {};
      console.log(`ing missing 'ids': ${ingred.name}`);
    }
    if (!ingred.consumableIDs) {
      ingred.consumableIDs = { dura: 0, charges: 0 };
      console.log(`ing missing 'consumableIDs': ${ingred.name}`);
    }
    if ('base' in ingred) {
      const base = (ingred as Record<string, unknown>).base as Record<string, unknown> | undefined;
      if (base && 'baseDamage' in base) {
        const bd = base.baseDamage as { min: number; max: number };
        ingred.ids!.damPct = { minimum: bd.min, maximum: bd.max };
        delete (ingred as Record<string, unknown>).base;
      }
    }
    if ('tier' in ingred && ingTierDict[ingred.tier as string] !== undefined) {
      ingred.tier = ingTierDict[ingred.tier as string];
    }

    const ingName = ingred.name as string;
    if (!(ingName in ingMap)) {
      const newId = Object.keys(ingMap).length;
      ingMap[ingName] = newId;
      console.log(`New ingred: ${ingName} (id: ${newId})`);
    }
    ingred.id = ingMap[ingName];
  }

  for (const tome of tomes) {
    const tomeName = tome.name as string;
    if (!(tomeName in tomeMap)) {
      const newId = Object.keys(tomeMap).length;
      tomeMap[tomeName] = newId;
      console.log(`New tome: ${tomeName} (id: ${newId})`);
      tome.alias = 'NO_ALIAS';
    } else if (tomeName in tomeValueMap) {
      const oldTome = tomeValueMap[tomeName];
      if ('alias' in oldTome) tome.alias = oldTome.alias;
    }
    tome.id = tomeMap[tomeName];
  }

  oldData.items = items;

  validateItemRemotePayload(oldData);
  validateIngredientList(ingreds);
  validateTomeRemotePayload({ tomes });
  validateMajorIdDatabase(majorIdsMap);

  writeJsonPretty(join(MAPS_DIR, 'id_map.json'), idMap);
  writeJsonPretty(join(MAPS_DIR, 'ing_map.json'), ingMap);
  writeJsonPretty(join(MAPS_DIR, 'tome_map.json'), tomeMap);

  writeJsonMinified(join(TEMP_DIR, 'item_out.json'), oldData);
  writeJsonPretty(join(TEMP_DIR, 'major_ids_clean.json'), majorIdsMap, 4);
  writeJsonMinified(join(TEMP_DIR, 'ing_out.json'), ingreds);
  writeJsonMinified(join(TEMP_DIR, 'tome_out.json'), { tomes } satisfies TomeRemotePayload);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
