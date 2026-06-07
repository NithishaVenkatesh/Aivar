"""
Level 2 entry point — called by the Next.js /api/analyze route.

Usage:
    python -u run_level2.py <inventory_json_path> <usecases_txt_path>

    inventory_json_path : path to a JSON file containing the Level 1 InventoryOutput
    usecases_txt_path   : path to a plain-text file with use cases, one per line

All progress logs go to stderr (streamed to the browser as SSE log lines).
Final JSON result goes to stdout (parsed by the API route as the structured result).
"""
import sys
import os
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
from discovery_agent.level2.pipeline import run

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print('{"error": "Usage: run_level2.py <inventory_path> <usecases_path>"}')
        sys.exit(1)

    inventory_path = sys.argv[1]
    usecases_path = sys.argv[2]

    try:
        with open(inventory_path, "r", encoding="utf-8") as f:
            inventory = InventoryOutput.model_validate_json(f.read())
    except Exception as exc:
        print(f'{{"error": "Failed to load inventory: {exc}"}}')
        sys.exit(1)

    try:
        with open(usecases_path, "r", encoding="utf-8") as f:
            raw_text = f.read()
        use_cases = [line.strip() for line in raw_text.splitlines() if line.strip()]
    except Exception as exc:
        print(f'{{"error": "Failed to load use cases: {exc}"}}')
        sys.exit(1)

    if not use_cases:
        print('{"error": "No use cases found in the provided file"}')
        sys.exit(1)

    report = run(inventory, use_cases)
    print(report.model_dump_json())
