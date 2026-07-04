#!/usr/bin/env node
/**
 * Process raw recipe data from the Wynncraft API.
 *
 * Usage: node --experimental-strip-types scripts/data-pipeline/process-recipes.ts <infile> <outfile>
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MAPS_DIR } from './lib/paths.ts';
import { readJson, writeJsonPretty } from './lib/json-io.ts';

const [, , infile, outfile] = process.argv;
if (!infile || !outfile) {
  console.error('Usage: process-recipes.ts <infile> <outfile>');
  process.exit(1);
}

type Recipe = Record<string, unknown> & { name: string; id?: number };
type RecipeData = { recipes: Recipe[] };

const recipeData = readJson<RecipeData>(infile);
const recipes = recipeData.recipes;

const recipeMapPath = join(MAPS_DIR, 'recipe_map.json');
let recipeMap: Record<string, number>;
if (existsSync(recipeMapPath)) {
  recipeMap = readJson(recipeMapPath);
} else {
  recipeMap = Object.fromEntries(recipes.map((r, i) => [r.name, i]));
}

const recipeTranslateMappings: Record<string, string> = {
  level: 'lvl',
  id: 'name',
};

for (const recipe of recipes) {
  for (const [k, v] of Object.entries(recipeTranslateMappings)) {
    if (k in recipe) {
      recipe[v] = recipe[k];
      delete recipe[k];
    }
  }
  if (!(recipe.name in recipeMap)) {
    recipeMap[recipe.name] = Object.keys(recipeMap).length;
    console.log(`New Recipe: ${recipe.name}`);
  }
  recipe.id = recipeMap[recipe.name];
}

writeJsonPretty(recipeMapPath, recipeMap);
writeJsonPretty(outfile, recipeData);
