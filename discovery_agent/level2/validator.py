from __future__ import annotations
import logging
from typing import List, Tuple

from rapidfuzz import fuzz

from ..models import SystemNode

logger = logging.getLogger(__name__)

_SIMILARITY_THRESHOLD = 88
_GENERIC_WORDS = {
    "system", "platform", "tool", "service", "app", "application",
    "database", "db", "api", "integration", "connector", "engine",
    "solution", "software", "crm", "erp", "hris", "bi",
}


def validate_systems(
    llm_names: List[str],
    inventory: List[SystemNode],
    use_case_text: str,
) -> Tuple[List[str], List[str], List[str]]:
    """
    Cross-check LLM-named systems against Level 1 inventory.

    Returns:
        valid_canonical  — canonical names confirmed in inventory
        rejected         — LLM named these, but no inventory match (product names)
        missing_caps     — LLM named these, but they look like generic capabilities
    """
    inventory_map = {node.canonical_name.lower(): node.canonical_name for node in inventory}

    valid_canonical: List[str] = []
    rejected: List[str] = []
    missing_caps: List[str] = []

    for name in llm_names:
        name_lower = name.lower().strip()

        # 1. Exact match
        if name_lower in inventory_map:
            canon = inventory_map[name_lower]
            if canon not in valid_canonical:
                valid_canonical.append(canon)
            continue

        # 2. Fuzzy match against all canonical names
        best_score = 0
        best_canon = None
        for canon_lower, canon in inventory_map.items():
            score = fuzz.token_sort_ratio(name_lower, canon_lower)
            if score > best_score:
                best_score = score
                best_canon = canon

        if best_score >= _SIMILARITY_THRESHOLD and best_canon:
            logger.info(
                f"  Fuzzy matched '{name}' → '{best_canon}' (score={best_score})"
            )
            if best_canon not in valid_canonical:
                valid_canonical.append(best_canon)
            continue

        # 3. No match — classify as missing capability or rejected hallucination
        words = set(name_lower.split())
        if words & _GENERIC_WORDS:
            logger.warning(
                f"  Missing capability: '{name}' not in inventory "
                f"(sounds generic, not a specific product)"
            )
            missing_caps.append(name)
        else:
            logger.warning(
                f"  Rejected LLM system: '{name}' not in Level 1 inventory "
                f"(best fuzzy score={best_score})"
            )
            rejected.append(name)

    return valid_canonical, rejected, missing_caps
