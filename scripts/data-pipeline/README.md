# Data pipeline scripts (TypeScript)

Offline data-processing for Wynnbuilder. Replaces the former `py_script/` pipeline scripts (those Python files were removed). Ad-hoc Python utilities without ports remain in `py_script/`.

Requires Node 22+ (`--experimental-strip-types`).

## Usage

```bash
# Run one script (same args as the .ts file)
npm run data -- atree-generate-id
npm run data -- compress-json data/baseline/clean.json data/temp/out.json
npm run data -- v3-process-items data/temp/dump.json

# List available scripts
npm run data -- list

# Smoke-test all scripts locally (offline by default)
npm run data:all
npm run data:all -- --online   # also runs get-aspects, v3-process-items, item-api (API)
```

Python-style names work as aliases: `npm run data -- v3_process_items`

## Prerequisites

- `py_script/translate_mappings.json` — required by `v3-process-items.ts` (same file the Python pipeline uses)

## Scripts

| Script | Replaces |
|--------|----------|
| `v3-process-items` | `v3_process_items.py` |
| `get-aspects` | `get_aspects.py` |
| `atree-generate-id` | `atree-generateID.py` |
| `process-recipes` | `process_recipes.py` |
| `encoding-gen-const` | `encoding_gen_const.py` |
| `compress-json` | `compress_json.py` |
| `clean-json` | `clean_json.py` |
| `validate-items` | `validate.py` |
| `json-diff` | `json_diff.py` |
| `item-api` | `item_wrapper.py` |

Workflow documentation: `data/baseline/README.md`.

## Type safety

`encoding-gen-const.ts` and `v3-process-items.ts` import from `src/types/build.ts`, `src/types/item.ts`, and `src/types/ingredient.ts`. Output is validated in `lib/validate-output.ts` before writing to `data/temp/`.
