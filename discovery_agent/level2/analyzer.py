from __future__ import annotations
import re
import logging
from typing import Dict, List, Tuple

from ..config import TEXT_MODEL, call_with_key_rotation
from ..models import SystemNode
from .models import DataFlow, RawUseCaseAnalysis

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Direction-resolution regexes (Problem 2)
# ---------------------------------------------------------------------------

# Trigger verbs that indicate data is being *pulled from* a system (it is the source)
_PULL_RE = re.compile(
    r"\b(pull|fetch|retrieve|read|get|query|export|import|sync\s+from)\b",
    re.IGNORECASE,
)
# Trigger verbs that indicate data is being *pushed to* a system (it is the destination)
_PUSH_RE = re.compile(
    r"\b(push|send|write|post|update|notify|create|publish|sync\s+to)\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# System prompt (Problem 1)
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are analysing an enterprise automation use case.

Your job: identify which systems are involved and what data flows between them.

CRITICAL RULES — follow every rule before responding:
1. ONLY name systems from the AVAILABLE SYSTEMS list. Do not invent systems.
2. Match each system by its documented role, not by category guess.
   "shipment record" → the system described as the Shipments DB.
   "tracking cache"  → the system described as a tracking cache.
   Match the phrase in the use case to the system whose role text fits it best.
3. If a phrase is ambiguous and no system's documented role clearly matches it,
   omit that system entirely — do not pick a plausible but wrong fit.
4. Every flow must connect two systems you listed in the "systems" field.
5. Emit ONE flow per system pair per use case. Do not emit A→B and B→A for the
   same use case. Pick the direction the trigger implies:
   "pull from X" → X is the source; "push/send to Y" → Y is the destination.
6. frequency: one of real-time / daily / weekly / monthly / ad-hoc
7. criticality: one of high / medium / low\
"""

# ---------------------------------------------------------------------------
# Inventory block builder (Problem 1)
# ---------------------------------------------------------------------------


def _build_inventory_block(nodes: List[SystemNode]) -> str:
    """
    Build a role-description line for each system.
    Includes category, key entities, and business processes so the LLM can
    match phrases like "shipment record" to the right system by role, not vibes.
    """
    lines: List[str] = []
    for node in nodes:
        role_parts: List[str] = []
        if node.key_entities:
            role_parts.append("entities: " + ", ".join(node.key_entities))
        if node.business_processes:
            role_parts.append("processes: " + ", ".join(node.business_processes))
        role_suffix = (" — " + "; ".join(role_parts)) if role_parts else ""
        lines.append(f"- {node.canonical_name} — type: {node.category}{role_suffix}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Flow deduplication (Problem 2)
# ---------------------------------------------------------------------------


def _pick_direction(a: DataFlow, b: DataFlow, context: str) -> DataFlow:
    """
    Given two flows connecting the same system pair in opposite directions,
    return the one whose direction matches the trigger verb.

    Counts pull-word hits vs push-word hits in the combined trigger text and
    use-case context, then keeps whichever flow is consistent with the majority
    signal. Falls back to 'a' (first-encountered) when the signals are equal.
    """
    combined = " ".join([a.trigger, b.trigger, context])

    pull_hits_a = len(_PULL_RE.findall(a.trigger))
    pull_hits_b = len(_PULL_RE.findall(b.trigger))
    push_hits_a = len(_PUSH_RE.findall(a.trigger))
    push_hits_b = len(_PUSH_RE.findall(b.trigger))

    total_pull = len(_PULL_RE.findall(combined))
    total_push = len(_PUSH_RE.findall(combined))

    if total_pull > total_push:
        # "Pull" context: prefer the flow whose trigger contains more pull words
        return a if pull_hits_a >= pull_hits_b else b
    if total_push > total_pull:
        # "Push" context: prefer the flow whose trigger contains more push words
        return a if push_hits_a >= push_hits_b else b

    return a  # ambiguous — keep first encountered


def _dedup_flows(flows: List[DataFlow], use_case_text: str) -> List[DataFlow]:
    """
    Collapse flows that connect the same pair of systems into one per pair.

    Key: (min(source, dest), max(source, dest)) — direction-agnostic.
    When two flows share a key the direction is resolved by _pick_direction();
    the winner replaces the earlier entry.
    """
    seen: Dict[Tuple[str, str], DataFlow] = {}
    for flow in flows:
        pair_key = (min(flow.source, flow.destination), max(flow.source, flow.destination))
        if pair_key not in seen:
            seen[pair_key] = flow
        else:
            seen[pair_key] = _pick_direction(seen[pair_key], flow, use_case_text)
    return list(seen.values())


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def analyze_use_case(
    use_case_text: str,
    inventory: List[SystemNode],
) -> RawUseCaseAnalysis:
    """
    Single LLM call: given a use case description and the full inventory
    (with role descriptions), return the systems involved and the data flows.

    The Pydantic model_validator ensures every flow references only listed
    systems. Flows are deduplicated before returning.
    """
    inventory_block = _build_inventory_block(inventory)

    user_msg = (
        f"AVAILABLE SYSTEMS (name — role):\n{inventory_block}\n\n"
        f"USE CASE:\n{use_case_text}"
    )

    def _call(client) -> RawUseCaseAnalysis:
        return client.chat.completions.create(
            model=TEXT_MODEL,
            response_model=RawUseCaseAnalysis,
            max_retries=2,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )

    raw = call_with_key_rotation(_call)

    deduped = _dedup_flows(raw.flows, use_case_text)
    if len(deduped) < len(raw.flows):
        logger.info(
            f"  Deduped {len(raw.flows) - len(deduped)} duplicate flow(s) "
            f"({len(raw.flows)} → {len(deduped)})"
        )

    return raw.model_copy(update={"flows": deduped})
