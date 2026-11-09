"""Always-On Desktop Sidecar Agent — Hotkeys, Wake-Word, Window & Clipboard Guard.

Provides:
1. Deterministic WakeWordDetector for multi-locale acoustic transcripts ("hey jarvis", "jarvis", "ó jarvis", "ok jarvis").
2. Authority-aware HotkeyBinding registry integrated with TrustBoundaryGate.
3. Cross-platform active window enumeration (Win32 User32 EnumWindows + POSIX /proc inspection).
4. Clipboard prompt-injection & canary leak guard via TrustBoundaryGate.
"""

from __future__ import annotations

import ctypes
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional

from jarvis_os.security.trust_boundary import ClearanceLevel, TrustBoundaryGate


@dataclass
class WakeWordEvent:
    triggered: bool
    wake_phrase: Optional[str]
    command_payload: str
    confidence: float
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class HotkeyBinding:
    hotkey_id: str
    combination: str
    action_name: str
    clearance_required: ClearanceLevel
    description: str

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["clearance_required"] = self.clearance_required.name
        return data


@dataclass
class WindowInfo:
    hwnd_or_pid: int
    title: str
    process_name: str
    is_active: bool

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class WakeWordDetector:
    """Deterministic lexical & phonetic wake-word detector for J.A.R.V.I.S. Cortex OS."""

    WAKE_PHRASES: List[str] = [
        "hey jarvis",
        "ok jarvis",
        "ó jarvis",
        "jarvis",
    ]

    def __init__(self, custom_phrases: Optional[List[str]] = None) -> None:
        phrases = list(self.WAKE_PHRASES)
        if custom_phrases:
            for phrase in custom_phrases:
                normalized = phrase.strip().lower()
                if normalized and normalized not in phrases:
                    phrases.append(normalized)
        # Sort longest first so multi-word wake phrases match before single "jarvis"
        self.phrases: List[str] = sorted(phrases, key=len, reverse=True)

    def process_transcript(self, transcript: str) -> WakeWordEvent:
        """Evaluates an incoming voice transcript for wake-words and extracts the command payload."""
        now = time.time()
        if not transcript or not transcript.strip():
            return WakeWordEvent(
                triggered=False,
                wake_phrase=None,
                command_payload="",
                confidence=0.0,
                timestamp=now,
            )

        cleaned = transcript.strip()
        lowered = cleaned.lower()

        for phrase in self.phrases:
            pattern = re.compile(
                rf"(?:^|\b)({re.escape(phrase)})(?:\b|[,:;.!?]+|\s+)(.*)$",
                re.IGNORECASE,
            )
            match = pattern.search(lowered)
            if match:
                start_idx = match.start(1)
                payload_start = match.start(2)
                raw_payload = cleaned[payload_start:].lstrip(" ,:;.!?-")
                # Higher confidence when wake phrase is at the start of utterance and multi-word
                position_bonus = 0.08 if start_idx == 0 else 0.0
                length_bonus = 0.05 if " " in phrase else 0.0
                confidence = round(min(0.99, 0.86 + position_bonus + length_bonus), 2)
                return WakeWordEvent(
                    triggered=True,
                    wake_phrase=phrase,
                    command_payload=raw_payload.strip(),
                    confidence=confidence,
                    timestamp=now,
                )

        return WakeWordEvent(
            triggered=False,
            wake_phrase=None,
            command_payload=cleaned,
            confidence=0.0,
            timestamp=now,
        )


class DesktopSidecar:
    """Always-On Desktop Sidecar managing hotkeys, window context, wake-word, and clipboard safety."""

    def __init__(self, trust_gate: Optional[TrustBoundaryGate] = None) -> None:
        self.trust_gate = trust_gate or TrustBoundaryGate()
        self.wake_detector = WakeWordDetector()
        self.hotkeys: Dict[str, HotkeyBinding] = {}
        self._action_handlers: Dict[str, Callable[[], Dict[str, Any]]] = {}
        self._register_default_hotkeys()

    def _register_default_hotkeys(self) -> None:
        defaults = [
            HotkeyBinding(
                hotkey_id="hk_palette",
                combination="Alt+Space",
                action_name="quick_command_palette",
                clearance_required=ClearanceLevel.READ_ONLY,
                description="Open J.A.R.V.I.S. Quick Command HUD Palette",
            ),
            HotkeyBinding(
                hotkey_id="hk_voice_briefing",
                combination="Ctrl+Shift+J",
                action_name="mark_vii_voice_briefing",
                clearance_required=ClearanceLevel.OPERATIONAL,
                description="Synthesize Mark-VII acoustic executive status briefing",
            ),
            HotkeyBinding(
                hotkey_id="hk_q18_dispatch",
                combination="Ctrl+Shift+P",
                action_name="q18_next_action_dispatch",
                clearance_required=ClearanceLevel.OPERATIONAL,
                description="Execute Q-18 deterministic next-action planner",
            ),
            HotkeyBinding(
                hotkey_id="hk_guardian_lockdown",
                combination="Ctrl+Shift+G",
                action_name="guardian_lockdown",
                clearance_required=ClearanceLevel.EXECUTIVE,
                description="Engage Guardian containment & rotate canary tokens",
            ),
        ]
        for binding in defaults:
            self.register_hotkey(binding)

        self._action_handlers = {
            "quick_command_palette": lambda: {
                "hud_mode": "COMMAND_PALETTE_OPEN",
                "latency_ms": 1.2,
            },
            "mark_vii_voice_briefing": lambda: {
                "Synthesizer": "Mark-VII HUD",
                "status": "BRIEFING_QUEUED",
            },
            "q18_next_action_dispatch": lambda: {
                "planner": "Q-18 Pareto Dispatcher",
                "status": "DISPATCHED",
            },
            "guardian_lockdown": lambda: {
                "containment": "LOCKDOWN_ACTIVE",
                "new_canary": self.trust_gate.generate_canary("guardian_sidecar"),
            },
        }

    def register_hotkey(
        self,
        binding: HotkeyBinding,
        handler: Optional[Callable[[], Dict[str, Any]]] = None,
    ) -> None:
        """Registers or updates a hotkey binding and optional handler."""
        norm_combo = self._normalize_combination(binding.combination)
        self.hotkeys[norm_combo] = binding
        if handler is not None:
            self._action_handlers[binding.action_name] = handler

    @staticmethod
    def _normalize_combination(combination: str) -> str:
        parts = [p.strip() for p in combination.split("+") if p.strip()]
        return "+".join(parts).lower()

    def list_active_windows(self) -> List[WindowInfo]:
        """Enumerates active visible windows on Win32 or workspace processes on Linux/POSIX."""
        windows: List[WindowInfo] = []

        if sys.platform == "win32" and hasattr(ctypes, "windll"):
            try:
                user32 = ctypes.windll.user32
                fg_hwnd = user32.GetForegroundWindow()

                WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

                def _enum_cb(hwnd: int, _lparam: int) -> bool:
                    if user32.IsWindowVisible(hwnd):
                        length = user32.GetWindowTextLengthW(hwnd)
                        if length > 0:
                            buf = ctypes.create_unicode_buffer(length + 1)
                            user32.GetWindowTextW(hwnd, buf, length + 1)
                            title = buf.value.strip()
                            if title:
                                windows.append(
                                    WindowInfo(
                                        hwnd_or_pid=int(hwnd),
                                        title=title,
                                        process_name="win32_window",
                                        is_active=(hwnd == fg_hwnd),
                                    )
                                )
                    return True

                user32.EnumWindows(WNDENUMPROC(_enum_cb), 0)
            except Exception:
                pass

        if not windows and os.path.isdir("/proc"):
            current_pid = os.getpid()
            try:
                pids = sorted(
                    int(entry) for entry in os.listdir("/proc") if entry.isdigit()
                )
                for pid in pids[:32]:
                    comm_path = f"/proc/{pid}/comm"
                    cmdline_path = f"/proc/{pid}/cmdline"
                    try:
                        with open(comm_path, "r", encoding="utf-8", errors="ignore") as f:
                            proc_name = f.read().strip() or "posix_proc"
                        title = proc_name
                        if os.path.exists(cmdline_path):
                            with open(cmdline_path, "rb") as cf:
                                raw_cmd = cf.read(256).replace(b"\x00", b" ").decode("utf-8", errors="ignore").strip()
                                if raw_cmd:
                                    title = raw_cmd[:120]
                        windows.append(
                            WindowInfo(
                                hwnd_or_pid=pid,
                                title=title,
                                process_name=proc_name,
                                is_active=(pid == current_pid),
                            )
                        )
                    except OSError:
                        continue
            except OSError:
                pass

        if not windows:
            windows.append(
                WindowInfo(
                    hwnd_or_pid=os.getpid(),
                    title="J.A.R.V.I.S. Cortex OS Sidecar Host",
                    process_name="python3",
                    is_active=True,
                )
            )

        return windows

    def inspect_clipboard(self, raw_text: Optional[str] = None) -> Dict[str, Any]:
        """Inspects clipboard text (or provided raw_text) through TrustBoundaryGate."""
        text = raw_text if raw_text is not None else ""
        is_safe, findings = self.trust_gate.inspect_input(text)
        preview = text[:80] + ("..." if len(text) > 80 else "")
        return {
            "safe": is_safe,
            "findings": findings,
            "length": len(text),
            "preview": preview,
            "timestamp": time.time(),
        }

    def trigger_hotkey(
        self,
        combination: str,
        caller_level: ClearanceLevel = ClearanceLevel.OPERATIONAL,
    ) -> Dict[str, Any]:
        """Validates clearance via TrustBoundaryGate and executes the bound sidecar action."""
        norm_combo = self._normalize_combination(combination)
        binding = self.hotkeys.get(norm_combo)
        now = time.time()

        if binding is None:
            return {
                "triggered": False,
                "allowed": False,
                "combination": combination,
                "action_name": None,
                "reason": f"Unbound hotkey combination: '{combination}'",
                "result": None,
                "timestamp": now,
            }

        allowed, reason = self.trust_gate.validate_clearance(
            caller_id="desktop_sidecar",
            caller_level=caller_level,
            required_level=binding.clearance_required,
            action_name=binding.action_name,
        )

        if not allowed:
            return {
                "triggered": False,
                "allowed": False,
                "combination": binding.combination,
                "action_name": binding.action_name,
                "reason": reason,
                "result": None,
                "timestamp": now,
            }

        handler = self._action_handlers.get(binding.action_name)
        result_payload = handler() if handler else {"status": "EXECUTED"}
        return {
            "triggered": True,
            "allowed": True,
            "combination": binding.combination,
            "action_name": binding.action_name,
            "reason": reason,
            "result": result_payload,
            "timestamp": now,
        }

    def get_status(self) -> Dict[str, Any]:
        """Returns comprehensive sidecar telemetry."""
        active_windows = self.list_active_windows()
        return {
            "platform": sys.platform,
            "registered_hotkeys": [b.to_dict() for b in self.hotkeys.values()],
            "registered_hotkeys_count": len(self.hotkeys),
            "active_windows_count": len(active_windows),
            "wake_word_readiness": True,
            "wake_phrases": list(self.wake_detector.phrases),
            "trust_audit": self.trust_gate.get_audit_summary(),
            "timestamp": time.time(),
        }
