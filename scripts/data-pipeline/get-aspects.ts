#!/usr/bin/env node
/**
 * Fetch and process aspect data from the Wynncraft v3 API.
 *
 * Usage: node --experimental-strip-types scripts/data-pipeline/get-aspects.ts
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_DIR, MAPS_DIR, TEMP_DIR } from './lib/paths.ts';
import { readJson, writeJsonPretty } from './lib/json-io.ts';
import { jsonDiff } from './lib/json-diff.ts';

const API_BASE_URL = 'https://api.wynncraft.com/v3/aspects/';
const CLASSES = ['Archer', 'Warrior', 'Mage', 'Assassin', 'Shaman'];

const replaceStrings: Record<string, string> = {
  '\ue01f ': '',
  '\ue01e ': '',
  '\ue01d ': '',
  '\ue01c ': '',
  '\ue01b ': '',
  '\ue007 ': '',
  '\ue027 ': '',
  '\ue006 ': '',
  ' \ue01a': '',
  ' \u2699': '',
  ' \ue018': '',
  ' \u2727': '',
  ' \ue025': '',
  ' \u2741': '',
  ' \ue035': '',
  ' \u273a': '',
  ' \u231a': '',
  ' \ue019': '',
  ' \ue040': '',
  ' \ue041': '',
  ' \ue042': '',
  ' \ue013': '',
  ' \u2765': '',
  ' \uE020': '',
  ' \uE031': '',
  ' \u2698': '',
  ' \u265a': '',
  ' \u21f6': '',
  ' \\(\ue00d\\)': '',
  ' \\(\ue00b\\)': '',
  ' \\(\ue01b\\)': '',
  ' \\(\ue015\\)': '',
  ' \\(\u2694\\)': '',
  ' \\(\u2741\\)': '',
  ' \\(\u273e\\)': '',
  ' \\(\u2748\\)': '',
  ' \\(\u2617\\)': '',
  ' \\(\u27b2\\)': '',
  ' \u2764': '',
  '\u00b0': ' degrees',
  'Total Damage': "</br><span class='mc-white'>Total Damage</span>",
  '\\(\ue005 Damage': "</br>&emsp;(<span class='nDam'>Damage</span>",
  '\\(\ue004 Water': "</br>&emsp;(<span class='wDam'>Water</span>",
  '\\(\ue003 Thunder': "</br>&emsp;(<span class='tDam'>Thunder</span>",
  '\\(\ue002 Fire': "</br>&emsp;(<span class='fDam'>Fire</span>",
  '\\(\ue001 Earth': "</br>&emsp;(<span class='eDam'>Earth</span>",
  '\\(\ue000 Air': "</br>&emsp;(<span class='aDam'>Air</span>",
  '\\(\ue001\ue003\ue004\ue002\ue000 Damage':
    "</br>&emsp;(<span class='nDam'>Rainbow Damage</span>",
  '\ue005 ': '</br>',
  '\ue004 ': '</br>',
  '\ue003 ': '</br>',
  '\ue002 ': '</br>',
  '\ue001 ': '</br>',
  '\ue000 ': '</br>',
};

const htmlCleaner = /<.*?>/g;

type ApiAspect = {
  name?: string;
  rarity: string;
  tiers: Record<string, { threshold: number; description: string[] }>;
};

/** API may return a list (current) or a name-keyed object (legacy cache). */
function normalizeAspectMap(raw: unknown): Record<string, ApiAspect> {
  if (Array.isArray(raw)) {
    const map: Record<string, ApiAspect> = {};
    for (const aspect of raw) {
      if (aspect && typeof aspect === 'object' && typeof aspect.name === 'string') {
        map[aspect.name] = aspect as ApiAspect;
      }
    }
    return map;
  }
  if (raw && typeof raw === 'object') {
    return raw as Record<string, ApiAspect>;
  }
  return {};
}

async function getAspectData(wynnClass: string): Promise<Record<string, ApiAspect>> {
  const url = API_BASE_URL + wynnClass.toLowerCase();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch aspects for ${wynnClass}: ${response.status}`);
  }
  return normalizeAspectMap(await response.json());
}

type AspectTier = {
  threshold: number;
  description: string | null;
  abilities: unknown[];
};

type AspectInfo = {
  displayName: string;
  id: number;
  tier?: string;
  class?: string;
  tiers: AspectTier[];
  aliases?: unknown;
};

function stylizeDescription(strings: string[]): string {
  const sub = (s: string): string => {
    let out = s;
    for (const [k, v] of Object.entries(replaceStrings)) {
      out = out.replace(new RegExp(k, 'g'), v);
    }
    return out;
  };

  const result: string[] = [];
  for (const text of strings) {
    if (text.includes('</br>')) {
      result.push('</br>');
      continue;
    }
    if (
      text.includes('Archetype') ||
      text.includes('Ability Points') ||
      text.includes('Unlocking will block:')
    ) {
      break;
    }
    result.push(sub(text.replace(htmlCleaner, '')));
  }

  if (result[0] === '</br>') result[0] = '';
  if (result[result.length - 1] === '</br>') result[result.length - 1] = '';

  return result.join(' ').trim();
}

async function main(): Promise<void> {
  const aspectIds = readJson<Record<string, Record<string, number>>>(
    join(MAPS_DIR, 'aspect_map.json'),
  );
  const oldAspectData = readJson<Record<string, AspectInfo[]>>(
    join(BASELINE_DIR, 'aspects.json'),
  );

  let oldApiData: Record<string, Record<string, ApiAspect> | null>;
  const oldApiPath = join(TEMP_DIR, 'api_aspects.json');
  if (existsSync(oldApiPath)) {
    const raw = readJson<Record<string, unknown>>(oldApiPath);
    oldApiData = Object.fromEntries(
      CLASSES.map((c) => [c, raw[c] != null ? normalizeAspectMap(raw[c]) : null]),
    );
  } else {
    oldApiData = Object.fromEntries(CLASSES.map((c) => [c, null]));
  }

  const apiData: Record<string, Record<string, ApiAspect>> = {};
  const aspectChanges: Record<string, string[]> = Object.fromEntries(
    CLASSES.map((c) => [c, []]),
  );
  const allOutputUnordered: Record<string, Record<string, AspectInfo>> = Object.fromEntries(
    CLASSES.map((c) => [c, {}]),
  );

  for (const wynnClass of CLASSES) {
    console.log(`Processing aspects for ${wynnClass}...`);
    const knownAspects = oldAspectData[wynnClass];
    const knownAspectMap = Object.fromEntries(
      knownAspects.map((a) => [a.displayName, a]),
    );

    const aspectData = await getAspectData(wynnClass);
    apiData[wynnClass] = aspectData;
    const oldClassData = oldApiData[wynnClass];

    const idMap = aspectIds[wynnClass];
    for (const [name, aspect] of Object.entries(aspectData)) {
      let oldTierData: AspectTier[] | null = null;
      if (name in knownAspectMap) {
        oldTierData = knownAspectMap[name].tiers;
      }

      const tierData: AspectTier[] = [];
      for (let i = 0; i < Object.keys(aspect.tiers).length; i++) {
        const data = aspect.tiers[String(i + 1)];
        const abils =
          oldTierData !== null && oldTierData.length > i
            ? oldTierData[i].abilities
            : [];
        tierData.push({
          threshold: data.threshold,
          description: stylizeDescription(data.description),
          abilities: abils,
        });
      }

      let aspectId: number;
      if (!(name in idMap)) {
        console.log(`New aspect: ${name}`);
        aspectId = Object.keys(idMap).length;
        idMap[name] = aspectId;
      } else {
        aspectId = idMap[name];
        if (oldClassData !== null) {
          if (!(name in oldClassData)) {
            console.log(`Already registered new aspect [${name}]? Likely a bug!`);
            continue;
          }
          if (jsonDiff(oldClassData[name], aspect)) {
            aspectChanges[wynnClass].push(name);
          }
        }
      }

      const aspectInfo: AspectInfo = {
        displayName: name,
        id: aspectId,
        tier: aspect.rarity[0].toUpperCase() + aspect.rarity.slice(1),
        tiers: tierData,
      };

      if (name in knownAspectMap && 'aliases' in knownAspectMap[name]) {
        aspectInfo.aliases = knownAspectMap[name].aliases;
      }

      allOutputUnordered[wynnClass][name] = aspectInfo;
    }
  }

  const allOutput: Record<string, AspectInfo[]> = Object.fromEntries(
    CLASSES.map((c) => [c, []]),
  );
  for (const wynnClass of CLASSES) {
    const knownAspects = oldAspectData[wynnClass];
    const newAspects = { ...allOutputUnordered[wynnClass] };
    for (const aspect of knownAspects) {
      const aspectName = aspect.displayName;
      if (aspectName in newAspects) {
        allOutput[wynnClass].push(newAspects[aspectName]);
        delete newAspects[aspectName];
      }
    }
    allOutput[wynnClass].push(...Object.values(newAspects));
  }

  console.log('Finished processing aspects');
  console.log('Summary of changed aspects:');
  for (const wynnClass of CLASSES) {
    console.log(wynnClass);
    console.log('---------------------');
    if (aspectChanges[wynnClass].length > 0) {
      console.log('\t' + aspectChanges[wynnClass].join('\n\t'));
    } else {
      console.log('No Changes');
    }
    console.log('---------------------');
  }

  writeJsonPretty(join(TEMP_DIR, 'api_aspects.json'), apiData);
  writeJsonPretty(join(TEMP_DIR, 'aspects.json'), allOutput);
  writeJsonPretty(join(MAPS_DIR, 'aspect_map.json'), aspectIds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
