"""
Thin subprocess entry point — called by the Next.js API route.
Reads file paths from argv, runs the discovery pipeline, prints JSON to stdout.
All progress logs go to stderr so the API route can stream them separately.
"""
import sys
import os
import logging

# Configure logging to stderr BEFORE importing anything else.
# force=True re-configures if a library already attached a handler.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)-8s %(name)s — %(message)s",
    stream=sys.stderr,
    force=True,
)

# Ensure the project root is on sys.path regardless of cwd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from discovery_agent.pipeline import run

if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        print('{"error": "No file paths provided"}')
        sys.exit(1)

    output = run(paths)
    # JSON result goes to stdout — kept clean so the API route can parse it
    print(output.model_dump_json())
