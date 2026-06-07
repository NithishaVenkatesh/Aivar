"""
Level 3 entry point — called by the Next.js /api/generate route.

Usage:
    python -u run_level3.py <inventory_json_path> <gap_report_json_path> [--output-dir <dir>]

    inventory_json_path  : path to a JSON file containing the Level 1 InventoryOutput
    gap_report_json_path : path to a JSON file containing the Level 2 GapReport

All progress logs go to stderr (streamed to the browser as SSE log lines).
Final JSON result (list of GeneratedBundle) goes to stdout.
"""
import sys
import os
import json
import logging

sys.stdout.reconfigure(encoding="utf-8")

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)-8s %(name)s — %(message)s",
    stream=sys.stderr,
    force=True,
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from discovery_agent.models import InventoryOutput
from discovery_agent.level2.models import GapReport
from discovery_agent.level3.pipeline import run

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print('{"error": "Usage: run_level3.py <inventory_path> <gap_report_path>"}')
        sys.exit(1)

    inventory_path = sys.argv[1]
    gap_report_path = sys.argv[2]
    output_dir = "generated"
    for i, arg in enumerate(sys.argv):
        if arg == "--output-dir" and i + 1 < len(sys.argv):
            output_dir = sys.argv[i + 1]

    try:
        with open(inventory_path, "r", encoding="utf-8") as f:
            inventory = InventoryOutput.model_validate_json(f.read())
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load inventory: {exc}"}))
        sys.exit(1)

    try:
        with open(gap_report_path, "r", encoding="utf-8") as f:
            gap_report = GapReport.model_validate_json(f.read())
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load gap report: {exc}"}))
        sys.exit(1)

    missing_count = sum(1 for g in gap_report.gaps if g.status == "missing")
    if missing_count == 0:
        print(json.dumps({"bundles": [], "message": "No missing integrations to generate"}))
        sys.exit(0)

    bundles = run(inventory, gap_report, output_dir)
    print(json.dumps({"bundles": [b.model_dump() for b in bundles]}))
