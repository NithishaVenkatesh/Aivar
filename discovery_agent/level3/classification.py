from __future__ import annotations
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ..models import SystemNode

DATABASE_SYSTEMS = frozenset({
    'postgresql', 'postgres', 'mysql', 'mariadb', 'mongodb', 'mongo',
    'sqlite', 'redis', 'snowflake', 'bigquery', 'redshift', 'oracle',
    'mssql', 'sqlserver', 'sql_server', 'dynamodb', 'cassandra',
    'elasticsearch', 'elastic', 'neo4j', 'influxdb', 'clickhouse',
})

# Systems whose primary integration pattern is event-push or webhook,
# not CRUD over REST.  A destination in this set cannot meaningfully receive
# "create_record / update_record" calls.
WEBHOOK_SYSTEMS = frozenset({
    'slack', 'discord', 'teams', 'msteams', 'microsoft_teams',
    'pagerduty', 'opsgenie', 'victorops',
})

# Identity providers and SSO/SCIM systems.  Integrating TO these systems is a
# provisioning workflow (SCIM 2.0 or IdP admin console), not generic REST CRUD.
IDENTITY_SYSTEMS = frozenset({
    'okta', 'onelogin', 'one_login', 'pingidentity', 'ping_identity',
    'azure_active_directory', 'active_directory', 'azure_ad', 'aad',
    'jumpcloud', 'jump_cloud', 'duo', 'cyberark', 'forgerock',
    'shibboleth', 'keycloak', 'auth0',
})


def _normalize(s: str) -> str:
    return s.lower().replace(' ', '_').replace('-', '_')


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
      'database_source'      — source is a native-driver database, not an HTTP endpoint
      'webhook_destination'  — destination is a push-only webhook / messaging system
      'scim_or_manual'       — destination is an identity/SSO system; provisioning task

    When src_node / dst_node are provided (Level 1 SystemNode objects), the check
    is enriched with auth_method and category metadata so SAML/SSO systems are caught
    even if their name isn't in the IDENTITY_SYSTEMS set.
    """
    src = _normalize(source)
    dst = _normalize(destination)

    for db in DATABASE_SYSTEMS:
        if db in src:
            return 'database_source'

    for wh in WEBHOOK_SYSTEMS:
        if wh in dst:
            return 'webhook_destination'

    # Identity / SCIM check — use node metadata when available for maximum accuracy,
    # fall back to known system name heuristics when nodes aren't in inventory.
    dst_cat = ((dst_node.category or "") if dst_node else "").lower()
    dst_auth = ((dst_node.auth_method or "") if dst_node else "").lower()
    if (
        "saml" in dst_auth
        or "identity" in dst_cat
        or "sso" in dst_cat
        or any(ident in dst for ident in IDENTITY_SYSTEMS)
    ):
        return 'scim_or_manual'

    return 'rest_api'


_NOTES: dict[str, str] = {
    'database_source': (
        "{source} is a relational or document database. Integrating FROM a database "
        "requires a native driver (e.g. psycopg2 for PostgreSQL, pymongo for MongoDB) "
        "rather than an HTTP REST client. The generic REST-CRUD connector template "
        "cannot be applied here.\n\n"
        "**Recommended approach:** Implement using the appropriate database driver, "
        "expose the query as a scheduled job or CDC (change-data-capture) stream, "
        "and push the resulting records to the destination system via its REST API."
    ),
    'webhook_destination': (
        "{destination} is a messaging or webhook-target system. Posting TO {destination} "
        "requires its event-push API (e.g. Slack `chat.postMessage` or an Incoming Webhook URL), "
        "not a generic REST CRUD client.\n\n"
        "**Recommended approach:** Implement a dedicated event-handler that reads records "
        "from the source, constructs the correct message payload (text, blocks, attachments), "
        "and POSTs it to the webhook endpoint or messaging API method."
    ),
    'scim_or_manual': (
        "{destination} is an identity provider or SSO/provisioning system. "
        "User provisioning TO {destination} is typically handled via SCIM 2.0 or the "
        "identity provider's pre-built integration marketplace, not a custom REST CRUD connector.\n\n"
        "**Recommended approach:** Configure SCIM provisioning from {source} to {destination} "
        "via the IdP's admin console (e.g. Okta Integration Network, Azure AD App Gallery). "
        "If a pre-built connector is unavailable, implement using the SCIM 2.0 protocol "
        "with bearer token authentication against {destination}'s SCIM endpoint. "
        "This is an administrative provisioning task, not an application-to-application data sync."
    ),
}


def get_paradigm_notes(paradigm: str, source: str, destination: str) -> str:
    template = _NOTES.get(paradigm, "")
    return template.format(source=source, destination=destination)
