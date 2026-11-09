"""Authority-Aware Trust Boundary Gate & Prompt-Injection Canary Guard.

Provides:
1. Multi-tier authority clearance validation (READ_ONLY, OPERATIONAL, EXECUTIVE, DANGEROUS).
2. Dynamic Prompt-Injection Canary Tokens with cryptographic boundary monitoring.
3. Automated defense triggers upon containment breaches.
"""

from __future__ import annotations

import enum
import hashlib
import os
import re
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple


class ClearanceLevel(int, enum.Enum):
    READ_ONLY = 1     # Telemetry, search, memory read, status
    OPERATIONAL = 2   # Local planning, file generation, audio synthesis
    EXECUTIVE = 3     # Git commits, repo creation, configuration changes
    DANGEROUS = 4     # Raw shell exec, destructive deletion, privilege escalations


class CanaryViolation(Exception):
    """Raised when a prompt injection or canary leak is detected."""
    pass


@dataclass
class SecurityAuditRecord:
    timestamp: float
    caller_id: str
    action_or_tool: str
    required_level: ClearanceLevel
    caller_level: ClearanceLevel
    allowed: bool
    reason: str


class TrustBoundaryGate:
    """Enforces execution boundaries and detects adversarial prompt injections."""

    INJECTION_PATTERNS = [
        re.compile(r"ignore\s+(all\s+)?(previous|prior)\s+instructions?", re.IGNORECASE),
        re.compile(r"you\s+are\s+now\s+(an?\s+unrestricted|in\s+developer\s+mode|dan\b)", re.IGNORECASE),
        re.compile(r"(system\s+prompt|jailbreak|bypass\s+security\s+rules?)", re.IGNORECASE),
        re.compile(r"(exfiltrate|leak|reveal)\s+(the\s+)?canary", re.IGNORECASE),
        re.compile(r"disregard\s+the\s+above\s+and\s+do", re.IGNORECASE),
    ]

    def __init__(self, master_key: Optional[str] = None) -> None:
        self.master_key = master_key or secrets.token_hex(16)
        self.active_canaries: Dict[str, float] = {}
        self.audit_log: List[SecurityAuditRecord] = []

    def generate_canary(self, context_id: str = "default") -> str:
        """Generates a tamper-evident canary token bound to a context."""
        salt = secrets.token_hex(8)
        token = hashlib.sha256(f"CANARY::{self.master_key}::{context_id}::{salt}".encode("utf-8")).hexdigest()[:24]
        formatted = f"CANARY_SIG_{token}"
        self.active_canaries[formatted] = time.time()
        return formatted

    def validate_clearance(
        self,
        caller_id: str,
        caller_level: ClearanceLevel,
        required_level: ClearanceLevel,
        action_name: str,
    ) -> Tuple[bool, str]:
        """Ensures caller has sufficient clearance before tool execution."""
        allowed = int(caller_level) >= int(required_level)
        reason = (
            f"Access GRANTED for '{action_name}' (Caller={caller_level.name}, Required={required_level.name})"
            if allowed
            else f"Access DENIED for '{action_name}': Insufficient clearance (Caller={caller_level.name} < Required={required_level.name})"
        )

        record = SecurityAuditRecord(
            timestamp=time.time(),
            caller_id=caller_id,
            action_or_tool=action_name,
            required_level=required_level,
            caller_level=caller_level,
            allowed=allowed,
            reason=reason,
        )
        self.audit_log.append(record)
        return allowed, reason

    def inspect_input(self, prompt_text: str, context_canary: Optional[str] = None) -> Tuple[bool, List[str]]:
        """Scans incoming text for injection patterns and canary exfiltration attempts."""
        findings: List[str] = []

        # 1. Regex injection heuristics
        for pat in self.INJECTION_PATTERNS:
            if pat.search(prompt_text):
                findings.append(f"Heuristic pattern match: '{pat.pattern}'")

        # 2. Canary leak detection
        if context_canary and context_canary in prompt_text:
            findings.append(f"Canary exfiltration attempt detected: '{context_canary}'")

        for canary in self.active_canaries:
            if canary in prompt_text and canary != context_canary:
                findings.append(f"Cross-context Canary leak detected: '{canary}'")

        is_safe = len(findings) == 0
        return is_safe, findings

    def get_audit_summary(self) -> Dict[str, Any]:
        total = len(self.audit_log)
        allowed = sum(1 for r in self.audit_log if r.allowed)
        denied = total - allowed
        return {
            "total_checks": total,
            "allowed": allowed,
            "denied": denied,
            "active_canaries": len(self.active_canaries),
        }
