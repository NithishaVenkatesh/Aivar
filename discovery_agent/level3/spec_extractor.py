from __future__ import annotations
import logging
import re
from typing import List, Optional

from ..config import TEXT_MODEL, call_with_key_rotation
from ..models import SystemNode
from ..level2.models import Gap
from .models import AgentDefSpec, ApiProfile, ConnectorSpec

logger = logging.getLogger(__name__)

_CONNECTOR_SYSTEM_PROMPT = """\
You are an API integration specialist generating two-sided connector specifications.

For the given source→destination integration, produce a ConnectorSpec with SEPARATE profiles
for the SOURCE system (read/list operations) and DESTINATION system (write/create operations).

SOURCE PROFILE rules:
1. api_base_url: use the real production base URL for the source system.
   For tenant-specific systems, use the template form e.g. "https://myinstance.example.com".
2. auth_type: use the source system's actual auth mechanism.
   Salesforce → oauth2_client_credentials. Workday → basic. NetSuite → oauth2_client_credentials.
3. auth_header_name: always "Authorization" for bearer/oauth2/api_key auth types.
4. auth_header_prefix: "Bearer " for most systems; "SSWS " for Okta API tokens only.
5. list_endpoint: the REST path for listing the entity (e.g. "/api/v1/users").
6. list_response_key: the JSON key containing the records array; use "" for bare JSON arrays.
7. pagination_style: cursor/offset/page/link_header/none — use what the source API actually uses.
   Salesforce SOQL → offset. GitHub/GitLab/Okta → link_header. HubSpot → cursor.
8. inferred_fields: list field names you inferred from general API knowledge, not verified docs.

DESTINATION PROFILE rules:
1. api_base_url: use the real production URL or template form.
2. auth_type: use the destination system's actual auth mechanism.
3. auth_header_name: ALWAYS "Authorization" for bearer/oauth2 auth. Never invent custom headers.
4. auth_header_prefix: "Bearer " for standard OAuth/bearer. "SSWS " only for Okta API tokens.
5. create_endpoint: the POST path for creating the entity in the destination.
6. list_endpoint: the collection path (often same as create_endpoint for REST APIs).
7. inferred_fields: list field names you inferred.

TOP-LEVEL rules:
1. entity_name: the primary data entity being synced (singular noun, no spaces, e.g. "lead").
2. mock_list_response: realistic source API response body with 1-2 records matching the real schema.
   For bare JSON arrays, use {"": [record1, record2]}; otherwise {"key": [record1, record2]}.
3. retry_status_codes: include at minimum [429, 503].
"""

# ---------------------------------------------------------------------------
# Known-system overrides — applied deterministically after the LLM call.
# These correct values that LLMs systematically get wrong for well-known APIs.
# Fields listed here are removed from inferred_fields because they are now
# verified reference values, not guesses.
#
# NOTE: The correct Zendesk auth is Authorization: Bearer {token}.
# "X-Zendesk-Token" does not exist — it was an LLM invention; this override removes it.
# ---------------------------------------------------------------------------

def _norm(name: str) -> str:
    return name.lower().replace(' ', '_').replace('-', '_')


_SYSTEM_OVERRIDES: dict[str, dict] = {
    "okta": {
        "auth_header_prefix": "SSWS ",
        "pagination_style": "link_header",
    },
    "zendesk": {
        "auth_type": "bearer",
        "auth_header_name": "Authorization",
        "auth_header_prefix": "Bearer ",
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


def _apply_profile_overrides(profile: ApiProfile, system_name: str) -> ApiProfile:
    """Apply deterministic overrides to a single ApiProfile for a known system."""
    key = _norm(system_name)
    for sys_key, overrides in _SYSTEM_OVERRIDES.items():
        if sys_key in key:
            updated = profile.model_copy(update=overrides)
            overridden_names = set(overrides.keys())
            cleaned = [f for f in updated.inferred_fields if f not in overridden_names]
            if len(cleaned) != len(updated.inferred_fields):
                updated = updated.model_copy(update={"inferred_fields": cleaned})
            logger.info(
                "  Applied %s overrides to %s profile: %s",
                sys_key, system_name, sorted(overrides),
            )
            return updated
    return profile


def _apply_overrides(spec: ConnectorSpec) -> ConnectorSpec:
    """Apply known-system overrides to both source and destination profiles."""
    new_src = _apply_profile_overrides(spec.source, spec.source_system)
    new_dst = _apply_profile_overrides(spec.destination, spec.destination_system)
    if new_src is not spec.source or new_dst is not spec.destination:
        spec = spec.model_copy(update={"source": new_src, "destination": new_dst})
    return spec


def _normalize_url(url: str, system_name: str) -> str:
    """Ensure the URL is HTTP(S); replace non-HTTP schemes with a safe local placeholder."""
    if url.startswith(("http://", "https://")):
        return url
    slug = re.sub(r"[^a-z0-9]", "", system_name.lower())
    normalized = f"https://api.{slug}.local/v1"
    logger.warning("Non-HTTP api_base_url %r normalized to %r", url, normalized)
    return normalized


def extract_connector_spec(
    gap: Gap,
    inventory: List[SystemNode],
) -> ConnectorSpec:
    """LLM call to extract both source and destination API profiles for one integration gap."""
    node_map = {n.canonical_name: n for n in inventory}
    src_node = node_map.get(gap.source_system)
    dst_node = node_map.get(gap.destination_system)

    def _node_summary(node: Optional[SystemNode], label: str, system_name: str) -> str:
        parts = [f"{label}: {system_name}"]
        if node is not None:
            parts.append(f"  category: {node.category}")
            if node.auth_method:
                parts.append(f"  auth_method: {node.auth_method}")
            if node.key_entities:
                parts.append(f"  entities: {', '.join(node.key_entities[:5])}")
            if node.business_processes:
                parts.append(f"  processes: {', '.join(node.business_processes[:3])}")
        else:
            parts.append("  (not in Level 1 inventory)")
        return "\n".join(parts)

    entity = gap.entities[0] if gap.entities else "record"
    trigger = gap.triggers[0] if gap.triggers else "on event"

    user_msg = (
        f"{_node_summary(src_node, 'SOURCE', gap.source_system)}\n\n"
        f"{_node_summary(dst_node, 'DESTINATION', gap.destination_system)}\n\n"
        f"Entity to sync: {entity}\n"
        f"Trigger: {trigger}\n"
        f"Direction: {gap.source_system} (read) → {gap.destination_system} (write)"
    )

    logger.info(
        "  Extracting ConnectorSpec for %s → %s",
        gap.source_system, gap.destination_system,
    )

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

    # Force-set system names to prevent LLM drift
    spec = spec.model_copy(update={
        "source_system": gap.source_system,
        "destination_system": gap.destination_system,
        "source": spec.source.model_copy(update={"system_name": gap.source_system}),
        "destination": spec.destination.model_copy(update={"system_name": gap.destination_system}),
    })

    # Normalize non-HTTP base URLs so the requests-based connector template works
    # and the responses library can mock requests in tests.
    updates: dict = {}
    src_url = _normalize_url(spec.source.api_base_url, gap.source_system)
    dst_url = _normalize_url(spec.destination.api_base_url, gap.destination_system)
    if src_url != spec.source.api_base_url:
        updates["source"] = spec.source.model_copy(update={"api_base_url": src_url})
    if dst_url != spec.destination.api_base_url:
        updates["destination"] = spec.destination.model_copy(update={"api_base_url": dst_url})
    if updates:
        spec = spec.model_copy(update=updates)

    # Enforce that 429 and 503 are always retried — the test template asserts this.
    must_retry = {429, 503}
    if not must_retry.issubset(set(spec.retry_status_codes)):
        merged = sorted(must_retry | set(spec.retry_status_codes))
        logger.warning(
            "retry_status_codes %r missing 429/503 — merged to %r",
            spec.retry_status_codes, merged,
        )
        spec = spec.model_copy(update={"retry_status_codes": merged})

    # Apply deterministic known-system overrides last so they take precedence
    # over LLM values and earlier normalization steps.
    spec = _apply_overrides(spec)

    return spec


_AGENT_SYSTEM_PROMPT = """\
You are generating an agent definition YAML for an enterprise integration.

Produce a concise, realistic agent definition with:
- system_prompt: 3-5 sentences explaining the agent's role and responsibilities.
- tools: 4-6 tool names the agent needs. Use entity-specific connector method names —
  list_{entity}s, get_{entity}, create_{entity}, update_{entity}, sync_{entity}s — where
  {entity} is the actual entity name given in the user message (e.g. list_leads, get_lead).
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
        f"Source auth: {connector_spec.source.auth_type}\n"
        f"Destination auth: {connector_spec.destination.auth_type}\n"
        f"Use cases this integration enables:\n"
        + "\n".join(f"  - {uc}" for uc in gap.use_cases_blocked)
    )

    logger.info(
        "  Extracting AgentDefSpec for %s → %s",
        gap.source_system, gap.destination_system,
    )

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
