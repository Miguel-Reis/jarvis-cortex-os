"""J.A.R.V.I.S. Cortex OS
====================
Autonomous Zero-Ollama Cognitive & Workflow Brain.

Subsystems:
- core: Real OS telemetry, Windows Kernel32 stats & Port Radar.
- memory: Synaptic DB with SQLite WAL, FTS5 BM25, 128-D LSH & HippoRAG 2 PPR.
- planning: Deterministic Next-Action Planner & Today Verified Outcome Gate.
- intelligence: Adaptive Personality, Vault Extractor & Routine Discovery.
- security: Authority-Aware Trust Boundaries & Prompt-Injection Canary.
- voice: Neural Speech Streamer & Skywalker Sound Mark-VII Helmet DSP.
"""

from __future__ import annotations

__version__ = "1.0.0"
__author__ = "Miguel Reis"

from jarvis_os.core.telemetry import TelemetryRadar
from jarvis_os.memory.synaptic_db import SynapticDB
from jarvis_os.planning.next_action import NextActionPlanner
from jarvis_os.planning.today_contract import TodayContractGate
from jarvis_os.intelligence.personality import PersonalityEngine
from jarvis_os.intelligence.vault_extractor import VaultExtractor
from jarvis_os.intelligence.routine_discovery import RoutineDiscoveryEngine
from jarvis_os.security.trust_boundary import TrustBoundaryGate
from jarvis_os.voice.mark_vii_tts import MarkVIISpeechSynthesizer

__all__ = [
    "__version__",
    "TelemetryRadar",
    "SynapticDB",
    "NextActionPlanner",
    "TodayContractGate",
    "PersonalityEngine",
    "VaultExtractor",
    "RoutineDiscoveryEngine",
    "TrustBoundaryGate",
    "MarkVIISpeechSynthesizer",
]
