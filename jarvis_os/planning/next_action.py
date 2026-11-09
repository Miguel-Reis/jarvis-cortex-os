"""Deterministic Next-Action Planner (Q-18 Protocol).

Calculates the single deterministic highest-leverage next action using bounded multi-factor scoring:
Score = (Impact * Urgency * AuthorityFactor) / ((Effort + 0.1) * (1.0 + RiskPenalty))
Guarantees dependency resolution, non-circular execution, and deterministic tie-breaking.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Set


@dataclass
class ActionCandidate:
    action_id: str
    title: str
    target_component: str
    impact: float          # 1.0 - 10.0
    urgency: float         # 1.0 - 10.0
    effort: float          # 1.0 - 10.0
    risk: float            # 0.0 - 5.0
    dependencies: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)

    def calculate_q18_score(self, authority_multiplier: float = 1.0) -> float:
        """Computes deterministic Q-18 priority index."""
        numerator = self.impact * self.urgency * authority_multiplier
        denominator = (self.effort + 0.1) * (1.0 + (self.risk * 0.2))
        return round(numerator / denominator, 4)


@dataclass
class ExecutionPlan:
    timestamp: float
    chosen_action: Optional[ActionCandidate]
    priority_score: float
    rationale: str
    fallback_queue: List[ActionCandidate]
    blocked_actions: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "chosen_action": asdict(self.chosen_action) if self.chosen_action else None,
            "priority_score": self.priority_score,
            "rationale": self.rationale,
            "fallback_count": len(self.fallback_queue),
            "blocked_count": len(self.blocked_actions),
        }


class NextActionPlanner:
    """Enterprise Next-Action Planner implementing the Q-18 Deterministic Dispatch algorithm."""

    def __init__(self) -> None:
        self.candidates: Dict[str, ActionCandidate] = {}
        self.completed_actions: Set[str] = set()

    def register_candidate(self, candidate: ActionCandidate) -> None:
        self.candidates[candidate.action_id] = candidate

    def mark_completed(self, action_id: str) -> None:
        self.completed_actions.add(action_id)
        self.candidates.pop(action_id, None)

    def plan_next(self, authority_multiplier: float = 1.0) -> ExecutionPlan:
        """Evaluates all candidates and returns the deterministic optimal action."""
        available: List[Tuple[float, ActionCandidate]] = []
        blocked: List[Dict[str, Any]] = []

        for cid, cand in sorted(self.candidates.items()):
            # Check dependencies
            missing = [d for d in cand.dependencies if d not in self.completed_actions]
            if missing:
                blocked.append({
                    "action_id": cand.action_id,
                    "title": cand.title,
                    "missing_dependencies": missing,
                })
                continue

            score = cand.calculate_q18_score(authority_multiplier)
            available.append((score, cand))

        if not available:
            return ExecutionPlan(
                timestamp=time.time(),
                chosen_action=None,
                priority_score=0.0,
                rationale="No eligible unblocked action candidates found in queue.",
                fallback_queue=[],
                blocked_actions=blocked,
            )

        # Sort deterministic descending by score, tie-break by action_id alphabetical
        available.sort(key=lambda item: (-item[0], item[1].action_id))

        top_score, top_action = available[0]
        fallbacks = [cand for _, cand in available[1:]]

        rationale = (
            f"Action [{top_action.action_id}] selected with Q-18 Score {top_score:.2f} "
            f"(Impact={top_action.impact}, Urgency={top_action.urgency}, Effort={top_action.effort}, "
            f"Risk={top_action.risk}). Zero dependency blockers."
        )

        return ExecutionPlan(
            timestamp=time.time(),
            chosen_action=top_action,
            priority_score=top_score,
            rationale=rationale,
            fallback_queue=fallbacks,
            blocked_actions=blocked,
        )
