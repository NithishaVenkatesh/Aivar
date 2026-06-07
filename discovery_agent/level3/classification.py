from __future__ import annotations
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ..models import SystemNode

# Name-based fallback sets — used only when SystemNode metadata is absent.
# Primary classification always uses node.category / node.auth_method attributes.
DATABASE_SYSTEMS = frozenset({
    'postgresql', 'postgres', 'mysql', 'mariadb', 'mongodb', 'mongo',
    'sqlite', 'redis', 'snowflake', 'bigquery', 'redshift', 'oracle',
    'mssql', 'sqlserver', 'sql_server', 'dynamodb', 'cassandra',
    'elasticsearch', 'elastic', 'neo4j', 'influxdb', 'clickhouse',
})

WEBHOOK_SYSTEMS = frozenset({
    'slack', 'discord', 'teams', 'msteams', 'microsoft_teams',
    'pagerduty', 'opsgenie', 'victorops',
})

IDENTITY_SYSTEMS = frozenset({
    'okta', 'onelogin', 'one_login', 'pingidentity', 'ping_identity',
    'azure_active_directory', 'active_directory', 'azure_ad', 'aad',
    'jumpcloud', 'jump_cloud', 'duo', 'cyberark', 'forgerock',
    'shibboleth', 'keycloak', 'auth0',
})


def _normalize(s: str) -> str:
    return s.lower().replace(' ', '_').replace('-', '_')


# --- Attribute-first predicate functions -------------------------------------------
# Each predicate checks node ATTRIBUTES first (category, auth_method) when a SystemNode
# is available, falling back to name-based heuristics only when metadata is absent.
# This ensures a "Booking Frontend" flagged as needs_human_review is caught even when
# its name doesn't appear in any frozenset.


def _is_database(name: str, node: Optional["SystemNode"]) -> bool:
    """True when the system requires a native database driver, not HTTP REST."""
    if node is not None and node.category:
        if "database" in node.category.lower():
            return True
    return any(db in name for db in DATABASE_SYSTEMS)


def _is_identity(name: str, node: Optional["SystemNode"]) -> bool:
    """True when the system is an identity provider / SSO / SCIM endpoint."""
    if node is not None:
        cat = (node.category or "").lower()
        auth = (node.auth_method or "").lower()
        if "saml" in auth or "identity" in cat or "sso" in cat:
            return True
    return any(ident in name for ident in IDENTITY_SYSTEMS)


def _is_webhook_only(name: str, node: Optional["SystemNode"]) -> bool:
    """True when the system is a push-only messaging/webhook system (no REST CRUD API)."""
    if node is not None:
        cat = (node.category or "").lower()
        is_messaging = any(kw in cat for kw in ("communication", "messaging", "webhook", "chat"))
        # A communication system with no known auth_method is very likely webhook-only
        if is_messaging and node.auth_method is None:
            return True
    return any(wh in name for wh in WEBHOOK_SYSTEMS)


def classify_gap(
    source: str,
    destination: str,
    src_node: Optional["SystemNode"] = None,
    dst_node: Optional["SystemNode"] = None,
) -> str:
    """
    Classify the integration paradigm for a source→destination pair.

    Returns one of:
      'rest_api'             — both sides addressable via HTTP REST; auto-gen applies
      'database_source'      — either side is a native-driver database
      'webhook_destination'  — either side is a push-only webhook / messaging system
      'scim_or_manual'       — either side is an IdP/SSO system, OR a system is flagged
                               for human review (low confidence)

    BOTH source and destination are evaluated. A non-REST signal on EITHER side routes
    the gap to manual setup. Classification uses node ATTRIBUTES (category, auth_method,
    needs_human_review) when available, with name heuristics as fallback only.
    """
    src = _normalize(source)
    dst = _normalize(destination)

    # Database: native driver required for either side
    if _is_database(src, src_node) or _is_database(dst, dst_node):
        return 'database_source'

    # Identity / SSO: either side being an IdP means provisioning workflow, not CRUD
    if _is_identity(src, src_node) or _is_identity(dst, dst_node):
        return 'scim_or_manual'

    # Webhook / messaging: push-only system cannot support generic CRUD
    if _is_webhook_only(src, src_node) or _is_webhook_only(dst, dst_node):
        return 'webhook_destination'

    # Low-confidence flag: auto-generating a connector for an unverified system is unsafe
    if (src_node is not None and src_node.needs_human_review) or \
       (dst_node is not None and dst_node.needs_human_review):
        return 'scim_or_manual'

    return 'rest_api'


def get_paradigm_notes(
    paradigm: str,
    source: str,
    destination: str,
    src_node: Optional["SystemNode"] = None,
    dst_node: Optional["SystemNode"] = None,
) -> str:
    """
    Generate a human-readable explanation of why this gap cannot use a REST connector.
    The reason is derived from node attributes (category, auth_method, review_note),
    not from hardcoded per-system sentences.
    """
    src = _normalize(source)
    dst = _normalize(destination)

    def _describe(name: str, node: Optional["SystemNode"]) -> str:
        if node is None:
            return name
        attrs = []
        if node.category:
            attrs.append(f"category: {node.category}")
        if node.auth_method:
            attrs.append(f"auth: {node.auth_method}")
        if node.needs_human_review and node.review_note:
            attrs.append(f"flagged: {node.review_note}")
        return f"{name} ({', '.join(attrs)})" if attrs else name

    src_desc = _describe(source, src_node)
    dst_desc = _describe(destination, dst_node)

    if paradigm == 'database_source':
        db_side = src_desc if _is_database(src, src_node) else dst_desc
        other_side = dst_desc if _is_database(src, src_node) else src_desc
        return (
            f"{db_side} is a relational or document database. Integrating requires a "
            f"native driver (e.g. psycopg2, pymongo) rather than an HTTP REST client. "
            f"The generic REST-CRUD connector template cannot be applied here.\n\n"
            f"**Recommended approach:** Use the appropriate database driver, expose the "
            f"query as a scheduled job or change-data-capture stream, and connect to "
            f"{other_side} via its REST API."
        )

    if paradigm == 'webhook_destination':
        wh_side = src_desc if _is_webhook_only(src, src_node) else dst_desc
        return (
            f"{wh_side} is a messaging or webhook-target system. Posting TO or receiving "
            f"FROM this system requires its event-push API, not a generic REST CRUD client.\n\n"
            f"**Recommended approach:** Implement a dedicated event-handler that reads records "
            f"from the source, constructs the correct message payload, "
            f"and POSTs to the webhook endpoint or messaging API method."
        )

    if paradigm == 'scim_or_manual':
        # Could be identity/SSO or needs_human_review
        if _is_identity(src, src_node) or _is_identity(dst, dst_node):
            id_side = src_desc if _is_identity(src, src_node) else dst_desc
            return (
                f"{id_side} is an identity provider or SSO/provisioning system. "
                f"User provisioning is typically handled via SCIM 2.0 or the IdP's "
                f"pre-built integration marketplace, not a custom REST CRUD connector.\n\n"
                f"**Recommended approach:** Configure SCIM provisioning from {src_desc} "
                f"to {dst_desc} via the IdP's admin console. If a pre-built connector "
                f"is unavailable, implement using the SCIM 2.0 protocol with bearer token "
                f"authentication against the SCIM endpoint."
            )
        # needs_human_review case
        flagged = src_desc if (src_node and src_node.needs_human_review) else dst_desc
        return (
            f"{flagged} was flagged for human review due to low extraction confidence. "
            f"Generating an automated connector before the system identity is confirmed "
            f"risks creating an integration for the wrong target.\n\n"
            f"**Recommended approach:** Verify the system details in the Level 1 inventory, "
            f"confirm it is the correct integration target, then re-run Level 3 generation "
            f"after the confidence issue is resolved."
        )

    return (
        f"Integration between {src_desc} and {dst_desc} requires manual setup. "
        f"Paradigm: {paradigm}."
    )
