# World map format (`.wmap.json`), version 1

One map is one UTF-8 JSON file. It is the source of truth for the editor and
the file your game should load. Everything in the export package is derived
from it.

## Coordinates

* 2D: origin at the **north-west corner**, `x` grows **east**, `y` grows **south**.
* All object/path/region coordinates are in **world units** (1 unit = 1 metre in most engines).
* Terrain sample `(i, j)` sits at world `(i * cellSize, j * cellSize)`.
  World size = `(width - 1) * cellSize` × `(height - 1) * cellSize`.
* 3D (glb / `entities.json`): **X = east, Y = up, Z = south** (glTF convention).
  In Blender (Z-up) the importer uses X = east, Y = north (−y), Z = up.
* `rotation` is in degrees, clockwise when seen from above; 0 = facing north.
  As a Y-up yaw: `rotationY = -radians(rotation)`.

## Top level

```jsonc
{
  "format": "worldmap",          // always this string
  "version": 1,
  "meta": {
    "id": "elderwood",           // file name, [a-z0-9_-]
    "name": "Elderwood",
    "kind": "world",             // world | quest | dungeon | town | arena | other
    "description": "", "author": "", "tags": [],
    "created": "2026-10-21T10:00:00Z", "modified": "…",
    "seed": 1337                 // last generator seed
  },
  "terrain": { … },
  "objects": [ … ],
  "paths": [ … ],
  "regions": [ … ],
  "properties": { },             // free-form map properties (music, weather…)
  "navigation": {                // walkability rules (optional, defaults shown)
    "maxSlopeDeg": 40,           // steeper ground is a cliff
    "maxWadeDepth": 0.8,         // deeper water means swimming
    "eyeHeight": 1.7             // first-person camera height used by walk mode
  }
}
```

## `terrain`

| field | meaning |
|---|---|
| `width`, `height` | number of height samples per row / column |
| `cellSize` | world units between samples |
| `heightScale` | world height of a normalized height of 1.0 |
| `seaLevel` | normalized (0..1) water level. World Y = `seaLevel * heightScale` |
| `heights` | `{"encoding": "base64-f32le", "data": "…"}` — `width*height` little-endian float32, row-major (row 0 = north), values 0..1 |
| `biomes` | `{"encoding": "base64-u8", "data": "…"}` — `width*height` bytes, biome id per sample |
| `biomePalette` | `[{"id": 3, "key": "grassland", "name": "Grassland", "color": "#7fae4e"}, …]` |

World height at sample (i, j) = `heights[j * width + i] * heightScale`.
Between samples, interpolate bilinearly (that is what the editor does).

Default biome ids: 0 deep_water, 1 shallow_water, 2 beach, 3 grassland,
4 forest, 5 jungle, 6 swamp, 7 farmland, 8 dirt, 9 desert, 10 savanna, 11 rock,
12 snow, 13 tundra, 14 volcanic, 15 lava, 16 paved, 17 corrupted. Always read
`biomePalette` instead of hard-coding these.

## `objects`

```jsonc
{
  "id": "o_mvhq7s5n1kp14i",  // unique, stable
  "type": "portal",          // see catalog in web/js/model.js
  "name": "To the Crypt",    // optional label
  "x": 312.5, "y": 120.0,    // world units
  "rotation": 90,            // degrees, clockwise from north
  "scale": 1.0,
  "elevation": 0,            // offset above the ground
  "props": { "targetMap": "crypt", "targetSpawn": "start" },
  "auto": true               // only present on auto-placed vegetation
}
```

Gameplay types come with default `props` you can extend freely:
`player_spawn {spawnId}`, `enemy_spawn {enemy, count, level, respawnSeconds}`,
`boss`, `npc {npcId, dialogue}`, `quest_giver {npcId, questId}`, `merchant {shopId}`,
`chest {lootTable}`, `resource {resource, amount}`, `portal / dungeon_entrance / cave {targetMap, targetSpawn}`,
`waypoint {waypointId}`, `sign {text}`, `trigger {event, radius}`.

**Linking worlds:** a `portal` with `props.targetMap = "crypt"` and
`props.targetSpawn = "start"` should load `crypt.wmap.json` and put the player
at the `player_spawn` whose `props.spawnId == "start"`.

## `paths`

```jsonc
{ "id": "p_…", "type": "road", "name": "King's Road", "width": 4,
  "closed": false, "points": [[x, y], [x, y], …], "props": {} }
```

Types: `road`, `trail`, `river`, `stream`, `wall`, `fence`, `cliff_edge`,
`railway` (train line, standard gauge; `props.lineId`, `props.speedKmh`),
`route` (a virtual line for patrols / quest routes; not drawn in 3D).
River points run downstream.

`ridge` (mountain range, `props.height`) and `rift` (canyon, `props.depth`) are
*terrain guides*: they shape the heightmap when you press Apply in the editor and
are kept in the file so you can see where they were. Games can ignore them.

## Transport hubs and walkable decks

`port`, `airport` and `train_station` have `props.targetMap` / `targetSpawn`,
so they can work as travel links between worlds (like `portal`). Their layout
at `rotation` 0, with `s = size × scale` (default size: port 40, airport 160,
station 24):

| type | layout (x east, z south, multiples of `s`, from the object position) |
|---|---|
| `port` | quay from x −0.5…0.5 at z 0.12, 0.35 deep; pier from z 0 to −0.95 (north, out over the water), 0.1 wide; deck height 0.05 |
| `airport` | runway x −0.5…0.5 at z 0.25, 0.06 wide; apron x −0.2…0.2 at z 0.05, 0.14 deep; taxiway between them; terminal north of the apron |
| `train_station` | platform x −0.5…0.5 at z 0.15, 0.16 deep; building at z −0.1 |
| `bridge` | deck x −1.5…1.5, 1 wide, height 0.15 |

These surfaces are walkable (value 2 in the walkmap), even over water. Their
exact numbers are the `deck` entries in `web/js/model.js`.

## Object collision radius

Objects that block movement have a collision radius in metres at scale 1
(multiply by `scale`): trees 0.3–0.7, cactus 0.4, rock 0.6, boulder 1.8,
crystal 0.6, house 3, barn and shop 3.5, tower 3, castle 10, temple 4.5,
ruins 1.5, windmill 2.5, lighthouse 3.5, well 0.7, camp 1.5, mine 2.5,
chest 0.5, resource 0.5. Bushes, ferns, reeds, flowers, markers and bridges
have no collision. The full table is `r` in `web/js/model.js`.

## Walkability (`walkmap.png` in the export)

One byte per terrain sample, same grid as the heightmap:

| value | meaning |
|---|---|
| 0 | blocked: a `no_build` region, or lava |
| 1 | walkable |
| 2 | road / trail / bridge (faster movement) |
| 3 | shallow water: can wade (depth ≤ `maxWadeDepth`) |
| 4 | deep water: swim |
| 5 | cliff: slope steeper than `maxSlopeDeg` |
| 6 | obstacle: wall, fence, or the footprint of a solid object |

Use it to bake a navmesh, to drive AI pathfinding (A* over the grid), or to
check that spawns and quest targets can be reached.

## `regions`

```jsonc
{ "id": "r_…", "type": "level", "name": "Goblin Hills", "color": "#ef8354",
  "points": [[x, y], …], "props": { "levelMin": 5, "levelMax": 9 } }
```

A closed polygon (last point connects back to the first). Types: `zone`,
`quest`, `level`, `spawn_area`, `safe`, `danger`, `kingdom`, `no_build`.

## Loading it (pseudo code)

```python
doc = json.load(open("elderwood.wmap.json"))
t = doc["terrain"]
heights = np.frombuffer(base64.b64decode(t["heights"]["data"]), "<f4").reshape(t["height"], t["width"])
biomes  = np.frombuffer(base64.b64decode(t["biomes"]["data"]), "u1").reshape(t["height"], t["width"])
world_y = heights * t["heightScale"]
```

C#: `Convert.FromBase64String(data)` then `Buffer.BlockCopy` into a `float[]`.
GDScript: `Marshalls.base64_to_raw(data).to_float32_array()`.

`server/exporter.py` is a complete reference implementation (decode, sample
heights, build glTF, heightmaps and splat maps).

## Export package

`Export` writes `exports/<id>/` and `exports/<id>.zip` on the PC:

| file | use |
|---|---|
| `<id>.wmap.json` | the map itself |
| `entities.json` | objects / paths / regions with baked 3D positions (`position: [x, y, z]`, `rotationY` in radians) |
| `terrain.glb` | terrain mesh with biome vertex colours + water plane |
| `heightmap_16bit.png` | 16-bit grayscale, 0..65535 = 0..heightScale |
| `heightmap.r16` | raw little-endian uint16 (Unity "Import Raw", flip vertically) |
| `biome_index.png` | 8-bit, pixel value = biome id |
| `biome_color.png` | biome colours |
| `splat_N.png` | RGBA weight maps, 4 biomes per image, palette order (see README.txt in the export) |
| `preview.png` | shaded map image |
| `walkmap.png` | walkability per sample (see above); `walkmap_color.png` to view it, `walkmap_legend.json` for the rules used |

Versioning: readers should reject `version` greater than they understand.
New optional fields may be added within a version.
