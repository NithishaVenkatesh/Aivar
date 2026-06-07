from __future__ import annotations
import logging
from typing import List

from ..models import InventoryOutput
from .models import (
    GapReport, MissingCapability, RejectedSystem,
    Skipped, SkippedItem, UseCaseResult,
)
from .analyzer import analyze_use_case
from .validator import validate_systems
from .gap_detector import detect_gaps
from .effort import classify_all_efforts
from .scorer import score_gaps
from .dependency import build_dependency_graph

logger = logging.getLogger(__name__)


def run(inventory: InventoryOutput, use_cases: List[str]) -> GapReport:
    """
    Full Level 2 pipeline.

    Args:
        inventory:   Level 1 InventoryOutput (systems + relationships).
        use_cases:   list of automation goal strings from the user.

    Returns:
        GapReport with prioritised gaps, dependency graph, and skipped items.
    """
    logger.info(f"Level 2 pipeline starting — {len(use_cases)} use case(s)")

    logger.info(f"Inventory contains {len(inventory.systems)} system(s)")

    use_case_results: List[UseCaseResult] = []
    unmapped: List[SkippedItem] = []
    all_rejected: List[RejectedSystem] = []
    all_missing_caps: List[MissingCapability] = []

    # ------------------------------------------------------------------
    # Stage 1: Analyse each use case (single LLM call) then validate
    # ------------------------------------------------------------------
    for i, uc_text in enumerate(use_cases, 1):
        uc_text = uc_text.strip()
        if not uc_text:
            continue

        logger.info(f"Analysing use case {i}/{len(use_cases)}: {uc_text[:80]}")

        # Single LLM call: systems + flows
        try:
            raw = analyze_use_case(uc_text, inventory.systems)
        except Exception as exc:
            logger.warning(f"  LLM analysis failed: {exc}")
            unmapped.append(SkippedItem(
                text=uc_text,
                reason=f"LLM analysis failed after retries: {type(exc).__name__}",
            ))
            continue

        logger.info(
            f"  LLM returned {len(raw.systems)} system(s), {len(raw.flows)} flow(s)"
        )

        # Cross-check against Level 1 inventory
        valid, rejected, missing_caps = validate_systems(
            raw.systems, inventory.systems, uc_text
        )

        for r in rejected:
            all_rejected.append(RejectedSystem(
                use_case=uc_text, system=r,
                reason="Not found in Level 1 inventory",
            ))
        for m in missing_caps:
            all_missing_caps.append(MissingCapability(
                use_case=uc_text, capability_needed=m,
            ))

        if not valid:
            logger.warning(f"  No valid inventory systems — marking as unmapped")
            unmapped.append(SkippedItem(
                text=uc_text,
                reason="No systems from the Level 1 inventory matched this use case",
            ))
            continue

        # Keep only flows that connect two validated systems
        valid_set = set(valid)
        valid_flows = [
            f for f in raw.flows
            if f.source in valid_set and f.destination in valid_set
        ]

        logger.info(
            f"  Validated {len(valid)} system(s), {len(valid_flows)} flow(s) kept"
        )

        use_case_results.append(UseCaseResult(
            text=uc_text,
            involved_systems=valid,
            flows=valid_flows,
            frequency=raw.frequency,
            criticality=raw.criticality,
            rejected_systems=rejected,
            missing_capabilities=missing_caps,
        ))

    logger.info(
        f"Use case analysis complete — "
        f"{len(use_case_results)} mapped, {len(unmapped)} unmapped"
    )

    # ------------------------------------------------------------------
    # Stage 2: Gap detection
    # ------------------------------------------------------------------
    gaps = detect_gaps(use_case_results, inventory.relationships)
    missing_count = sum(1 for g in gaps if g.status == "missing")
    available_count = len(gaps) - missing_count
    logger.info(
        f"Gaps detected — {missing_count} missing, {available_count} available"
    )

    # ------------------------------------------------------------------
    # Stage 3: Effort classification (rule-based, no LLM)
    # ------------------------------------------------------------------
    gaps = classify_all_efforts(gaps, inventory.systems)
    logger.info("Effort classification complete")

    # ------------------------------------------------------------------
    # Stage 4: Priority scoring
    # ------------------------------------------------------------------
    gaps = score_gaps(gaps, use_case_results)
    logger.info("Priority scoring complete")

    # ------------------------------------------------------------------
    # Stage 5: Dependency graph
    # ------------------------------------------------------------------
    dep_graph = build_dependency_graph(gaps)
    logger.info(f"Dependency graph — {len(dep_graph)} integration(s) blocking use cases")

    # ------------------------------------------------------------------
    # Assemble output
    # ------------------------------------------------------------------
    skipped = Skipped(
        unmapped_use_cases=unmapped,
        rejected_systems=all_rejected,
        missing_capabilities=all_missing_caps,
    )

    report = GapReport(
        use_cases_analyzed=len(use_case_results),
        total_gaps=len(gaps),
        missing_integrations=missing_count,
        gaps=gaps,
        dependency_graph=dep_graph,
        skipped=skipped,
    )

    logger.info(
        f"Level 2 complete — {report.missing_integrations} integration gap(s) found, "
        f"{report.use_cases_analyzed} use case(s) mapped"
    )
    return report
