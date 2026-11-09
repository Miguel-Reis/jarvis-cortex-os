"""Entity, Fact & Commitment Extractor with Provenance Gate.

Extracts structured knowledge, actionable commitments, and domain facts from raw developer
dialogue and transcripts, applying confidence weighting and source provenance.
"""

from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ExtractedCommitment:
    commitment_id: str
    actor: str
    action: str
    deadline: Optional[str]
    confidence: float
    source_snippet: str


@dataclass
class ExtractedFact:
    subject: str
    predicate: str
    object_value: str
    confidence: float


@dataclass
class VaultExtractionResult:
    source_uri: str
    timestamp: float
    entities: List[str]
    facts: List[ExtractedFact]
    commitments: List[ExtractedCommitment]
    provenance_passed: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_uri": self.source_uri,
            "timestamp": self.timestamp,
            "entities": self.entities,
            "facts": [asdict(f) for f in self.facts],
            "commitments": [asdict(c) for c in self.commitments],
            "provenance_passed": self.provenance_passed,
        }


class VaultExtractor:
    """Heuristic, zero-dependency pattern extractor for facts and obligations."""

    COMMITMENT_PATTERNS = [
        re.compile(r"\b(vou|vamos|precisamos|devo|prometo|tenho de|tenho que)\s+([^\.\,\;\n]+)", re.IGNORECASE),
        re.compile(r"\b(i will|we will|must|should|have to|plan to)\s+([^\.\,\;\n]+)", re.IGNORECASE),
        re.compile(r"\bTODO:\s*([^\.\,\;\n]+)", re.IGNORECASE),
    ]

    FACT_PATTERNS = [
        re.compile(r"([A-Za-z0-9_\-\.]+)\s+(?:é|is|uses|usa|executa|runs on)\s+([^\.\,\;\n]+)", re.IGNORECASE),
        re.compile(r"([A-Za-z0-9_\-\.]+)\s+(?:version|versão|porta|port)\s*[:=]?\s*([0-9a-zA-Z\.\-]+)", re.IGNORECASE),
    ]

    ENTITY_PATTERN = re.compile(r"\b([A-Z][a-zA-Z0-9_\-]{2,}|[a-z0-9_\-]+\.(?:py|json|md|db|ts|js|go)|localhost:[0-9]+)\b")

    def __init__(self, min_confidence_threshold: float = 0.60) -> None:
        self.min_confidence = min_confidence_threshold

    def extract(self, text: str, source_uri: str = "transcript") -> VaultExtractionResult:
        commitments: List[ExtractedCommitment] = []
        facts: List[ExtractedFact] = []
        entities: List[str] = []

        # 1. Entities
        raw_entities = self.ENTITY_PATTERN.findall(text)
        for e in raw_entities:
            if len(e) > 2 and e not in entities:
                entities.append(e)

        # 2. Commitments
        cid = 1
        for pat in self.COMMITMENT_PATTERNS:
            for match in pat.finditer(text):
                action_text = match.group(2).strip() if len(match.groups()) >= 2 else match.group(1).strip()
                if len(action_text) > 4:
                    commitments.append(
                        ExtractedCommitment(
                            commitment_id=f"COM-{cid:03d}",
                            actor="USER/AGENT",
                            action=action_text,
                            deadline=None,
                            confidence=0.85,
                            source_snippet=match.group(0),
                        )
                    )
                    cid += 1

        # 3. Facts
        for pat in self.FACT_PATTERNS:
            for match in pat.finditer(text):
                subj, val = match.group(1).strip(), match.group(2).strip()
                if len(subj) > 1 and len(val) > 1:
                    facts.append(
                        ExtractedFact(
                            subject=subj,
                            predicate="DEFINED_AS",
                            object_value=val,
                            confidence=0.80,
                        )
                    )

        # Provenance gate: valid source_uri and verified non-empty extraction
        passed = bool(source_uri) and (len(facts) > 0 or len(commitments) > 0 or len(entities) > 0)

        return VaultExtractionResult(
            source_uri=source_uri,
            timestamp=time.time(),
            entities=entities[:20],
            facts=facts[:20],
            commitments=commitments[:10],
            provenance_passed=passed,
        )
