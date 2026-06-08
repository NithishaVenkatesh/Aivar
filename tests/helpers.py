"""Shared test helpers — lightweight builders that keep fixtures DRY."""
from __future__ import annotations

from discovery_agent.models import Chunk, SystemMention, SystemNode


def make_mention(
    name: str = "Salesforce",
    category: str = "CRM",
    evidence: str = "We use Salesforce for CRM.",
    source_document: str = "doc.pdf",
    chunk_id: str = "c1",
    auth_method: str | None = None,
    key_entities: list[str] | None = None,
    business_processes: list[str] | None = None,
    criticality: str | None = None,
) -> SystemMention:
    return SystemMention(
        name=name,
        category=category,
        evidence=evidence,
        source_document=source_document,
        chunk_id=chunk_id,
        auth_method=auth_method,
        key_entities=key_entities or [],
        business_processes=business_processes or [],
        criticality=criticality,
    )


def make_node(
    name: str = "Salesforce",
    canonical_name: str | None = None,
    category: str = "CRM",
    mention_count: int = 1,
    auth_method: str | None = None,
    key_entities: list[str] | None = None,
    business_processes: list[str] | None = None,
    criticality: str = "unknown",
    evidence: list[str] | None = None,
    source_documents: list[str] | None = None,
    confidence: float = 0.0,
    needs_human_review: bool = False,
) -> SystemNode:
    return SystemNode(
        name=name,
        canonical_name=canonical_name or name,
        category=category,
        mention_count=mention_count,
        auth_method=auth_method,
        key_entities=key_entities or [],
        business_processes=business_processes or [],
        criticality=criticality,
        evidence=evidence or ["We use it."],
        source_documents=source_documents or ["doc.pdf"],
        confidence=confidence,
        needs_human_review=needs_human_review,
    )


def make_chunk(
    text: str = "We use Salesforce.",
    chunk_id: str = "c1",
    source_document: str = "doc.pdf",
    chunk_type: str = "section",
) -> Chunk:
    return Chunk(
        chunk_id=chunk_id,
        source_document=source_document,
        text=text,
        chunk_type=chunk_type,
    )
