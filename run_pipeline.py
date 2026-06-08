"""
Thin subprocess entry point — called by the Next.js API route.
Reads file paths from argv, runs the discovery pipeline, prints JSON to stdout.
All progress logs go to stderr so the API route can stream them separately.

Guarantees:
  - stdout is always valid JSON (either the full result or an error envelope)
  - Any unhandled exception is caught and serialized as {"error": "..."}
  - Sentry is initialized if SENTRY_DSN is present in the environment
"""
import json
import os
import sys
import logging
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

# Configure logging to stderr BEFORE importing anything else.
# force=True re-configures if a library already attached a handler.
# The format must match the logMapper regex patterns in the Next.js frontend.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)-8s %(name)s — %(message)s",
    stream=sys.stderr,
    force=True,
)

logger = logging.getLogger(__name__)

# Ensure the project root is on sys.path regardless of cwd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# --------------------------------------------------------------------------
# Configuration constants for path validation
# --------------------------------------------------------------------------
_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024   # 50 MB per file
_MAX_FILE_COUNT = 20                        # reject batches larger than this


def _validate_paths(raw_paths: list[str]) -> tuple[list[str], list[str]]:
    """
    Validate that each path resolves to a real, readable file within the
    current working tree.  Returns (valid_paths, errors).

    Checks:
      - Path is not empty
      - Resolved path exists and is a file (prevents directory traversal)
      - File size is within _MAX_FILE_SIZE_BYTES
    """
    valid: list[str] = []
    errors: list[str] = []

    for raw in raw_paths:
        if not raw or not raw.strip():
            errors.append("Empty path provided")
            continue

        try:
            resolved = Path(raw).resolve()
        except Exception as exc:
            errors.append(f"Could not resolve path {raw!r}: {exc}")
            continue

        if not resolved.exists():
            errors.append(f"File not found: {raw!r}")
            continue

        if not resolved.is_file():
            errors.append(f"Path is not a file: {raw!r}")
            continue

        try:
            size = resolved.stat().st_size
        except OSError as exc:
            errors.append(f"Cannot stat {raw!r}: {exc}")
            continue

        if size > _MAX_FILE_SIZE_BYTES:
            errors.append(
                f"File too large ({size / 1_048_576:.1f} MB > "
                f"{_MAX_FILE_SIZE_BYTES // 1_048_576} MB limit): {raw!r}"
            )
            continue

        valid.append(str(resolved))

    return valid, errors


def _emit_error(message: str, code: int = 1) -> None:
    """Print a JSON error envelope to stdout and exit."""
    print(json.dumps({"error": message}), flush=True)
    sys.exit(code)


if __name__ == "__main__":
    raw_paths = sys.argv[1:]

    if not raw_paths:
        _emit_error("No file paths provided")

    # -----------------------------------------------------------------------
    # Reject oversized batches before any imports or I/O
    # -----------------------------------------------------------------------
    if len(raw_paths) > _MAX_FILE_COUNT:
        _emit_error(
            f"Too many files: {len(raw_paths)} (limit {_MAX_FILE_COUNT}). "
            "Split into smaller batches."
        )

    # -----------------------------------------------------------------------
    # Validate paths — must happen before pipeline import so errors are fast
    # -----------------------------------------------------------------------
    valid_paths, validation_errors = _validate_paths(raw_paths)

    if validation_errors:
        for err in validation_errors:
            logger.error(f"Validation: {err}")

    if not valid_paths:
        _emit_error(
            "No valid file paths after validation. "
            f"Errors: {'; '.join(validation_errors)}"
        )

    # -----------------------------------------------------------------------
    # Lazy imports — only after validation passes, so startup is fast on error
    # -----------------------------------------------------------------------
    from discovery_agent.config import init_sentry
    from discovery_agent.pipeline import run

    init_sentry()

    # -----------------------------------------------------------------------
    # Run pipeline — guaranteed stdout JSON regardless of outcome
    # -----------------------------------------------------------------------
    try:
        output = run(valid_paths)
        print(output.model_dump_json(), flush=True)

    except KeyboardInterrupt:
        _emit_error("Pipeline interrupted", code=130)

    except Exception as exc:
        logger.exception("Unhandled pipeline error")

        # Best-effort Sentry capture
        try:
            import sentry_sdk
            sentry_sdk.capture_exception(exc)
        except Exception:
            pass

        _emit_error(f"Pipeline failed: {exc}")
