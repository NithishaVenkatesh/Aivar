from __future__ import annotations
from typing import Dict, List, Optional, Tuple

from ..models import SystemNode
from .models import Gap

# Effort size ordering for "bump up" logic
_SIZES = ["S", "M", "L", "XL"]

# Human-readable effort descriptions shown in the UI
EFFORT_LABELS: Dict[str, str] = {
    "S": "1–3 days",
    "M": "1–2 weeks",
    "L": "3–6 weeks",
    "XL": "2+ months",
}


def _bump(size: str) -> str:
    idx = _SIZES.index(size)
    return _SIZES[min(idx + 1, len(_SIZES) - 1)]


def classify_effort(
    source_node: Optional[SystemNode],
    dest_node: Optional[SystemNode],
) -> Tuple[str, str]:
    """
    Rule-based effort classification. Returns (size, rationale).
    Never calls the LLM — the rationale is constructed deterministically
    so estimates are repeatable across runs.

    Decision table:
      both have auth            → S
      one has auth              → M
      neither has auth          → L
      either is flagged/legacy  → bump one size up
    """
    src_auth = bool(source_node and source_node.auth_method)
    dst_auth = bool(dest_node and dest_node.auth_method)
    src_name = source_node.canonical_name if source_node else "source"
    dst_name = dest_node.canonical_name if dest_node else "destination"
    src_review = bool(source_node and source_node.needs_human_review)
    dst_review = bool(dest_node and dest_node.needs_human_review)

    if src_auth and dst_auth:
        size = "S"
        rationale = (
            f"Both {src_name} and {dst_name} have documented auth methods "
            f"({source_node.auth_method}, {dest_node.auth_method}), "
            "enabling a standard API integration."
        )
    elif src_auth or dst_auth:
        size = "M"
        has_auth = src_name if src_auth else dst_name
        no_auth = dst_name if src_auth else src_name
        auth_method = (source_node.auth_method if src_auth else dest_node.auth_method)
        rationale = (
            f"{has_auth} has a documented auth method ({auth_method}), "
            f"but {no_auth}'s auth is undocumented — integration approach "
            "needs investigation before implementation."
        )
    else:
        size = "L"
        rationale = (
            f"Neither {src_name} nor {dst_name} has a documented auth method; "
            "the integration approach is unknown and will require discovery work."
        )

    # Legacy / flagged-for-review bump
    legacy = []
    if src_review:
        legacy.append(src_name)
    if dst_review:
        legacy.append(dst_name)

    if legacy:
        size = _bump(size)
        names = " and ".join(legacy)
        verb = "is" if len(legacy) == 1 else "are"
        rationale += (
            f" Additionally, {names} {verb} flagged for human review, "
            "increasing implementation risk and estimated effort."
        )

    return size, rationale


def classify_all_efforts(
    gaps: List[Gap],
    inventory: List[SystemNode],
) -> List[Gap]:
    """Attach effort size and rationale to every missing gap."""
    node_map: Dict[str, SystemNode] = {n.canonical_name: n for n in inventory}
    result: List[Gap] = []

    for gap in gaps:
        if gap.status == "available":
            result.append(gap)
            continue

        src_node = node_map.get(gap.source_system)
        dst_node = node_map.get(gap.destination_system)
        size, rationale = classify_effort(src_node, dst_node)

        result.append(gap.model_copy(update={
            "effort": size,
            "effort_rationale": rationale,
        }))

    return result
