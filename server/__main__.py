import json
import os
import socket
import sys
import urllib.request

import uvicorn

from .app import MAPS_DIR, lan_addresses


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return False
        except OSError:
            return True


def is_map_creator(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/info", timeout=2) as r:
            return "mapsDir" in json.load(r)
    except (OSError, ValueError):
        return False


if __name__ == "__main__":
    port = int(os.environ.get("MAPCREATOR_PORT", 8765))
    os.environ["MAPCREATOR_PORT"] = str(port)
    urls = [f"http://{ip}:{port}" for ip in lan_addresses()]

    if port_in_use(port):
        if is_map_creator(port):
            print(f"\n  Map Creator is already running - just open it:")
            print(f"  On this PC:      http://localhost:{port}")
            for u in urls:
                print(f"  On your tablet:  {u}")
            print("\n  (To restart it, close the other Map Creator window first.)\n")
        else:
            print(f"\n  Port {port} is used by another program.")
            print(f"  Pick another port, for example:  set MAPCREATOR_PORT=8770  and run again.\n")
        sys.exit(1)

    print("\n  Map Creator")
    print(f"  On this PC:      http://localhost:{port}")
    for u in urls:
        print(f"  On your tablet:  {u}")
    print(f"  Maps folder:     {MAPS_DIR}")
    print("  Close this window (or press Ctrl+C) to stop the server.\n")
    uvicorn.run("server.app:app", host="0.0.0.0", port=port, log_level="warning")
