# py_script

Most pipeline scripts were migrated to `scripts/data-pipeline/` (run via `npm run data -- <script>`). See `data/baseline/README.md` for the main workflow.

## Remaining Python scripts (no TypeScript port)

| Script | Purpose |
|--------|---------|
| `get.py` | Legacy Wynncraft API fetcher (predates v3 pipeline) |
| `get_atree.py` | Ad-hoc fetch/patch of atree_constants from API |
| `yaml_to_json.py` / `json_to_yaml.py` | Generic format converters |
| `parse_log.py` | One-off historical changelog parser |
| `research/plot_dps.py` | DPS analysis / plot_dps debug data |
| `research/skillpoint_test.py` | Skillpoint optimizer prototype |

## Shared data

`translate_mappings.json` in this directory is used by `npm run data -- v3-process-items`.
