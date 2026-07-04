#!/usr/bin/env node
/**
 * Compile ability trees: assign numeric IDs, replace string cross-references,
 * validate graph geometry, and write minified JSON outputs.
 *
 * Usage: node --experimental-strip-types scripts/data-pipeline/atree-generate-id.ts
 */
import { join } from 'node:path';
import { BASELINE_DIR, TEMP_DIR } from './lib/paths.ts';
import { readJson, writeJsonMinified, writeJsonPretty } from './lib/json-io.ts';

type JsonObj = Record<string, unknown>;
type Abil = JsonObj & {
  display_name: string;
  id?: number;
  display?: { row: number; col: number; icon: string };
  cost?: number;
  parents?: number[];
  dependencies?: number[];
  blockers?: number[];
  base_abil?: number;
  effects?: JsonObj[];
};

function translateSpellPart(idData: Record<string, number>, part: JsonObj): void {
  if ('hits' in part && part.hits && typeof part.hits === 'object') {
    const hitsMapping = part.hits as Record<string, unknown>;
    for (const k of Object.keys(hitsMapping)) {
      const v = hitsMapping[k];
      if (typeof v === 'string') {
        const [abilId, propname] = v.split('.');
        hitsMapping[k] = `${idData[abilId]}.${propname}`;
      }
    }
  }
  if ('mana_gained' in part) {
    const val = part.mana_gained;
    if (typeof val === 'string') {
      const [abilId, propname] = val.split('.');
      part.mana_gained = `${idData[abilId]}.${propname}`;
    }
  }
}

function translateEffect(idData: Record<string, number>, effect: JsonObj): void {
  if (effect.type === 'raw_stat') {
    for (const bonus of (effect.bonuses as JsonObj[]) ?? []) {
      if ('abil' in bonus && typeof bonus.abil === 'string' && bonus.abil in idData) {
        bonus.abil = idData[bonus.abil];
      }
      if ('value' in bonus) {
        const val = bonus.value;
        if (typeof val === 'string') {
          const [abilId, propname] = val.split('.');
          bonus.value = `${idData[abilId]}.${propname}`;
        }
      }
    }
  } else if (effect.type === 'replace_spell') {
    for (const part of (effect.parts as JsonObj[]) ?? []) {
      translateSpellPart(idData, part);
    }
  } else if (effect.type === 'add_spell_prop') {
    translateSpellPart(idData, effect);
  } else if (effect.type === 'stat_scaling') {
    if ('inputs' in effect) {
      for (const input of (effect.inputs as JsonObj[]) ?? []) {
        if ('abil' in input && typeof input.abil === 'string' && input.abil in idData) {
          input.abil = idData[input.abil];
        }
      }
    }
    if ('output' in effect) {
      const output = effect.output;
      if (Array.isArray(output)) {
        for (const o of output) {
          if ('abil' in o && typeof o.abil === 'string' && o.abil in idData) {
            o.abil = idData[o.abil];
          }
        }
      } else if (output && typeof output === 'object') {
        const o = output as JsonObj;
        if ('abil' in o && typeof o.abil === 'string' && o.abil in idData) {
          o.abil = idData[o.abil];
        }
      }
    }
    for (const key of ['scaling', 'max', 'slider_max', 'slider_max_mult'] as const) {
      if (!(key in effect)) continue;
      const val = effect[key];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (typeof val[i] === 'string') {
            const [abilId, propname] = (val[i] as string).split('.');
            val[i] = `${idData[abilId]}.${propname}`;
          }
        }
      } else if (typeof val === 'string') {
        const [abilId, propname] = val.split('.');
        effect[key] = `${idData[abilId]}.${propname}`;
      }
    }
  }
}

function translateAbil(
  idData: Record<string, number>,
  abil: Abil,
  tree = true,
): void {
  function translate(path: (string | number)[], ref: number): void {
    let refDict: unknown = abil;
    for (const x of path) {
      refDict = (refDict as JsonObj)[x as string];
    }
    const arr = refDict as unknown[];
    const key = arr[ref];
    if (typeof key === 'string' && key in idData) {
      arr[ref] = idData[key];
    }
  }

  for (const optionalKey of ['parents', 'dependencies', 'blockers'] as const) {
    if (!(optionalKey in abil)) {
      if (tree) console.log(`WARNING: atree node missing required key [${optionalKey}]`);
      continue;
    }
    const refs = abil[optionalKey] as unknown[];
    for (let ref = 0; ref < refs.length; ref++) {
      translate([optionalKey], ref);
    }
  }

  if ('base_abil' in abil && typeof abil.base_abil === 'string') {
    if (abil.base_abil in idData) {
      abil.base_abil = idData[abil.base_abil];
    }
  }

  if (!('effects' in abil)) {
    console.log("WARNING: abil missing 'effects' tag");
    console.log(abil);
    abil.effects = [];
  }
  for (const effect of abil.effects ?? []) {
    translateEffect(idData, effect);
  }
}

function translateAll(
  idData: Record<string, Record<string, number>>,
  atreeData: Record<string, Abil[]>,
): void {
  for (const [_class, info] of Object.entries(atreeData)) {
    for (const abil of info) {
      abil.id = idData[_class][abil.display_name];
      translateAbil(idData[_class], abil);
    }
  }
}

function getPathPositions(
  parent: Abil,
  child: Abil,
): Array<[number, number]> {
  const childR = child.display!.row;
  const childC = child.display!.col;
  const parentR = parent.display!.row;
  const parentC = parent.display!.col;
  const positions: Array<[number, number]> = [];
  if (childC !== parentC) {
    let fillDirection = -1;
    if (childC < parentC) fillDirection = 1;
    for (let col = childC; col !== parentC; col += fillDirection) {
      positions.push([parentR, col]);
    }
  }
  positions.reverse();
  if (childR === parentR) {
    return positions.slice(0, -1);
  }
  for (let row = parentR + 1; row < childR; row++) {
    positions.push([row, childC]);
  }
  return positions;
}

function validateAtreeGraph(atree: Abil[]): void {
  const abilLookup: Record<number, Abil> = {
    998: { display_name: 'elemental master' } as Abil,
    999: { display_name: 'melee' } as Abil,
  };

  for (const abil of atree) {
    const abilName = abil.display_name;
    let fatalErr = false;
    if (!abil.display) {
      console.log(`ERROR: '${abilName}' missing 'display'`);
      fatalErr = true;
    } else {
      for (const field of ['row', 'col', 'icon'] as const) {
        if (!(field in abil.display!)) {
          console.log(`ERROR: '${abilName}'.display missing '${field}'`);
          fatalErr = true;
        }
      }
      const abilIcon = abil.display!.icon;
      if (abil.cost === 1) {
        if (['node_2', 'node_3', 'node_4'].includes(abilIcon)) {
          console.log(
            `WARNING: '${abilName}' is a different cost than standard, should be 2 if icon is '${abilIcon}'`,
          );
        }
      } else if (abil.cost === 2) {
        if (['node_0', 'node_1'].includes(abilIcon)) {
          console.log(
            `WARNING: '${abilName}' is a different cost than standard, should be 1 if icon is '${abilIcon}'`,
          );
        }
      }
    }
    if (!('parents' in abil)) {
      console.log(`ERROR: '${abilName}' missing 'parents'`);
      fatalErr = true;
    }
    if (fatalErr) {
      console.log('Not adding ability to lookup -- it is fatally malformed.');
      continue;
    }
    abilLookup[abil.id!] = abil;
  }

  const abilNodePositions: Record<string, Abil[]> = {};
  for (const abil of atree) {
    if (!(abil.id! in abilLookup)) continue;
    const pos = `${abil.display!.row},${abil.display!.col}`;
    (abilNodePositions[pos] ??= []).push(abil);
  }

  const abilPathEdges: Record<string, Set<string>> = {};

  console.log('Validation Pass 1');
  for (const abil of atree) {
    const abilName = abil.display_name;
    const abilId = abil.id!;
    if (!(abilId in abilLookup)) {
      console.log(`Skipping '${abilName}'`);
      continue;
    }

    for (const listName of ['parents', 'dependencies', 'blockers'] as const) {
      if (!(listName in abil)) {
        console.log(`WARNING: '${abilName}' missing '${listName}'`);
        continue;
      }
      for (const target of abil[listName] ?? []) {
        if (!(target in abilLookup)) {
          console.log(
            `WARNING: '${abilName}'.${listName} contains unrecognized ability '${target}'`,
          );
        }
      }
    }
    if ('base_abil' in abil && !(abil.base_abil! in abilLookup)) {
      console.log(`ERROR: '${abilName}' has unrecognized base ability ${abil.base_abil}`);
    }

    const abilR = abil.display!.row;
    const abilC = abil.display!.col;

    for (const target of abil.parents ?? []) {
      if (!(target in abilLookup)) {
        console.log(`ERROR: '${abilName}'.parents contains unrecognized ability '${target}'`);
        continue;
      }
      const parent = abilLookup[target];
      const parentName = parent.display_name;
      const parentR = parent.display!.row;
      if (abilR < parentR) {
        console.log(`ERROR: '${abilName}' is above parent '${parentName}'`);
        continue;
      }
      if (abilR === parentR) {
        if (!(parent.parents ?? []).includes(abilId)) {
          console.log(
            `WARNING: parent of '${abilName}' ('${parentName}') has same row but no path`,
          );
        }
        if (abilC === parent.display!.col) {
          for (const otherTarget of abil.parents ?? []) {
            const otherParent = abilLookup[otherTarget];
            if (target === otherParent.id) continue;
            if (
              otherParent.display!.row === parentR &&
              (otherParent.parents ?? []).includes(target)
            ) {
              console.log(
                `WARNING: '${otherParent.display_name}' to '${abilName}' goes through parent '${parentName}', check '${abilName}'`,
              );
            }
          }
        }
      }

      const pathPositions = getPathPositions(parent, abil);
      for (const [r, c] of pathPositions) {
        const pos = `${r},${c}`;
        if (pos in abilNodePositions) {
          for (const blockingAbil of abilNodePositions[pos]) {
            const blockingId = blockingAbil.id!;
            if (blockingId === abilId || blockingId === parent.id) continue;
            console.log(
              `ERROR: path from '${parentName}' to '${abilName}' passes through node '${blockingAbil.display_name}'`,
            );
          }
        }
      }
      for (const [r, c] of pathPositions) {
        const pos = `${r},${c}`;
        const edge = `${abilId},${parent.id}`;
        (abilPathEdges[pos] ??= new Set()).add(edge);
      }
    }
  }

  for (const [pos, abils] of Object.entries(abilNodePositions)) {
    if (abils.length > 1) {
      const names = abils.map((a) => `'${a.display_name}'`).join(', ');
      console.log(`ERROR: Position ${pos} has multiple abilities! [${names}]`);
    }
  }

  console.log('Validation Pass 2');
  for (const abil of atree) {
    const abilName = abil.display_name;
    const abilId = abil.id!;
    if (!(abilId in abilLookup)) continue;

    const abilR = abil.display!.row;
    const warnedParents = new Set<number>();
    for (const target of abil.parents ?? []) {
      if (!(target in abilLookup)) continue;
      const parent = abilLookup[target];
      if (abilR < parent.display!.row) continue;

      for (const [r, c] of getPathPositions(parent, abil)) {
        const pos = `${r},${c}`;
        if (pos in abilNodePositions) continue;
        for (const edge of abilPathEdges[pos] ?? []) {
          const [edgeChildId, edgeParentId] = edge.split(',').map(Number);
          if (edgeChildId !== abilId) continue;
          if (edgeParentId === parent.id) continue;
          if (
            !(abil.parents ?? []).includes(edgeParentId) &&
            !warnedParents.has(edgeParentId)
          ) {
            const pathParent = abilLookup[edgeParentId];
            console.log(
              `ERROR: '${abilName}' is connected to '${pathParent.display_name}' visually but not in code`,
            );
            warnedParents.add(edgeParentId);
          }
        }
      }
    }
  }
}

function validateAtreeData(atreeData: Record<string, Abil[]>): void {
  for (const [_class, info] of Object.entries(atreeData)) {
    console.log(`Validate tree for class ${_class}`);
    validateAtreeGraph(info);
  }
}

function main(): void {
  const abilDict: Record<string, Record<string, number>> = {};
  const data = readJson<Record<string, Abil[]>>(join(BASELINE_DIR, 'atree_constants.json'));

  for (const [classType, info] of Object.entries(data)) {
    let id = 0;
    abilDict[classType] = {};
    for (const abil of info) {
      abilDict[classType][abil.display_name] = id;
      id += 1;
    }
  }

  writeJsonPretty(join(TEMP_DIR, 'atree_ids.json'), abilDict, 4);

  translateAll(abilDict, data);
  validateAtreeData(data);

  const majIdDat = readJson<Record<string, JsonObj>>(join(BASELINE_DIR, 'major_ids_clean.json'));
  for (const v of Object.values(majIdDat)) {
    for (const abil of (v.abilities as Abil[]) ?? []) {
      const clazz = abil.class as string;
      translateAbil(abilDict[clazz], abil, false);
    }
  }
  writeJsonMinified(join(TEMP_DIR, 'major_ids_min.json'), majIdDat);

  const aspectDat = readJson<Record<string, JsonObj[]>>(join(BASELINE_DIR, 'aspects.json'));
  for (const [clazz, aspects] of Object.entries(aspectDat)) {
    for (const aspect of aspects) {
      for (const aspectTier of (aspect.tiers as JsonObj[]) ?? []) {
        for (const abil of (aspectTier.abilities as Abil[]) ?? []) {
          translateAbil(abilDict[clazz], abil, false);
        }
      }
    }
  }
  writeJsonMinified(join(TEMP_DIR, 'aspects_min.json'), aspectDat);
  writeJsonMinified(join(TEMP_DIR, 'atree_constants_min.json'), data);
}

main();
