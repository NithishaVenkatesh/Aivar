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
   If unsure, use a realistic placeholder like "https://api.{system-slug}.com/v1".
2. auth_type: use the system's actual auth mechanism.
   Salesforce → oauth2_client_credentials. Marketo → oauth2_client_credentials.
   Okta → bearer. Workday → basic. Slack → bearer. Zendesk → bearer or api_key.
   NetSuite → oauth2_client_credentials. PostgreSQL → basic (db credentials not HTTP).
   Tableau → bearer. For PostgreSQL (a database, not an HTTP API): set api_base_url to
   "postgresql://host:5432/dbname", auth_type to "basic", auth_notes to explain it uses
   a database driver (psycopg2), and set list_endpoint to the table name.
3. auth_header_name: for bearer → "Authorization". For api_key → the real header name (e.g. "X-API-Key").
4. auth_header_prefix: for bearer → "Bearer ". For api_key → "". For basic → "Basic ".
5. list_endpoint: the real REST endpoint path for listing the entity (e.g. "/leads.json").
6. list_response_key: the JSON key in the response body that contains the array (e.g. "result", "records", "data").
7. pagination_style: cursor / offset / page / none — use what the real API uses.
8. entity_name: the primary data entity (singular noun, no spaces, e.g. "lead", "employee", "invoice").
9. create_endpoint: the POST endpoint to create the entity.
10. mock_list_response: a realistic mock response body with 1-2 example records matching the real API schema.
11. auth_notes: 1-2 sentences describing what credentials are needed and how to obtain them.
12. inferred_fields: list the snake_case field names whose values you inferred from general API
    knowledge rather than the provided system inventory. Be honest — if you guessed a value,
    include its field name here. Common candidates: api_base_url, pagination_cursor_field,
    auth_type, list_response_key. An engineer will use this list to verify the values against
    the live API docs before deploying.
"""


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
