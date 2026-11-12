"""
Unified Launcher Entrypoint for J.A.R.V.I.S. Cortex OS v4.0 (A-02 Consolidation).

By default, delegates to the canonical Node.js/TypeScript full-stack backend (`server.ts`)
on $PORT (default 3000) and $HOST (default 127.0.0.1).
Pass `--legacy-python-hud` (or set `JARVIS_LEGACY_PYTHON_SERVER=1`) only when running
in a pure-Python headless environment without Node.js >=22.6.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys


def main() -> None:
    repo_root = os.path.dirname(os.path.abspath(__file__))
    use_legacy_py = (
        "--legacy-python-hud" in sys.argv
        or os.environ.get("JARVIS_LEGACY_PYTHON_SERVER") == "1"
    )
    node_bin = shutil.which("node")

    if not use_legacy_py and node_bin and os.path.exists(os.path.join(repo_root, "server.ts")):
        tsx_bin = os.path.join(
            repo_root,
            "node_modules",
            ".bin",
            "tsx.cmd" if os.name == "nt" else "tsx",
        )
        cmd = [tsx_bin, "server.ts"] if os.path.exists(tsx_bin) else [node_bin, "server.ts"]
        forwarded = [a for a in sys.argv[1:] if a != "--legacy-python-hud"]
        raise SystemExit(subprocess.call(cmd + forwarded, cwd=repo_root))

    from jarvis_os.server.http_sse import run_server

    port = int(os.environ.get("PORT", 3000))
    host = os.environ.get("HOST", "127.0.0.1")
    brain_url = os.environ.get("BRAIN_URL", "http://127.0.0.1:8765")
    db_path = os.environ.get("JARVIS_DB_PATH", "jarvis_cortex.db")
    run_server(host=host, port=port, db_path=db_path, brain_url=brain_url)


if __name__ == "__main__":
    main()
