from __future__ import annotations
import logging
import re
from pathlib import Path
from typing import List

from ..models import InventoryOutput
from ..level2.models import GapReport
from .classification import classify_gap, get_paradigm_notes
from .models import GeneratedBundle, ValidationReport
from .spec_extractor import extract_connector_spec, extract_agent_spec
from .renderer import (
    render_connector, render_agent_def, render_tests,
    render_requirements, render_readme, _to_class_name,
)
from .validator import validate

logger = logging.getLogger(__name__)


def _slug(source: str, destination: str) -> str:
    def clean(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "_", s.lower()).strip("_")
    return f"{clean(source)}_to_{clean(destination)}"


def run(
    inventory: InventoryOutput,
    gap_report: GapReport,
    output_dir: str = "generated",
) -> List[GeneratedBundle]:
    """
    Level 3 pipeline: for every missing integration gap, generate a connector
    bundle (code + agent def + tests + docs), validate it, and return all bundles.

    Bundles that fail validation are still returned — marked valid=False with
    specific failure reasons so they appear in the observable output.
    """
    missing_gaps = [g for g in gap_report.gaps if g.status == "missing"]
    logger.info(f"Level 3 pipeline — {len(missing_gaps)} missing gap(s) to generate for")

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    bundles: List[GeneratedBundle] = []

    for i, gap in enumerate(missing_gaps, 1):
        gap_key = f"{gap.source_system} → {gap.destination_system}"
        logger.info(f"[{i}/{len(missing_gaps)}] Generating bundle for {gap_key}")

        # --- Paradigm gate -------------------------------------------------------
        # Detect whether this gap can be served by the REST-CRUD template before
        # spending any LLM calls.  Database sources (psycopg2, pymongo …) and
        # webhook-only destinations (Slack chat.postMessage …) cannot be expressed
        # as a generic HTTP CRUD connector — generating one would produce code that
        # is internally consistent but fundamentally wrong for the paradigm.
        paradigm = classify_gap(gap.source_system, gap.destination_system)
        if paradigm != 'rest_api':
            notes = get_paradigm_notes(paradigm, gap.source_system, gap.destination_system)
            logger.warning(
                f"  Paradigm '{paradigm}' detected for {gap_key} — "
                f"REST auto-generation skipped, marking manual_setup_required"
            )
            bundles.append(GeneratedBundle(
                gap_key=gap_key,
                source_system=gap.source_system,
                destination_system=gap.destination_system,
                connector_code="",
                agent_def_yaml="",
                test_code="",
                readme=(
                    f"# {gap_key}\n\n"
                    f"## Manual Setup Required\n\n"
                    f"{notes}\n"
                ),
                requirements="",
                validation=ValidationReport(),
                artifacts_dir=None,
                paradigm=paradigm,
                manual_setup_required=True,
                paradigm_notes=notes,
            ))
            continue
        # -------------------------------------------------------------------------

        bundle_dir = output_path / _slug(gap.source_system, gap.destination_system)
        bundle_dir.mkdir(parents=True, exist_ok=True)

        validation = ValidationReport()
        connector_code = ""
        agent_def_yaml = ""
        test_code = ""
        readme = ""
        requirements = ""

        # ------------------------------------------------------------------
        # Step 1: Extract ConnectorSpec (LLM call 1)
        # ------------------------------------------------------------------
        try:
            logger.info(f"  Step 1/4: Extracting ConnectorSpec")
            spec = extract_connector_spec(gap, inventory.systems)
        except Exception as exc:
            msg = f"ConnectorSpec extraction failed: {type(exc).__name__}: {exc}"
            logger.error(f"  {msg}")
            validation = validation.model_copy(update={"failures": [msg]})
            bundles.append(GeneratedBundle(
                gap_key=gap_key,
                source_system=gap.source_system,
                destination_system=gap.destination_system,
                connector_code="", agent_def_yaml="", test_code="",
                readme="", requirements="",
                validation=validation,
                artifacts_dir=None,
            ))
            continue

        # ------------------------------------------------------------------
        # Step 2: Extract AgentDefSpec (LLM call 2)
        # ------------------------------------------------------------------
        try:
            logger.info(f"  Step 2/4: Extracting AgentDefSpec")
            agent_spec = extract_agent_spec(gap, spec)
        except Exception as exc:
            msg = f"AgentDefSpec extraction failed: {type(exc).__name__}: {exc}"
            logger.error(f"  {msg}")
            validation = validation.model_copy(update={"failures": [msg]})
            bundles.append(GeneratedBundle(
                gap_key=gap_key,
                source_system=gap.source_system,
                destination_system=gap.destination_system,
                connector_code="", agent_def_yaml="", test_code="",
                readme="", requirements="",
                validation=validation,
                artifacts_dir=None,
            ))
            continue

        # ------------------------------------------------------------------
        # Step 3: Render all files
        # ------------------------------------------------------------------
        try:
            logger.info(f"  Step 3/4: Rendering templates")
            connector_code = render_connector(spec)
            agent_def_yaml = render_agent_def(spec, agent_spec)
            test_code = render_tests(spec)
            requirements = render_requirements(spec)
            readme = render_readme(spec)
        except Exception as exc:
            msg = f"Template rendering failed: {type(exc).__name__}: {exc}"
            logger.error(f"  {msg}")
            validation = validation.model_copy(update={"failures": [msg]})
            bundles.append(GeneratedBundle(
                gap_key=gap_key,
                source_system=gap.source_system,
                destination_system=gap.destination_system,
                connector_code=connector_code,
                agent_def_yaml=agent_def_yaml,
                test_code=test_code,
                readme=readme,
                requirements=requirements,
                validation=validation,
                artifacts_dir=None,
            ))
            continue

        # ------------------------------------------------------------------
        # Step 4: Write files to disk
        # ------------------------------------------------------------------
        try:
            (bundle_dir / "connector.py").write_text(connector_code, encoding="utf-8")
            (bundle_dir / "agent_def.yaml").write_text(agent_def_yaml, encoding="utf-8")
            (bundle_dir / "test_connector.py").write_text(test_code, encoding="utf-8")
            (bundle_dir / "requirements.txt").write_text(requirements, encoding="utf-8")
            (bundle_dir / "README.md").write_text(readme, encoding="utf-8")
            logger.info(f"  Files written to {bundle_dir}")
        except Exception as exc:
            msg = f"File write failed: {type(exc).__name__}: {exc}"
            logger.error(f"  {msg}")
            validation = validation.model_copy(update={"failures": [msg]})
            bundles.append(GeneratedBundle(
                gap_key=gap_key,
                source_system=gap.source_system,
                destination_system=gap.destination_system,
                connector_code=connector_code,
                agent_def_yaml=agent_def_yaml,
                test_code=test_code,
                readme=readme,
                requirements=requirements,
                validation=validation,
                artifacts_dir=None,
            ))
            continue

        # ------------------------------------------------------------------
        # Step 5 (was Step 8 in plan): Validation gate
        # ------------------------------------------------------------------
        logger.info(f"  Step 4/4: Running validation gate")
        validation = validate(bundle_dir)

        status = "VALID" if validation.valid else f"INVALID ({len(validation.failures)} failure(s))"
        logger.info(f"  Validation: {status}")

        bundles.append(GeneratedBundle(
            gap_key=gap_key,
            source_system=gap.source_system,
            destination_system=gap.destination_system,
            connector_code=connector_code,
            agent_def_yaml=agent_def_yaml,
            test_code=test_code,
            readme=readme,
            requirements=requirements,
            validation=validation,
            artifacts_dir=str(bundle_dir),
        ))

    valid_count = sum(1 for b in bundles if b.validation.valid)
    logger.info(
        f"Level 3 complete — {valid_count}/{len(bundles)} bundle(s) passed validation"
    )
    return bundles
