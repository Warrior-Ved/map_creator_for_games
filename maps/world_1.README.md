# World 1: map info

> Generated from `world_1.wmap.json` (last edited 2026-10-21 10:03 UTC) on 2026-10-21 15:39. Map Creator rebuilds this file every time the map is saved. Descriptions come from `description` properties in the map and from `world_1.descriptions.json`.

World 1 is the main open world: one large island, a chain of small tropical isles and a volcanic island in the far south-east. Players begin in the capital, Aurelia, on the warm southern coast, and difficulty rises the further they travel from it: north into forests, meadows and lakes, east into the desert, north-west through the Ironspine Mountains to the frozen Frosthold Peaks, and finally into the Blightlands and the Emberfall Volcano at the very top of the level range. Fast travel is kept to a handful of waypoints so that most of the world is discovered on foot, by rail, by air or by sea.

World 1 - the main world. The capital Aurelia sits above the southern beach with its airport, central station and harbor; the player starts there. Frosthold in the north-western snowfields is hard to reach: Frostpass Road is still under construction, the Frost Line freezes in extreme winters and its harbor can be blocked by snow. Difficulty rises from the southern heartlands (Lv 1) to the Blightlands and the Emberfall volcano (Lv 100).

**Contents:** [At a glance](#at-a-glance) · [Geography](#geography) · [Difficulty zones](#difficulty-zones) · [Settlements](#settlements) · [Landmarks](#landmarks--points-of-interest) · [Travel & transport](#travel--transport) · [Access & seasons](#access-seasons--closures) · [Object inventory](#object-inventory) · [Technical notes](#technical-notes)

## At a glance

| | |
|---|---|
| **Map ID / file** | `world_1` / `world_1.wmap.json` |
| **Map type** | world |
| **World size** | 2046 × 2046 units (1 unit = 1 metre) |
| **Terrain grid** | 1024 × 1024 height samples, 2 units apart |
| **Heights** | 0 to 180 units; sea level at 54.0 units |
| **Land** | 1.52 km² (36% of the map); the rest is sea and lakes |
| **Highest point** | 81 m above sea, 156 m W of Millbrook (Millbrook Meadows) |
| **Capital** | Aurelia at (662, 1056) |
| **Player start** | Start: Aurelia Plaza, in Aurelia, facing NE |
| **Difficulty** | 15 zones, levels 1-100 |
| **Settlements** | 3 cities, 3 towns, 3 villages |
| **Transport** | 7 train stations, 3 airports, 4 ports, 3 bridges; 5 rail lines, 10 roads and trails |
| **Fast travel** | 9 waypoints |
| **Objects** | 7306 in total, 7129 of them trees, plants and rocks |

Tags: `main world`, `open world`, `levels 1-100`

## Geography

### Landmasses

| Landmass | Area | Extent (x, y) | Highest point | Zones | Places |
|---|---|---|---|---|---|
| Main island | 1.39 km² | 88-1496, 48-1376 | 76 m | Ironspine Mountains, Sandcrest Desert, Millbrook Meadows, Aurelia Heartlands, Seabreeze Shore, Frosthold Peaks, Blightlands, Northlake Highlands, Silverbrook Vale, Westbrook Plains, Wildwood, Eastmere Reach, Mirelake Marshes | Aurelia, Frosthold, Eastmere, Westbrook, Millbrook, Northlake, Mirelake, Ruins of Ashkar, Sandcrest Keep, Temple of the Frozen Dawn, Seabreeze, Blighted Ruins, Blight Camp Village, Mingal Shrine (Corrupted) |
| Emberfall Volcano island | 0.07 km² | 1696-2016, 1720-1976 | 23 m | Emberfall Volcano | Cinder Cave, Magma Rift Cave |
| Coral Isles island | 0.03 km² | 1440-1640, 1744-1992 | 35 m | Coral Isles | Gull Island Store, Gull Island Airstrip |
| Coral Isles island | 0.02 km² | 1664-1896, 1552-1680 | 34 m | Coral Isles | Coral Market, Coral Harbor |
| Coral Isles island | 0.01 km² | 1360-1456, 1752-1840 | 5 m | Coral Isles | - |
| Coral Isles island | 0.00 km² | 1512-1576, 1616-1680 | 5 m | Coral Isles | Gull Watchtower |

### Biomes (share of land)

| Biome | Share | Biome | Share |
|---|---|---|---|
| Grassland | 53.4% | Beach / Sand | 9.2% |
| Rock / Cliff | 9.0% | Snow | 7.2% |
| Desert | 5.3% | Jungle | 5.1% |
| Corrupted Land | 3.4% | Volcanic Ash | 2.5% |
| Swamp | 2.1% | Paved / Town | 1.1% |
| Dirt | 0.8% | Forest | 0.5% |
| Lava | 0.2% | Shallow Water | 0.1% |

### Terrain

- **Elevation:** half the land is below 5 m and 90% is below 23 m. Lowlands under 10 m make up 80% of the land.
- **Slopes:** 73% of the land is gentle (under 15°); 7.9% is too steep to walk (over the 40° walk limit) and shows as cliffs.
- **Notable heights:** 76 m, 157 m W of Millbrook (Millbrook Meadows); 63 m, 184 m N of Mirelake (Millbrook Meadows); 47 m, 275 m NE of Westbrook (Ironspine Mountains); 32 m, 123 m S of Gull Island Store (Coral Isles); 32 m, 108 m W of Coral Market (Coral Isles); 24 m, 185 m SE of Blight Camp Village (Blightlands).
- **Lakes:** 2.5 ha, 153 m E of Mirelake (-); 0.3 ha, 283 m SW of Mirelake (Silverbrook Vale).
- **River:** 810 m long, flowing from 323 m SW of Mirelake to 218 m SE of Aurelia.
- **River:** 288 m long, flowing from 364 m NE of Aurelia to in Aurelia.

## Difficulty zones

Level ranges overlap on purpose, so neighbouring zones blend into each other. In the map file the zones are `level` regions with `props.levelMin` and `props.levelMax`.

| Levels | Zone | Area | Climate / hazard | Settlements & landmarks | Waypoint |
|---|---|---|---|---|---|
| **1-8** | [Aurelia Heartlands](#aurelia-heartlands-lv-1-8) | 0.12 km² | - | Aurelia | yes |
| **4-12** | [Seabreeze Shore](#seabreeze-shore-lv-4-12) | 0.12 km² | - | Seabreeze | yes |
| **8-18** | [Westbrook Plains](#westbrook-plains-lv-8-18) | 0.08 km² | - | - | - |
| **10-20** | [Silverbrook Vale](#silverbrook-vale-lv-10-20) | 0.10 km² | - | - | - |
| **16-28** | [Wildwood](#wildwood-lv-16-28) | 0.09 km² | - | Westbrook | yes |
| **18-30** | [Millbrook Meadows](#millbrook-meadows-lv-18-30) | 0.14 km² | - | Millbrook | yes |
| **22-34** | [Eastmere Reach](#eastmere-reach-lv-22-34) | 0.08 km² | - | Eastmere | yes |
| **26-38** | [Mirelake Marshes](#mirelake-marshes-lv-26-38) | 0.07 km² | wetland | Mirelake | yes |
| **30-42** | [Northlake Highlands](#northlake-highlands-lv-30-42) | 0.11 km² | - | Northlake | yes |
| **35-50** | [Sandcrest Desert](#sandcrest-desert-lv-35-50) | 0.14 km² | arid / heat and sandstorms | Ruins of Ashkar, Sandcrest Keep | - |
| **40-55** | [Coral Isles](#coral-isles-lv-40-55) | 0.07 km² | tropical | Gull Watchtower | yes |
| **45-65** | [Ironspine Mountains](#ironspine-mountains-lv-45-65) | 0.14 km² | - | Ironspine Mine, Frostbite Mine, Echo Cave, Icefang Cave, Deepvein Mine | - |
| **62-85** | [Frosthold Peaks](#frosthold-peaks-lv-62-85) | 0.12 km² | arctic / blizzards and extreme cold | Frosthold, Temple of the Frozen Dawn | yes |
| **85-100** | [Blightlands](#blightlands-lv-85-100) | 0.11 km² | blighted / corruption | Blighted Ruins, Blight Camp Village, Mingal Shrine (Corrupted) | - |
| **90-100** | [Emberfall Volcano](#emberfall-volcano-lv-90-100) | 0.07 km² | volcanic / lava and eruptions | Cinder Cave, Magma Rift Cave | - |

### Aurelia Heartlands (Lv 1-8)

The safe starting region around the capital: flat green farmland, the river delta and the start of the long southern beach. Every form of travel begins here: the Western and Eastern rail lines, Aurelia Airport and Aurelia Harbor. New players can learn the basics without straying far from the city walls.

- **Area:** 0.12 km²; ground from 0 to 6 m above sea.
- **Terrain:** Grassland 77%, Beach / Sand 22%, Paved / Town 1%, Jungle 0%.
- **City:** Aurelia.
- **Bridges:** River Gate Road Bridge, Eastern Line Bridge.
- **Airport:** Aurelia Airport.
- **Port:** Aurelia Harbor.
- **Train Station:** Aurelia Central Station.
- **Castle:** Sunspire Palace.
- **Waypoint:** Aurelia Waypoint.
- **Player Spawn:** Start: Aurelia Plaza.

### Seabreeze Shore (Lv 4-12)

A long, sunny stretch of sand and coastal grass along the south-western coast. The beach town of Seabreeze sits at its heart, linked to the capital by the Coast Road and to Westbrook by Seabreeze Way.

- **Area:** 0.12 km²; ground from 0 to 6 m above sea.
- **Terrain:** Beach / Sand 55%, Grassland 45%.
- **Town:** Seabreeze.
- **Waypoint:** Seabreeze Waypoint.

### Westbrook Plains (Lv 8-18)

Open, gently rolling grassland along the west coast. It is quiet, roomy country between the western coast and the dense Wildwood, crossed by the Western Line on its way north.

- **Area:** 0.08 km²; ground from 0 to 21 m above sea.
- **Terrain:** Grassland 90%, Beach / Sand 6%, Rock / Cliff 3%, Jungle 1%.

### Silverbrook Vale (Lv 10-20)

The river valley north of the capital, where two rivers wind down from the central lake to meet above Aurelia. The Riverside Trail follows the water upstream, and there is no waypoint here, so it is a natural first walk away from the city.

- **Area:** 0.10 km²; ground from 0 to 14 m above sea.
- **Terrain:** Grassland 91%, Jungle 4%, Paved / Town 3%, Rock / Cliff 1%.

### Wildwood (Lv 16-28)

A dense, jungle-like forest in the middle of the island, wrapped around the small central lake and the upper rivers. Visibility is poor under the canopy. The city of Westbrook stands on its south-western edge.

- **Area:** 0.09 km² in 2 parts; ground from 0 to 47 m above sea.
- **Terrain:** Jungle 75%, Grassland 20%, Rock / Cliff 4%, Paved / Town 0%.
- **City:** Westbrook.
- **Train Station:** Westbrook Station.
- **Waypoint:** Westbrook Waypoint.

### Millbrook Meadows (Lv 18-30)

Wide northern meadows of farmland and windmills that climb toward the snow line, holding the highest ground on the main island. The village of Millbrook is the starting point of the unfinished Frostpass Road.

- **Area:** 0.14 km²; ground from 0 to 78 m above sea.
- **Terrain:** Grassland 96%, Snow 2%, Beach / Sand 1%, Rock / Cliff 1%.
- **Village:** Millbrook.
- **Camp:** Road Builders Camp.
- **Waypoint:** Milbrook Waypoint.

### Eastmere Reach (Lv 22-34)

The green east coast around the walled city of Eastmere, the second hub of the island with its own airfield, docks and the junction where three rail lines meet.

- **Area:** 0.08 km²; ground from 0 to 6 m above sea.
- **Terrain:** Grassland 89%, Paved / Town 6%, Beach / Sand 2%, Swamp 2%.
- **City:** Eastmere.
- **Airport:** Eastmere Airfield.
- **Port:** Eastmere Docks.
- **Train Station:** Eastmere Junction.
- **Waypoint:** Eastmere Waypoint.

### Mirelake Marshes (Lv 26-38)

Swampy lowland on the southern shore of the great northern lake. The lakeside town of Mirelake sits at the end of the Mire Line, and the Meadow Road runs west from it to Millbrook.

- **Area:** 0.07 km²; ground from 0 to 11 m above sea.
- **Terrain:** Grassland 53%, Swamp 40%, Paved / Town 6%, Desert 1%.
- **Properties:** climate = wetland.
- **Town:** Mirelake.
- **Train Station:** Mirelake Station.
- **Waypoint:** Mirelake Waypoint.

### Northlake Highlands (Lv 30-42)

Hilly country wrapped around the great northern lake, with bare earth around its outflow and a bridge where the Northlake Road crosses it. The village of Northlake marks the end of the Northern Line.

- **Area:** 0.11 km²; ground from 0 to 69 m above sea.
- **Terrain:** Grassland 85%, Dirt 11%, Beach / Sand 3%, Swamp 1%.
- **Village:** Northlake.
- **Bridge:** Northlake Bridge.
- **Train Station:** Northlake Station.
- **Waypoint:** Northlake Waypoint.

### Sandcrest Desert (Lv 35-50)

The arid heart of the east: open sand, heat and sandstorms. Sandcrest Keep watches over the desert, the Ruins of Ashkar lie on its north-eastern edge, and the Oasis Trading Post is the last stop for supplies before the Blightlands. The Eastern Line and the Desert Road both cross it.

- **Area:** 0.14 km²; ground from 3 to 12 m above sea.
- **Terrain:** Desert 58%, Grassland 41%, Swamp 1%, Paved / Town 0%.
- **Properties:** climate = arid, hazard = heat and sandstorms.
- **Ruins:** Ruins of Ashkar.
- **Castle:** Sandcrest Keep.
- **Shop / Inn:** Oasis Trading Post.
- **Train Station:** Sandcrest Station.

### Coral Isles (Lv 40-55)

A scatter of tropical islands far to the south-east of the main island, reached only by sea through Coral Harbor or by air through Gull Island Airstrip. The isles have a small harbour village, a market, a store and the lonely Gull Watchtower.

- **Area:** 0.07 km² in 4 parts; ground from 0 to 36 m above sea.
- **Terrain:** Beach / Sand 45%, Grassland 45%, Rock / Cliff 5%, Paved / Town 4%.
- **Properties:** climate = tropical.
- **Tower:** Gull Watchtower.
- **Shops and inns:** Coral Market, Gull Island Store.
- **Airport:** Gull Island Airstrip.
- **Port:** Coral Harbor.
- **Waypoint:** Coral Harbor Waypoint.

### Ironspine Mountains (Lv 45-65)

A rugged range of grey rock south of the snowfields, riddled with mines and caves. The Frost Line climbs along its western flank on the way to Frosthold.

- **Area:** 0.14 km²; ground from 0 to 65 m above sea.
- **Terrain:** Rock / Cliff 66%, Grassland 30%, Jungle 2%, Snow 2%.
- **Mines:** Ironspine Mine, Frostbite Mine, Deepvein Mine.
- **Caves:** Echo Cave, Icefang Cave.

### Frosthold Peaks (Lv 62-85)

The frozen north-west: deep snowfields, blizzards and extreme cold. The remote town of Frosthold is very hard to reach. Frostpass Road is still being built, the Frost Line freezes in extreme winters, and heavy snow can block Frosthold Harbor. The Temple of the Frozen Dawn stands on the eastern side of the snowfields.

- **Area:** 0.12 km²; ground from 0 to 74 m above sea.
- **Terrain:** Snow 92%, Grassland 6%, Beach / Sand 1%, Paved / Town 1%.
- **Properties:** climate = arctic, hazard = blizzards and extreme cold.
- **Town:** Frosthold.
- **Temple / Shrine:** Temple of the Frozen Dawn.
- **Port:** Frosthold Harbor.
- **Train Station:** Frosthold Station.
- **Waypoint:** Frosthold Waypoint.

### Blightlands (Lv 85-100)

The corrupted south-east of the main island: purple, blighted earth and broken rock along the coast. It is one of the two most dangerous regions in the world, with the Blighted Ruins, the rough Blight Camp Village and the Mingal Shrine (Corrupted).

- **Area:** 0.11 km²; ground from 0 to 25 m above sea.
- **Terrain:** Corrupted Land 49%, Grassland 31%, Rock / Cliff 19%, Beach / Sand 1%.
- **Properties:** hazard = corruption, climate = blighted.
- **Ruins:** Blighted Ruins.
- **Village:** Blight Camp Village.
- **Temple / Shrine:** Mingal Shrine (Corrupted).

### Emberfall Volcano (Lv 90-100)

A volcanic island in the far south-east with a glowing lava crater, ash fields and caves in its flanks. It has no harbour or airstrip of its own; the closest landing is Coral Harbor on the neighbouring isles. Together with the Blightlands it is the end-game region of the world.

- **Area:** 0.07 km²; ground from 0 to 24 m above sea.
- **Terrain:** Volcanic Ash 56%, Rock / Cliff 18%, Forest 11%, Beach / Sand 9%.
- **Properties:** hazard = lava and eruptions, climate = volcanic.
- **Caves:** Cinder Cave, Magma Rift Cave.

## Settlements

| Settlement | Type | Zone | Location | From capital | Transport | Waypoint |
|---|---|---|---|---|---|---|
| [**Aurelia (capital)**](#aurelia) | City | Aurelia Heartlands | (662, 1056) | - | - | yes |
| [**Eastmere**](#eastmere) | City | Eastmere Reach | (1399, 660) | 837 m NE | Train Station, Port, Airport | yes |
| [**Westbrook**](#westbrook) | City | Wildwood | (359, 857) | 362 m NW | Train Station | yes |
| [**Frosthold**](#frosthold) | Town | Frosthold Peaks | (319, 175) | 946 m N | Train Station, Port | yes |
| [**Mirelake**](#mirelake) | Town | Mirelake Marshes | (994, 407) | 729 m NE | Train Station | yes |
| [**Seabreeze**](#seabreeze) | Town | Seabreeze Shore | (321, 1173) | 361 m W | - | yes |
| [**Blight Camp Village**](#blight-camp-village) | Village | Blightlands | (1208, 935) | 559 m E | - | - |
| [**Millbrook**](#millbrook) | Village | Millbrook Meadows | (788, 269) | 797 m N | - | yes |
| [**Northlake**](#northlake) | Village | Northlake Highlands | (1233, 205) | 1.03 km NE | Train Station | yes |

### Aurelia

The walled capital on the southern coast, and the place where every player begins. Inside the walls are Sunspire Palace, the plaza fountain, the Grand Market, The Golden Gull Inn, the Royal Bank, the Adventurers Guild and the Blacksmith, guarded by two watchtowers. Aurelia Central Station, Aurelia Airport and Aurelia Harbor connect it to the rest of the world.

- **Where:** (662, 1056), 5 m above sea, in Aurelia Heartlands.
- **Buildings:** 16 houses, 8 shops and inns, 2 towers, 1 castle, 1 well / fountain.
- **Notable:** Sunspire Palace (castle), Grand Market (shop / inn), The Golden Gull Inn (shop / inn), Royal Bank (shop / inn), Adventurers Guild (shop / inn), Blacksmith (shop / inn), East Watchtower (tower), West Watchtower (tower), Aurelia Plaza Fountain (well / fountain).
- **Fast travel:** Aurelia Waypoint.
- **Player start:** Start: Aurelia Plaza.
- **Properties:** population = large.

### Eastmere

The walled eastern city and the island's second transport hub: Eastmere Junction joins the Eastern, Northern and Mire lines, and the city has its own airfield and docks.

- **Where:** (1399, 660), 5 m above sea, in Eastmere Reach; 837 m NE from Aurelia.
- **Buildings:** 8 houses, 4 shops and inns.
- **Train Station:** Eastmere Junction, 60 m SW of the centre.
- **Port:** Eastmere Docks, 93 m E of the centre.
- **Airport:** Eastmere Airfield, 134 m N of the centre.
- **Fast travel:** Eastmere Waypoint.
- **Properties:** population = medium.

### Westbrook

A sizeable city on the west side of the island, on the edge of the Wildwood. It is the end of the Western Line and the start of the Frost Line north to Frosthold.

- **Where:** (359, 857), 4 m above sea, in Wildwood; 362 m NW from Aurelia.
- **Buildings:** 6 houses, 4 shops and inns, 2 farms.
- **Train Station:** Westbrook Station, 44 m E of the centre.
- **Fast travel:** Westbrook Waypoint.
- **Properties:** population = medium.

### Frosthold

A small, isolated town in the north-western snowfields. Reaching it is a journey: the road there is unfinished, the Frost Line stops in extreme winters and heavy snow can close the harbour.

- **Where:** (319, 175), 4 m above sea, in Frosthold Peaks; 946 m N from Aurelia.
- **Buildings:** 5 houses, 2 shops and inns.
- **Train Station:** Frosthold Station, 73 m SE of the centre, closes in extreme winter.
- **Port:** Frosthold Harbor, 96 m S of the centre, closes in heavy snow.
- **Fast travel:** Frosthold Waypoint.
- **Properties:** access = very hard.
- **Note:** Remote snow town. No finished road yet; the Frost Line and the harbor close in extreme winters.

### Mirelake

A lakeside town on the southern shore of the great northern lake, served by the Mire Line and joined to Millbrook by the Meadow Road.

- **Where:** (994, 407), 5 m above sea, in Mirelake Marshes; 729 m NE from Aurelia.
- **Buildings:** 3 houses, 2 shops and inns, 2 farms.
- **Train Station:** Mirelake Station, 57 m SE of the centre.
- **Fast travel:** Mirelake Waypoint.

### Seabreeze

A beach town on the south-western coast, connected to the capital by the Coast Road.

- **Where:** (321, 1173), 5 m above sea, in Seabreeze Shore; 361 m W from Aurelia.
- **Buildings:** 4 houses, 3 shops and inns.
- **Fast travel:** Seabreeze Waypoint.

### Blight Camp Village

A rough settlement of camps on the edge of the Blightlands, reached by the road from the Oasis Trading Post.

- **Where:** (1208, 935), 5 m above sea, in Blightlands; 559 m E from Aurelia.
- **Buildings:** 8 farms, 2 houses, 1 shop / inn.

### Millbrook

A farming village in the northern meadows, surrounded by windmills. Frostpass Road toward Frosthold starts here.

- **Where:** (788, 269), 3 m above sea, in Millbrook Meadows; 797 m N from Aurelia.
- **Buildings:** 3 farms, 2 houses.
- **Fast travel:** Milbrook Waypoint.

### Northlake

A village on the far side of the great northern lake, at the end of the Northern Line.

- **Where:** (1233, 205), 5 m above sea, in Northlake Highlands; 1.03 km NE from Aurelia.
- **Buildings:** 3 farms, 2 houses.
- **Train Station:** Northlake Station, 80 m SE of the centre.
- **Fast travel:** Northlake Waypoint.

## Landmarks & points of interest

| Name | Type | Zone | Location | Description |
|---|---|---|---|---|
| **Road Builders Camp** | Camp | Millbrook Meadows | (677, 137), 172 m NW of Millbrook | The construction crew's camp at the current end of Frostpass Road. |
| **Sandcrest Keep** | Castle | Sandcrest Desert | (1108, 772), 191 m NW of Blight Camp Village | A desert fortress standing over the Sandcrest Desert, beside Sandcrest Station on the Eastern Line. |
| **Sunspire Palace** | Castle | Aurelia Heartlands | (638, 1080), in Aurelia | The royal palace at the heart of Aurelia. |
| **Cinder Cave** | Cave | Emberfall Volcano | (1762, 1884), 187 m W of Magma Rift Cave | A cave on the southern slopes of the Emberfall Volcano. |
| **Echo Cave** | Cave | Ironspine Mountains | (496, 442), 320 m SE of Frosthold | A cave in the heart of the Ironspine Mountains. |
| **Icefang Cave** | Cave | Ironspine Mountains | (676, 338), at Frostbite Mine | A cave at the cold northern edge of the Ironspine Mountains, beside Frostbite Mine. |
| **Magma Rift Cave** | Cave | Emberfall Volcano | (1939, 1824), 187 m E of Cinder Cave | A cave on the eastern slopes of the Emberfall Volcano. |
| **Lonely Light** | Lighthouse | - | (741, 1729), out at sea, (741, 1729) | A lighthouse on a tiny islet alone in the southern sea. |
| **Deepvein Mine** | Mine | Ironspine Mountains | (413, 469), 309 m S of Frosthold | A mine in the western Ironspine Mountains, just north of Ironspine Mine. |
| **Frostbite Mine** | Mine | Ironspine Mountains | (697, 367), at Icefang Cave | A mine in the north-eastern Ironspine Mountains, next to Icefang Cave. |
| **Ironspine Mine** | Mine | Ironspine Mountains | (399, 512), 347 m S of Frosthold | A mine in the western Ironspine Mountains. |
| **Blighted Ruins** | Ruins | Blightlands | (1295, 1018), 120 m SE of Blight Camp Village | Crumbling ruins deep in the Blightlands. |
| **Ruins of Ashkar** | Ruins | Sandcrest Desert | (1233, 663), 167 m W of Eastmere | Old ruins on the north-eastern edge of the Sandcrest Desert, close to Eastmere. |
| **Coral Market** | Shop / Inn | Coral Isles | (1834, 1637), 214 m NW of Magma Rift Cave | The market of the Coral Isles harbour village. |
| **Gull Island Store** | Shop / Inn | Coral Isles | (1578, 1783), 154 m S of Gull Watchtower | A small store on Gull Island, near the airstrip. |
| **Oasis Trading Post** | Shop / Inn | Sandcrest Desert | (1051, 893), 163 m W of Blight Camp Village | A desert trading post beside Sandcrest Station; the road to Blight Camp Village starts here. |
| **Road closed** | Signpost | - | (674, 150), 165 m NW of Millbrook | Frostpass Road: construction in progress. Frosthold lies beyond the snowfields to the west. |
| **Mingal Shrine (Corrupted)** | Temple / Shrine | Blightlands | (1380, 911), 174 m E of Blight Camp Village | A shrine on the east side of the Blightlands, consumed by the corruption. |
| **Temple of the Frozen Dawn** | Temple / Shrine | Frosthold Peaks | (607, 250), 182 m W of Millbrook | A remote shrine on the eastern side of the Frosthold snowfields. |
| **Gull Watchtower** | Tower | Coral Isles | (1538, 1635), 154 m N of Gull Island Store | A watchtower on a small islet among the Coral Isles. |

### Other features (unnamed)

- 3 camps 169 m S of Mirelake (Mirelake Marshes), around (1048, 567).
- 3 camps 201 m SW of Millbrook (Millbrook Meadows), around (606, 354).
- 2 camps 213 m NW of Eastmere (Mirelake Marshes), around (1244, 514).
- A camp 171 m S of Northlake (Northlake Highlands), around (1244, 375).
- A camp 224 m W of Blight Camp Village (Sandcrest Desert), around (984, 934).
- A camp 155 m N of Blight Camp Village (Sandcrest Desert), around (1235, 782).
- A camp 174 m NW of Millbrook (Millbrook Meadows), around (682, 131).
- 6 windmills 186 m N of Mirelake (Millbrook Meadows), around (973, 223).
- 3 windmills at Ironspine Mine (Ironspine Mountains), around (425, 515).
- 2 windmills 182 m S of Northlake (Northlake Highlands), around (1248, 386).
- A windmill 218 m NW of Eastmere (Mirelake Marshes), around (1251, 501).

## Travel & transport

### Railways

| Line | Route | Length | Speed | Journey | Stations (in order) | Notes |
|---|---|---|---|---|---|---|
| **Western Line** | Aurelia - Westbrook | 292 m | 120 km/h | ~9 s | Aurelia Central Station → Westbrook Station | - |
| **Eastern Line** | Aurelia - Sandcrest - Eastmere | 841 m | 120 km/h | ~25 s | Aurelia Central Station → Sandcrest Station → Eastmere Junction | - |
| **Northern Line** | Eastmere - Northlake | 499 m | 90 km/h | ~20 s | Eastmere Junction → Northlake Station | - |
| **Mire Line** | Eastmere - Mirelake | 451 m | 80 km/h | ~20 s | Eastmere Junction → Mirelake Station | - |
| **Frost Line** | Westbrook - Frosthold | 658 m | 60 km/h | ~39 s | Westbrook Station → Frosthold Station | Tracks freeze and services stop during extreme winters. |

### Train stations

| Name | Serves | Zone | Location | Line | Notes |
|---|---|---|---|---|---|
| **Aurelia Central Station** | Grand Market (20 m) | Aurelia Heartlands | (647, 1025) | `eastern` | - |
| **Westbrook Station** | Westbrook (44 m) | Wildwood | (403, 861) | `western` | - |
| **Frosthold Station** | Frosthold (73 m) | Frosthold Peaks | (361, 234) | `frost` | Closes in extreme winter. |
| **Mirelake Station** | Mirelake (57 m) | Mirelake Marshes | (1031, 450) | `mire` | - |
| **Sandcrest Station** | Oasis Trading Post (46 m) | Sandcrest Desert | (1047, 847) | `eastern` | - |
| **Eastmere Junction** | Eastmere (60 m) | Eastmere Reach | (1346, 689) | `northern` | - |
| **Northlake Station** | Northlake (80 m) | Northlake Highlands | (1291, 261) | `northern` | - |

### Airports

| Name | Serves | Zone | Location | Runway | Notes |
|---|---|---|---|---|---|
| **Aurelia Airport** | Grand Market (120 m) | Aurelia Heartlands | (582, 936) | 160 m runway, heading 60°/240° | - |
| **Gull Island Airstrip** | Gull Island Store (57 m) | Coral Isles | (1580, 1840) | 112 m runway, heading 135°/315° | - |
| **Eastmere Airfield** | Eastmere (134 m) | Eastmere Reach | (1430, 530) | 160 m runway, heading 90°/270° | - |

### Ports

| Name | Serves | Zone | Location | Pier | Notes |
|---|---|---|---|---|---|
| **Frosthold Harbor** | Frosthold (96 m) | Frosthold Peaks | (293, 267) | 38 m pier facing SW | Ice and heavy snow can block the harbor in winter. |
| **Aurelia Harbor** | Blacksmith (133 m) | Aurelia Heartlands | (814, 1154) | 38 m pier facing SE | - |
| **Coral Harbor** | Coral Market (161 m) | Coral Isles | (1688, 1570) | 38 m pier facing NW | - |
| **Eastmere Docks** | Eastmere (93 m) | Eastmere Reach | (1492, 670) | 38 m pier facing E | - |

### Roads & trails

| Name | Type | Length | From | To | Status |
|---|---|---|---|---|---|
| **Westbrook Road** | road | 257 m | in Westbrook | in Aurelia | open |
| **Meadow Road** | road | 232 m | in Millbrook | in Mirelake | open |
| **Northlake Road** | road | 412 m | in Eastmere | in Northlake | open |
| **River Gate Road** | road | 40 m | in Aurelia | in Aurelia | open |
| **Desert Road** | road | 1.11 km | in Aurelia | in Eastmere | open |
| **Coast Road** | road | 256 m | in Seabreeze | in Aurelia | open |
| **Seabreeze Way** | road | 199 m | in Seabreeze | in Westbrook | open |
| **Frostpass Road (under construction)** | road | 196 m | in Millbrook | 163 m NW of Millbrook | under construction. Construction is still progressing; the road ends in the snowfields. |
| **Riverside Trail** | trail | 571 m | in Aurelia | 313 m SW of Mirelake | open |
| **(unnamed road)** | road | 140 m | at Oasis Trading Post | in Blight Camp Village | open |

### Bridges

- **Northlake Bridge:** 12 m span at (1269, 323), 124 m S of Northlake.
- **River Gate Road Bridge:** 20 m span at (740, 1103), in Aurelia.
- **Eastern Line Bridge:** 20 m span at (725, 1049), in Aurelia.

### Fast travel (waypoints)

9 waypoints. Everywhere else has to be reached on foot, by train, by plane or by ship.

| Waypoint | Zone | Location | Unlock |
|---|---|---|---|
| **Aurelia Waypoint** | Aurelia Heartlands | (662, 1066), in Aurelia | unlocked at the start |
| **Westbrook Waypoint** | Wildwood | (369, 858), in Westbrook | unlocked by visiting |
| **Eastmere Waypoint** | Eastmere Reach | (1409, 660), in Eastmere | unlocked by visiting |
| **Mirelake Waypoint** | Mirelake Marshes | (1004, 407), in Mirelake | unlocked by visiting |
| **Coral Harbor Waypoint** | Coral Isles | (1699, 1581), 146 m W of Coral Market | unlocked by visiting |
| **Seabreeze Waypoint** | Seabreeze Shore | (318, 1163), in Seabreeze | unlocked by visiting |
| **Frosthold Waypoint** | Frosthold Peaks | (321, 193), in Frosthold | unlocked by visiting |
| **Milbrook Waypoint** | Millbrook Meadows | (812, 270), in Millbrook | unlocked by visiting |
| **Northlake Waypoint** | Northlake Highlands | (1245, 190), in Northlake | unlocked by visiting |

Zones without a waypoint (explore to reach them): Blightlands, Emberfall Volcano, Ironspine Mountains, Sandcrest Desert, Silverbrook Vale, Westbrook Plains.

## Access, seasons & closures

Extreme winters close the Frost Line and can block Frosthold Harbor.

- **Frosthold** (town): access: very hard. Remote snow town. No finished road yet; the Frost Line and the harbor close in extreme winters.
- **Frosthold Harbor** (port): closes in heavy snow. Ice and heavy snow can block the harbor in winter.
- **Frosthold Station** (train station): closes in extreme winter.
- **Frostpass Road (under construction)** (road): under construction. Construction is still progressing; the road ends in the snowfields.
- **Frost Line** (railway): closes in extreme winter. Tracks freeze and services stop during extreme winters.

## Object inventory

| Category | Count | Breakdown |
|---|---|---|
| Settlement markers | 9 | City 3, Town 3, Village 3 |
| Buildings | 136 | House 52, Shop / Inn 27, Farm / Barn 18, Camp 13, Windmill 12, Tower 3, Mine 3, Castle 2, Temple / Shrine 2, Ruins 2, Lighthouse 1, Well / Fountain 1 |
| Transport | 17 | Train Station 7, Port 4, Airport 3, Bridge 3 |
| Gameplay | 15 | Waypoint 9, Cave 4, Player Spawn 1, Signpost 1 |
| Nature | 7129 | bush 1236, jungle tree 1018, fern 909, flowers 670, palm tree 622, oak tree 509, rock 498, birch tree 317, boulder 313, dead tree 265, reeds 204, pine tree 166, snowpine tree 158, mushroom 117, cactus 76, crystal 51 |

## Map properties

Custom key/value properties in the map's `properties` field:

| Key | Value |
|---|---|
| `capital` | Aurelia |
| `startSpawn` | start |
| `levelRange` | 1-100 |
| `seasons` | Extreme winters close the Frost Line and can block Frosthold Harbor. |

## Technical notes

- **Coordinates:** world units, origin at the north-west corner, x grows east and y grows south. In 3D: X east, Y up, Z south. Object `rotation` is degrees clockwise from north.
- **Heights:** `heights` are normalized 0..1 and multiplied by `heightScale` (180). Sea level is 0.300 normalized, which is 54.0 units.
- **Walkability rules:** max slope 40°, max wading depth 0.8 units, eye height 1.7 units. Exports include `walkmap.png` built with these rules.
- **Files next to this README:** `world_1.wmap.json` (the map), `world_1.thumb.png` (preview), `world_1.descriptions.json` (optional texts used here) and earlier versions in `.backups/world_1/`.
- **Export:** Map Creator's Export writes the game package (GLB mesh, 16-bit heightmap, splat maps, `entities.json`, walkmap, this README) to `exports/`. The file format is described in `docs/FORMAT.md`.
