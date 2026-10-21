"""Builds a human-readable map info README (Markdown) from a .wmap.json map.

The server writes it next to the map on every save (maps/<id>.README.md) and
adds it to export packages. Written descriptions come from `description`
properties in the map and from an optional companion file
maps/<id>.descriptions.json:
    {"overview": "...", "zones": {"Zone name": "..."}, "places": {"Place name": "..."}}
Run by hand with:
    .venv\\Scripts\\python.exe -m server.mapinfo maps\\world_1.wmap.json
"""
from __future__ import annotations

import json
import math
import sys
from collections import Counter, deque
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .exporter import decode_terrain

NATURE = {"tree_oak", "tree_birch", "tree_pine", "tree_snowpine", "tree_jungle", "tree_palm", "tree_dead", "cactus",
          "bush", "fern", "reeds", "flowers", "rock", "boulder", "crystal", "mushroom"}
SETTLEMENTS = ("city", "town", "village")
LANDMARKS = ("castle", "temple", "ruins", "lighthouse", "tower", "mine", "cave", "dungeon_entrance", "portal", "windmill")
HUBS = ("train_station", "airport", "port")
GAMEPLAY = ("player_spawn", "enemy_spawn", "boss", "npc", "quest_giver", "merchant", "chest", "resource", "portal",
            "dungeon_entrance", "waypoint", "sign", "trigger", "custom")
TYPE_NAMES = {
    "city": ("City", "cities"), "town": ("Town", "towns"), "village": ("Village", "villages"), "castle": ("Castle", "castles"),
    "temple": ("Temple / Shrine", "temples"), "ruins": ("Ruins", "ruins"), "tower": ("Tower", "towers"),
    "lighthouse": ("Lighthouse", "lighthouses"), "mine": ("Mine", "mines"), "cave": ("Cave", "caves"),
    "shop": ("Shop / Inn", "shops and inns"), "house": ("House", "houses"), "barn": ("Farm / Barn", "farms"),
    "windmill": ("Windmill", "windmills"), "well": ("Well / Fountain", "wells"), "camp": ("Camp", "camps"),
    "sign": ("Signpost", "signposts"), "bridge": ("Bridge", "bridges"), "port": ("Port", "ports"), "airport": ("Airport", "airports"),
    "train_station": ("Train Station", "train stations"), "waypoint": ("Waypoint", "waypoints"),
    "player_spawn": ("Player Spawn", "player spawns"), "dungeon_entrance": ("Dungeon Entrance", "dungeon entrances"),
    "portal": ("Portal", "portals"),
}
SIZES = {"airport": 160, "port": 40, "train_station": 24, "bridge": 2}
DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
TOWN_RADIUS = {"city": 120, "town": 80, "village": 60}


def tname(t, n=1):
    one, many = TYPE_NAMES.get(t, (t.replace("_", " ").title(), t.replace("_", " ") + "s"))
    return one if n == 1 else many


# ---------------------------------------------------------------- geometry

def _poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i - 1]
        x2, y2 = pts[i]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def _inside(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _length(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def _project(x, y, pts):
    """(distance along the polyline, distance from it) of the closest point."""
    best, acc = (0.0, float("inf")), 0.0
    for i in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / l2)) if l2 else 0.0
        d = math.hypot(x - ax - t * dx, y - ay - t * dy)
        if d < best[1]:
            best = (acc + t * math.sqrt(l2), d)
        acc += math.sqrt(l2)
    return best


def _bearing(fx, fy, tx, ty):
    """Compass direction from (fx, fy) to (tx, ty); y grows south."""
    ang = (math.degrees(math.atan2(tx - fx, -(ty - fy))) + 360) % 360
    return DIRS[round(ang / 45) % 8]


def _km(m):
    return f"{m / 1000:.2f} km" if m >= 1000 else f"{m:.0f} m"


def _md(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


def _sentences(*parts):
    """Join text fragments into sentences without doubled full stops."""
    out = []
    for p in parts:
        p = str(p).strip()
        if p:
            out.append(p if p[-1] in ".!?" else p + ".")
    return " ".join(out)


def _duration(km, kmh):
    mins = km / kmh * 60
    return f"~{mins * 60:.0f} s" if mins < 1 else f"~{mins:.0f} min"


def _components(mask):
    """4-connected components of a boolean grid -> (label grid, list of sizes)."""
    h, w = mask.shape
    lab = np.full(mask.shape, -1, dtype=np.int32)
    sizes = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0] >= 0:
            continue
        cid = len(sizes)
        q = deque([(y0, x0)])
        lab[y0, x0] = cid
        n = 0
        while q:
            y, x = q.popleft()
            n += 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and lab[ny, nx] < 0:
                    lab[ny, nx] = cid
                    q.append((ny, nx))
        sizes.append(n)
    return lab, sizes


# ---------------------------------------------------------------- map wrapper

class _Map:
    def __init__(self, doc, notes):
        self.doc, self.notes = doc, notes
        t = self.t = decode_terrain(doc)
        self.cs = t.cell_size
        self.elev = (t.heights - t.sea_level) * t.height_scale  # metres above sea
        self.names = {int(p["id"]): p.get("name", p.get("key")) for p in t.palette}
        self.objects = doc.get("objects", [])
        self.paths = doc.get("paths", [])
        self.zones = sorted([r for r in doc.get("regions", []) if len(r.get("points", [])) > 2], key=lambda r: _poly_area(r["points"]))
        self.named = [o for o in self.objects if o.get("name") and o["type"] not in NATURE]
        self.settlements = [o for o in self.named if o["type"] in SETTLEMENTS]
        self.capital = next((o for o in self.objects if (o.get("props") or {}).get("capital")), None)
        # zone raster (step 2 cells): smaller zones are drawn last so they win, like zone_at()
        self.zstep = 2
        gw, gh = (t.width + 1) // self.zstep, (t.height + 1) // self.zstep
        img = Image.new("L", (gw, gh), 0)
        dr = ImageDraw.Draw(img)
        k = 1 / (self.cs * self.zstep)
        for i, r in sorted(enumerate(self.zones), key=lambda ir: -_poly_area(ir[1]["points"])):
            dr.polygon([(x * k, y * k) for x, y in r["points"]], fill=min(255, i + 1))
        self.zgrid = np.asarray(img, dtype=np.int32) - 1  # -1 = no zone

    def zone_at(self, x, y):
        for r in self.zones:  # smallest first, so nested zones win
            if _inside(x, y, r["points"]):
                return r
        return None

    def zone_name(self, x, y):
        z = self.zone_at(x, y)
        return z["name"] if z else "-"

    def elev_at(self, x, y):
        cx = min(max(int(round(x / self.cs)), 0), self.t.width - 1)
        cy = min(max(int(round(y / self.cs)), 0), self.t.height - 1)
        return float(self.elev[cy, cx])

    def nearest(self, x, y, types, exclude=None, within=None):
        best = None
        for o in self.named:
            if o is exclude or o["type"] not in types:
                continue
            d = math.hypot(o["x"] - x, o["y"] - y)
            if (within is None or d <= within) and (best is None or d < best[0]):
                best = (d, o)
        return best

    def town_of(self, x, y):
        """The settlement whose streets (x, y) is in, if any."""
        n = self.nearest(x, y, SETTLEMENTS)
        return n[1] if n and n[0] <= TOWN_RADIUS[n[1]["type"]] else None

    def where(self, x, y, exclude=None):
        """Short human description of a location."""
        town = self.town_of(x, y)
        if town is not None and town is not exclude:
            return f"in {town['name']}"
        lm = self.nearest(x, y, LANDMARKS + ("shop",), exclude=exclude, within=40)
        if lm:
            return f"at {lm[1]['name']}"
        # refer to something close by; far from everything, the zone says more than a distance
        n = self.nearest(x, y, SETTLEMENTS, exclude=exclude, within=500) or self.nearest(x, y, LANDMARKS + ("shop",), exclude=exclude, within=500)
        if n:
            return f"{_km(n[0])} {_bearing(n[1]['x'], n[1]['y'], x, y)} of {n[1]['name']}"
        z = self.zone_name(x, y)
        return f"in {z}" if z != "-" else f"out at sea, ({x:.0f}, {y:.0f})"

    def from_capital(self, o):
        c = self.capital
        if not c or c is o:
            return "-"
        return f"{_km(math.hypot(o['x'] - c['x'], o['y'] - c['y']))} {_bearing(c['x'], c['y'], o['x'], o['y'])}"

    def _owner(self, hub):
        """(distance, object) a station / airport / port belongs to: the nearest settlement,
        unless a major landmark (a keep, temple...) is right next to it."""
        s = self.nearest(hub["x"], hub["y"], SETTLEMENTS, within=600)
        lm = self.nearest(hub["x"], hub["y"], ("castle", "temple", "ruins", "lighthouse", "tower", "shop"), within=150)
        if lm and (not s or lm[0] < s[0]):
            return lm
        return s or self.nearest(hub["x"], hub["y"], LANDMARKS + ("shop",), within=400)

    def serves(self, hub):
        own = self._owner(hub)
        return (own[1]["name"], own[0]) if own else (self.zone_name(hub["x"], hub["y"]), None)

    def hubs_of(self, town):
        """Hubs that belong to `town`."""
        out = []
        for q in self.objects:
            if q["type"] in HUBS and q.get("name"):
                own = self._owner(q)
                if own and own[1] is town:
                    out.append((own[0], q))
        return sorted(out, key=lambda x: x[0])

    def describe(self, kind, name, props=None):
        return (props or {}).get("description") or self.notes.get(kind, {}).get(name, "")


# ---------------------------------------------------------------- report

def build_readme(doc: dict, notes: dict | None = None) -> str:
    M = _Map(doc, notes or {})
    t, meta = M.t, doc.get("meta", {})
    props, nav = doc.get("properties", {}) or {}, doc.get("navigation", {}) or {}
    cs = M.cs
    land = M.elev >= 0
    out = []
    w = out.append
    counts = Counter(o["type"] for o in M.objects)

    title = meta.get("name") or meta.get("id")
    w(f"# {title}: map info\n")
    w(f"> Generated from `{meta.get('id')}.wmap.json` (last edited {meta.get('modified', '?')[:16].replace('T', ' ')} UTC) "
      f"on {datetime.now():%Y-%m-%d %H:%M}. Map Creator rebuilds this file every time the map is saved. "
      f"Descriptions come from `description` properties in the map and from `{meta.get('id')}.descriptions.json`.\n")
    if M.notes.get("overview"):
        w(M.notes["overview"] + "\n")
    if meta.get("description"):
        w(meta["description"] + "\n")

    # ---------------------------------------------------------- contents
    w("**Contents:** [At a glance](#at-a-glance) · [Geography](#geography) · [Difficulty zones](#difficulty-zones) · "
      "[Settlements](#settlements) · [Landmarks](#landmarks--points-of-interest) · [Travel & transport](#travel--transport) · "
      "[Access & seasons](#access-seasons--closures) · [Object inventory](#object-inventory) · [Technical notes](#technical-notes)\n")

    # ---------------------------------------------------------- at a glance
    w("## At a glance\n")
    peak = np.unravel_index(np.argmax(M.elev), M.elev.shape)
    px, py = peak[1] * cs, peak[0] * cs
    lv = [(z.get("props") or {}) for z in M.zones]
    rows = [
        ("Map ID / file", f"`{meta.get('id')}` / `{meta.get('id')}.wmap.json`"),
        ("Map type", meta.get("kind", "world")),
        ("World size", f"{(t.width - 1) * cs:.0f} × {(t.height - 1) * cs:.0f} units (1 unit = 1 metre)"),
        ("Terrain grid", f"{t.width} × {t.height} height samples, {cs:g} units apart"),
        ("Heights", f"0 to {t.height_scale:g} units; sea level at {t.sea_level * t.height_scale:.1f} units"),
        ("Land", f"{land.sum() * cs * cs / 1e6:.2f} km² ({land.mean() * 100:.0f}% of the map); the rest is sea and lakes"),
        ("Highest point", f"{M.elev.max():.0f} m above sea, {M.where(px, py)} ({M.zone_name(px, py)})"),
    ]
    if M.capital:
        rows.append(("Capital", f"{M.capital['name']} at ({M.capital['x']:.0f}, {M.capital['y']:.0f})"))
    spawn = next((o for o in M.objects if o["type"] == "player_spawn"), None)
    if spawn:
        rows.append(("Player start", f"{spawn.get('name') or 'Player Spawn'}, {M.where(spawn['x'], spawn['y'])}, "
                                     f"facing {DIRS[round((spawn.get('rotation') or 0) / 45) % 8]}"))
    if M.zones:
        rows.append(("Difficulty", f"{len({z['name'] for z in M.zones})} zones, levels {min(p.get('levelMin', 0) for p in lv)}-{max(p.get('levelMax', 0) for p in lv)}"))
    rows += [
        ("Settlements", ", ".join(f"{counts[k]} {tname(k, counts[k]).lower()}" for k in SETTLEMENTS if counts[k]) or "none"),
        ("Transport", ", ".join(f"{counts[k]} {tname(k, counts[k]).lower()}" for k in HUBS + ("bridge",) if counts[k])
         + f"; {sum(1 for p in M.paths if p['type'] == 'railway')} rail lines, {sum(1 for p in M.paths if p['type'] in ('road', 'trail'))} roads and trails"),
        ("Fast travel", f"{counts['waypoint']} waypoint{'s' if counts['waypoint'] != 1 else ''}"),
        ("Objects", f"{len(M.objects)} in total, {sum(counts[k] for k in NATURE)} of them trees, plants and rocks"),
    ]
    w("| | |\n|---|---|")
    for k, v in rows:
        w(f"| **{k}** | {_md(v)} |")
    w("")
    if meta.get("tags"):
        w("Tags: " + ", ".join(f"`{x}`" for x in meta["tags"]) + "\n")

    # ---------------------------------------------------------- geography
    w("## Geography\n")
    step = 4
    land_c = land[::step, ::step]
    lab, sizes = _components(land_c)
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i])

    def comp_of(x, y):
        cy, cx = int(y / cs / step), int(x / cs / step)
        for dy, dx in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1), (2, 0), (0, 2), (-2, 0), (0, -2)):
            yy, xx = cy + dy, cx + dx
            if 0 <= yy < lab.shape[0] and 0 <= xx < lab.shape[1] and lab[yy, xx] >= 0:
                return lab[yy, xx]
        return -1

    w("### Landmasses\n")
    w("| Landmass | Area | Extent (x, y) | Highest point | Zones | Places |\n|---|---|---|---|---|---|")
    for rank, cid in enumerate(order):
        area = sizes[cid] * (step * cs) ** 2 / 1e6
        if area < 0.002:
            continue
        ys, xs = np.nonzero(lab == cid)
        hi = M.elev[::step, ::step][ys, xs].max()
        zl = Counter(M.zgrid[np.minimum(ys * step // M.zstep, M.zgrid.shape[0] - 1), np.minimum(xs * step // M.zstep, M.zgrid.shape[1] - 1)])
        zones = [M.zones[z]["name"] for z, _ in zl.most_common() if z >= 0]
        zones = list(dict.fromkeys(zones))
        # the main island lists settlements and major landmarks; small islands list everything named
        types = SETTLEMENTS + ("castle", "temple", "ruins", "lighthouse") if rank == 0 else SETTLEMENTS + LANDMARKS + HUBS + ("shop",)
        places = [o["name"] for o in M.named if o["type"] in types and comp_of(o["x"], o["y"]) == cid
                  and not (o["type"] in ("shop", "tower", "windmill", "castle") and M.town_of(o["x"], o["y"]))]
        label = "Main island" if rank == 0 else (f"{zones[0]} island" if zones else f"Island {rank}")
        w(f"| {label} | {area:.2f} km² | {xs.min() * step * cs:.0f}-{xs.max() * step * cs:.0f}, {ys.min() * step * cs:.0f}-{ys.max() * step * cs:.0f} | "
          f"{hi:.0f} m | {_md(', '.join(zones) or '-')} | {_md(', '.join(places) or '-')} |")
    w("")

    w("### Biomes (share of land)\n")
    bio = Counter(int(b) for b in t.biomes[::2, ::2][land[::2, ::2]])
    total = sum(bio.values()) or 1
    items = [(M.names.get(b, b), n / total * 100) for b, n in bio.most_common() if n / total >= 0.001]
    w("| Biome | Share | Biome | Share |\n|---|---|---|---|")
    for i in range(0, len(items), 2):
        a = items[i]
        b = items[i + 1] if i + 1 < len(items) else ("", None)
        w(f"| {a[0]} | {a[1]:.1f}% | {b[0]} | {'' if b[1] is None else f'{b[1]:.1f}%'} |")
    w("")

    w("### Terrain\n")
    e = M.elev[land]
    gy, gx = np.gradient(t.heights * t.height_scale, cs)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))[land]
    max_slope = nav.get("maxSlopeDeg", 40)
    w(f"- **Elevation:** half the land is below {np.median(e):.0f} m and 90% is below {np.percentile(e, 90):.0f} m. "
      f"Lowlands under 10 m make up {(e < 10).mean() * 100:.0f}% of the land.")
    w(f"- **Slopes:** {(slope < 15).mean() * 100:.0f}% of the land is gentle (under 15°); {(slope > max_slope).mean() * 100:.1f}% is too steep to walk "
      f"(over the {max_slope}° walk limit) and shows as cliffs.")
    coarse = M.elev[::8, ::8]
    peaks = []
    for idx in np.argsort(coarse, axis=None)[::-1]:
        y, x = np.unravel_index(idx, coarse.shape)
        wx, wy = x * 8 * cs, y * 8 * cs
        if coarse[y, x] < 20 or len(peaks) >= 6:
            break
        if all(math.hypot(wx - p[0], wy - p[1]) > 250 for p in peaks):
            peaks.append((wx, wy, float(coarse[y, x])))
    if peaks:
        w("- **Notable heights:** " + "; ".join(f"{h:.0f} m, {M.where(x, y)} ({M.zone_name(x, y)})" for x, y, h in peaks) + ".")
    water = ~land_c
    wlab, wsizes = _components(water)
    lakes = []
    edge = set(np.unique(np.concatenate([wlab[0], wlab[-1], wlab[:, 0], wlab[:, -1]])))
    for cid, n in enumerate(wsizes):
        if cid in edge or n * (step * cs) ** 2 < 1500:
            continue
        ys, xs = np.nonzero(wlab == cid)
        lakes.append((n * (step * cs) ** 2, xs.mean() * step * cs, ys.mean() * step * cs))
    if lakes:
        w("- **Lakes:** " + "; ".join(f"{a / 1e4:.1f} ha, {M.where(x, y)} ({M.zone_name(x, y)})" for a, x, y in sorted(lakes, reverse=True)) + ".")
    for r in (p for p in M.paths if p["type"] in ("river", "stream")):
        a, b = r["points"][0], r["points"][-1]
        name = r.get("name") or r["type"].title()
        w(f"- **{name}:** {_km(_length(r['points']))} long, flowing from {M.where(*a)} to {M.where(*b)}."
          + (f" {M.describe('places', name, r.get('props'))}" if M.describe("places", name, r.get("props")) else ""))
    w("")

    # ---------------------------------------------------------- zones
    if M.zones:
        w("## Difficulty zones\n")
        w("Level ranges overlap on purpose, so neighbouring zones blend into each other. In the map file the zones are "
          "`level` regions with `props.levelMin` and `props.levelMax`.\n")
        groups = {}
        for r in M.zones:
            groups.setdefault(r["name"], []).append(r)
        zl = sorted(groups.items(), key=lambda kv: ((kv[1][0].get("props") or {}).get("levelMin", 0), (kv[1][0].get("props") or {}).get("levelMax", 0)))
        members = {}
        for o in M.named:
            z = M.zone_at(o["x"], o["y"])
            if z:
                members.setdefault(z["name"], []).append(o)
        w("| Levels | Zone | Area | Climate / hazard | Settlements & landmarks | Waypoint |\n|---|---|---|---|---|---|")
        for name, parts in zl:
            p = parts[0].get("props") or {}
            area = sum(_poly_area(r["points"]) for r in parts)
            inside = members.get(name, [])
            places = [o["name"] for o in inside if o["type"] in SETTLEMENTS + LANDMARKS and not M.town_of(o["x"], o["y"]) or o["type"] in SETTLEMENTS]
            places = list(dict.fromkeys(o for o in places))
            ch = " / ".join(x for x in (p.get("climate"), p.get("hazard")) if x) or "-"
            wp = any(o["type"] == "waypoint" for o in inside)
            w(f"| **{p.get('levelMin', '?')}-{p.get('levelMax', '?')}** | [{_md(name)}](#{name.lower().replace(' ', '-')}-lv-{p.get('levelMin', '')}-{p.get('levelMax', '')}) | "
              f"{area / 1e6:.2f} km² | {_md(ch)} | {_md(', '.join(places) or '-')} | {'yes' if wp else '-'} |")
        w("")
        zidx = {}
        for i, r in enumerate(M.zones):
            zidx.setdefault(r["name"], []).append(i)
        sub = M.zgrid
        el2 = M.elev[::M.zstep, ::M.zstep][: sub.shape[0], : sub.shape[1]]
        bi2 = t.biomes[::M.zstep, ::M.zstep][: sub.shape[0], : sub.shape[1]]
        sub = sub[: el2.shape[0], : el2.shape[1]]
        for name, parts in zl:
            p = parts[0].get("props") or {}
            w(f"### {name} (Lv {p.get('levelMin', '?')}-{p.get('levelMax', '?')})\n")
            desc = M.describe("zones", name, p)
            if desc:
                w(desc + "\n")
            sel = np.isin(sub, zidx[name]) & (el2 >= 0)
            area = sum(_poly_area(r["points"]) for r in parts)
            if sel.any():
                el = el2[sel]
                bc = Counter(int(b) for b in bi2[sel])
                top = ", ".join(f"{M.names.get(b, b)} {n / sel.sum() * 100:.0f}%" for b, n in bc.most_common(4))
                w(f"- **Area:** {area / 1e6:.2f} km²{f' in {len(parts)} parts' if len(parts) > 1 else ''}; ground from {el.min():.0f} to {el.max():.0f} m above sea.")
                w(f"- **Terrain:** {top}.")
            extra = {k: v for k, v in p.items() if k not in ("levelMin", "levelMax", "description")}
            if extra:
                w("- **Properties:** " + ", ".join(f"{k} = {v}" for k, v in extra.items()) + ".")
            by_type = {}
            for o in members.get(name, []):
                if o["type"] in ("house", "barn", "well") or (o["type"] in ("shop", "tower", "camp", "windmill") and M.town_of(o["x"], o["y"])):
                    continue
                by_type.setdefault(o["type"], []).append(o["name"])
            for tp, names in by_type.items():
                w(f"- **{tname(tp, len(names)).capitalize() if len(names) > 1 else tname(tp)}:** {', '.join(names)}.")
            w("")

    # ---------------------------------------------------------- settlements
    if M.settlements:
        w("## Settlements\n")
        w("| Settlement | Type | Zone | Location | From capital | Transport | Waypoint |\n|---|---|---|---|---|---|---|")
        sets = sorted(M.settlements, key=lambda o: (SETTLEMENTS.index(o["type"]), not (o.get("props") or {}).get("capital"), o["name"]))
        for o in sets:
            hubs = M.hubs_of(o)
            tr = ", ".join(dict.fromkeys(tname(q["type"]) for _, q in hubs)) or "-"
            wp = any(q["type"] == "waypoint" and M.town_of(q["x"], q["y"]) is o for q in M.objects)
            label = o["name"] + (" (capital)" if (o.get("props") or {}).get("capital") else "")
            w(f"| [**{_md(label)}**](#{o['name'].lower().replace(' ', '-')}) | {tname(o['type'])} | {_md(M.zone_name(o['x'], o['y']))} | "
              f"({o['x']:.0f}, {o['y']:.0f}) | {M.from_capital(o)} | {tr} | {'yes' if wp else '-'} |")
        w("")
        for o in sets:
            p = o.get("props") or {}
            w(f"### {o['name']}\n")
            desc = M.describe("places", o["name"], p)
            if desc:
                w(desc + "\n")
            loc = f"({o['x']:.0f}, {o['y']:.0f}), {M.elev_at(o['x'], o['y']):.0f} m above sea, in {M.zone_name(o['x'], o['y'])}"
            if M.capital and M.capital is not o:
                loc += f"; {M.from_capital(o)} from {M.capital['name']}"
            w(f"- **Where:** {loc}.")
            own = [q for q in M.objects if q is not o and q["type"] not in NATURE and q["type"] not in HUBS + ("waypoint", "player_spawn", "bridge", "sign")
                   and M.town_of(q["x"], q["y"]) is o]
            b = Counter(q["type"] for q in own)
            if b:
                w("- **Buildings:** " + ", ".join(f"{n} {tname(k, n).lower()}" for k, n in b.most_common()) + ".")
            named_b = [f"{q['name']} ({tname(q['type']).lower()})" for q in own if q.get("name")]
            if named_b:
                w("- **Notable:** " + ", ".join(named_b) + ".")
            for d, q in M.hubs_of(o):
                qp = q.get("props") or {}
                note = f", closes in {qp['closedWhen']}" if qp.get("closedWhen") else ""
                w(f"- **{tname(q['type'])}:** {q['name']}, {_km(d)} {_bearing(o['x'], o['y'], q['x'], q['y'])} of the centre{note}.")
            for q in M.objects:
                if q["type"] == "waypoint" and M.town_of(q["x"], q["y"]) is o:
                    w(f"- **Fast travel:** {q.get('name') or 'Waypoint'}.")
                if q["type"] == "player_spawn" and M.town_of(q["x"], q["y"]) is o:
                    w(f"- **Player start:** {q.get('name') or 'Player Spawn'}.")
            extra = {k: v for k, v in p.items() if k not in ("description", "note", "capital")}
            if extra:
                w("- **Properties:** " + ", ".join(f"{k} = {v}" for k, v in extra.items()) + ".")
            if p.get("note"):
                w(f"- **Note:** {_sentences(p['note'])}")
            w("")

    # ---------------------------------------------------------- landmarks
    lm = [o for o in M.named if (o["type"] in LANDMARKS + ("shop", "camp", "sign") and not M.town_of(o["x"], o["y"]))
          or o["type"] in ("castle", "temple", "ruins", "lighthouse")]
    lm = list(dict.fromkeys(id(o) for o in lm))
    lm = [o for o in M.named if id(o) in lm]
    if lm:
        w("## Landmarks & points of interest\n")
        w("| Name | Type | Zone | Location | Description |\n|---|---|---|---|---|")
        for o in sorted(lm, key=lambda o: (tname(o["type"]), o["name"])):
            p = o.get("props") or {}
            desc = M.describe("places", o["name"], p) or p.get("text") or ", ".join(f"{k}: {v}" for k, v in p.items() if v not in ("", None)) or "-"
            w(f"| **{_md(o['name'])}** | {tname(o['type'])} | {_md(M.zone_name(o['x'], o['y']))} | "
              f"({o['x']:.0f}, {o['y']:.0f}), {M.where(o['x'], o['y'], exclude=o)} | {_md(desc)} |")
        w("")

    # ---------------------------------------------------------- unnamed features, grouped
    loose = [o for o in M.objects if not o.get("name") and o["type"] in ("camp", "windmill", "tower", "ruins", "well", "mine", "cave", "chest", "resource")
             and not M.town_of(o["x"], o["y"])]
    groups = []
    for o in loose:
        for g in groups:
            if g["type"] == o["type"] and any(math.hypot(o["x"] - q["x"], o["y"] - q["y"]) < 90 for q in g["items"]):
                g["items"].append(o)
                break
        else:
            groups.append({"type": o["type"], "items": [o]})
    if groups:
        w("### Other features (unnamed)\n")
        for g in sorted(groups, key=lambda g: (g["type"], -len(g["items"]))):
            cx = sum(q["x"] for q in g["items"]) / len(g["items"])
            cy = sum(q["y"] for q in g["items"]) / len(g["items"])
            n = len(g["items"])
            w(f"- {'A' if n == 1 else n} {tname(g['type'], n).lower()} {M.where(cx, cy)} ({M.zone_name(cx, cy)}), around ({cx:.0f}, {cy:.0f}).")
        w("")

    # ---------------------------------------------------------- transport
    w("## Travel & transport\n")
    rails = [p for p in M.paths if p["type"] == "railway"]
    stations = [o for o in M.objects if o["type"] == "train_station"]
    if rails:
        w("### Railways\n")
        w("| Line | Route | Length | Speed | Journey | Stations (in order) | Notes |\n|---|---|---|---|---|---|---|")
        for r in rails:
            p = r.get("props") or {}
            length = _length(r["points"])
            st = sorted(((_project(s["x"], s["y"], r["points"]), s) for s in stations), key=lambda x: x[0][0])
            st = [s for (pos, d), s in st if d < 40]
            speed = p.get("speedKmh")
            journey = _duration(length / 1000, speed) if speed else "-"
            notes = _sentences(p.get("note", "")) or (f"Closes in {p['closedWhen']}." if p.get("closedWhen") else "-")
            w(f"| **{_md(r.get('name') or 'Railway')}** | {_md(p.get('route', '-'))} | {_km(length)} | {speed or '-'} km/h | {journey} | "
              f"{_md(' → '.join(s.get('name') or 'Station' for s in st) or '-')} | {_md(notes)} |")
        w("")

    def hub_table(kind, title, extra_col):
        hubs = [o for o in M.objects if o["type"] == kind]
        if not hubs:
            return
        w(f"### {title}\n")
        w(f"| Name | Serves | Zone | Location | {extra_col} | Notes |\n|---|---|---|---|---|---|")
        for o in hubs:
            p = o.get("props") or {}
            sv, d = M.serves(o)
            s = SIZES.get(kind, 1) * (o.get("scale") or 1)
            if kind == "airport":
                ex = f"{s:.0f} m runway, heading {(o.get('rotation') or 0) % 180:.0f}°/{(o.get('rotation') or 0) % 180 + 180:.0f}°"
            elif kind == "port":
                ex = f"{0.95 * s:.0f} m pier facing {DIRS[round((o.get('rotation') or 0) / 45) % 8]}"
            else:
                ex = f"`{p.get('lineId') or '-'}`"
            bits = [_sentences(p["note"]) if p.get("note") else (f"Closes in {p['closedWhen']}." if p.get("closedWhen") else "")]
            if p.get("targetMap"):
                bits.append(f"Travels to map `{p['targetMap']}`" + (f" (spawn `{p['targetSpawn']}`)." if p.get("targetSpawn") else "."))
            w(f"| **{_md(o.get('name') or tname(kind))}** | {_md(sv)}{f' ({_km(d)})' if d is not None else ''} | {_md(M.zone_name(o['x'], o['y']))} | "
              f"({o['x']:.0f}, {o['y']:.0f}) | {ex} | {_md(' '.join(b for b in bits if b) or '-')} |")
        w("")

    hub_table("train_station", "Train stations", "Line")
    hub_table("airport", "Airports", "Runway")
    hub_table("port", "Ports", "Pier")
    roads = [p for p in M.paths if p["type"] in ("road", "trail")]
    if roads:
        w("### Roads & trails\n")
        w("| Name | Type | Length | From | To | Status |\n|---|---|---|---|---|---|")
        for r in roads:
            p = r.get("props") or {}
            status = p.get("status", "open").replace("_", " ")
            w(f"| **{_md(r.get('name') or '(unnamed ' + r['type'] + ')')}** | {r['type']} | {_km(_length(r['points']))} | {_md(M.where(*r['points'][0]))} | "
              f"{_md(M.where(*r['points'][-1]))} | {_md(_sentences(status, p['note']) if p.get('note') else status)} |")
        w("")
    bridges = [o for o in M.objects if o["type"] == "bridge"]
    if bridges:
        w("### Bridges\n")
        for b in bridges:
            w(f"- **{b.get('name') or 'Bridge'}:** {SIZES['bridge'] * 3 * (b.get('scale') or 1):.0f} m span at ({b['x']:.0f}, {b['y']:.0f}), {M.where(b['x'], b['y'])}.")
        w("")
    wps = [o for o in M.objects if o["type"] == "waypoint"]
    w("### Fast travel (waypoints)\n")
    if wps:
        w(f"{len(wps)} waypoint{'s' if len(wps) != 1 else ''}. Everywhere else has to be reached on foot, by train, by plane or by ship.\n")
        w("| Waypoint | Zone | Location | Unlock |\n|---|---|---|---|")
        for o in wps:
            p = o.get("props") or {}
            w(f"| **{_md(o.get('name') or 'Waypoint')}** | {_md(M.zone_name(o['x'], o['y']))} | ({o['x']:.0f}, {o['y']:.0f}), {M.where(o['x'], o['y'])} | "
              f"{'unlocked at the start' if p.get('unlockedAtStart') else 'unlocked by visiting'} |")
        w("")
        no_wp = sorted({r["name"] for r in M.zones} - {M.zone_name(o["x"], o["y"]) for o in wps})
        if no_wp:
            w("Zones without a waypoint (explore to reach them): " + ", ".join(no_wp) + ".\n")
    else:
        w("No waypoints on this map.\n")

    # ---------------------------------------------------------- access & seasons
    notes = []
    for o in M.objects:
        p = o.get("props") or {}
        if o.get("name") and any(k in p for k in ("seasonal", "closedWhen", "access", "status")):
            bits = [f"access: {p['access']}" if p.get("access") else "", f"closes in {p['closedWhen']}" if p.get("closedWhen") else "", p.get("note", "")]
            notes.append(f"- **{o['name']}** ({tname(o['type']).lower()}): {_sentences(*bits)}")
    for r in M.paths:
        p = r.get("props") or {}
        if any(k in p for k in ("seasonal", "closedWhen", "status")):
            bits = [str(p.get("status", "")).replace("_", " "), f"closes in {p['closedWhen']}" if p.get("closedWhen") else "", p.get("note", "")]
            notes.append(f"- **{r.get('name') or r['type']}** ({r['type']}): {_sentences(*bits)}")
    w("## Access, seasons & closures\n")
    if props.get("seasons"):
        w(_sentences(props["seasons"]) + "\n")
    w("\n".join(notes) + "\n" if notes else "Nothing on this map is seasonal or closed.\n")

    # ---------------------------------------------------------- objects
    w("## Object inventory\n")
    cats = {
        "Settlement markers": SETTLEMENTS,
        "Buildings": ("house", "barn", "shop", "tower", "castle", "temple", "ruins", "windmill", "lighthouse", "well", "camp", "mine"),
        "Transport": HUBS + ("bridge",),
        "Gameplay": GAMEPLAY + ("cave",),
        "Nature": tuple(sorted(NATURE)),
    }
    w("| Category | Count | Breakdown |\n|---|---|---|")
    for cat, types in cats.items():
        sub = sorted(((k, counts[k]) for k in types if counts[k]), key=lambda x: -x[1])
        if sub:
            nice = lambda k: tname(k) if k in TYPE_NAMES else k.replace("tree_", "").replace("_", " ") + (" tree" if k.startswith("tree_") else "")
            w(f"| {cat} | {sum(n for _, n in sub)} | {', '.join(f'{nice(k)} {n}' for k, n in sub)} |")
    w("")

    # ---------------------------------------------------------- properties & technical
    if props:
        w("## Map properties\n")
        w("Custom key/value properties in the map's `properties` field:\n")
        w("| Key | Value |\n|---|---|")
        for k, v in props.items():
            w(f"| `{k}` | {_md(v)} |")
        w("")
    w("## Technical notes\n")
    w("- **Coordinates:** world units, origin at the north-west corner, x grows east and y grows south. "
      "In 3D: X east, Y up, Z south. Object `rotation` is degrees clockwise from north.")
    w(f"- **Heights:** `heights` are normalized 0..1 and multiplied by `heightScale` ({t.height_scale:g}). "
      f"Sea level is {t.sea_level:.3f} normalized, which is {t.sea_level * t.height_scale:.1f} units.")
    w(f"- **Walkability rules:** max slope {nav.get('maxSlopeDeg', 40)}°, max wading depth {nav.get('maxWadeDepth', 0.8)} units, "
      f"eye height {nav.get('eyeHeight', 1.7)} units. Exports include `walkmap.png` built with these rules.")
    w(f"- **Files next to this README:** `{meta.get('id')}.wmap.json` (the map), `{meta.get('id')}.thumb.png` (preview), "
      f"`{meta.get('id')}.descriptions.json` (optional texts used here) and earlier versions in `.backups/{meta.get('id')}/`.")
    w("- **Export:** Map Creator's Export writes the game package (GLB mesh, 16-bit heightmap, splat maps, `entities.json`, walkmap, this README) to `exports/`. "
      "The file format is described in `docs/FORMAT.md`.")
    w("")
    return "\n".join(out)


def load_notes(map_path: Path) -> dict:
    p = map_path.with_name(map_path.name.replace(".wmap.json", ".descriptions.json"))
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except (OSError, ValueError):
        return {}


def write_readme(doc: dict, folder: Path) -> Path:
    folder = Path(folder)
    map_path = folder / f"{doc['meta']['id']}.wmap.json"
    path = folder / f"{doc['meta']['id']}.README.md"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(build_readme(doc, load_notes(map_path)), encoding="utf-8")
    tmp.replace(path)
    return path


if __name__ == "__main__":
    src = Path(sys.argv[1])
    doc = json.loads(src.read_text(encoding="utf-8"))
    print(write_readme(doc, src.parent))
