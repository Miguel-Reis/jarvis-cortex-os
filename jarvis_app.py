"""1-Click Windows/POSIX Launcher for J.A.R.V.I.S. Cortex OS (Port 8766 <-> Brain Port 8765).

Usage:
    python jarvis_app.py --open
    python jarvis_app.py --port 8766 --brain-url http://127.0.0.1:8765 --open
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
import webbrowser

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from jarvis_os.server.http_sse import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="J.A.R.V.I.S. Cortex OS — Mark-VII HUD Launcher")
    parser.add_argument("--host", default="127.0.0.1", help="Host address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8766, help="Dedicated Jarvis port (default: 8766)")
    parser.add_argument("--brain-url", default="http://127.0.0.1:8765", help="Antigravity Brain URL (default: http://127.0.0.1:8765)")
    parser.add_argument("--db-path", default="jarvis_synaptic.db", help="Persistent SQLite DB file")
    parser.add_argument("--open", action="store_true", help="Automatically open HUD in default browser")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"
    if args.open:
        def _open_browser() -> None:
            time.sleep(0.4)
            try:
                webbrowser.open(url)
            except Exception:
                pass

        threading.Thread(target=_open_browser, daemon=True).start()

    run_server(host=args.host, port=args.port, db_path=args.db_path, brain_url=args.brain_url)


if __name__ == "__main__":
    main()
