from __future__ import annotations
import logging
from typing import List, Set

from ..models import Chunk, RawRelationshipList, SystemNode, SystemRelationship
from ..config import TEXT_MODEL, call_with_key_rotation

logger = logging.getLogger(__name__)


def _build_system_prompt(confirmed_names: List[str]) -> str:
    system_list = "\n".join(f"- {n}" for n in sorted(confirmed_names))
    return f"""You are analyzing enterprise documents to find integration relationships
between software systems.

Confirmed systems found in this document collection:
{system_list}

Find explicit mentions of how these systems connect to each other.

For each relationship provide:
- source: the system that sends data or triggers the action
  (must be exactly from the confirmed list above)
- target: the system that receives (must be exactly from the confirmed list above)
- relation: one of syncs_to / feeds_data_to / depends_on / triggers /
  pushes_to / pulls_from / integrates_with
- direction: unidirectional or bidirectional
- trigger: when it happens (nightly / real-time / on-event / manual) —
  null if not stated
- data_entities: list of data types that flow (Contacts, Orders, etc.) —
  empty list if not stated
- evidence: exact verbatim quote from the text proving this connection

Rules:
- Both source AND target must appear exactly in the confirmed list above
- evidence MUST be a verbatim substring of the provided text
- Return an empty relationships list if no explicit connections are mentioned
- Do not invent connections"""


def extract_relationships(
    chunks: List[Chunk],
    confirmed_nodes: List[SystemNode],
) -> List[SystemRelationship]:
    """Pass 2 — extract relationships between confirmed systems across all chunks."""
    if len(confirmed_nodes) < 2:
        return []

    confirmed_names: Set[str] = {n.canonical_name for n in confirmed_nodes}
    system_prompt = _build_system_prompt(list(confirmed_names))
    all_relationships: List[SystemRelationship] = []

    for chunk in chunks:
        rels = _extract_from_chunk(chunk, system_prompt, confirmed_names)
        all_relationships.extend(rels)

    return _deduplicate(all_relationships)


def _extract_from_chunk(
    chunk: Chunk,
    system_prompt: str,
    confirmed_names: Set[str],
) -> List[SystemRelationship]:

    def _call(client, text: str) -> RawRelationshipList:
        return client.chat.completions.create(
            model=TEXT_MODEL,
            response_model=RawRelationshipList,
            max_retries=1,
            temperature=0,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Document text:\n\n{text}"},
            ],
        )

    try:
        raw: RawRelationshipList = call_with_key_rotation(_call, chunk.text)
    except Exception as exc:
        logger.error(f"Relationship extraction failed for chunk {chunk.chunk_id}: {exc}")
        return []

    return _validate(raw.relationships, confirmed_names, chunk)


def _validate(
    raw_rels: list,
    confirmed_names: Set[str],
    chunk: Chunk,
) -> List[SystemRelationship]:
    valid: List[SystemRelationship] = []

    for rel in raw_rels:
        # Guard 1: both endpoints must be confirmed system nodes
        if rel.source not in confirmed_names or rel.target not in confirmed_names:
            logger.warning(
                f"Rejected edge {rel.source!r} → {rel.target!r}: "
                "one or both endpoints not in confirmed systems"
            )
            continue

        # Guard 2: evidence must appear in the source chunk.
        # Normalized check (lowercase + collapsed whitespace) so minor LLM
        # formatting differences don't silently drop real edges.
        def _norm(t: str) -> str:
            return " ".join(t.lower().split())

        if _norm(rel.evidence) not in _norm(chunk.text):
            logger.warning(
                f"Rejected edge {rel.source!r} → {rel.target!r}: "
                "evidence not found in source text"
            )
            continue

        confidence = _relationship_confidence(rel)

        valid.append(SystemRelationship(
            source=rel.source,
            target=rel.target,
            relation=rel.relation,
            direction=rel.direction,
            trigger=rel.trigger,
            data_entities=rel.data_entities,
            evidence=rel.evidence,
            source_document=chunk.source_document,
            confidence=confidence,
        ))

    return valid


def _relationship_confidence(rel) -> float:
    """Deterministic confidence for a validated relationship."""
    score = 80.0  # evidence passed substring check
    if rel.data_entities:
        score += 10.0
    if rel.trigger:
        score += 10.0
    return min(100.0, score)


def _deduplicate(relationships: List[SystemRelationship]) -> List[SystemRelationship]:
    """Keep the first occurrence of each unique (source, target, relation) triple."""
    seen: Set[tuple] = set()
    unique: List[SystemRelationship] = []
    for rel in relationships:
        key = (rel.source, rel.target, rel.relation)
        if key not in seen:
            seen.add(key)
            unique.append(rel)
    return unique
