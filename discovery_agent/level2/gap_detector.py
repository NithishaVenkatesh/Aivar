from __future__ import annotations
import re
from typing import List, Dict, Set, Tuple

from ..models import SystemRelationship
from .models import DataFlow, Gap, UseCaseResult

# Phrases in evidence text that indicate a manual process, caught when the LLM
# sets trigger=null instead of trigger="manual" (e.g. when the text describes
# *what* the process is rather than *when* it runs).
_MANUAL_EVIDENCE_RE = re.compile(
    r"\b(manual(ly)?|exports?\s+csv|csv\s+export|by\s+hand|"
    r"no\s+live\s+connect|no\s+automated)\b",
    re.IGNORECASE,
)


def _is_manual(rel: SystemRelationship) -> bool:
    if rel.trigger == "manual":
        return True
    if rel.trigger is None and rel.evidence and _MANUAL_EVIDENCE_RE.search(rel.evidence):
        return True
    return False


def _build_exists(relationships: List[SystemRelationship]) -> Set[Tuple[str, str]]:
    """
    Build the set of system pairs that have an automated integration in Level 1.

    Two rules:
    1. Manual process excluded — checked via trigger field AND evidence text,
       because LLMs sometimes set trigger=null when the evidence describes a
       manual process without stating a schedule.
    2. Direction-agnostic — both (A, B) and (B, A) are always added.
    """
    exists: Set[Tuple[str, str]] = set()
    for rel in relationships:
        if _is_manual(rel):
            continue
        exists.add((rel.source, rel.target))
        exists.add((rel.target, rel.source))
    return exists


def detect_gaps(
    use_case_results: List[UseCaseResult],
    relationships: List[SystemRelationship],
) -> List[Gap]:
    """
    For every data flow in every use case, check whether the required directed
    edge exists in the Level 1 relationship graph.

    Status is set by a pure EXISTS lookup:
      available — (source, destination) is in the Level 1 edge set
      missing   — it is not

    Returns a deduplicated list of Gaps. Multiple use cases that need the same
    (source, destination) pair are merged into one Gap entry.
    """
    exists = _build_exists(relationships)

    # key = (source, destination) → Gap
    gaps_map: Dict[Tuple[str, str], Gap] = {}

    for uc in use_case_results:
        for flow in uc.flows:
            key = (flow.source, flow.destination)
            status = "available" if key in exists else "missing"

            if key not in gaps_map:
                gaps_map[key] = Gap(
                    source_system=flow.source,
                    destination_system=flow.destination,
                    entities=[flow.entity] if flow.entity else [],
                    triggers=[flow.trigger] if flow.trigger else [],
                    status=status,
                    use_cases_blocked=[uc.text],
                )
            else:
                existing = gaps_map[key]
                updates: dict = {}
                if flow.entity and flow.entity not in existing.entities:
                    updates["entities"] = existing.entities + [flow.entity]
                if flow.trigger and flow.trigger not in existing.triggers:
                    updates["triggers"] = existing.triggers + [flow.trigger]
                if uc.text not in existing.use_cases_blocked:
                    updates["use_cases_blocked"] = existing.use_cases_blocked + [uc.text]
                if updates:
                    gaps_map[key] = existing.model_copy(update=updates)

    return list(gaps_map.values())
