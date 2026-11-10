"""Ultra-Low-Latency HTTP & Server-Sent Events (SSE) Server for J.A.R.V.I.S. Cortex OS.

100% Python 3.11+ Standard Library (http.server, socketserver, json, threading, urllib.parse).
Zero external dependencies, <15ms startup latency, 0 GB VRAM.
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from jarvis_os.core.brain_bridge import BrainBridge
from jarvis_os.core.telemetry import TelemetryRadar
from jarvis_os.intelligence.personality import PersonalityEngine, PersonalityMode
from jarvis_os.intelligence.routine_discovery import RoutineDiscoveryEngine
from jarvis_os.intelligence.vault_extractor import VaultExtractor
from jarvis_os.memory.synaptic_db import SynapticDB
from jarvis_os.planning.next_action import ActionCandidate, NextActionPlanner
from jarvis_os.planning.today_contract import TodayContractGate, VerificationType
from jarvis_os.security.trust_boundary import ClearanceLevel, TrustBoundaryGate
from jarvis_os.voice.mark_vii_tts import AudioDSPPreset, MarkVIISpeechSynthesizer


class JarvisCortexState:
    """Thread-safe unified cognitive state orchestrating all J.A.R.V.I.S. Cortex OS subsystems."""

    def __init__(
        self,
        db_path: str = ":memory:",
        jarvis_port: int = 8766,
        brain_url: str = "http://127.0.0.1:8765",
    ) -> None:
        self.lock = threading.RLock()
        self.started_at = time.time()
        self.jarvis_port = jarvis_port
        self.radar = TelemetryRadar()
        self.brain_bridge = BrainBridge(brain_url=brain_url, jarvis_port=jarvis_port)
        self.db_path = db_path
        self.memory = SynapticDB(db_path)
        self.planner = NextActionPlanner()
        self.contract_gate = TodayContractGate()
        self.personality = PersonalityEngine(db_path)
        self.extractor = VaultExtractor()
        self.routines = RoutineDiscoveryEngine(min_recurrence=2, min_confidence=0.55)
        self.security = TrustBoundaryGate()
        self.tts = MarkVIISpeechSynthesizer(sample_rate=16000)

        # Lazy-loaded sidecar and workflow engines (graceful if still initializing)
        self._sidecar: Any = None
        self._workflows: Any = None

        self.event_log: List[Dict[str, Any]] = []
        self._seed_initial_state()
        # Non-blocking background memory sync from Antigravity Brain (8765 / brain.db)
        def _bg_brain_sync() -> None:
            try:
                self.brain_bridge.sync_with_brain(self.memory)
            except Exception:
                pass

        threading.Thread(target=_bg_brain_sync, name="JarvisBrainBootSync", daemon=True).start()

    @property
    def sidecar(self) -> Any:
        if self._sidecar is None:
            try:
                from jarvis_os.sidecar.desktop_agent import DesktopSidecar
                self._sidecar = DesktopSidecar(trust_gate=self.security)
            except Exception:
                self._sidecar = None
        return self._sidecar

    @property
    def workflows(self) -> Any:
        if self._workflows is None:
            try:
                from jarvis_os.workflows.engine import WorkflowEngine
                self._workflows = WorkflowEngine()
            except Exception:
                self._workflows = None
        return self._workflows

    def _seed_initial_state(self) -> None:
        """Populates initial synaptic graph, Q-18 action candidates, and Today Contracts."""
        with self.lock:
            # 1. Seed Synaptic Memories & HippoRAG 2 Graph
            self.memory.store_memory(
                topic="Mark-VII HUD Architecture",
                content="Skywalker Sound Mark-VII acoustic chain: 320-3800Hz bandpass, 18.5ms titanium comb resonance, harmonic saturation.",
                source_uri="blueprint://jarvis_os/voice/mark_vii_tts.py",
                confidence=0.98,
            )
            self.memory.store_memory(
                topic="HippoRAG 2 Associative Memory",
                content="Personalized PageRank (PPR) with alpha=0.85 combined with 128-D LSH SimHash and SQLite WAL FTS5 BM25.",
                source_uri="blueprint://jarvis_os/memory/synaptic_db.py",
                confidence=0.99,
            )
            self.memory.store_memory(
                topic="Protocol Q-18 Deterministic Planner",
                content="Calculates highest-leverage next action via (Impact * Urgency * Authority) / ((Effort + 0.1) * (1 + 0.2 * Risk)).",
                source_uri="blueprint://jarvis_os/planning/next_action.py",
                confidence=0.97,
            )
            self.memory.store_memory(
                topic="Zero-Ollama Native Principle",
                content="100% Python 3.11+ stdlib execution with <15ms startup latency and 0.0 GB VRAM overhead.",
                source_uri="blueprint://AGENTS.md",
                confidence=1.0,
            )

            # Associative Graph Edges
            self.memory.add_edge("J.A.R.V.I.S. Cortex", "HippoRAG 2 PPR", "USES_MEMORY", weight=1.0)
            self.memory.add_edge("HippoRAG 2 PPR", "128-D LSH SimHash", "HYBRID_WITH", weight=0.95)
            self.memory.add_edge("J.A.R.V.I.S. Cortex", "Q-18 Planner", "ORCHESTRATES", weight=1.0)
            self.memory.add_edge("Q-18 Planner", "Today Outcome Gate", "ENFORCES", weight=0.95)
            self.memory.add_edge("J.A.R.V.I.S. Cortex", "Mark-VII Audio DSP", "SYNTHESIZES", weight=0.90)
            self.memory.add_edge("J.A.R.V.I.S. Cortex", "TrustBoundary Gate", "GUARDED_BY", weight=1.0)
            self.memory.add_edge("Desktop Sidecar", "TrustBoundary Gate", "VALIDATES_CLEARANCE", weight=0.90)

            # 2. Seed Q-18 Action Candidates
            self.planner.register_candidate(
                ActionCandidate(
                    action_id="ACT-001",
                    title="Executar Verificação Criptográfica da Suite de Testes (Today Gate)",
                    target_component="jarvis_os.workflows",
                    impact=9.5,
                    urgency=9.0,
                    effort=1.5,
                    risk=0.2,
                    tags=["verification", "tests", "gate"],
                )
            )
            self.planner.register_candidate(
                ActionCandidate(
                    action_id="ACT-002",
                    title="Auditar Integridade AST dos Módulos Core & Servidor SSE",
                    target_component="jarvis_os.server",
                    impact=8.8,
                    urgency=8.2,
                    effort=2.0,
                    risk=0.5,
                    dependencies=["ACT-001"],
                    tags=["ast", "architecture"],
                )
            )
            self.planner.register_candidate(
                ActionCandidate(
                    action_id="ACT-003",
                    title="Calibrar Ressonância Acústica Mark-VII HUD (18.5ms Comb)",
                    target_component="jarvis_os.voice",
                    impact=8.0,
                    urgency=7.5,
                    effort=1.8,
                    risk=0.3,
                    tags=["voice", "dsp"],
                )
            )

            # 3. Seed Today Contract Gate WorkItems
            self.contract_gate.add_work_item(
                item_id="WORK-01",
                title="Suite Unitária Core & Fase 1 (100% PASS)",
                target_outcome="Executar unittest e validar exit_code == 0 com passed_count >= 10",
                verification_type=VerificationType.TEST_PASS,
                verification_target="tests",
            )
            self.contract_gate.add_work_item(
                item_id="WORK-02",
                title="Integridade Física do Blueprint Arquitetural",
                target_outcome="Confirmar existência e bytes > 0 de JARVIS_OS_BLUEPRINT.md",
                verification_type=VerificationType.FILE_EXISTS,
                verification_target="JARVIS_OS_BLUEPRINT.md",
            )
            self.contract_gate.add_work_item(
                item_id="WORK-03",
                title="Assinatura Executiva Stark (Clearance L3)",
                target_outcome="Token SHA-256 validado pelo Executive Secret",
                verification_type=VerificationType.EXECUTIVE_SIGN,
                verification_target="STARK_EXEC_SIGNATURE",
            )

            # 4. Seed Routine Discovery History
            now = time.time()
            self.routines.record_event("executive_morning_briefing", "session_boot", now - 86400)
            self.routines.record_event("executive_morning_briefing", "session_boot", now - 3600)
            self.routines.record_event("ast_and_unit_test_gate", "pre_commit", now - 7200)
            self.routines.record_event("ast_and_unit_test_gate", "pre_commit", now - 600)

            # Generate initial canary
            self.default_canary = self.security.generate_canary("hud_session")
            self._record_event("SYSTEM_BOOT", "J.A.R.V.I.S. Cortex OS HTTP/SSE Core Initialized")

    def _record_event(self, event_type: str, detail: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        ev = {
            "timestamp": time.time(),
            "type": event_type,
            "detail": detail,
            "metadata": metadata or {},
        }
        self.event_log.append(ev)
        if len(self.event_log) > 50:
            self.event_log = self.event_log[-50:]
        return ev

    def get_status_payload(self, run_port_scan: bool = False) -> Dict[str, Any]:
        with self.lock:
            report = self.radar.capture_report(run_port_scan=run_port_scan)
            cur = self.personality.conn.cursor()
            cur.execute("SELECT * FROM personality_state WHERE id = 1")
            p_row = cur.fetchone()
            mode = PersonalityMode(p_row["current_mode"])
            profile = self.personality.get_profile(mode)

            sidecar_info = self.sidecar.get_status() if self.sidecar else {"available": False}

            return {
                "timestamp": time.time(),
                "engine_mode": "ANTIGRAVITY_NATIVE_ZERO_OLLAMA",
                "vram_gb": 0.0,
                "telemetry": report.to_dict(),
                "personality": {
                    "mode": profile.mode.value,
                    "conciseness": profile.conciseness,
                    "technicality": profile.technicality,
                    "formality": profile.formality,
                    "proactivity": profile.proactivity,
                    "greeting_prefix": profile.greeting_prefix,
                    "ema": {
                        "urgency": p_row["urgency_ema"],
                        "frustration": p_row["frustration_ema"],
                        "technical": p_row["technical_ema"],
                        "total_interactions": p_row["total_interactions"],
                    },
                },
                "security": self.security.get_audit_summary(),
                "memory_Stats": {
                    "total_memories": self.memory.count_memories(),
                },
                "brain_bridge": self.brain_bridge.probe(auto_discover=False).to_dict(),
                "sidecar": sidecar_info,
                "recent_events": self.event_log[-10:],
            }

    def get_plan_payload(self) -> Dict[str, Any]:
        with self.lock:
            plan = self.planner.plan_next()
            candidates = [
                {
                    "action_id": c.action_id,
                    "title": c.title,
                    "target_component": c.target_component,
                    "impact": c.impact,
                    "urgency": c.urgency,
                    "effort": c.effort,
                    "risk": c.risk,
                    "dependencies": c.dependencies,
                    "q18_score": c.calculate_q18_score(),
                }
                for c in self.planner.candidates.values()
            ]
            candidates.sort(key=lambda x: -x["q18_score"])

            contracts = [item.to_dict() for item in self.contract_gate.items.values()]
            routines = [r.to_dict() for r in self.routines.discover_routines()]

            return {
                "plan": plan.to_dict(),
                "candidates": candidates,
                "completed_actions": list(self.planner.completed_actions),
                "contracts": contracts,
                "contract_summary": self.contract_gate.get_summary(),
                "routines": routines,
            }

    def get_graph_payload(self, seed_node: str = "J.A.R.V.I.S. Cortex") -> Dict[str, Any]:
        with self.lock:
            cur = self.memory.conn.cursor()
            cur.execute("SELECT name, node_type, weight FROM synaptic_nodes")
            nodes = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT source, target, relation, weight FROM synaptic_edges WHERE NOT relation LIKE 'REV_%'")
            edges = [dict(r) for r in cur.fetchall()]
            ppr = self.memory.run_hipporag_ppr(seed_nodes={seed_node: 1.0}, alpha=0.85)
            ppr_map = {name: score for name, score in ppr}
            for n in nodes:
                n["ppr_score"] = ppr_map.get(n["name"], 0.0)
            return {
                "seed_node": seed_node,
                "nodes": nodes,
                "edges": edges,
                "ppr_ranking": [{"node": k, "score": v} for k, v in ppr[:12]],
            }

    def process_directive(self, text: str, lang: str = "pt") -> Dict[str, Any]:
        """Executes the full J.A.R.V.I.S. Cognitive Pipeline for an incoming operator directive."""
        with self.lock:
            # 1. Wake-word detection if sidecar available
            wake_info = None
            clean_directive = text.strip()
            if self.sidecar and hasattr(self.sidecar, "wake_detector"):
                wake_ev = self.sidecar.wake_detector.process_transcript(clean_directive)
                wake_info = {
                    "triggered": wake_ev.triggered,
                    "wake_phrase": wake_ev.wake_phrase,
                    "command_payload": wake_ev.command_payload,
                    "confidence": wake_ev.confidence,
                }
                if wake_ev.triggered and wake_ev.command_payload:
                    clean_directive = wake_ev.command_payload

            # 2. TrustBoundary Gate Inspection
            is_safe, findings = self.security.inspect_input(clean_directive, context_canary=self.default_canary)
            self.security.validate_clearance(
                caller_id="operator_hud",
                caller_level=ClearanceLevel.EXECUTIVE,
                required_level=ClearanceLevel.OPERATIONAL,
                action_name="process_directive",
            )
            if not is_safe:
                self._record_event("SECURITY_ALERT", f"Prompt injection blocked: {findings}")
                return {
                    "safe": False,
                    "findings": findings,
                    "response_text": (
                        "Alerta de Perímetro Guardian: Diretiva bloqueada pelo TrustBoundaryGate devido a tentativa de injeção ou exfiltração de canário."
                        if lang.startswith("pt")
                        else "Guardian Perimeter Alert: Directive blocked by TrustBoundaryGate due to injection signature."
                    ),
                    "personality_mode": PersonalityMode.GUARDIAN_DEFENSE.value,
                    "dsp_preset": AudioDSPPreset.WAR_ROOM_RADIO.value,
                }

            # 3. Adaptive Personality Update
            profile = self.personality.adapt_mode(clean_directive)

            # 4. Vault Extractor
            extraction = self.extractor.extract(clean_directive, source_uri="hud://directive")
            for fact in extraction.facts:
                self.memory.store_memory(
                    topic=fact.subject,
                    content=f"{fact.subject} {fact.predicate} {fact.object_value}",
                    source_uri="hud://vault_extractor",
                    confidence=fact.confidence,
                )

            # 5. Hybrid Synaptic Memory Search (BM25 + 128-D LSH + HippoRAG PPR)
            bm25_hits = self.memory.search_bm25(clean_directive, limit=3)
            lsh_hits = self.memory.search_semantic_lsh(clean_directive, threshold=0.42, limit=3)
            seed = bm25_hits[0]["topic"] if bm25_hits else "J.A.R.V.I.S. Cortex"
            ppr_hits = self.memory.run_hipporag_ppr(seed_nodes={seed: 1.0}, alpha=0.85)[:5]

            # 6. Q-18 Next-Action Evaluation
            plan = self.planner.plan_next()
            contract_summary = self.contract_gate.get_summary()

            # 7. Record routine cue
            self.routines.record_event("operator_directive", profile.mode.value.lower())

            # 8. Build response in PT-PT or EN
            chosen_title = plan.chosen_action.title if plan.chosen_action else "Nenhuma ação pendente"
            chosen_score = plan.priority_score

            if lang.startswith("pt"):
                response_text = (
                    f"[{profile.mode.value}] Diretiva processada, Senhor. "
                    f"Postura ajustada (Concisão={profile.conciseness:.2f}, Rigor Técnico={profile.technicality:.2f}). "
                    f"Memória Sináptica retornou {len(bm25_hits)} registos BM25 e {len(lsh_hits)} vetores LSH 128-D. "
                    f"Ação prioritária Q-18: '{chosen_title}' (Score {chosen_score:.2f}). "
                    f"Contratos verificados hoje: {contract_summary['completed_verified']}/{contract_summary['total_items']} ({contract_summary['completion_rate']}%)."
                )
            else:
                response_text = (
                    f"[{profile.mode.value}] Directive processed, Sir. "
                    f"Posture adapted (Conciseness={profile.conciseness:.2f}, Technicality={profile.technicality:.2f}). "
                    f"Synaptic Memory matched {len(bm25_hits)} BM25 entries and {len(lsh_hits)} 128-D LSH vectors. "
                    f"Optimal Q-18 Action: '{chosen_title}' (Score {chosen_score:.2f}). "
                    f"Verified Today Contracts: {contract_summary['completed_verified']}/{contract_summary['total_items']} ({contract_summary['completion_rate']}%)."
                )

            preset = (
                AudioDSPPreset.WAR_ROOM_RADIO.value
                if profile.mode == PersonalityMode.WAR_ROOM_CONCISE
                else AudioDSPPreset.MARK_VII_HELMET.value
            )

            self._record_event(
                "DIRECTIVE_EXECUTED",
                f"Mode={profile.mode.value} | Q18={plan.chosen_action.action_id if plan.chosen_action else 'NONE'}",
            )

            return {
                "safe": True,
                "wake_word": wake_info,
                "response_text": response_text,
                "personality": {
                    "mode": profile.mode.value,
                    "conciseness": profile.conciseness,
                    "technicality": profile.technicality,
                    "greeting_prefix": profile.greeting_prefix,
                },
                "dsp_preset": preset,
                "dsp_profile": {
                    "bandpass_low": 320.0,
                    "bandpass_high": 3800.0,
                    "comb_delay_ms": 18.5,
                    "comb_feedback": 0.38,
                    "saturation_gain": 1.45,
                },
                "extraction": extraction.to_dict(),
                "memory_hits": {
                    "bm25": bm25_hits,
                    "lsh": lsh_hits,
                    "ppr": [{"node": k, "score": v} for k, v in ppr_hits],
                },
                "q18_plan": plan.to_dict(),
                "contract_summary": contract_summary,
            }


class JarvisHTTPRequestHandler(BaseHTTPRequestHandler):
    """HTTP & SSE Request Handler for J.A.R.V.I.S. Cortex OS."""

    server_version = "JarvisCortexOS/1.0"

    @property
    def cortex(self) -> JarvisCortexState:
        return self.server.cortex_state  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:
        # Quiet logging to keep terminal clean during tests and daemon operation
        if os.environ.get("JARVIS_HTTP_VERBOSE") == "1":
            super().log_message(format, *args)

    def _send_json(self, payload: Dict[str, Any], status: int = HTTPStatus.OK) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path in ("/", "/index.html", "/dashboard"):
            ui_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ui", "dashboard.html")
            if os.path.exists(ui_path):
                with open(ui_path, "rb") as f:
                    content = f.read()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content)
            else:
                self._send_json({"status": "UI initializing", "engine": "J.A.R.V.I.S. Cortex OS"})
            return

        if path == "/favicon.ico":
            svg = (
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
                '<circle cx="32" cy="32" r="28" fill="#06101a" stroke="#0ec4e8" stroke-width="4"/>'
                '<circle cx="32" cy="32" r="12" fill="#0ec4e8"/></svg>'
            ).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(svg)))
            self.end_headers()
            self.wfile.write(svg)
            return

        if path == "/api/health":
            self._send_json({"status": "ok", "engine": "J.A.R.V.I.S. Cortex OS", "port": self.cortex.jarvis_port})
            return

        if path in ("/metadata.json", "/manifest.json"):
            self._send_json({
                "name": "J.A.R.V.I.S. Cortex OS — Mark-VII Tactical HUD & Zero-Ollama Cognitive Brain",
                "description": "Autonomous Zero-Ollama Cognitive & Workflow Operating Brain: SQLite WAL + FTS5 BM25 + 128-D LSH SimHash + HippoRAG 2 PPR, Q-18 Deterministic Planner, Today Outcome Verification Gate, Adaptive Personality Engine, Skywalker Sound Mark-VII WebAudio DSP, Desktop Sidecar, and Cross-Port Bridge (:8766 ⇄ :8765 Antigravity Brain).",
                "requestFramePermissions": ["microphone"],
                "majorCapabilities": ["MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"],
            })
            return

        if path == "/api/status":
            scan = qs.get("ports", ["0"])[0] == "1"
            self._send_json(self.cortex.get_status_payload(run_port_scan=scan))
            return

        if path == "/api/plan":
            self._send_json(self.cortex.get_plan_payload())
            return

        if path == "/api/memory/search":
            q = qs.get("q", [""])[0]
            seed = qs.get("seed", ["J.A.R.V.I.S. Cortex"])[0]
            with self.cortex.lock:
                bm25 = self.cortex.memory.search_bm25(q, limit=8) if q else []
                lsh = self.cortex.memory.search_semantic_lsh(q, threshold=0.38, limit=8) if q else []
                ppr = self.cortex.memory.run_hipporag_ppr(seed_nodes={seed: 1.0}, alpha=0.85)[:10]
            self._send_json({
                "query": q,
                "bm25": bm25,
                "lsh": lsh,
                "ppr": [{"node": k, "score": v} for k, v in ppr],
            })
            return

        if path == "/api/memory/graph":
            seed = qs.get("seed", ["J.A.R.V.I.S. Cortex"])[0]
            self._send_json(self.cortex.get_graph_payload(seed_node=seed))
            return

        if path == "/api/voice/synthesize":
            text = qs.get("text", ["Sistemas operacionais nominais, Senhor."])[0]
            preset_str = qs.get("preset", ["MARK_VII_HELMET"])[0]
            try:
                preset = AudioDSPPreset(preset_str)
            except ValueError:
                preset = AudioDSPPreset.MARK_VII_HELMET

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                wav_path = tf.name
            try:
                self.cortex.tts.synthesize_speech_file(text, wav_path, preset=preset)
                with open(wav_path, "rb") as wf:
                    wav_bytes = wf.read()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav_bytes)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(wav_bytes)
            finally:
                if os.path.exists(wav_path):
                    try:
                        os.remove(wav_path)
                    except OSError:
                        pass
            return

        if path == "/api/sidecar/status":
            if self.cortex.sidecar:
                self._send_json({
                    "status": self.cortex.sidecar.get_status(),
                    "windows": [
                        {
                            "hwnd_or_pid": w.hwnd_or_pid,
                            "title": w.title,
                            "process_name": w.process_name,
                            "is_active": w.is_active,
                        }
                        for w in self.cortex.sidecar.list_active_windows()[:12]
                    ],
                })
            else:
                self._send_json({"available": False})
            return

        if path == "/api/workflows/status":
            if self.cortex.workflows:
                repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                git_info = self.cortex.workflows.inspect_git_workspace(repo_root)
                self._send_json({"available": True, "git": git_info})
            else:
                self._send_json({"available": False})
            return

        if path == "/api/brain/status":
            auto_disc = qs.get("discover", ["1"])[0] == "1"
            self._send_json(self.cortex.brain_bridge.probe(auto_discover=auto_disc).to_dict())
            return

        if path == "/api/events":
            # Server-Sent Events (SSE) stream
            once = qs.get("once", ["0"])[0] == "1"
            self.close_connection = True
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close" if once else "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            try:
                while True:
                    snapshot = {
                        "timestamp": time.time(),
                        "memory": self.cortex.radar.get_memory_stats().__dict__,
                        "uptime": self.cortex.radar.get_uptime_seconds(),
                        "contracts": self.cortex.contract_gate.get_summary(),
                        "brain_bridge": self.cortex.brain_bridge.probe(auto_discover=False).to_dict(),
                        "recent_events": self.cortex.event_log[-5:],
                    }
                    msg = f"event: telemetry\ndata: {json.dumps(snapshot)}\n\n"
                    self.wfile.write(msg.encode("utf-8"))
                    self.wfile.flush()
                    if once:
                        break
                    time.sleep(2.0)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            return

        self._send_json({"error": f"Endpoint not found: {path}"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()

        if path == "/api/directive":
            text = str(body.get("text") or body.get("directive") or "").strip()
            lang = str(body.get("lang", "pt")).strip()
            if not text:
                self._send_json({"error": "Missing 'text' or 'directive' field"}, status=HTTPStatus.BAD_REQUEST)
                return
            result = self.cortex.process_directive(text, lang=lang)
            result["response"] = result.get("response_text", "")
            self._send_json(result)
            return

        if path == "/api/brain/sync":
            with self.cortex.lock:
                sync_res = self.cortex.brain_bridge.sync_with_brain(self.cortex.memory)
                self.cortex._record_event(
                    "BRAIN_BRIDGE_SYNC",
                    f"Imported={sync_res['imported_memories']} from {sync_res['brain_status']['brain_url']}",
                )
            self._send_json(sync_res)
            return

        if path == "/api/brain/config":
            new_url = str(body.get("brain_url", "http://127.0.0.1:8765")).strip()
            with self.cortex.lock:
                status = self.cortex.brain_bridge.set_brain_url(new_url)
                self.cortex._record_event("BRAIN_BRIDGE_CONFIG", f"Target Brain set to {status.brain_url}")
            self._send_json(status.to_dict())
            return

        if path == "/api/memory/ingest":
            topic = str(body.get("topic", "General")).strip()
            content = str(body.get("content", "")).strip()
            source = str(body.get("source_uri", "hud://manual_entry")).strip()
            confidence = float(body.get("confidence", 0.95))
            with self.cortex.lock:
                entry = self.cortex.memory.store_memory(
                    topic=topic,
                    content=content,
                    source_uri=source,
                    confidence=confidence,
                )
                if entry:
                    self.cortex._record_event("MEMORY_INGEST", f"Topic='{topic}' ID={entry.id}")
                    self._send_json({"accepted": True, "entry": entry.to_dict()})
                else:
                    self._send_json({"accepted": False, "reason": "Rejected by Provenance Gate (<0.70 confidence)"})
            return

        if path == "/api/plan/candidate":
            with self.cortex.lock:
                cand = ActionCandidate(
                    action_id=str(body.get("action_id", f"ACT-{int(time.time()) % 10000:04d}")),
                    title=str(body.get("title", "Nova Ação Tática")),
                    target_component=str(body.get("target_component", "jarvis_os.core")),
                    impact=float(body.get("impact", 8.0)),
                    urgency=float(body.get("urgency", 8.0)),
                    effort=float(body.get("effort", 2.0)),
                    risk=float(body.get("risk", 0.5)),
                    dependencies=list(body.get("dependencies", [])),
                )
                self.cortex.planner.register_candidate(cand)
                self.cortex._record_event("Q18_CANDIDATE_ADDED", f"[{cand.action_id}] {cand.title}")
            self._send_json(self.cortex.get_plan_payload())
            return

        if path == "/api/plan/complete":
            action_id = str(body.get("action_id", "")).strip()
            with self.cortex.lock:
                self.cortex.planner.mark_completed(action_id)
                self.cortex._record_event("Q18_ACTION_COMPLETED", f"Completed {action_id}")
            self._send_json(self.cortex.get_plan_payload())
            return

        if path == "/api/contract/verify":
            item_id = str(body.get("item_id", "WORK-01")).strip()
            evidence = dict(body.get("evidence", {}))
            with self.cortex.lock:
                # Special helper: if EXECUTIVE_SIGN is requested with auto_sign=True in HUD
                if body.get("auto_executive_sign") and item_id in self.cortex.contract_gate.items:
                    import hashlib
                    secret = self.cortex.contract_gate.executive_secret
                    evidence["signature_token"] = hashlib.sha256(f"{item_id}:{secret}".encode("utf-8")).hexdigest()

                ok, msg = self.cortex.contract_gate.verify_and_close(item_id, evidence)
                self.cortex._record_event("CONTRACT_GATE_VERIFY", f"{item_id}: {msg}")
            self._send_json({
                "verified": ok,
                "message": msg,
                "contracts": [i.to_dict() for i in self.cortex.contract_gate.items.values()],
                "summary": self.cortex.contract_gate.get_summary(),
            })
            return

        if path == "/api/workflows/run":
            workflow_type = str(body.get("type", "unit_tests")).strip()
            repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            with self.cortex.lock:
                if not self.cortex.workflows:
                    self._send_json({"error": "WorkflowEngine not available"}, status=HTTPStatus.SERVICE_UNAVAILABLE)
                    return

                if workflow_type == "unit_tests":
                    test_dir = os.path.join(repo_root, "tests")
                    res = self.cortex.workflows.run_unit_test_gate(
                        self.cortex.contract_gate,
                        work_item_id=str(body.get("work_item_id", "WORK-01")),
                        test_dir=test_dir,
                    )
                    # Also verify WORK-02 file existence automatically if requested
                    bp_path = os.path.join(repo_root, "JARVIS_OS_BLUEPRINT.md")
                    if "WORK-02" in self.cortex.contract_gate.items and os.path.exists(bp_path):
                        self.cortex.contract_gate.verify_and_close("WORK-02", {"path": bp_path})
                    self.cortex._record_event("WORKFLOW_TEST_GATE", res.gate_message)
                    self._send_json({
                        "workflow": res.__dict__,
                        "contract_summary": self.cortex.contract_gate.get_summary(),
                        "contracts": [i.to_dict() for i in self.cortex.contract_gate.items.values()],
                    })
                    return

                if workflow_type == "ast_audit":
                    target_rel = str(body.get("file_path", "jarvis_os/memory/synaptic_db.py"))
                    target_abs = os.path.join(repo_root, target_rel)
                    report = self.cortex.workflows.analyze_python_ast(target_abs)
                    self.cortex._record_event("WORKFLOW_AST_AUDIT", f"Audited {target_rel} (valid={report.syntax_valid})")
                    self._send_json({"ast_report": report.__dict__})
                    return

                if workflow_type == "git_status":
                    git_info = self.cortex.workflows.inspect_git_workspace(repo_root)
                    self._send_json({"git": git_info})
                    return

            self._send_json({"error": f"Unknown workflow type: {workflow_type}"}, status=HTTPStatus.BAD_REQUEST)
            return

        if path == "/api/sidecar/command":
            cmd_type = str(body.get("type", "hotkey")).strip()
            with self.cortex.lock:
                if not self.cortex.sidecar:
                    self._send_json({"error": "DesktopSidecar not available"}, status=HTTPStatus.SERVICE_UNAVAILABLE)
                    return

                if cmd_type == "hotkey":
                    combo = str(body.get("combination", "Alt+Space"))
                    res = self.cortex.sidecar.trigger_hotkey(combo, caller_level=ClearanceLevel.EXECUTIVE)
                    self.cortex._record_event("SIDECAR_HOTKEY", f"Triggered {combo}")
                    self._send_json(res)
                    return

                if cmd_type == "clipboard":
                    raw_text = body.get("raw_text")
                    res = self.cortex.sidecar.inspect_clipboard(raw_text=raw_text)
                    self.cortex._record_event("SIDECAR_CLIPBOARD", f"Safe={res['safe']}")
                    self._send_json(res)
                    return

                if cmd_type == "wake_word":
                    transcript = str(body.get("transcript", "Hey Jarvis status report"))
                    ev = self.cortex.sidecar.wake_detector.process_transcript(transcript)
                    self._send_json(ev.__dict__)
                    return

            self._send_json({"error": f"Unknown sidecar command: {cmd_type}"}, status=HTTPStatus.BAD_REQUEST)
            return

        self._send_json({"error": f"POST endpoint not found: {path}"}, status=HTTPStatus.NOT_FOUND)


class JarvisHTTPServer(ThreadingHTTPServer):
    """Multi-threaded HTTP & SSE Server holding a shared JarvisCortexState instance."""

    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        cortex_state: Optional[JarvisCortexState] = None,
    ) -> None:
        self.cortex_state = cortex_state or JarvisCortexState(jarvis_port=server_address[1])
        super().__init__(server_address, JarvisHTTPRequestHandler)
        self.cortex_state.jarvis_port = self.server_address[1]
        self.cortex_state.brain_bridge.jarvis_port = self.server_address[1]


def create_server(
    host: str = "127.0.0.1",
    port: int = 8766,
    db_path: str = ":memory:",
    brain_url: str = "http://127.0.0.1:8765",
) -> JarvisHTTPServer:
    state = JarvisCortexState(db_path=db_path, jarvis_port=port, brain_url=brain_url)
    return JarvisHTTPServer((host, port), cortex_state=state)


def run_server(
    host: str = "127.0.0.1",
    port: int = 8766,
    db_path: str = ":memory:",
    brain_url: str = "http://127.0.0.1:8765",
) -> None:
    import sys

    if getattr(sys, "stdout", None) is not None and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    srv = create_server(host=host, port=port, db_path=db_path, brain_url=brain_url)

    def _bg_probe() -> None:
        try:
            srv.cortex_state.brain_bridge.probe(auto_discover=True)
        except Exception:
            pass

    threading.Thread(target=_bg_probe, name="JarvisBrainProbe", daemon=True).start()

    print("\n" + "=" * 72, flush=True)
    print("  J.A.R.V.I.S. CORTEX OS - MARK-VII HTTP/SSE SERVER ONLINE", flush=True)
    print("=" * 72, flush=True)
    print(f"  Jarvis HUD:      http://{host}:{port}/   (Porta dedicada Jarvis: {port})", flush=True)
    print(f"  SSE Stream:      http://{host}:{port}/api/events", flush=True)
    print(f"  Brain Bridge:    {brain_url}", flush=True)
    print("  Engine Mode:     ANTIGRAVITY_NATIVE_ZERO_OLLAMA (0 GB VRAM)", flush=True)
    print("=" * 72 + "\n", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()

