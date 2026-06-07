from __future__ import annotations
import re
from typing import List

from ..models import SystemNode
from .extractor import has_hedge_markers

# Three-tier thresholds matching the spec
HIGH_CONFIDENCE = 95.0   # floor for explicitly mentioned systems
INFERRED_FLOOR  = 72.0   # floor for inferred systems (above review threshold before penalties)
REVIEW_THRESHOLD = 70.0  # below this → flagged for human review

_STRUCTURED_EXTS = {".xlsx", ".xls", ".csv", ".pdf"}

# Evidence sentences that directly assert the system is in active use
_ACTIVE_USE = re.compile(
    r"\b("
    r"use[sd]?|using|deploy(ed)?|integrat(ed)?|connect(ed)?|sync(s|ed)?|"
    r"manage[sd]?|power(ed)?|built\s+on|run(ning)?|configur(ed)?|"
    r"authenticat(ed|es)?|provisioned|federated|hosted|stored\s+in|"
    r"migrat(ed|ing)?|we\s+use|we\s+have|our\s+\w+\s+is|is\s+our"
    r")\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def score(nodes: List[SystemNode]) -> List[SystemNode]:
    """Assign confidence scores using the three-tier spec."""
    return [_score_node(node) for node in nodes]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_node(node: SystemNode) -> SystemNode:
    tier = _classify_tier(node)
    raw = _base_score(node, tier)
    penalty = _penalties(node, tier)
    final = min(100.0, round(max(0.0, raw - penalty), 1))

    needs_review = final < REVIEW_THRESHOLD
    review_note = _build_review_note(node, final, tier, penalty) if needs_review else None

    return node.model_copy(update={
        "confidence": final,
        "needs_human_review": needs_review,
        "review_note": review_note,
    })


def _classify_tier(node: SystemNode) -> str:
    """
    Returns "explicit" or "inferred".

    Explicit: system is directly asserted as in active use.
      - evidence contains hedge markers → forces "inferred" regardless
      - multiple mentions across documents → strong corroboration
      - appeared in a structured source (spreadsheet / PDF) → inventory-level signal
      - evidence sentence contains active-use language

    Inferred: system name appears but usage is not clearly asserted.
    """
    # Hedge markers immediately downgrade to inferred so penalties can push below 70
    if any(has_hedge_markers(e) for e in node.evidence):
        return "inferred"

    # Multiple mentions = corroborated across documents
    if node.mention_count >= 2:
        return "explicit"

    # Structured source = integration inventory / architecture doc
    if any(
        any(src.lower().endswith(ext) for ext in _STRUCTURED_EXTS)
        for src in node.source_documents
    ):
        return "explicit"

    # Direct active-use language in any evidence sentence
    if any(_ACTIVE_USE.search(e) for e in node.evidence):
        return "explicit"

    return "inferred"


def _base_score(node: SystemNode, tier: str) -> float:
    if tier == "explicit":
        # Floor is HIGH_CONFIDENCE (95). Metadata richness adds up to +4, multi-mention +1.
        base = HIGH_CONFIDENCE
        base += 1.0 if node.auth_method else 0.0
        base += 1.0 if node.key_entities else 0.0
        base += 1.0 if node.business_processes else 0.0
        base += 1.0 if node.criticality and node.criticality != "unknown" else 0.0
        base += min(1.0, (node.mention_count - 1) * 0.5)
    else:
        # Inferred: floor 72, metadata can push into the 70-89 band.
        base = INFERRED_FLOOR
        base += 3.0 if node.auth_method else 0.0
        base += 3.0 if node.key_entities else 0.0
        base += 3.0 if node.business_processes else 0.0
        base += 2.0 if node.criticality and node.criticality != "unknown" else 0.0
        base += min(5.0, (node.mention_count - 1) * 2.0)

    return base


def _penalties(node: SystemNode, tier: str) -> float:
    penalty = 0.0

    # Hedge markers penalise in both tiers — explicit systems with hedges were
    # already downgraded to "inferred" by _classify_tier, so this mainly hits
    # the score calculation further.
    if any(has_hedge_markers(e) for e in node.evidence):
        penalty += 20.0

    # Single inferred mention with neither structured-source nor metadata corroboration.
    # Populated metadata means the LLM extracted enough context to describe the system,
    # which itself counts as weak corroboration — so only penalise bare name-only mentions.
    if tier == "inferred" and node.mention_count == 1:
        has_structured = any(
            any(src.lower().endswith(ext) for ext in _STRUCTURED_EXTS)
            for src in node.source_documents
        )
        has_metadata = bool(node.key_entities or node.business_processes or node.auth_method)
        if not has_structured and not has_metadata:
            penalty += 10.0

    return penalty


def _build_review_note(node: SystemNode, confidence: float, tier: str, penalty: float) -> str:
    parts = [f"Confidence {confidence:.1f}% ({tier})."]

    if any(has_hedge_markers(e) for e in node.evidence):
        parts.append("Uncertainty markers in evidence.")
    if tier == "inferred" and node.mention_count == 1:
        parts.append("Single inferred mention — no corroboration.")

    missing: List[str] = []
    if not node.auth_method:
        missing.append("auth method")
    if not node.key_entities:
        missing.append("key entities")
    if not node.business_processes:
        missing.append("business processes")
    if node.criticality == "unknown":
        missing.append("criticality")
    if missing:
        parts.append(f"Missing: {', '.join(missing)}.")

    return " ".join(parts)
