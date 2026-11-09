"""Today Work-Items & Verified Outcome Gate.

Prevents premature or hallucinated task completions by enforcing verifiable evidence
(test exit codes, file existence, hash integrity, or cryptographic executive signatures).
"""

from __future__ import annotations

import enum
import hashlib
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple


class WorkItemStatus(str, enum.Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    DONE = "DONE"
    FAILED = "FAILED"
    REJECTED = "REJECTED"


class VerificationType(str, enum.Enum):
    TEST_PASS = "TEST_PASS"
    FILE_EXISTS = "FILE_EXISTS"
    CHECKSUM_MATCH = "CHECKSUM_MATCH"
    EXECUTIVE_SIGN = "EXECUTIVE_SIGN"


@dataclass
class WorkItem:
    item_id: str
    title: str
    target_outcome: str
    verification_type: VerificationType
    verification_target: str
    status: WorkItemStatus = WorkItemStatus.PENDING
    evidence: Optional[Dict[str, Any]] = None
    completed_at: Optional[float] = None
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class TodayContractGate:
    """Manages daily commitments and guarantees verified outcomes."""

    def __init__(self, executive_secret: str = "JARVIS_CORTEX_2026") -> None:
        self.executive_secret = executive_secret
        self.items: Dict[str, WorkItem] = {}

    def add_work_item(
        self,
        item_id: str,
        title: str,
        target_outcome: str,
        verification_type: VerificationType,
        verification_target: str,
    ) -> WorkItem:
        item = WorkItem(
            item_id=item_id,
            title=title,
            target_outcome=target_outcome,
            verification_type=verification_type,
            verification_target=verification_target,
        )
        self.items[item_id] = item
        return item

    def start_work_item(self, item_id: str) -> bool:
        if item_id in self.items:
            self.items[item_id].status = WorkItemStatus.IN_PROGRESS
            return True
        return False

    def verify_and_close(self, item_id: str, evidence: Dict[str, Any]) -> Tuple[bool, str]:
        """Evaluates proof before transitioning status to DONE."""
        if item_id not in self.items:
            return False, f"WorkItem {item_id} does not exist."

        item = self.items[item_id]
        v_type = item.verification_type
        target = item.verification_target

        if v_type == VerificationType.TEST_PASS:
            # Requires exit_code == 0 and passed_count > 0
            code = evidence.get("exit_code")
            passed = evidence.get("passed_count", 0)
            if code == 0 and passed > 0:
                item.status = WorkItemStatus.DONE
                item.evidence = evidence
                item.completed_at = time.time()
                return True, f"Verified: test suite passed with {passed} passing tests."
            item.status = WorkItemStatus.FAILED
            return False, f"Verification failed: exit_code={code}, passed={passed}."

        elif v_type == VerificationType.FILE_EXISTS:
            path = evidence.get("path", target)
            if os.path.exists(path) and os.path.getsize(path) > 0:
                item.status = WorkItemStatus.DONE
                item.evidence = evidence
                item.completed_at = time.time()
                return True, f"Verified: artifact exists at '{path}' ({os.path.getsize(path)} bytes)."
            item.status = WorkItemStatus.FAILED
            return False, f"Verification failed: file missing or empty at '{path}'."

        elif v_type == VerificationType.CHECKSUM_MATCH:
            raw_data = evidence.get("raw_data", "")
            expected_hash = target
            actual_hash = hashlib.sha256(raw_data.encode("utf-8")).hexdigest()
            if actual_hash.lower() == expected_hash.lower():
                item.status = WorkItemStatus.DONE
                item.evidence = evidence
                item.completed_at = time.time()
                return True, "Verified: SHA256 integrity match confirmed."
            item.status = WorkItemStatus.FAILED
            return False, f"Verification failed: expected {expected_hash}, got {actual_hash}."

        elif v_type == VerificationType.EXECUTIVE_SIGN:
            token = evidence.get("signature_token", "")
            expected = hashlib.sha256(f"{item_id}:{self.executive_secret}".encode("utf-8")).hexdigest()
            if token == expected:
                item.status = WorkItemStatus.DONE
                item.evidence = evidence
                item.completed_at = time.time()
                return True, "Verified: Executive authorization signature valid."
            item.status = WorkItemStatus.REJECTED
            return False, "Verification rejected: Invalid executive signature token."

        return False, f"Unknown verification type: {v_type}"

    def get_summary(self) -> Dict[str, Any]:
        total = len(self.items)
        done = sum(1 for i in self.items.values() if i.status == WorkItemStatus.DONE)
        failed = sum(1 for i in self.items.values() if i.status == WorkItemStatus.FAILED)
        pending = sum(1 for i in self.items.values() if i.status in (WorkItemStatus.PENDING, WorkItemStatus.IN_PROGRESS))
        return {
            "total_items": total,
            "completed_verified": done,
            "failed": failed,
            "pending": pending,
            "completion_rate": round(done / total * 100.0, 1) if total > 0 else 0.0,
        }
