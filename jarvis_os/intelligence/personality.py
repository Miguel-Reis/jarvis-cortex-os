"""Adaptive Personality Engine & Signal Detector (SQLite-backed).

Dynamically modulates conversational cadence, technical depth, and tone based on incoming
signals (urgency, frustration, analytical depth, directive command).
"""

from __future__ import annotations

import enum
import re
import sqlite3
import time
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Tuple


class PersonalityMode(str, enum.Enum):
    STARK_EXECUTIVE = "STARK_EXECUTIVE"      # Sharp, high-agency, witty, decisive
    TACTICAL_ENGINEER = "TACTICAL_ENGINEER"  # Deep architectural precision, analytical
    WAR_ROOM_CONCISE = "WAR_ROOM_CONCISE"    # Urgent, ultra-terse, incident response
    GUARDIAN_DEFENSE = "GUARDIAN_DEFENSE"    # Security-first, paranoid, threat verification


@dataclass
class InteractionSignal:
    urgency_score: float       # 0.0 - 1.0
    technical_depth: float     # 0.0 - 1.0
    frustration_level: float   # 0.0 - 1.0
    directive_ratio: float     # 0.0 - 1.0
    detected_markers: List[str]


@dataclass
class PersonalityProfile:
    mode: PersonalityMode
    conciseness: float         # 0.0 (elaborate) - 1.0 (ultra-terse)
    technicality: float        # 0.0 (high-level) - 1.0 (source code / metrics)
    formality: float           # 0.0 (casual) - 1.0 (executive protocol)
    proactivity: float         # 0.0 (reactive) - 1.0 (anticipatory)
    greeting_prefix: str


class PersonalityEngine:
    """Modulates Jarvis's psychological and conversational posture based on real-time cues."""

    URGENCY_REGEX = re.compile(r"\b(urgente|rapido|asap|critico|down|emergencia|break|timeout|panic|alerta)\b", re.IGNORECASE)
    ANALYTICAL_REGEX = re.compile(r"\b(porquê|como funciona|explica|arquitetura|detalhes|benchmark|profiling|porque|why|how)\b", re.IGNORECASE)
    FRUSTRATION_REGEX = re.compile(r"\b(falhou|bug|erro|nao funciona|não funciona|merda|droga|quebrou|broken|failing|stuck)\b", re.IGNORECASE)
    DIRECTIVE_REGEX = re.compile(r"\b(faz|executa|cria|corrige|deploy|commit|push|build|run|start|stop|fix)\b", re.IGNORECASE)

    def __init__(self, db_path: str = ":memory:") -> None:
        self.db_path = db_path
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self) -> None:
        cur = self.conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS personality_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                current_mode TEXT NOT NULL,
                urgency_ema REAL NOT NULL,
                frustration_ema REAL NOT NULL,
                technical_ema REAL NOT NULL,
                total_interactions INTEGER NOT NULL,
                last_updated REAL NOT NULL
            );
        """)
        cur.execute("""
            INSERT OR IGNORE INTO personality_state 
            (id, current_mode, urgency_ema, frustration_ema, technical_ema, total_interactions, last_updated)
            VALUES (1, 'STARK_EXECUTIVE', 0.2, 0.1, 0.7, 0, ?);
        """, (time.time(),))
        self.conn.commit()

    def detect_signals(self, text: str) -> InteractionSignal:
        """Analyzes text for emotional and operational markers."""
        words = text.split()
        num_words = max(1, len(words))

        urgency_matches = self.URGENCY_REGEX.findall(text)
        analytical_matches = self.ANALYTICAL_REGEX.findall(text)
        frustration_matches = self.FRUSTRATION_REGEX.findall(text)
        directive_matches = self.DIRECTIVE_REGEX.findall(text)

        markers = list(set(urgency_matches + analytical_matches + frustration_matches + directive_matches))

        urgency = min(1.0, len(urgency_matches) * 0.35 + (0.3 if "!" in text else 0.0))
        analytical = min(1.0, len(analytical_matches) * 0.30 + (0.2 if "?" in text else 0.0))
        frustration = min(1.0, len(frustration_matches) * 0.40)
        directive = min(1.0, len(directive_matches) * 0.25)

        return InteractionSignal(
            urgency_score=round(urgency, 2),
            technical_depth=round(analytical, 2),
            frustration_level=round(frustration, 2),
            directive_ratio=round(directive, 2),
            detected_markers=markers,
        )

    def adapt_mode(self, text: str) -> PersonalityProfile:
        """Updates internal EMA state and determines optimal personality configuration."""
        sig = self.detect_signals(text)

        cur = self.conn.cursor()
        cur.execute("SELECT * FROM personality_state WHERE id = 1")
        row = cur.fetchone()

        alpha = 0.3  # Exponential Moving Average weight
        urg_ema = round((1.0 - alpha) * row["urgency_ema"] + alpha * sig.urgency_score, 3)
        fru_ema = round((1.0 - alpha) * row["frustration_ema"] + alpha * sig.frustration_level, 3)
        tec_ema = round((1.0 - alpha) * row["technical_ema"] + alpha * sig.technical_depth, 3)
        total = row["total_interactions"] + 1

        # Mode Selection Logic
        if urg_ema > 0.65 or sig.urgency_score > 0.70:
            mode = PersonalityMode.WAR_ROOM_CONCISE
        elif fru_ema > 0.50 or "segurança" in text.lower() or "auth" in text.lower():
            mode = PersonalityMode.GUARDIAN_DEFENSE
        elif tec_ema > 0.45 or sig.technical_depth > 0.50:
            mode = PersonalityMode.TACTICAL_ENGINEER
        else:
            mode = PersonalityMode.STARK_EXECUTIVE

        cur.execute("""
            UPDATE personality_state 
            SET current_mode = ?, urgency_ema = ?, frustration_ema = ?, technical_ema = ?, total_interactions = ?, last_updated = ?
            WHERE id = 1
        """, (mode.value, urg_ema, fru_ema, tec_ema, total, time.time()))
        self.conn.commit()

        return self.get_profile(mode)

    def get_profile(self, mode: PersonalityMode) -> PersonalityProfile:
        if mode == PersonalityMode.WAR_ROOM_CONCISE:
            return PersonalityProfile(
                mode=mode,
                conciseness=0.95,
                technicality=0.85,
                formality=0.70,
                proactivity=0.90,
                greeting_prefix="Sir. War room status engaged.",
            )
        elif mode == PersonalityMode.GUARDIAN_DEFENSE:
            return PersonalityProfile(
                mode=mode,
                conciseness=0.75,
                technicality=0.90,
                formality=0.90,
                proactivity=0.85,
                greeting_prefix="Perimeter guarded, Sir. Integrity gates holding.",
            )
        elif mode == PersonalityMode.TACTICAL_ENGINEER:
            return PersonalityProfile(
                mode=mode,
                conciseness=0.55,
                technicality=0.95,
                formality=0.60,
                proactivity=0.80,
                greeting_prefix="Telemetry synced, Sir. Engineering architecture ready.",
            )
        else:  # STARK_EXECUTIVE
            return PersonalityProfile(
                mode=mode,
                conciseness=0.70,
                technicality=0.75,
                formality=0.65,
                proactivity=0.85,
                greeting_prefix="Good day, Sir. Systems operating at peak nominal capacity.",
            )
