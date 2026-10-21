# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web-based world-map editor for 3D open-world games. You draw maps in 2D,
preview them in 3D (including first-person walk mode), and save them on the PC
as `.wmap.json`, with game-ready exports. A Python server on the PC serves the
editor, so a tablet on the same Wi-Fi can use it too.

## Commands

```
run.bat                                  # start the server (same as below)
.venv\Scripts\python.exe -m server       # http://localhost:8765, LAN URLs printed for the tablet
set MAPCREATOR_PORT=8770                 # other port (8000 is taken by another app on this PC)
```

- **No build, linter or test suite.** The frontend is plain ES modules loaded via an import map. JS changes only need a browser reload. Python changes need a server restart (no auto-reload).
- **Syntax-check JS:** `node --check web/js/<file>.js`.
- **Headless logic tests in Node:** `model.js`, `terrain.js`, `navigation.js` and `decorate.js` don't import three.js, so a Node script can import them by `file:///F:/projects/map_creator/web/js/...` URL. Use this to generate maps and check walkability stats or round-trips. `textures.js`, `view3d.js`, `shapes3d.js`, `grass.js` and `walk.js` need a browser.
- **Python exporter smoke test:** `from server import exporter` → `exporter.validate(doc)`, `exporter.export_package(doc)`, `exporter.render_preview(exporter.decode_terrain(doc))`. Rendering a preview PNG is the quickest way to eyeball terrain changes.
- **Browser testing:** Playwright is *not* a project dependency. Install it outside the repo and drive installed Edge with `p.chromium.launch(channel='msedge', args=['--enable-unsafe-swiftshader', '--use-angle=swiftshader'])`, which WebGL needs in headless mode. The page exposes `window.mapCreator = { app, editor, view3d, history }` for scripting.
- **Blender importer (Blender 5.2 is installed):** `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python tools\blender_import_wmap.py -- maps\<id>.wmap.json --save out.blend`
- **Dependencies:** `requirements.txt` (fastapi, uvicorn, numpy, pillow) in the existing `.venv` (Python 3.12). three.js r170 is vendored in `web/vendor/three/` (OrbitControls and GLTFExporter only). Addons import the bare specifier `three`, which the import map in `index.html` resolves.

Don't leave a background server running when you finish. It holds port 8765, and the user's `run.bat` then exits saying Map Creator is already running.

## Coordinate and data conventions

These hold across every module, the server and the Blender importer:

- Terrain is a `width × height` grid of samples. Sample `(i, j)` is at world `(i*cellSize, j*cellSize)`, so world size is `(width-1)*cellSize`.
- `heights` are normalized 0..1 (Float32), and world height = `h * heightScale`. `seaLevel` is normalized too. `biomes` is one byte per sample, an id into `biomePalette`.
- Object, path and region coordinates are **world units**, with 2D `x` east and `y` **south**, origin at the north-west corner.
- 3D is X east, Y up, **Z = map y (south)**.
- `rotation` is degrees clockwise from north. As a Y-up yaw it's `-radians(rotation)`.
- In the editor, the 2D view's screen↔world mapping puts sample centres at `+0.5` cell (`Editor2D.w2s` / `s2w`).
- Walkability depends mostly on **max height relative to world width**. 120 m peaks on a 500 m world come out ~25% cliff, while 2 km worlds with ~180 m peaks are mostly walkable. Defaults were chosen for this.

## Architecture

**The file format is the contract.** [docs/FORMAT.md](docs/FORMAT.md) is the spec for `.wmap.json`: base64 little-endian arrays, `format: "worldmap"`, `version: 1`, and optional fields may be added within a version. Readers live in three places, which must stay in sync:
- `WorldMap.toJSON` / `fromJSON` in `web/js/model.js`
- `decode_terrain` and the rest of `server/exporter.py`
- `tools/blender_import_wmap.py`

**Object `deck`s:** a catalog entry can list `deck` segments in shape units: bridge, port, airport and train station. Resolve them to world space with `objectDecks(o)`. Four places depend on them:
- `navigation.js`: they count as road in the walkability grid, even over water.
- `walk.js`: `floor()` lets you stand on them.
- `editor2d.js`: their footprints are drawn in 2D, and `levelUnderSelected` flattens, paves and clears plants under the `level: true` ones.
- `shapes3d.js`: the 3D models must match the deck geometry.

**Duplicated data:**
- `model.js` is the only full catalog: `OBJECT_TYPES` (with collision radius `r`), `PATH_TYPES` (`guide` = terrain-shaping lines like `ridge`/`rift` that aren't drawn in 3D, `virtual` = route lines), `REGION_TYPES`, `DEFAULT_BIOMES` and `NAV_DEFAULTS`.
- Python copies: the `NATURE` set in the Blender importer, and `WALK_LEGEND` in the exporter, which mirrors `NAV_LEGEND` in `navigation.js`.
- Code looks up biomes by palette **`key`**, never by hard-coded id, because palettes can be customised per map.

**The app hub is `main.js`.** It builds the `app` object that `Editor2D`, `View3D` and `History` call back into:
- `terrainChanged(rect, final)` and `entitiesChanged(live)`. `live` means mid-drag: refresh 3D but don't rebuild panels.
- `selectionChanged`, `draftChanged`, `afterHistoryApply` and `walkChanged`.

All UI (panels, modals, shortcuts, autosave) is DOM built with the small `h()` helper in `main.js`. There's no framework.

**Every edit must go through `History` (`history.js`).** An entry can combine:
- `terrain`: a rect patch of before/after heights and biomes. Snapshot `heights`/`biomes` before the edit, then `extractPatch(map, snapshot, rect)`.
- `changes`: per-entity before/after clones. Usually done with `history.entities(label, track => { track(coll, id); mutate })`; newly added entities are detected automatically.
- `settings`: plain fields `Object.assign`ed onto the map (`seaLevel`, `meta`, `navigation`…).

Resizing a map isn't supported, because patches assume fixed dimensions.

**Terrain algorithms (`terrain.js`):**
- Noise, generator (`generateHeights`, with `GEN_DEFAULTS.plains` controlling lowland flatness), erosion, `autoBiomes`, and `shadeRegion` (the 2D hillshaded image).
- `applyDab`: drag brushes, including `land`/`water`/`beach`, which call `fixCoastBiome` so biomes follow the water line.
- `applyStamp`: one-shot landforms listed in `STAMPS`. Brush-mode names and stamp names share one namespace in `editor.brush.mode`; `Editor2D._strokeStart` treats any mode in `STAMPS` as a stamp. That's why the beach stamp is `beach_stamp`.
- `shapeAlongPath` (mountain ranges / rifts) and `carvePath` (roads / rivers).
- Raises use `softAdd` to ease into the 1.0 ceiling instead of clamping flat.

**2D editor (`editor2d.js`):**
- An offscreen canvas holds one pixel per sample, updated by dirty rects. Vector overlays (paths, regions, objects as cached emoji icons) are drawn every frame on top.
- Input is Pointer Events. Two touches always pinch/pan; a second finger cancels and reverts an in-progress stroke. Once a pen is seen, "stylus mode" makes fingers navigate only.
- The walkability overlay comes from `navigation.computeWalkGrid`, which is the **only** walkability implementation. The client sends the grid to the server on export, and the server writes `walkmap.png`.

**3D view (`view3d.js`):**
- Initialized lazily the first time it's shown. Rebuilds are throttled. It renders on demand, except continuously in walk mode or with "animate water" on.
- The terrain is a `MeshStandardMaterial` patched with `onBeforeCompile`. It blends a `DataArrayTexture` of procedural biome textures with an R8 per-sample layer map (`unpackAlignment = 1` is required) using height-based blending, plus triplanar rock on steep slopes, a snow line and lava glow.
  - `textures.js` generates the array and tints each layer to its palette colour, cached per palette.
  - The last layer is pure noise, used by the shader.
- Objects are one `InstancedMesh` per (type, shape part) from `shapes3d.js`. Shape geometries are shared (`userData.keepGeometry`), and per-instance colour gives variety.
- Grass (`grass.js`) is regenerated around the camera with deterministic hashing.
- `walk.js` handles physics, collisions with objects (radius `r`) and walls, the slope limit from `map.navigation`, and the HUD. While it's active, `main.js` ignores its own keyboard shortcuts.
- The orbit camera is clamped above the ground and sea.

**Server (`server/`):**
- `app.py` (FastAPI) serves `web/` with `Cache-Control: no-cache`, so tablets get fresh code.
- Storage:
  - Maps: `maps/<id>.wmap.json`, written via a temp file and atomic replace, plus a `.thumb.png`.
  - Rolling backups: `maps/.backups/<id>/` (last 15).
  - Deletes move files to `maps/.trash/`.
- Map ids must match `^[a-z0-9][a-z0-9_-]{0,63}$`.
- `POST /api/maps/{id}/export` builds the zip in `exporter.py` (GLB written by hand with numpy, 16-bit PNG/RAW heightmaps, splat maps, baked `entities.json`). It writes both `exports/<id>.zip` and the unpacked `exports/<id>/`.
- `__main__.py` detects an occupied port and says whether it's already Map Creator.
- `mapinfo.py` generates `maps/<id>.README.md` from the map on every save, and puts it in export zips too. Narrative text comes from `description` props and the optional `maps/<id>.descriptions.json` (`overview` / `zones` / `places`, keyed by name). Regenerate by hand with `python -m server.mapinfo maps\<id>.wmap.json`. It must stay fast (well under a second on a 1024² map), because it runs inside the save request.
- Env overrides: `MAPCREATOR_PORT`, `MAPCREATOR_MAPS`, `MAPCREATOR_EXPORTS`.

**Persistence in the browser** is only a crash-recovery draft in IndexedDB (`api.js`) plus UI preferences in `localStorage` (`mc:*` keys). The PC copy is the source of truth.
