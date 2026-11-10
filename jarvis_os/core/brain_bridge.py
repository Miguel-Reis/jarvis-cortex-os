"""Bi-Directional Antigravity Brain Bridge for J.A.R.V.I.S. Cortex OS.

Architecture:
- J.A.R.V.I.S. Cortex OS runs on its own dedicated port: 8766 (http://127.0.0.1:8766)
- Antigravity Brain runs on its standard port:           8765 (http://127.0.0.1:8765)

BrainBridge links Jarvis (8766) <-> Brain (8765) via:
1. Live HTTP REST Bridge to http://127.0.0.1:8765 (/api/jarvis, /api/memories, /api/swarm, /api/orbit/overview, /api/graph)
2. Direct SQLite WAL Bridge to ../antigravity-brain/brain.db (if present on disk, even when Brain HTTP is sleeping)

100% Python 3.11+ Standard Library (urllib.request, sqlite3, socket, json, time).
"""

from __future__ import annotations

import json
import os
import socket
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class BrainConnectionStatus:
    connected: bool
    http_online: bool
    sqlite_linked: bool
    brain_url: str
    jarvis_port: int
    brain_port: int
    host: str
    latency_ms: Optional[float]
    status_label: str
    sqlite_db_path: Optional[str] = None
    detected_endpoints: List[str] = field(default_factory=list)
    remote_payload: Dict[str, Any] = field(default_factory=dict)
    synced_memories_count: int = 0
    last_checked: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class BrainBridge:
    """Connects J.A.R.V.I.S. Cortex OS (Port 8766) to Antigravity Brain (Port 8765)."""

    DEFAULT_BRAIN_PORT: int = 8765
    DEFAULT_JARVIS_PORT: int = 8766
    CANDIDATE_BRAIN_PORTS: List[int] = [8765, 8000, 8080, 3000]
    BRAIN_HEALTH_PATHS: List[str] = [
        "/api/jarvis?action=overview",
        "/api/memories",
        "/api/swarm",
        "/api/orbit/overview",
        "/api/graph",
        "/api/status",
    ]

    def __init__(
        self,
        brain_url: Optional[str] = None,
        jarvis_port: int = DEFAULT_JARVIS_PORT,
        brain_db_path: Optional[str] = None,
        timeout_sec: float = 0.40,
    ) -> None:
        self.jarvis_port = jarvis_port
        self.timeout_sec = timeout_sec
        env_url = os.environ.get("JARVIS_BRAIN_URL", "").strip()
        self.configured_url = (brain_url or env_url or f"http://127.0.0.1:{self.DEFAULT_BRAIN_PORT}").rstrip("/")
        self.brain_db_path = brain_db_path or self._discover_brain_db_path()
        self.last_status: Optional[BrainConnectionStatus] = None
        self.sync_count: int = 0

    def _discover_brain_db_path(self) -> Optional[str]:
        """Searches for Antigravity Brain's brain.db on the local workstation."""
        env_db = os.environ.get("JARVIS_BRAIN_DB", "").strip()
        if env_db and os.path.isfile(env_db):
            return os.path.abspath(env_db)

        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        parent_dir = os.path.dirname(repo_root)
        home = os.path.expanduser("~")

        candidates = [
            os.path.join(parent_dir, "antigravity-brain", "brain.db"),
            os.path.join(parent_dir, "brain", "brain.db"),
            os.path.join(home, "Desktop", "antigravity-brain", "brain.db"),
            os.path.join(home, "Desktop", "brain.db"),
            os.path.join(home, ".gemini", "antigravity", "brain.db"),
        ]
        for path in candidates:
            if os.path.isfile(path):
                return os.path.abspath(path)
        return None

    @staticmethod
    def _parse_host_port(url: str) -> tuple[str, int]:
        clean = url.replace("http://", "").replace("https://", "").split("/")[0]
        if ":" in clean:
            h, p_str = clean.split(":", 1)
            try:
                return h, int(p_str)
            except ValueError:
                return h, 8765
        return clean or "127.0.0.1", 8765

    def _is_port_open(self, host: str, port: int, timeout: float = 0.08) -> tuple[bool, float]:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        t0 = time.perf_counter()
        try:
            res = s.connect_ex((host, port))
            latency = round((time.perf_counter() - t0) * 1000.0, 2)
            return (res == 0), latency
        except Exception:
            return False, 0.0
        finally:
            s.close()

    def set_brain_url(self, new_url: str) -> BrainConnectionStatus:
        """Dynamically updates the target Brain URL and immediately probes it."""
        if not new_url.startswith(("http://", "https://")):
            new_url = f"http://{new_url}"
        self.configured_url = new_url.rstrip("/")
        return self.probe(auto_discover=False)

    def probe(self, auto_discover: bool = True) -> BrainConnectionStatus:
        """Probes Antigravity Brain on Port 8765 (HTTP) and checks SQLite brain.db link."""
        host, port = self._parse_host_port(self.configured_url)

        # Ensure we never probe Jarvis's own port as if it were the external Brain
        if port == self.jarvis_port:
            port = self.DEFAULT_BRAIN_PORT if self.jarvis_port != self.DEFAULT_BRAIN_PORT else 8000
            self.configured_url = f"http://{host}:{port}"

        http_open, latency = self._is_port_open(host, port)

        if not http_open and auto_discover:
            for cand_port in self.CANDIDATE_BRAIN_PORTS:
                if cand_port == self.jarvis_port:
                    continue
                is_up, cand_lat = self._is_port_open("127.0.0.1", cand_port)
                if is_up:
                    host = "127.0.0.1"
                    port = cand_port
                    http_open = True
                    latency = cand_lat
                    self.configured_url = f"http://{host}:{port}"
                    break

        sqlite_ok = bool(self.brain_db_path and os.path.isfile(self.brain_db_path))
        detected: List[str] = []
        remote_data: Dict[str, Any] = {}

        if http_open:
            for path in self.BRAIN_HEALTH_PATHS:
                target = f"http://{host}:{port}{path}"
                try:
                    req = urllib.request.Request(
                        target,
                        headers={
                            "Accept": "application/json",
                            "X-Jarvis-Cortex-Port": str(self.jarvis_port),
                        },
                        method="GET",
                    )
                    with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                        if resp.status < 400:
                            clean_ep = path.split("?")[0]
                            if clean_ep not in detected:
                                detected.append(clean_ep)
                            raw = resp.read(8192).decode("utf-8", errors="ignore")
                            try:
                                parsed = json.loads(raw)
                                if isinstance(parsed, dict) and not remote_data:
                                    remote_data = parsed
                                elif isinstance(parsed, list) and not remote_data:
                                    remote_data = {"items_count": len(parsed), "sample": parsed[:2]}
                            except Exception:
                                pass
                            if len(detected) >= 2:
                                break
                except Exception:
                    continue

        connected = http_open or sqlite_ok
        if http_open:
            label = f"BRAIN ONLINE ({host}:{port} ⇄ Jarvis :{self.jarvis_port} · {latency} ms)"
        elif sqlite_ok:
            label = f"BRAIN SQLITE LINKED (brain.db ⇄ Jarvis :{self.jarvis_port})"
        else:
            label = f"STANDBY (Jarvis :{self.jarvis_port} pronto ➔ Aguardando Brain em :{port})"

        status = BrainConnectionStatus(
            connected=connected,
            http_online=http_open,
            sqlite_linked=sqlite_ok,
            brain_url=f"http://{host}:{port}",
            jarvis_port=self.jarvis_port,
            brain_port=port,
            host=host,
            latency_ms=latency if http_open else None,
            status_label=label,
            sqlite_db_path=self.brain_db_path if sqlite_ok else None,
            detected_endpoints=detected,
            remote_payload=remote_data,
            synced_memories_count=self.sync_count,
            last_checked=time.time(),
        )
        self.last_status = status
        return status

    def dispatch_to_brain(
        self,
        directive_text: str,
        cortex_context: Dict[str, Any],
        workspace: str = "brain_mcp",
    ) -> Dict[str, Any]:
        """Forwards a command/directive from Jarvis (8766) to Antigravity Brain (8765) /api/jarvis."""
        status = self.probe(auto_discover=True)
        if not status.http_online:
            return {
                "forwarded": False,
                "brain_connected": status.connected,
                "http_online": False,
                "sqlite_linked": status.sqlite_linked,
                "brain_url": status.brain_url,
                "jarvis_port": self.jarvis_port,
                "brain_port": status.brain_port,
                "reason": (
                    f"Brain HTTP ({status.brain_url}) não está ativo neste momento; "
                    f"processado localmente no Jarvis Cortex OS (:{self.jarvis_port})."
                ),
                "brain_response": None,
            }

        # Antigravity Brain native /api/jarvis POST payload + generic fallback
        payload = {
            "action": "command",
            "prompt": directive_text,
            "text": directive_text,
            "workspace": workspace,
            "auto_dispatch_agy": False,
            "source": "jarvis-cortex-os",
            "jarvis_port": self.jarvis_port,
            "cortex_context": cortex_context,
        }
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        for path in ("/api/jarvis", "/api/directive", "/api/chat"):
            target = f"{status.brain_url}{path}"
            try:
                req = urllib.request.Request(
                    target,
                    data=encoded,
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "X-Jarvis-Cortex-Port": str(self.jarvis_port),
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=max(0.6, self.timeout_sec * 2)) as resp:
                    raw = resp.read(16384).decode("utf-8", errors="ignore")
                    self.sync_count += 1
                    try:
                        parsed = json.loads(raw)
                    except Exception:
                        parsed = {"raw_text": raw[:500]}
                    return {
                        "forwarded": True,
                        "brain_connected": True,
                        "http_online": True,
                        "brain_url": status.brain_url,
                        "jarvis_port": self.jarvis_port,
                        "brain_port": status.brain_port,
                        "endpoint": path,
                        "latency_ms": status.latency_ms,
                        "brain_response": parsed,
                    }
            except urllib.error.HTTPError as he:
                if he.code == 404:
                    continue
            except Exception:
                continue

        return {
            "forwarded": False,
            "brain_connected": True,
            "http_online": True,
            "brain_url": status.brain_url,
            "jarvis_port": self.jarvis_port,
            "brain_port": status.brain_port,
            "latency_ms": status.latency_ms,
            "reason": "Brain port open and telemetry linked.",
            "brain_response": status.remote_payload,
        }

    def sync_with_brain(self, synaptic_db: Any) -> Dict[str, Any]:
        """Bi-directionally syncs memories between Antigravity Brain (8765 / brain.db) and Jarvis SynapticDB (8766)."""
        status = self.probe(auto_discover=True)
        imported = 0

        # 1. Pull via HTTP GET /api/memories from Antigravity Brain (8765)
        if status.http_online:
            try:
                req = urllib.request.Request(
                    f"{status.brain_url}/api/memories",
                    headers={"Accept": "application/json"},
                    method="GET",
                )
                with urllib.request.urlopen(req, timeout=self.timeout_sec * 2) as resp:
                    raw = resp.read(65536).decode("utf-8", errors="ignore")
                    data = json.loads(raw)
                    items = data if isinstance(data, list) else data.get("memories", data.get("items", []))
                    if isinstance(items, list):
                        for item in items[:25]:
                            if isinstance(item, dict):
                                topic = str(item.get("category") or item.get("topic") or item.get("workspace") or "BrainSync")
                                content = str(item.get("content") or item.get("fact") or item.get("text") or "")
                                if content:
                                    entry = synaptic_db.store_memory(
                                        topic=topic,
                                        content=content,
                                        source_uri=f"brain_http://{status.host}:{status.brain_port}/api/memories",
                                        confidence=0.95,
                                    )
                                    if entry:
                                        imported += 1
            except Exception:
                pass

        # 2. Pull directly from ../antigravity-brain/brain.db SQLite if present on disk
        if status.sqlite_linked and self.brain_db_path:
            try:
                conn = sqlite3.connect(self.brain_db_path)
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
                tables = {r["name"] for r in cur.fetchall()}
                if "memories" in tables:
                    cur.execute("SELECT * FROM memories ORDER BY id DESC LIMIT 25")
                    for row in cur.fetchall():
                        r_dict = dict(row)
                        topic = str(r_dict.get("category") or r_dict.get("workspace") or "BrainDB")
                        content = str(r_dict.get("content") or r_dict.get("fact") or "")
                        if content:
                            entry = synaptic_db.store_memory(
                                topic=topic,
                                content=content,
                                source_uri=f"brain_sqlite://{os.path.basename(self.brain_db_path)}",
                                confidence=0.95,
                            )
                            if entry:
                                imported += 1
                conn.close()
            except Exception:
                pass

        self.sync_count += imported
        return {
            "ok": True,
            "imported_memories": imported,
            "total_synced_session": self.sync_count,
            "brain_status": self.probe(auto_discover=False).to_dict(),
        }
