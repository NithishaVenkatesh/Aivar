from __future__ import annotations
from typing import Dict, List, Tuple

from .models import Gap, UseCaseResult

_FREQ_SCORES: Dict[str, int] = {
    "real-time": 4,
    "daily": 3,
    "weekly": 2,
    "monthly": 1,
    "ad-hoc": 1,
}

_CRIT_SCORES: Dict[str, int] = {
    "high": 3,
    "medium": 2,
    "low": 1,
    "unknown": 1,
}


def _uc_scores(uc: UseCaseResult) -> Tuple[int, int]:
    freq = _FREQ_SCORES.get(uc.frequency.lower(), 1)
    crit = _CRIT_SCORES.get(uc.criticality.lower(), 1)
    return freq, crit


def score_gaps(
    gaps: List[Gap],
    use_case_results: List[UseCaseResult],
) -> List[Gap]:
    """
    Priority = (max_freq + max_crit) × (1 + downstream_count)

    Using max instead of average so a critical daily use case that also runs
    ad-hoc doesn't get its score dragged down.
    Using (1 + downstream_count) instead of downstream_count so a critical
    standalone workflow still scores high even when nothing depends on it.
    """
    # Build a lookup: use_case_text → (freq_score, crit_score)
    uc_map: Dict[str, Tuple[int, int]] = {
        uc.text: _uc_scores(uc) for uc in use_case_results
    }

    scored: List[Gap] = []
    for gap in gaps:
        if not gap.use_cases_blocked:
            scored.append(gap.model_copy(update={"priority_score": 0.0}))
            continue

        max_freq = max(
            (uc_map.get(uc_text, (1, 1))[0] for uc_text in gap.use_cases_blocked),
            default=1,
        )
        max_crit = max(
            (uc_map.get(uc_text, (1, 1))[1] for uc_text in gap.use_cases_blocked),
            default=1,
        )
        downstream = len(gap.use_cases_blocked)
        priority = (max_freq + max_crit) * (1 + downstream)

        scored.append(gap.model_copy(update={"priority_score": float(priority)}))

    return sorted(scored, key=lambda g: g.priority_score, reverse=True)
