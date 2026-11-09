"""Security Subsystem: Authority-Aware Trust Boundaries & Prompt-Injection Canary."""

from jarvis_os.security.trust_boundary import (
    ClearanceLevel,
    TrustBoundaryGate,
    SecurityAuditRecord,
    CanaryViolation,
)

__all__ = [
    "ClearanceLevel",
    "TrustBoundaryGate",
    "SecurityAuditRecord",
    "CanaryViolation",
]
