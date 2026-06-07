from __future__ import annotations

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


def _normalize(s: str) -> str:
    return s.lower().replace(' ', '_').replace('-', '_')


def classify_gap(source: str, destination: str) -> str:
    """
    Classify the integration paradigm for a source→destination pair.

    Returns one of:
      'rest_api'             — both sides addressable via HTTP REST; auto-gen applies
      'database_source'      — source is a native-driver database, not an HTTP endpoint
      'webhook_destination'  — destination is a push-only webhook / messaging system

    Classification is conservative: only explicitly known non-HTTP sources and
    known webhook-only destinations are flagged.  Everything else falls through
    to 'rest_api', where the validation gate catches paradigm failures at run time.
    """
    src = _normalize(source)
    dst = _normalize(destination)

    for db in DATABASE_SYSTEMS:
        if db in src:
            return 'database_source'

    for wh in WEBHOOK_SYSTEMS:
        if wh in dst:
            return 'webhook_destination'

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
}


def get_paradigm_notes(paradigm: str, source: str, destination: str) -> str:
    template = _NOTES.get(paradigm, "")
    return template.format(source=source, destination=destination)
