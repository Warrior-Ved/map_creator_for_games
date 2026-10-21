"""Import a Map Creator world (.wmap.json) into Blender.

Use it either way:
  * Add-on: Edit > Preferences > Add-ons > Install from Disk... pick this file,
    then File > Import > World Map (.wmap.json)
  * Command line:
      blender --python tools/blender_import_wmap.py -- maps/my_world.wmap.json [--save out.blend]

Axes: the map's x (east) becomes Blender +X, the map's y (south) becomes
Blender -Y, height becomes +Z. One map unit = one Blender metre.

What gets created (in a collection named after the map):
  Terrain        mesh with a "biome" colour attribute and integer "biome_id"
  Water          plane at sea level
  Nature_<type>  one point mesh per vegetation/rock type (rotation & scale
                 stored as point attributes, ready for Geometry Nodes instancing)
  Objects        empties for buildings / gameplay markers with custom properties
  Paths          poly curves (roads, rivers, walls...) with custom properties
  Regions        closed poly curves with custom properties
"""

bl_info = {
    "name": "Map Creator World Import",
    "author": "Map Creator",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "File > Import > World Map (.wmap.json)",
    "category": "Import-Export",
}

import base64
import json
import math
import sys

import bpy
import numpy as np

NATURE = {"tree_oak", "tree_birch", "tree_pine", "tree_snowpine", "tree_jungle", "tree_palm", "tree_dead", "cactus",
          "bush", "fern", "reeds", "flowers", "rock", "boulder", "crystal", "mushroom"}


def _decode(block, dtype, shape):
    raw = base64.b64decode(block["data"])
    arr = np.frombuffer(raw, dtype="<f4" if block["encoding"] == "base64-f32le" else np.uint8)
    return arr.reshape(shape)


def _hex(c):
    c = c.lstrip("#")
    return [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def _srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _set_props(idblock, props):
    for k, v in (props or {}).items():
        try:
            idblock[k] = v if isinstance(v, (int, float, str, bool)) else json.dumps(v)
        except (TypeError, OverflowError):
            idblock[k] = str(v)


def import_wmap(path, step=1):
    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)
    if doc.get("format") != "worldmap":
        raise ValueError("not a worldmap file")
    t = doc["terrain"]
    W, H = t["width"], t["height"]
    cs, hs, sea = t["cellSize"], t["heightScale"], t["seaLevel"]
    heights = _decode(t["heights"], "f4", (H, W)).astype(np.float32)
    biomes = _decode(t["biomes"], "u1", (H, W))
    name = doc["meta"].get("name") or doc["meta"]["id"]

    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    coll["wmap_id"] = doc["meta"]["id"]
    coll["wmap_kind"] = doc["meta"].get("kind", "world")
    _set_props(coll, doc.get("properties"))

    def ground(x, y):
        fx = min(max(x / cs, 0), W - 1)
        fy = min(max(y / cs, 0), H - 1)
        x0, y0 = int(fx), int(fy)
        x1, y1 = min(x0 + 1, W - 1), min(y0 + 1, H - 1)
        ax, ay = fx - x0, fy - y0
        top = heights[y0, x0] * (1 - ax) + heights[y0, x1] * ax
        bot = heights[y1, x0] * (1 - ax) + heights[y1, x1] * ax
        return float((top * (1 - ay) + bot * ay) * hs)

    # ---------------- terrain
    xs = list(range(0, W, step)) + ([W - 1] if (W - 1) % step else [])
    ys = list(range(0, H, step)) + ([H - 1] if (H - 1) % step else [])
    xs, ys = np.array(xs), np.array(ys)
    gx, gy = np.meshgrid(xs, ys)
    verts = np.stack([gx * cs, -gy * cs, heights[gy, gx] * hs], axis=-1).reshape(-1, 3)
    rows, cols = len(ys), len(xs)
    r, c = np.meshgrid(np.arange(rows - 1), np.arange(cols - 1), indexing="ij")
    a = (r * cols + c).reshape(-1)
    faces = np.stack([a, a + cols, a + cols + 1, a + 1], axis=-1)  # counter-clockwise seen from +Z
    mesh = bpy.data.meshes.new(name + "_Terrain")
    mesh.from_pydata(verts.tolist(), [], faces.tolist())
    mesh.update()
    ids = biomes[gy, gx].reshape(-1).astype(np.int32)
    lut = np.ones((256, 3), dtype=np.float32) * [1, 0, 1]
    for p in t.get("biomePalette", []):
        lut[int(p["id"])] = _srgb_to_linear(_hex(p["color"]))
    col = np.concatenate([lut[ids], np.ones((len(ids), 1), dtype=np.float32)], axis=1)
    cattr = mesh.color_attributes.new("biome", "FLOAT_COLOR", "POINT")
    cattr.data.foreach_set("color", col.reshape(-1))
    iattr = mesh.attributes.new("biome_id", "INT", "POINT")
    iattr.data.foreach_set("value", ids)
    for poly in mesh.polygons:
        poly.use_smooth = True
    mat = bpy.data.materials.new(name + "_TerrainMat")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "biome"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    mesh.materials.append(mat)
    terrain = bpy.data.objects.new(name + "_Terrain", mesh)
    coll.objects.link(terrain)
    terrain["biome_palette"] = json.dumps(t.get("biomePalette", []))

    # ---------------- water
    ww, wh = (W - 1) * cs, (H - 1) * cs
    wmesh = bpy.data.meshes.new(name + "_Water")
    wmesh.from_pydata([(0, 0, 0), (ww, 0, 0), (ww, -wh, 0), (0, -wh, 0)], [], [(0, 3, 2, 1)])
    wmat = bpy.data.materials.new(name + "_WaterMat")
    wmat.use_nodes = True
    wb = wmat.node_tree.nodes.get("Principled BSDF")
    wb.inputs["Base Color"].default_value = (0.03, 0.15, 0.35, 1)
    wb.inputs["Roughness"].default_value = 0.05
    if "Alpha" in wb.inputs:
        wb.inputs["Alpha"].default_value = 0.75
    wmesh.materials.append(wmat)
    water = bpy.data.objects.new(name + "_Water", wmesh)
    water.location.z = sea * hs
    coll.objects.link(water)

    # ---------------- objects
    nature = {}
    obj_coll = bpy.data.collections.new(name + "_Objects")
    coll.children.link(obj_coll)
    for o in doc.get("objects", []):
        x, y = float(o["x"]), float(o["y"])
        z = ground(x, y) + float(o.get("elevation", 0))
        rot = -math.radians(float(o.get("rotation", 0)))
        if o["type"] in NATURE and not o.get("name"):
            nature.setdefault(o["type"], []).append((x, -y, z, rot, float(o.get("scale", 1))))
            continue
        e = bpy.data.objects.new(o.get("name") or o["type"], None)
        e.empty_display_type = "SINGLE_ARROW" if o["type"] in ("player_spawn", "portal", "dungeon_entrance") else "PLAIN_AXES"
        e.empty_display_size = 2 * float(o.get("scale", 1))
        e.location = (x, -y, z)
        e.rotation_euler = (0, 0, rot)
        e["wmap_id"] = o["id"]
        e["wmap_type"] = o["type"]
        _set_props(e, o.get("props"))
        obj_coll.objects.link(e)
    for typ, pts in nature.items():
        arr = np.array(pts, dtype=np.float32)
        pm = bpy.data.meshes.new(f"Nature_{typ}")
        pm.vertices.add(len(arr))
        pm.vertices.foreach_set("co", arr[:, :3].reshape(-1))
        pm.attributes.new("rotation_z", "FLOAT", "POINT").data.foreach_set("value", arr[:, 3])
        pm.attributes.new("scale", "FLOAT", "POINT").data.foreach_set("value", arr[:, 4])
        po = bpy.data.objects.new(f"Nature_{typ}", pm)
        po["wmap_type"] = typ
        obj_coll.objects.link(po)

    # ---------------- paths & regions
    def poly_curve(cname, points, closed, coll_):
        cd = bpy.data.curves.new(cname, "CURVE")
        cd.dimensions = "3D"
        sp = cd.splines.new("POLY")
        sp.points.add(len(points) - 1)
        for i, (px, py) in enumerate(points):
            sp.points[i].co = (px, -py, ground(px, py) + 0.2, 1)
        sp.use_cyclic_u = closed
        ob = bpy.data.objects.new(cname, cd)
        coll_.objects.link(ob)
        return ob, cd

    path_coll = bpy.data.collections.new(name + "_Paths")
    coll.children.link(path_coll)
    for p in doc.get("paths", []):
        if len(p.get("points", [])) < 2:
            continue
        ob, cd = poly_curve(p.get("name") or p["type"], p["points"], bool(p.get("closed")), path_coll)
        cd.bevel_depth = 0 if p["type"] in ("route",) else max(0.05, float(p.get("width", 1)) / 2)
        cd.bevel_resolution = 0
        ob["wmap_id"], ob["wmap_type"], ob["width"] = p["id"], p["type"], float(p.get("width", 1))
        _set_props(ob, p.get("props"))

    reg_coll = bpy.data.collections.new(name + "_Regions")
    coll.children.link(reg_coll)
    for rg in doc.get("regions", []):
        if len(rg.get("points", [])) < 3:
            continue
        ob, _ = poly_curve(rg.get("name") or rg["type"], rg["points"], True, reg_coll)
        ob["wmap_id"], ob["wmap_type"] = rg["id"], rg["type"]
        ob.color = (*_hex(rg.get("color", "#ffffff")), 1)
        _set_props(ob, rg.get("props"))
    return coll


# ---------------------------------------------------------------- add-on UI

try:
    from bpy_extras.io_utils import ImportHelper
    from bpy.props import IntProperty, StringProperty

    class IMPORT_OT_wmap(bpy.types.Operator, ImportHelper):
        bl_idname = "import_scene.wmap"
        bl_label = "Import World Map"
        filename_ext = ".json"
        filter_glob: StringProperty(default="*.wmap.json;*.json", options={"HIDDEN"})
        step: IntProperty(name="Terrain step", description="Use every Nth sample (2 = quarter the polygons)", default=1, min=1, max=16)

        def execute(self, context):
            import_wmap(self.filepath, self.step)
            return {"FINISHED"}

    def _menu(self, context):
        self.layout.operator(IMPORT_OT_wmap.bl_idname, text="World Map (.wmap.json)")

    def register():
        bpy.utils.register_class(IMPORT_OT_wmap)
        bpy.types.TOPBAR_MT_file_import.append(_menu)

    def unregister():
        bpy.types.TOPBAR_MT_file_import.remove(_menu)
        bpy.utils.unregister_class(IMPORT_OT_wmap)
except Exception:  # running outside Blender's UI
    pass


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv:
        save = None
        if "--save" in argv:
            save = argv[argv.index("--save") + 1]
        step = int(argv[argv.index("--step") + 1]) if "--step" in argv else 1
        import_wmap(argv[0], step)
        if save:
            bpy.ops.wm.save_as_mainfile(filepath=save)
        print(f"Imported {argv[0]}")
    else:
        register()
