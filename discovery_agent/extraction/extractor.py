from __future__ import annotations
import logging
import re
from typing import List

from ..models import Chunk, RawExtractionList, SystemMention
from ..config import TEXT_MODEL, call_with_key_rotation

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(fn=None, **kwargs):  # type: ignore[misc]
        if fn is not None:
            return fn
        return lambda f: f

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Patterns that indicate the evidence sentence does NOT describe an active
# software system — it names a room, codename, deprecated tool, or uncertainty.
# ---------------------------------------------------------------------------
_NON_SYSTEM_PATTERNS = re.compile(
    r"""
    \b(
        room\s+named        |  # "room named after Kafka"
        named\s+after       |  # "named after the streaming thing"
        conference\s+room   |
        meeting\s+room      |
        office\s+named      |
        code\s*name         |  # "codename Kafka"
        project\s+named     |
        project\s+code      |
        legacy\s+system     |
        deprecated\w*       |
        decommission\w*     |
        no\s+longer\s+use   |
        we\s+used\s+to      |
        shut\s+down         |
        was\s+replaced
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Hedge/uncertainty markers — presence degrades confidence in scoring stage
_HEDGE_PATTERNS = re.compile(
    r"""
    \b(
        i\s+think           |
        not\s+sure          |
        might\s+be          |
        probably            |
        possibly            |
        \bmaybe\b           |
        nobody\s+maintains  |
        single\s+use        |
        old\s+system        |
        legacy
    )\b
    | \?                     # trailing uncertainty
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Minimum characters for a valid system name.
# Single-char and two-char names ("IT", "AI") are generic terms, not systems.
_MIN_NAME_LENGTH = 3

# Sanity cap: more than this many systems per chunk is likely LLM over-extraction.
_MAX_SYSTEMS_PER_CHUNK = 30

_SYSTEM_PROMPT = """You are an enterprise system discovery agent analyzing company documents.

Extract ONLY software systems, tools, and platforms that are actively in use.

For each system provide:
- name: full official product name — expand abbreviations
  (e.g. SFDC → Salesforce, BQ → Google BigQuery, ADO → Azure DevOps)
- category: CRM / ERP / HRIS / BI / Data Warehouse / Database / Message Broker /
  Communication / Project Management / Cloud Platform / Identity / etc.
- auth_method: if explicitly stated in the text (OAuth2 / API Key / SAML /
  Basic Auth / SSO) — return null if not mentioned, never guess
- key_entities: list of data objects this system manages
  (e.g. Contacts, Orders, Invoices, Employees) — return [] if not stated
- business_processes: list of business workflows this system supports
  (e.g. "Sales pipeline management", "Invoice approval") — return [] if not stated
- criticality: if explicitly stated (high / medium / low) —
  return null if not mentioned, never guess
- evidence: an exact verbatim quote from the provided text that proves
  this system is actively in use — this field is mandatory

Rules:
- Only extract systems explicitly named in the provided text
- evidence MUST be an exact substring of the provided text
- SKIP if the system name only appears as a room name, codename, or metaphor
  (e.g. "the Kafka room", "project named Snowflake", "named after Kafka")
- SKIP deprecated, decommissioned, or shut-down systems
- Return an empty systems list if no active systems are mentioned
- Do not invent or hallucinate systems"""


@_traceable(name="extract_systems_from_chunk")
def extract_systems(chunk: Chunk) -> List[SystemMention]:
    """Pass 1 — extract systems from one chunk. Returns validated SystemMentions."""

    def _call(client, text: str) -> RawExtractionList:
        return client.chat.completions.create(
            model=TEXT_MODEL,
            response_model=RawExtractionList,
            max_retries=1,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"Document text:\n\n{text}"},
            ],
        )

    try:
        raw: RawExtractionList = call_with_key_rotation(_call, chunk.text)
    except Exception as exc:
        logger.error(f"Extraction failed for chunk {chunk.chunk_id}: {exc}")
        return []

    if len(raw.systems) > _MAX_SYSTEMS_PER_CHUNK:
        logger.warning(
            f"Chunk {chunk.chunk_id} returned {len(raw.systems)} systems — "
            f"unusually high (limit {_MAX_SYSTEMS_PER_CHUNK}), possible over-extraction"
        )

    mentions: List[SystemMention] = []
    for item in raw.systems:
        # Guard 0: name must be long enough to be a real system identifier
        if len(item.name.strip()) < _MIN_NAME_LENGTH:
            logger.debug(f"Skipped trivially short name: {item.name!r}")
            continue

        # Guard 1: evidence must exist in source text (hallucination check)
        if item.evidence not in chunk.text:
            logger.warning(
                f"Hallucination rejected — {item.name!r}: "
                f"evidence not found in source chunk {chunk.chunk_id}"
            )
            continue

        # Guard 2: evidence sentence must describe active system usage,
        # not a room name, codename, deprecation notice, etc.
        if _NON_SYSTEM_PATTERNS.search(item.evidence):
            logger.warning(
                f"Context rejected — {item.name!r}: "
                f"evidence describes a non-system context in chunk {chunk.chunk_id}: "
                f"{item.evidence!r}"
            )
            continue

        mentions.append(SystemMention(
            name=item.name,
            category=item.category,
            auth_method=item.auth_method,
            key_entities=item.key_entities,
            business_processes=item.business_processes,
            criticality=item.criticality,
            evidence=item.evidence,
            source_document=chunk.source_document,
            chunk_id=chunk.chunk_id,
        ))

    return mentions


def has_hedge_markers(evidence: str) -> bool:
    """True if the evidence sentence contains uncertainty/hedge language."""
    return bool(_HEDGE_PATTERNS.search(evidence))
