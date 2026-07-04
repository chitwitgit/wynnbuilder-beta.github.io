import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root (directory containing package.json). */
export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export const DATA_DIR = join(REPO_ROOT, 'data');
export const BASELINE_DIR = join(DATA_DIR, 'baseline');
export const TEMP_DIR = join(DATA_DIR, 'temp');
export const MAPS_DIR = join(BASELINE_DIR, 'maps');

/** Legacy location for translate_mappings.json (still used by the item pipeline). */
export const TRANSLATE_MAPPINGS_PATH = join(REPO_ROOT, 'py_script', 'translate_mappings.json');
