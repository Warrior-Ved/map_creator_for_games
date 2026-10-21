"""Map Creator web server.

Serves the editor (web/) and stores maps as .wmap.json files on this PC.
Run with:  .venv\\Scripts\\python.exe -m server
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import shutil
import socket
import time
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import exporter, mapinfo

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
MAPS_DIR = Path(os.environ.get("MAPCREATOR_MAPS", ROOT / "maps"))
EXPORT_DIR = Path(os.environ.get("MAPCREATOR_EXPORTS", ROOT / "exports"))
BACKUP_DIR = MAPS_DIR / ".backups"
TRASH_DIR = MAPS_DIR / ".trash"
BACKUPS_KEPT = 15
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

for d in (MAPS_DIR, EXPORT_DIR, BACKUP_DIR, TRASH_DIR):
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Map Creator")


def _check_id(map_id: str) -> str:
    if not ID_RE.match(map_id):
        raise HTTPException(400, "map id must be lowercase letters, digits, '-' or '_'")
    return map_id


def _map_path(map_id: str) -> Path:
    return MAPS_DIR / f"{_check_id(map_id)}.wmap.json"


def _thumb_path(map_id: str) -> Path:
    return MAPS_DIR / f"{_check_id(map_id)}.thumb.png"


def _load(map_id: str) -> dict:
    p = _map_path(map_id)
    if not p.exists():
        raise HTTPException(404, f"map {map_id!r} not found")
    return json.loads(p.read_text(encoding="utf-8"))


def lan_addresses() -> list[str]:
    ips: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    try:  # the address used for outbound traffic is usually the LAN one
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    response = await call_next(request)
    # the tablet should always pick up the newest editor code
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/info")
def info():
    port = int(os.environ.get("MAPCREATOR_PORT", 8765))
    return {
        "mapsDir": str(MAPS_DIR),
        "exportsDir": str(EXPORT_DIR),
        "lanUrls": [f"http://{ip}:{port}" for ip in lan_addresses()],
    }


@app.get("/api/maps")
def list_maps():
    out = []
    for p in sorted(MAPS_DIR.glob("*.wmap.json")):
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
            meta, terr = doc.get("meta", {}), doc.get("terrain", {})
            out.append({
                "id": meta.get("id", p.name.removesuffix(".wmap.json")),
                "name": meta.get("name", ""),
                "kind": meta.get("kind", "world"),
                "description": meta.get("description", ""),
                "modified": meta.get("modified") or datetime.fromtimestamp(p.stat().st_mtime).isoformat(),
                "width": terr.get("width"),
                "height": terr.get("height"),
                "objects": len(doc.get("objects", [])),
                "hasThumb": _thumb_path(meta.get("id", "x")).exists() if ID_RE.match(meta.get("id", "")) else False,
                "sizeBytes": p.stat().st_size,
            })
        except (OSError, ValueError, KeyError):
            continue
    out.sort(key=lambda m: m["modified"] or "", reverse=True)
    return out


@app.get("/api/maps/{map_id}")
def get_map(map_id: str):
    return FileResponse(_map_path(map_id), media_type="application/json")


@app.put("/api/maps/{map_id}")
async def save_map(map_id: str, request: Request):
    _check_id(map_id)
    try:
        doc = json.loads(await request.body())
        exporter.validate(doc)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"invalid map: {e}")
    if doc["meta"].get("id") != map_id:
        raise HTTPException(400, "meta.id does not match the URL")

    path = _map_path(map_id)
    if path.exists():  # keep rolling backups of previous saves
        bdir = BACKUP_DIR / map_id
        bdir.mkdir(exist_ok=True)
        shutil.copy2(path, bdir / f"{time.strftime('%Y%m%d-%H%M%S')}.wmap.json")
        for old in sorted(bdir.glob("*.wmap.json"))[:-BACKUPS_KEPT]:
            old.unlink(missing_ok=True)

    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)
    try:
        _thumb_path(map_id).write_bytes(exporter.thumbnail_png(doc))
    except Exception:  # a thumbnail must never block saving
        pass
    try:  # keep the map info README next to the map up to date
        mapinfo.write_readme(doc, MAPS_DIR)
    except Exception:
        pass
    return {"ok": True, "id": map_id, "path": str(path), "bytes": path.stat().st_size}


@app.delete("/api/maps/{map_id}")
def delete_map(map_id: str):
    path = _map_path(map_id)
    if not path.exists():
        raise HTTPException(404, "not found")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    shutil.move(str(path), TRASH_DIR / f"{map_id}.{stamp}.wmap.json")
    _thumb_path(map_id).unlink(missing_ok=True)
    for extra in (f"{map_id}.README.md", f"{map_id}.descriptions.json"):
        if (MAPS_DIR / extra).exists():
            shutil.move(str(MAPS_DIR / extra), TRASH_DIR / f"{stamp}.{extra}")
    return {"ok": True, "movedTo": str(TRASH_DIR)}


@app.get("/api/maps/{map_id}/thumb")
def get_thumb(map_id: str):
    p = _thumb_path(map_id)
    if not p.exists():
        raise HTTPException(404, "no thumbnail")
    return FileResponse(p, media_type="image/png", headers={"Cache-Control": "no-cache"})


@app.get("/api/maps/{map_id}/backups")
def list_backups(map_id: str):
    bdir = BACKUP_DIR / _check_id(map_id)
    return sorted((p.name for p in bdir.glob("*.wmap.json")), reverse=True) if bdir.exists() else []


@app.get("/api/maps/{map_id}/backups/{name}")
def get_backup(map_id: str, name: str):
    if not re.match(r"^\d{8}-\d{6}\.wmap\.json$", name):
        raise HTTPException(400, "bad backup name")
    p = BACKUP_DIR / _check_id(map_id) / name
    if not p.exists():
        raise HTTPException(404, "not found")
    return FileResponse(p, media_type="application/json")


@app.post("/api/maps/{map_id}/export")
async def export_map(map_id: str, request: Request, glb_step: int = 1):
    """Build the export package, keep a copy on this PC and return the zip.

    The editor may send {"walkmap": base64 bytes} - the walkability grid it
    computed with the same rules it shows on screen.
    """
    doc = _load(map_id)
    walkmap = None
    body = await request.body()
    if body:
        try:
            walkmap = base64.b64decode(json.loads(body).get("walkmap") or "") or None
        except (ValueError, AttributeError):
            raise HTTPException(400, "bad walkmap")
    try:
        data = exporter.export_package(doc, glb_step=max(1, min(glb_step, 16)), walkmap=walkmap,
                                       readme=mapinfo.build_readme(doc, mapinfo.load_notes(_map_path(map_id))))
    except ValueError as e:
        raise HTTPException(400, str(e))
    zip_path = EXPORT_DIR / f"{map_id}.zip"
    zip_path.write_bytes(data)
    # also unpack it so game projects can point straight at the files
    out_dir = EXPORT_DIR / map_id
    shutil.rmtree(out_dir, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(out_dir)
    return JSONResponse({
        "ok": True,
        "zip": str(zip_path),
        "folder": str(out_dir),
        "files": sorted(p.name for p in out_dir.iterdir()),
        "download": f"/api/exports/{map_id}.zip",
    })


@app.get("/api/exports/{map_id}.zip")
def download_export(map_id: str):
    p = EXPORT_DIR / f"{_check_id(map_id)}.zip"
    if not p.exists():
        raise HTTPException(404, "export not found; export the map first")
    return FileResponse(p, media_type="application/zip", filename=f"{map_id}.zip")


@app.get("/api/maps/{map_id}/terrain.glb")
def map_glb(map_id: str, step: int = 1):
    t = exporter.decode_terrain(_load(map_id))
    return Response(exporter.terrain_glb(t, max(1, min(step, 16))), media_type="model/gltf-binary")


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
