"""1-Click Windows/POSIX Launcher for J.A.R.V.I.S. Cortex OS v4.0.

Delegates by default to the unified Node.js/React Studio & HUD (`server.ts`, port 3000),
while keeping `--legacy-python-hud` available for standalone Python stdlib diagnostics on port 8766.

Usage:
    python jarvis_app.py --open
    python jarvis_app.py --port 3000 --open
    python jarvis_app.py --legacy-python-hud --port 8766 --open
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)


def _schedule_browser(url: str) -> None:
    def _open() -> None:
        time.sleep(0.8)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=_open, daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(description="J.A.R.V.I.S. Cortex OS v4.0 — Unified Launcher")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=3000, help="HTTP port (default: 3000)")
    parser.add_argument("--brain-url", default="http://127.0.0.1:8765", help="Antigravity Brain URL")
    parser.add_argument("--db-path", default="jarvis_synaptic.db", help="Legacy Python SQLite DB file")
    parser.add_argument("--open", action="store_true", help="Automatically open Studio HUD in browser")
    parser.add_argument(
        "--legacy-python-hud",
        action="store_true",
        help="Run the standalone pure-Python Mark-VII console instead of the unified Node/React Studio",
    )
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"
    if args.open:
        _schedule_browser(url)

    node_bin = shutil.which("node")
    if not args.legacy_python_hud and node_bin and os.path.exists(os.path.join(CURRENT_DIR, "server.ts")):
        tsx_bin = os.path.join(
            CURRENT_DIR,
            "node_modules",
            ".bin",
            "tsx.cmd" if os.name == "nt" else "tsx",
        )
        cmd = [tsx_bin, "server.ts"] if os.path.exists(tsx_bin) else [node_bin, "server.ts"]
        cmd.extend(["--host", args.host, "--port", str(args.port)])
        raise SystemExit(subprocess.call(cmd, cwd=CURRENT_DIR))

    from jarvis_os.server.http_sse import run_server

    run_server(host=args.host, port=args.port, db_path=args.db_path, brain_url=args.brain_url)


if __name__ == "__main__":
    main()
