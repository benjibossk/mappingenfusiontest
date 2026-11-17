# Pak tools (offline, no Workbench)

Node/Python scripts used to build `library/prefabs-catalogue.json`, `library/prefabs-captions.json` and `library/mods/*.json`
from the game and Workshop `.pak` files (read-only):

- `pak.js`, `idx.js`, `modidx.js`, `peek.js`, `xh.js`: read Enfusion `.pak` archives and index their files.
- `dims.js`: real prefab dimensions from the `.xob` header bounding box (`FORM....XOB9` / `HEAD`, 6 floats at byte 24).
- `edds.js`, `topng.py`, `shrink.py`, `mont.py`, `map.js`, `ancestors.js`: extract and decode `UI/Textures/EditorPreviews` thumbnails (`.edds` = DDS header + COPY/LZ4 mips, BC1/BC7/BGRA).
- `modreg.js`: mod prefab registries (`library/mods/`), GUIDs from `resourceDatabase.rdb`.
- `import-shots.js`: import screenshots made by the MG_PrefabShots plugin into the thumbnails.

Paths inside the scripts point to the author's machine and scratch folders: edit them before running.
Never copy mod or game assets into this repo: only metadata (paths, GUIDs, dimensions).
