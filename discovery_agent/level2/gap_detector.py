from __future__ import annotations
from typing import List, Dict, Set, Tuple

from ..models import SystemRelationship
from .models import DataFlow, Gap, UseCaseResult


def _build_exists(relationships: List[SystemRelationship]) -> Set[Tuple[str, str]]:
    """
    Build the set of system pairs that have an automated integration in Level 1.

    Two rules:
    1. Manual trigger excluded — a manual process (CSV export, etc.) is not an
       automated integration and must not mark a gap as available.
    2. Direction-agnostic — both (A, B) and (B, A) are always added. Level 2 LLMs
       may reverse the flow direction relative to how Level 1 stored it; if any
       integration exists between two systems the gap is available regardless of
       which direction was emitted.
    """
    exists: Set[Tuple[str, str]] = set()
    for rel in relationships:
        if rel.trigger == "manual":
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
