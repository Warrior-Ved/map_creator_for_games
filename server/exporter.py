"""Decoding and export helpers for .wmap.json world maps.

Everything here works on the saved map document, so the same code is used by
the web server, the command line and the Blender importer's sibling scripts.
"""
from __future__ import annotations

import base64
import io
import json
import math
import struct
import zipfile
from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass
class Terrain:
    width: int
    height: int
    cell_size: float
    height_scale: float
    sea_level: float
    heights: np.ndarray  # float32 (height, width), normalized 0..1
    biomes: np.ndarray  # uint8 (height, width)
    palette: list[dict]


def _decode_array(block: dict, dtype: str, shape: tuple[int, int]) -> np.ndarray:
    enc = block.get("encoding")
    raw = base64.b64decode(block["data"])
    if enc == "base64-f32le":
        arr = np.frombuffer(raw, dtype="<f4")
    elif enc == "base64-u8":
        arr = np.frombuffer(raw, dtype=np.uint8)
    else:
        raise ValueError(f"unsupported encoding {enc!r}")
    if arr.size != shape[0] * shape[1]:
        raise ValueError(f"array size {arr.size} does not match {shape}")
    return arr.reshape(shape).astype(dtype, copy=True)


def decode_terrain(doc: dict) -> Terrain:
    t = doc["terrain"]
    w, h = int(t["width"]), int(t["height"])
    return Terrain(
        width=w,
        height=h,
        cell_size=float(t["cellSize"]),
        height_scale=float(t["heightScale"]),
        sea_level=float(t["seaLevel"]),
        heights=_decode_array(t["heights"], "float32", (h, w)),
        biomes=_decode_array(t["biomes"], "uint8", (h, w)),
        palette=t.get("biomePalette", []),
    )


def validate(doc: dict) -> None:
    if doc.get("format") != "worldmap":
        raise ValueError("not a worldmap document")
    decode_terrain(doc)  # raises on malformed terrain
    for key in ("objects", "paths", "regions"):
        if not isinstance(doc.get(key, []), list):
            raise ValueError(f"{key} must be a list")


# ---------------------------------------------------------------- images

def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def palette_lut(t: Terrain) -> np.ndarray:
    lut = np.full((256, 3), 255, dtype=np.float32)
    lut[:, 1] = 0  # unknown ids show up magenta
    for entry in t.palette:
        lut[int(entry["id"])] = _hex_to_rgb(entry.get("color", "#ff00ff"))
    return lut


def hillshade(t: Terrain) -> np.ndarray:
    z = t.heights * t.height_scale
    gy, gx = np.gradient(z, t.cell_size)
    nx, ny, nz = -gx, -gy, np.ones_like(z)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    lx, ly, lz = -0.5, -0.5, 0.7071
    shade = (nx * lx + ny * ly + nz * lz) / norm
    return np.clip(0.45 + 0.75 * shade, 0.35, 1.3)


def render_preview(t: Terrain) -> Image.Image:
    lut = palette_lut(t)
    rgb = lut[t.biomes] * hillshade(t)[..., None]
    water = t.heights < t.sea_level
    if water.any():
        depth = np.clip((t.sea_level - t.heights) * 6.0, 0, 1)[..., None]
        water_col = np.array([38, 92, 140], dtype=np.float32)
        mix = 0.55 + 0.4 * depth
        under = rgb * (1 - mix) + water_col * mix
        rgb = np.where(water[..., None], under, rgb)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def thumbnail_png(doc: dict, size: int = 256) -> bytes:
    img = render_preview(decode_terrain(doc))
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def heightmap16(t: Terrain) -> np.ndarray:
    return np.round(np.clip(t.heights, 0, 1) * 65535).astype(np.uint16)


def splatmaps(t: Terrain) -> list[tuple[Image.Image, list[dict]]]:
    """RGBA weight maps, four biomes per texture, in palette order."""
    out = []
    pal = sorted(t.palette, key=lambda p: int(p["id"]))
    for i in range(0, len(pal), 4):
        group = pal[i:i + 4]
        chans = [np.where(t.biomes == int(p["id"]), 255, 0).astype(np.uint8) for p in group]
        while len(chans) < 4:
            chans.append(np.zeros_like(t.biomes))
        out.append((Image.fromarray(np.stack(chans, axis=-1), "RGBA"), group))
    return out


# ---------------------------------------------------------------- sampling

def sample_height(t: Terrain, x: float, y: float) -> float:
    """Ground height in world units at world position (x east, y south)."""
    fx = min(max(x / t.cell_size, 0.0), t.width - 1.0)
    fy = min(max(y / t.cell_size, 0.0), t.height - 1.0)
    x0, y0 = int(fx), int(fy)
    x1, y1 = min(x0 + 1, t.width - 1), min(y0 + 1, t.height - 1)
    ax, ay = fx - x0, fy - y0
    h = t.heights
    top = h[y0, x0] * (1 - ax) + h[y0, x1] * ax
    bot = h[y1, x0] * (1 - ax) + h[y1, x1] * ax
    return float((top * (1 - ay) + bot * ay) * t.height_scale)


def baked_entities(doc: dict, t: Terrain) -> dict:
    """Entities with 3D engine coordinates (X east, Y up, Z south)."""
    def pos3(x, y, lift=0.0):
        return [round(x, 4), round(sample_height(t, x, y) + lift, 4), round(y, 4)]

    objects = []
    for o in doc.get("objects", []):
        objects.append({
            **o,
            "position": pos3(o["x"], o["y"], float(o.get("elevation", 0))),
            "rotationY": -math.radians(float(o.get("rotation", 0))),
        })
    paths = []
    for p in doc.get("paths", []):
        paths.append({**p, "points3d": [pos3(x, y) for x, y in p.get("points", [])]})
    regions = []
    for r in doc.get("regions", []):
        pts = r.get("points", [])
        xs = [p[0] for p in pts] or [0]
        ys = [p[1] for p in pts] or [0]
        regions.append({**r, "bounds": [min(xs), min(ys), max(xs), max(ys)]})
    return {
        "coordinateSystem": "X east, Y up, Z south (map row direction); units = world units",
        "worldSize": [(t.width - 1) * t.cell_size, (t.height - 1) * t.cell_size],
        "seaLevelY": t.sea_level * t.height_scale,
        "objects": objects,
        "paths": paths,
        "regions": regions,
    }


# ---------------------------------------------------------------- glTF

def terrain_glb(t: Terrain, step: int = 1, with_water: bool = True) -> bytes:
    """Binary glTF with the terrain mesh (vertex colors) and a water plane."""
    hs = t.heights[::step, ::step]
    bi = t.biomes[::step, ::step]
    # always include the last row/column so the mesh covers the whole map
    if (t.height - 1) % step:
        hs = np.vstack([hs, t.heights[-1:, ::step]])
        bi = np.vstack([bi, t.biomes[-1:, ::step]])
    if (t.width - 1) % step:
        col_h = t.heights[::step, -1:]
        col_b = t.biomes[::step, -1:]
        if col_h.shape[0] < hs.shape[0]:
            col_h = np.vstack([col_h, t.heights[-1:, -1:]])
            col_b = np.vstack([col_b, t.biomes[-1:, -1:]])
        hs = np.hstack([hs, col_h])
        bi = np.hstack([bi, col_b])
    rows, cols = hs.shape
    xs = np.minimum(np.arange(cols) * step, t.width - 1) * t.cell_size
    zs = np.minimum(np.arange(rows) * step, t.height - 1) * t.cell_size
    gx, gz = np.meshgrid(xs, zs)
    gy = hs * t.height_scale
    pos = np.stack([gx, gy, gz], axis=-1).reshape(-1, 3).astype(np.float32)

    dzdz, dzdx = np.gradient(gy, zs, xs)
    nrm = np.stack([-dzdx, np.ones_like(gy), -dzdz], axis=-1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    nrm = nrm.reshape(-1, 3).astype(np.float32)

    lut = palette_lut(t) / 255.0
    col = np.concatenate([lut[bi.reshape(-1)], np.ones((rows * cols, 1))], axis=1)
    col = np.round(np.clip(col, 0, 1) * 255).astype(np.uint8)

    r, c = np.meshgrid(np.arange(rows - 1), np.arange(cols - 1), indexing="ij")
    a = (r * cols + c).reshape(-1)
    b, d, e = a + 1, a + cols, a + cols + 1
    idx = np.stack([a, d, b, b, d, e], axis=-1).reshape(-1).astype(np.uint32)

    builder = _GlbBuilder()
    prim = {
        "attributes": {
            "POSITION": builder.add_accessor(pos, 5126, "VEC3", minmax=True),
            "NORMAL": builder.add_accessor(nrm, 5126, "VEC3"),
            "COLOR_0": builder.add_accessor(col, 5121, "VEC4", normalized=True),
        },
        "indices": builder.add_accessor(idx, 5125, "SCALAR", target=34963),
        "material": 0,
    }
    meshes = [{"name": "Terrain", "primitives": [prim]}]
    nodes = [{"name": "Terrain", "mesh": 0}]
    materials = [{
        "name": "TerrainVertexColor",
        "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.95},
    }]
    if with_water:
        wx, wz = (t.width - 1) * t.cell_size, (t.height - 1) * t.cell_size
        wy = t.sea_level * t.height_scale
        wpos = np.array([[0, wy, 0], [wx, wy, 0], [0, wy, wz], [wx, wy, wz]], dtype=np.float32)
        wnrm = np.tile(np.array([[0, 1, 0]], dtype=np.float32), (4, 1))
        widx = np.array([0, 2, 1, 1, 2, 3], dtype=np.uint32)
        meshes.append({"name": "Water", "primitives": [{
            "attributes": {
                "POSITION": builder.add_accessor(wpos, 5126, "VEC3", minmax=True),
                "NORMAL": builder.add_accessor(wnrm, 5126, "VEC3"),
            },
            "indices": builder.add_accessor(widx, 5125, "SCALAR", target=34963),
            "material": 1,
        }]})
        nodes.append({"name": "Water", "mesh": 1})
        materials.append({
            "name": "Water", "alphaMode": "BLEND", "doubleSided": True,
            "pbrMetallicRoughness": {"baseColorFactor": [0.15, 0.4, 0.65, 0.7], "metallicFactor": 0, "roughnessFactor": 0.1},
        })
    gltf = {
        "asset": {"version": "2.0", "generator": "Map Creator"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
    }
    return builder.build(gltf)


class _GlbBuilder:
    def __init__(self):
        self.bin = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def add_accessor(self, arr, comp, typ, minmax=False, normalized=False, target=34962):
        data = np.ascontiguousarray(arr).tobytes()
        while len(self.bin) % 4:
            self.bin.append(0)
        self.views.append({"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data), "target": target})
        self.bin.extend(data)
        acc = {
            "bufferView": len(self.views) - 1,
            "componentType": comp,
            "count": int(arr.shape[0]),
            "type": typ,
        }
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = [float(v) for v in arr.min(axis=0)]
            acc["max"] = [float(v) for v in arr.max(axis=0)]
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def build(self, gltf: dict) -> bytes:
        while len(self.bin) % 4:
            self.bin.append(0)
        gltf["buffers"] = [{"byteLength": len(self.bin)}]
        gltf["bufferViews"] = self.views
        gltf["accessors"] = self.accessors
        js = json.dumps(gltf, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        out = bytearray(struct.pack("<III", 0x46546C67, 2, total))
        out += struct.pack("<II", len(js), 0x4E4F534A) + js
        out += struct.pack("<II", len(self.bin), 0x004E4942) + self.bin
        return bytes(out)


# ---------------------------------------------------------------- package

EXPORT_README = """World map export: {name}
==========================================

{id}.wmap.json        The full map (source of truth). See docs/FORMAT.md.
entities.json         Objects / paths / regions with baked 3D positions
                      (X east, Y up, Z south, world units).
terrain.glb           Terrain mesh with biome vertex colors + water plane.
                      Imports into Blender, Godot, Unity (glTFast), Unreal.
heightmap_16bit.png   16-bit grayscale heightmap, {w}x{h}. 0 = 0, 65535 = heightScale.
heightmap.r16         Same heights as raw little-endian uint16 (Unity "Import Raw":
                      Depth 16 bit, Byte order Windows, enable "Flip Vertically").
biome_index.png       8-bit image, each pixel value = biome id (see palette below).
biome_color.png       Biome colors without shading.
splat_N.png           RGBA biome weight maps, four biomes per image (see palette).
preview.png           Shaded preview render.
{id}.README.md       Map info: zones, places, travel, seasons (human readable).
walkmap.png           8-bit walkability per terrain sample (same grid as the heightmap):
                      0 blocked, 1 walkable, 2 road, 3 shallow water, 4 deep water,
                      5 cliff, 6 obstacle. Rules: see walkmap_legend.json.
walkmap_color.png     The same, coloured for viewing.

Terrain size: {w} x {h} samples, cell size {cell} -> {wx} x {wz} world units.
Height scale: {hs} world units. Sea level: {sea:.4f} (normalized) = {seay:.3f} world units.

Biome palette (id: key -> splat image / channel):
{palette}
"""


WALK_LEGEND = [
    (0, "blocked", "no-go region or lava", (120, 30, 30)),
    (1, "walk", "walkable ground", (60, 200, 90)),
    (2, "road", "road / trail / bridge", (240, 200, 80)),
    (3, "shallow", "shallow water, can wade", (90, 200, 230)),
    (4, "water", "deep water, swim", (40, 90, 220)),
    (5, "cliff", "too steep to walk", (230, 60, 60)),
    (6, "obstacle", "building, wall, tree trunk, rock", (255, 140, 30)),
]


def export_package(doc: dict, glb_step: int = 1, walkmap: bytes | None = None, readme: str | None = None) -> bytes:
    t = decode_terrain(doc)
    walk = None
    if walkmap is not None:
        if len(walkmap) != t.width * t.height:
            raise ValueError("walkmap size does not match the terrain")
        walk = np.frombuffer(walkmap, dtype=np.uint8).reshape(t.height, t.width)
    map_id = doc["meta"]["id"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{map_id}.wmap.json", json.dumps(doc, separators=(",", ":")))
        z.writestr("entities.json", json.dumps(baked_entities(doc, t), indent=1))
        z.writestr("terrain.glb", terrain_glb(t, max(1, glb_step)))
        hm = heightmap16(t)
        z.writestr("heightmap_16bit.png", _png(Image.fromarray(hm)))
        z.writestr("heightmap.r16", hm.astype("<u2").tobytes())
        z.writestr("biome_index.png", _png(Image.fromarray(t.biomes, "L")))
        lut = palette_lut(t).astype(np.uint8)
        z.writestr("biome_color.png", _png(Image.fromarray(lut[t.biomes], "RGB")))
        lines = []
        for n, (img, group) in enumerate(splatmaps(t)):
            z.writestr(f"splat_{n}.png", _png(img))
            for ch, p in zip("RGBA", group):
                lines.append(f"  {p['id']:>3}: {p.get('key', '?'):<16} splat_{n}.png {ch}")
        z.writestr("preview.png", _png(render_preview(t)))
        if readme:
            z.writestr(f"{map_id}.README.md", readme)
        if walk is not None:
            z.writestr("walkmap.png", _png(Image.fromarray(walk, "L")))
            colors = np.zeros((256, 3), dtype=np.uint8)
            for v, _, _, c in WALK_LEGEND:
                colors[v] = c
            z.writestr("walkmap_color.png", _png(Image.fromarray(colors[walk], "RGB")))
            z.writestr("walkmap_legend.json", json.dumps({
                "navigation": doc.get("navigation", {}),
                "values": {str(v): {"name": n, "meaning": d} for v, n, d, _ in WALK_LEGEND},
            }, indent=1))
        z.writestr("README.txt", EXPORT_README.format(
            name=doc["meta"].get("name", map_id), id=map_id, w=t.width, h=t.height,
            cell=t.cell_size, wx=(t.width - 1) * t.cell_size, wz=(t.height - 1) * t.cell_size,
            hs=t.height_scale, sea=t.sea_level, seay=t.sea_level * t.height_scale,
            palette="\n".join(lines),
        ))
    return buf.getvalue()
