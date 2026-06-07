from __future__ import annotations
from typing import List

from .models import DependencyLink, Gap


def build_dependency_graph(gaps: List[Gap]) -> List[DependencyLink]:
    """
    Produce a list of DependencyLinks: for each missing integration,
    list which use cases are blocked until that integration exists.

    Only missing integrations generate dependency entries —
    available integrations don't block anything.
    """
    links: List[DependencyLink] = []

    for gap in gaps:
        if gap.status == "available":
            continue
        if not gap.use_cases_blocked:
            continue

        integration_label = f"{gap.source_system} -> {gap.destination_system}"
        links.append(DependencyLink(
            integration=integration_label,
            required_before=list(gap.use_cases_blocked),
        ))

    # Sort by number of blocked use cases descending (most blocking first)
    links.sort(key=lambda l: len(l.required_before), reverse=True)
    return links
