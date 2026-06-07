from __future__ import annotations
import logging
import re
from typing import List, Optional

from ..config import TEXT_MODEL, call_with_key_rotation
from ..models import SystemNode
from ..level2.models import Gap
from .models import AgentDefSpec, ConnectorSpec

logger = logging.getLogger(__name__)

_CONNECTOR_SYSTEM_PROMPT = """\
You are an API integration specialist generating connector specifications.

Given a source system and destination system, produce a realistic, accurate connector spec.

RULES:
1. api_base_url: use the real production base URL for the system (e.g. "https://rest.salesforce.com/services/data/v59.0").
   Tenant-specific systems (Okta, Zendesk, Salesforce): use the real template form, e.g.
   "https://{org}.okta.com/api/v1" or "https://{subdomain}.zendesk.com/api/v2".
2. auth_type: use the system's actual auth mechanism.
   Salesforce → oauth2_client_credentials. Marketo → oauth2_client_credentials.
   Okta → bearer (API token, NOT SAML). Workday → basic. Slack → bearer. Zendesk → api_key.
   NetSuite → oauth2_client_credentials. Tableau → bearer.
3. auth_header_name: for bearer → "Authorization". For api_key → the real header name (e.g. "X-Zendesk-Token").
4. auth_header_prefix: for bearer/api_key → use the REAL prefix.
   Okta API tokens use "SSWS " (not "Bearer "). Most others use "Bearer ".
5. list_endpoint: the real REST endpoint path for listing the entity (e.g. "/api/v1/users").
6. list_response_key: the JSON key in the response body that contains the array (e.g. "result", "records").
   If the API returns a bare JSON array (no wrapper), use an empty string "".
7. pagination_style: cursor / offset / page / none / link_header — use what the real API uses.
   Okta, GitHub, GitLab, Jira use link_header (RFC 5988 Link response headers).
8. entity_name: the primary data entity (singular noun, no spaces, e.g. "lead", "employee", "invoice").
9. create_endpoint: the POST endpoint to create the entity.
10. mock_list_response: a realistic mock response body with 1-2 example records matching the real API schema.
    If the API returns a bare array, use {"": [...]} to represent it (list_response_key = "").
11. auth_notes: 1-2 sentences describing what credentials are needed and how to obtain them.
12. inferred_fields: list the snake_case field names whose values you inferred from general API
    knowledge rather than the provided system inventory. Be honest — if you guessed a value,
    include its field name here. Common candidates: api_base_url, pagination_cursor_field,
    auth_type, list_response_key. An engineer will use this list to verify the values against
    the live API docs before deploying.
"""


# ---------------------------------------------------------------------------
# Known-system overrides — applied deterministically after the LLM call.
# The LLM is correct about structure and CRUD shape; these override only the
# specific values that LLMs systematically get wrong for well-known APIs.
# Fields listed here are removed from inferred_fields automatically because
# they are no longer guesses — they are verified reference values.
# ---------------------------------------------------------------------------

def _norm_dest(name: str) -> str:
    return name.lower().replace(" ", "_").replace("-", "_")


_SYSTEM_OVERRIDES: dict[str, dict] = {
    "okta": {
        "auth_header_prefix": "SSWS ",
        "pagination_style": "link_header",
    },
    "zendesk": {
        "auth_type": "api_key",
        "auth_header_name": "X-Zendesk-Token",
        "auth_header_prefix": "",
        "pagination_style": "cursor",
    },
    "github": {
        "pagination_style": "link_header",
        "auth_header_prefix": "Bearer ",
    },
    "gitlab": {
        "pagination_style": "link_header",
    },
    "jira": {
        "pagination_style": "offset",
    },
    "salesforce": {
        "auth_type": "oauth2_client_credentials",
        "pagination_style": "offset",
    },
    "marketo": {
        "auth_type": "oauth2_client_credentials",
        "pagination_style": "offset",
    },
    "hubspot": {
        "pagination_style": "cursor",
    },
    "workday": {
        "auth_type": "basic",
        "pagination_style": "offset",
    },
}


def _apply_overrides(spec: ConnectorSpec, destination: str) -> ConnectorSpec:
    """
    Apply deterministic API-specific corrections after the LLM call.
    First matching key wins (substring match on normalized destination name).
    Overridden fields are removed from inferred_fields since they are now verified.
    """
    key = _norm_dest(destination)
    for sys_key, overrides in _SYSTEM_OVERRIDES.items():
        if sys_key in key:
            spec = spec.model_copy(update=overrides)
            overridden_names = set(overrides.keys())
            cleaned = [f for f in spec.inferred_fields if f not in overridden_names]
            if len(cleaned) != len(spec.inferred_fields):
                spec = spec.model_copy(update={"inferred_fields": cleaned})
            logger.info(
                f"  Applied {sys_key} overrides: {sorted(overridden_names)}"
            )
            return spec
    return spec


def extract_connector_spec(
    gap: Gap,
    inventory: List[SystemNode],
) -> ConnectorSpec:
    """Single LLM call to extract API details for one integration gap."""
    node_map = {n.canonical_name: n for n in inventory}
    src_node = node_map.get(gap.source_system)
    dst_node = node_map.get(gap.destination_system)

    def _node_summary(node: Optional[SystemNode], label: str) -> str:
        if node is None:
            return f"{label}: unknown (not in Level 1 inventory)"
        parts = [f"{label}: {node.canonical_name}"]
        parts.append(f"  category: {node.category}")
        if node.auth_method:
            parts.append(f"  auth_method: {node.auth_method}")
        if node.key_entities:
            parts.append(f"  entities: {', '.join(node.key_entities[:5])}")
        if node.business_processes:
            parts.append(f"  processes: {', '.join(node.business_processes[:3])}")
        return "\n".join(parts)

    entity = gap.entities[0] if gap.entities else "record"
    trigger = gap.triggers[0] if gap.triggers else "on event"

    user_msg = (
        f"{_node_summary(src_node, 'SOURCE')}\n\n"
        f"{_node_summary(dst_node, 'DESTINATION')}\n\n"
        f"Entity to sync: {entity}\n"
        f"Trigger: {trigger}\n"
        f"Integration direction: {gap.source_system} → {gap.destination_system}"
    )

    logger.info(f"  Extracting ConnectorSpec for {gap.source_system} → {gap.destination_system}")

    def _call(client) -> ConnectorSpec:
        return client.chat.completions.create(
            model=TEXT_MODEL,
            response_model=ConnectorSpec,
            max_retries=2,
            messages=[
                {"role": "system", "content": _CONNECTOR_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )

    spec = call_with_key_rotation(_call)
    # Ensure source/destination are correct (LLM might drift)
    spec = spec.model_copy(update={
        "source_system": gap.source_system,
        "destination_system": gap.destination_system,
    })
    # Normalize non-HTTP base URLs so the requests-based connector template works.
    # Databases (postgresql://, mysql://) and other non-HTTP schemes are not callable
    # via requests and cannot be mocked by the responses library in tests.
    if not spec.api_base_url.startswith(("http://", "https://")):
        slug = re.sub(r"[^a-z0-9]", "", gap.source_system.lower())
        normalized = f"https://api.{slug}.local/v1"
        logger.warning(
            "Non-HTTP api_base_url %r normalized to %r for connector template compatibility",
            spec.api_base_url, normalized,
        )
        spec = spec.model_copy(update={"api_base_url": normalized})

    # Enforce that 429 and 503 are always in retry_status_codes.
    # The test template's test_retries_on_429 is mandatory — if the LLM returns []
    # or omits these codes, the test is guaranteed to fail.
    must_retry = {429, 503}
    if not must_retry.issubset(set(spec.retry_status_codes)):
        merged = sorted(must_retry | set(spec.retry_status_codes))
        logger.warning("retry_status_codes %r missing 429/503 — merged to %r", spec.retry_status_codes, merged)
        spec = spec.model_copy(update={"retry_status_codes": merged})

    # Apply deterministic known-system overrides last so they take precedence
    # over both the LLM values and the earlier normalization steps.
    spec = _apply_overrides(spec, gap.destination_system)

    return spec


_AGENT_SYSTEM_PROMPT = """\
You are generating an agent definition YAML for an enterprise integration.

Produce a concise, realistic agent definition with:
- system_prompt: 3-5 sentences explaining the agent's role and responsibilities.
- tools: 4-6 tool names the agent needs. Use entity-specific connector method names —
  list_{entity}s, get_{entity}, create_{entity}, update_{entity} — where {entity} is the
  actual entity name given in the user message (e.g. list_leads, get_lead, not list_records).
  Add utilities like log_event and handle_error as needed.
- workflow: 4-7 ordered steps describing the end-to-end automation flow (plain English).
- test_scenarios: 3-5 concrete test scenarios covering happy path, error cases, and edge cases.

Keep each workflow step and test scenario under 100 characters.
"""


def extract_agent_spec(
    gap: Gap,
    connector_spec: ConnectorSpec,
) -> AgentDefSpec:
    """Single LLM call to generate the agent definition for one integration gap."""
    user_msg = (
        f"Integration: {gap.source_system} → {gap.destination_system}\n"
        f"Entity: {connector_spec.entity_name}\n"
        f"Trigger: {gap.triggers[0] if gap.triggers else 'on event'}\n"
        f"Auth type: {connector_spec.auth_type}\n"
        f"Use cases this integration enables:\n"
        + "\n".join(f"  - {uc}" for uc in gap.use_cases_blocked)
    )

    logger.info(f"  Extracting AgentDefSpec for {gap.source_system} → {gap.destination_system}")

    def _call(client) -> AgentDefSpec:
        return client.chat.completions.create(
            model=TEXT_MODEL,
            response_model=AgentDefSpec,
            max_retries=2,
            messages=[
                {"role": "system", "content": _AGENT_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )

    return call_with_key_rotation(_call)
