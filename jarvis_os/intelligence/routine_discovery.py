"""Evidence-Backed Routine Discovery Engine (routine-cues-v2).

Identifies recurring developer patterns, periodic commands, and workflow habits
from execution telemetry and interaction logs to suggest autonomous standing routines.
"""

from __future__ import annotations

import collections
import math
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class RoutineEvent:
    timestamp: float
    action_name: str
    context_cue: str  # e.g. "morning_briefing", "post_commit_lint", "terminal_scan"
    status: str = "SUCCESS"


@dataclass
class DiscoveredRoutine:
    routine_id: str
    name: str
    trigger_cue: str
    recommended_action: str
    confidence: float          # 0.0 - 1.0
    evidence_count: int
    mean_hour_of_day: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class RoutineDiscoveryEngine:
    """Detects recurring operational patterns and converts them into automation candidates."""

    def __init__(self, min_recurrence: int = 2, min_confidence: float = 0.65) -> None:
        self.min_recurrence = min_recurrence
        self.min_confidence = min_confidence
        self.events: List[RoutineEvent] = []

    def record_event(self, action_name: str, context_cue: str, timestamp: Optional[float] = None, status: str = "SUCCESS") -> None:
        t = timestamp if timestamp is not None else time.time()
        self.events.append(RoutineEvent(timestamp=t, action_name=action_name, context_cue=context_cue, status=status))

    def discover_routines(self) -> List[DiscoveredRoutine]:
        """Analyzes recorded history and computes routine candidates."""
        if not self.events:
            return []

        # Group by (action_name, context_cue)
        groups: Dict[tuple[str, str], List[RoutineEvent]] = collections.defaultdict(list)
        for ev in self.events:
            if ev.status == "SUCCESS":
                groups[(ev.action_name, ev.context_cue)].append(ev)

        discovered: List[DiscoveredRoutine] = []
        routine_counter = 1

        for (action, cue), ev_list in groups.items():
            count = len(ev_list)
            if count < self.min_recurrence:
                continue

            # Calculate hour-of-day distribution
            hours = [time.localtime(e.timestamp).tm_hour + (time.localtime(e.timestamp).tm_min / 60.0) for e in ev_list]
            mean_hour = sum(hours) / float(count)
            variance = sum((h - mean_hour) ** 2 for h in hours) / float(count) if count > 1 else 0.0
            std_dev = math.sqrt(variance)

            # High stability (low std_dev) and high recurrence yields high confidence
            recurrence_factor = min(1.0, count / 5.0)
            stability_factor = max(0.2, 1.0 - (std_dev / 12.0))
            confidence = round(0.5 * recurrence_factor + 0.5 * stability_factor, 3)

            if confidence >= self.min_confidence:
                discovered.append(
                    DiscoveredRoutine(
                        routine_id=f"ROUTINE-{routine_counter:03d}",
                        name=f"Autonomous {action.title()} ({cue})",
                        trigger_cue=cue,
                        recommended_action=f"Execute {action} on trigger cue '{cue}'",
                        confidence=confidence,
                        evidence_count=count,
                        mean_hour_of_day=round(mean_hour, 1),
                    )
                )
                routine_counter += 1

        discovered.sort(key=lambda r: r.confidence, reverse=True)
        return discovered
