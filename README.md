# Map Creator

A web-based world map editor for your games. You draw maps in 2D (on the PC
or a tablet), preview them in 3D, and save them on this PC in a documented
format with game-ready exports.

## Start it

Double-click **`run.bat`**, or run:

```
.venv\Scripts\python.exe -m server
```

It prints the addresses:

```
On this PC:      http://localhost:8765
On your tablet:  http://192.168.x.x:8765
```

**Tablet:** connect it to the same Wi-Fi as the PC and open the "On your tablet"
address. The first time you start the server, Windows asks whether Python may use
the network. Allow it on **Private networks**. On iPad or Android you can use
*Share → Add to Home Screen* so it opens full screen like an app.

Port 8765 is the default because another program on this PC uses 8000. To use a
different port: `set MAPCREATOR_PORT=9000` before starting.

## Where things are saved

| what | where |
|---|---|
| maps | `maps/<id>.wmap.json` (+ `.thumb.png`) |
| map info | `maps/<id>.README.md`: zones, settlements, landmarks, travel, seasons. Rebuilt on every save and included in exports. Add written descriptions in `maps/<id>.descriptions.json` or as `description` properties in the editor |
| previous versions | `maps/.backups/<id>/` (the last 15 saves) |
| deleted maps | `maps/.trash/` |
| game exports | `exports/<id>/` and `exports/<id>.zip` |

The browser also keeps a crash-recovery copy of unsaved work. Saving to the PC
happens automatically every 2 minutes once a map has been saved once (you can
turn this off under *Layers & display*).

## Tools

| key | tool | |
|---|---|---|
| 1 | Select | tap to select, drag to move, box-select objects, reshape paths/regions with handles |
| 2 | Pan | or two fingers / right mouse / space+drag / wheel |
| 3 | Sculpt | **Land / Water / Beach** brushes (paint land out of the sea, cut bays and lakes, make beaches; biomes follow the water line automatically); raise, lower, smooth, flatten, set height, roughen, terrace; tap-to-stamp island, mountain, hill, plateau, crater, volcano, desert, sand dunes, beach; whole-map smooth and erosion |
| 4 | Paint | biomes (grass, forest, desert, snow…); auto-paint biomes from terrain |
| 5 | Place | buildings, settlements, ports, airports, train stations, spawns, NPCs, quest givers, chests, portals…; **Level the ground here** flattens, paves and clears the site under an airport, station or port |
| 6 | Scatter | brush-paint forests and rocks, or erase them |
| 7 | Paths | roads, trails, train lines, rivers, streams, walls, fences, quest routes; carve them into the terrain (train lines get a gently graded track bed). Draw a **Mountain Range** or **Rift / Canyon** line and press Apply to shape whole landscapes |
| 8 | Regions | named areas, quest zones, level zones, spawn areas, safe zones, factions |

Other shortcuts: `Ctrl+Z` / `Ctrl+Y` undo / redo, `Ctrl+S` save, `Ctrl+D`
duplicate, `Del` delete, `Enter` finish a path, `Esc` cancel, `[` `]` brush
size, `F` fit the map, `Tab` cycles 2D / split / 3D.

With a stylus, the pen draws and fingers pan and zoom (palm-friendly), and pen
pressure controls brush strength.

**Generate** builds terrain from noise: island, continent, archipelago, inland
or valley. It has erosion, automatic biomes and vegetation, and a live preview.
The **Plains** slider flattens the lowlands so most land is walkable.

**World scale:** walkability depends mostly on max height compared to world
width. For open worlds, keep max height under about 12% of the width. For
example, a 2 km world (512 cells × 4 m) with 180 m peaks is mostly walkable,
with real mountains. The New map dialog warns you when a map will be steep.

## 3D view and walk mode

The 3D view uses a texture for every biome (grass, forest floor, sand, rock,
snow, cobblestone, glowing lava…). Biomes blend smoothly into each other, steep
slopes turn into rock cliffs, and you can add a snow line. Plants and buildings
are low-poly models, and grass grows around the camera. Turn these on or off
under *Layers & display → 3D view*.

Press **🚶** in the 3D view to walk around in first person. Walking starts at the
selected object, the Player Spawn, or the centre of the view.

* PC: click to look around, **WASD** to move, **Shift** to run, **Space** to jump, **F** to fly (**C** to go down), **Esc** to leave.
* Tablet: move with the left stick, drag anywhere else to look, and use the jump, run and fly buttons.

You can't climb slopes steeper than the map's max walk slope. You collide with
trees, rocks, buildings and walls, and you swim in deep water. A banner shows
the name of each region you walk into.

## Walkability

*Layers & display → Walkable areas* colours the 2D map: walkable ground, roads,
shallow and deep water, cliffs, obstacles and blocked areas, with percentages.
The rules (max slope, max wading depth) are in *Map settings* and are saved with
the map. Exports include `walkmap.png` for your game's AI and navmesh.

Every object, path, region and the map itself has **game properties** (free
key/value pairs). Gameplay objects come with useful defaults: a portal has
`targetMap` and `targetSpawn`, an enemy spawn has `enemy`, `count` and `level`.
Use portals to link your main world to quest worlds and dungeons.

## Using maps in a game

See **[docs/FORMAT.md](docs/FORMAT.md)** for the file format and the export
package (glTF mesh, 16-bit heightmap, Unity RAW, splat maps, entities with 3D
positions).

**Blender:** `tools/blender_import_wmap.py` imports a `.wmap.json` with the
terrain, biome colours, water, vegetation point clouds, gameplay empties with
custom properties, and path and region curves. Install it as an add-on
(File > Import > World Map), or run it from the command line:

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --python tools\blender_import_wmap.py -- maps\my_world.wmap.json
```

## Project layout

```
server/        FastAPI server (storage, thumbnails, backups, export builder)
web/           the editor (plain ES modules, no build step; three.js vendored)
  js/model.js      format, biome palette, object catalog
  js/terrain.js    noise, generation, erosion, brushes, shading
  js/editor2d.js   2D canvas, input, tools
  js/view3d.js     3D preview (sky, textured terrain shader, water, models)
  js/textures.js   procedural biome textures
  js/shapes3d.js   low-poly tree / rock / building models
  js/grass.js      grass around the camera
  js/walk.js       first-person walk mode
  js/navigation.js walkability grid
  js/main.js       UI, dialogs, saving
tools/         Blender importer
docs/          format specification
```
