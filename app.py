"""
Google AI Studio & Cloud Run Entrypoint for J.A.R.V.I.S. Cortex OS.
Binds to $PORT (default 3000 in AI Studio, or 8766 locally) on $HOST (0.0.0.0)
while preserving the Cross-Port Bridge to Antigravity Brain (http://127.0.0.1:8765).
"""

from __future__ import annotations

import os
from jarvis_os.server.http_sse import run_server

if __name__ == "__main__":
    os.environ.setdefault("JARVIS_DEBUG", "1")
    os.environ.setdefault("JARVIS_HTTP_VERBOSE", "1")
    port = int(os.environ.get("PORT", 3000))
    host = os.environ.get("HOST", "0.0.0.0")
    brain_url = os.environ.get("BRAIN_URL", "http://127.0.0.1:8765")
    db_path = os.environ.get("JARVIS_DB_PATH", "jarvis_cortex.db")
    run_server(host=host, port=port, db_path=db_path, brain_url=brain_url)
