from __future__ import annotations
import re
import json
import logging
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .models import AgentDefSpec, ConnectorSpec

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"


def _build_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters["to_python_repr"] = repr
    env.filters["to_json"] = lambda x: json.dumps(x, indent=2)
    return env


_ENV = _build_env()


def _to_class_name(source: str, destination: str) -> str:
    def clean(s: str) -> str:
        return re.sub(r"[^a-zA-Z0-9]", "", s.title().replace(" ", ""))

    return f"{clean(source)}To{clean(destination)}Connector"


def render_connector(spec: ConnectorSpec) -> str:
    # Defense-in-depth: spec_extractor already enforces this, but re-check at
    # render time so a misconfigured spec can never silently produce a connector
    # whose test_retries_on_429 is guaranteed to fail.
    required_retry = {429, 503}
    if not required_retry.issubset(set(spec.retry_status_codes)):
        merged = sorted(required_retry | set(spec.retry_status_codes))
        logger.warning(
            "render_connector: retry_status_codes %r missing 429/503 — merged to %r",
            spec.retry_status_codes, merged,
        )
        spec = spec.model_copy(update={"retry_status_codes": merged})

    tmpl = _ENV.get_template("connector.py.j2")
    ctx = spec.model_dump()
    ctx["class_name"] = _to_class_name(spec.source_system, spec.destination_system)
    return tmpl.render(**ctx)


def render_agent_def(spec: ConnectorSpec, agent_spec: AgentDefSpec) -> str:
    tmpl = _ENV.get_template("agent_def.yaml.j2")
    ctx = {
        "source_system": spec.source_system,
        "destination_system": spec.destination_system,
        "system_prompt": agent_spec.system_prompt,
        "tools": agent_spec.tools,
        "workflow": agent_spec.workflow,
        "test_scenarios": agent_spec.test_scenarios,
    }
    return tmpl.render(**ctx)


def render_tests(spec: ConnectorSpec) -> str:
    tmpl = _ENV.get_template("test_connector.py.j2")
    ctx = spec.model_dump()
    ctx["class_name"] = _to_class_name(spec.source_system, spec.destination_system)
    return tmpl.render(**ctx)


def render_requirements(spec: ConnectorSpec) -> str:
    tmpl = _ENV.get_template("requirements.txt.j2")
    return tmpl.render(**spec.model_dump())


def render_readme(spec: ConnectorSpec) -> str:
    tmpl = _ENV.get_template("README.md.j2")
    ctx = spec.model_dump()
    ctx["class_name"] = _to_class_name(spec.source_system, spec.destination_system)
    # Build a {field: value} lookup for the "Verify before deploying" section.
    # Only fields that exist in the spec dict are included; unrecognized names
    # (LLM hallucinated field names) map to "(unknown)".
    ctx["inferred_values"] = {
        field: str(ctx.get(field, "(unknown)"))
        for field in (spec.inferred_fields or [])
    }
    return tmpl.render(**ctx)
