"""
Four-check validation gate for generated bundles.

Checks run cheapest-first:
  a. static   — py_compile syntax + subprocess import
  b. structural — yaml.safe_load + required keys
  c. dynamic  — isolated venv, pip install, pytest -q
  d. score    — aggregate into ValidationReport

A failing check short-circuits (no point installing a venv for a file with
a syntax error). The bundle is always returned; failures are stamped onto
the ValidationReport rather than raised.
"""
from __future__ import annotations
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Tuple

import yaml

from .models import ValidationReport

logger = logging.getLogger(__name__)

REQUIRED_AGENT_KEYS = {"system_prompt", "tools", "workflow", "test_scenarios"}

_IS_WINDOWS = sys.platform == "win32"
_BIN_DIR = "Scripts" if _IS_WINDOWS else "bin"
_PIP_EXE = "pip.exe" if _IS_WINDOWS else "pip"
_PY_EXE = "python.exe" if _IS_WINDOWS else "python"


def _static_check(bundle_dir: Path, filename: str) -> Tuple[bool, bool, list[str]]:
    """
    Returns (compiles, imports, failures).

    Compiles: py_compile syntax check passes.
    Imports: subprocess import (catches bad imports, undefined names at module load).
    """
    path = bundle_dir / filename
    failures: list[str] = []

    # a1. Syntax
    r = subprocess.run(
        [sys.executable, "-m", "py_compile", str(path)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        msg = f"Syntax error in {filename}: {r.stderr.strip()}"
        logger.warning(msg)
        return False, False, [msg]

    # a2. Import (catches undefined names, missing imports)
    # Use repr() of the resolved absolute path so Windows backslashes are safe
    # and cwd of the subprocess has no effect on path resolution.
    abs_path = path.resolve()
    import_code = (
        "import importlib.util, sys; "
        f"spec = importlib.util.spec_from_file_location('m', {repr(str(abs_path))}); "
        "m = importlib.util.module_from_spec(spec); "
        "spec.loader.exec_module(m)"
    )
    r = subprocess.run(
        [sys.executable, "-c", import_code],
        capture_output=True, text=True,
        timeout=30,
    )
    if r.returncode != 0:
        last_line = (r.stderr.strip().splitlines() or ["unknown error"])[-1]
        msg = f"Import error in {filename}: {last_line}"
        logger.warning(msg)
        return True, False, [msg]

    return True, True, failures


def _structural_check(bundle_dir: Path) -> Tuple[bool, list[str]]:
    """Parse agent_def.yaml and verify required keys are present."""
    path = bundle_dir / "agent_def.yaml"
    failures: list[str] = []
    try:
        with open(path, encoding="utf-8") as f:
            doc = yaml.safe_load(f)
    except yaml.YAMLError as exc:
        msg = f"Invalid YAML in agent_def.yaml: {exc}"
        logger.warning(msg)
        return False, [msg]

    if not isinstance(doc, dict):
        msg = "agent_def.yaml is not a YAML mapping"
        return False, [msg]

    missing = REQUIRED_AGENT_KEYS - set(doc.keys())
    if missing:
        msg = f"agent_def.yaml missing required keys: {sorted(missing)}"
        logger.warning(msg)
        return False, [msg]

    return True, failures


def _dynamic_check(bundle_dir: Path) -> Tuple[bool, list[str]]:
    """
    Create an isolated venv, install requirements, run pytest.
    Uses PYTHONPATH=bundle_dir so the test can import connector.py.
    """
    failures: list[str] = []
    venv_dir = bundle_dir / ".venv"
    pip = venv_dir / _BIN_DIR / _PIP_EXE
    py = venv_dir / _BIN_DIR / _PY_EXE

    # Create venv
    r = subprocess.run(
        [sys.executable, "-m", "venv", str(venv_dir)],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        msg = f"venv creation failed: {r.stderr.strip()[-300:]}"
        return False, [msg]

    # Install deps + pytest + responses
    reqs_path = bundle_dir / "requirements.txt"
    r = subprocess.run(
        [str(pip), "install", "-q", "-r", str(reqs_path), "pytest", "responses"],
        capture_output=True, text=True, timeout=300,
    )
    if r.returncode != 0:
        msg = f"Dependency install failed: {r.stderr.strip()[-300:]}"
        logger.warning(msg)
        return False, [msg]

    # Run tests
    env = {**os.environ, "PYTHONPATH": str(bundle_dir)}
    r = subprocess.run(
        [str(py), "-m", "pytest", "-q", str(bundle_dir)],
        capture_output=True, text=True, timeout=180,
        cwd=str(bundle_dir), env=env,
    )
    if r.returncode != 0:
        output = (r.stdout + r.stderr).strip()[-500:]
        msg = f"Tests failed:\n{output}"
        logger.warning(f"  Dynamic check FAILED for {bundle_dir.name}")
        return False, [msg]

    logger.info(f"  Dynamic check PASSED for {bundle_dir.name}")
    return True, failures


def validate(bundle_dir: Path) -> ValidationReport:
    """
    Run all four checks in sequence, cheapest first.
    Short-circuits on the first blocking failure.
    Always returns a ValidationReport — never raises.
    """
    bundle_dir = bundle_dir.resolve()  # absolute once; prevents path-doubling in all subprocesses
    report = ValidationReport()

    try:
        # a. Static
        compiles, imports, fails = _static_check(bundle_dir, "connector.py")
        report = report.model_copy(update={
            "connector_compiles": compiles,
            "connector_imports": imports,
            "failures": report.failures + fails,
        })
        if not compiles:
            return report

        # b. Structural
        yaml_valid, fails = _structural_check(bundle_dir)
        report = report.model_copy(update={
            "agent_def_valid": yaml_valid,
            "failures": report.failures + fails,
        })
        if not yaml_valid:
            return report

        # c. Dynamic (most expensive — only runs if a+b pass)
        tests_pass, fails = _dynamic_check(bundle_dir)
        report = report.model_copy(update={
            "tests_pass": tests_pass,
            "failures": report.failures + fails,
        })

    except Exception as exc:
        msg = f"Validation gate exception: {type(exc).__name__}: {exc}"
        logger.error(msg)
        report = report.model_copy(update={"failures": report.failures + [msg]})

    return report
