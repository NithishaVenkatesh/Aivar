from __future__ import annotations
from typing import Dict, Optional, List
from pydantic import BaseModel, Field, field_validator


class Chunk(BaseModel):
    chunk_id: str
    source_document: str
    text: str
    chunk_type: str  # section / table / paragraph / vision_description


class RawSystemExtraction(BaseModel):
    """What the LLM returns for a single system — no metadata fields."""
    name: str
    category: str
    auth_method: Optional[str] = None
    key_entities: List[str] = Field(default_factory=list)
    business_processes: List[str] = Field(default_factory=list)
    criticality: Optional[str] = None  # high / medium / low / unknown
    evidence: str  # exact quote from source text

    @field_validator("key_entities", "business_processes", mode="before")
    @classmethod
    def _null_to_empty(cls, v: object) -> object:
        # LLM sometimes returns null for optional list fields; coerce to []
        return v if v is not None else []


class RawExtractionList(BaseModel):
    """Instructor wrapper for system extraction."""
    systems: List[RawSystemExtraction] = Field(default_factory=list)


class SystemMention(BaseModel):
    """Raw extraction enriched with chunk metadata."""
    name: str
    category: str
    auth_method: Optional[str] = None
    key_entities: List[str] = Field(default_factory=list)
    business_processes: List[str] = Field(default_factory=list)
    criticality: Optional[str] = None
    evidence: str
    source_document: str
    chunk_id: str


class RawRelationshipExtraction(BaseModel):
    """What the LLM returns for a single relationship — no metadata fields."""
    source: str
    target: str
    relation: str   # syncs_to / feeds_data_to / authenticates_via / depends_on / triggers
    direction: str  # unidirectional / bidirectional
    trigger: Optional[str] = None       # nightly / real-time / on-event / manual
    data_entities: List[str] = Field(default_factory=list)
    evidence: str   # exact quote from source text

    @field_validator("data_entities", mode="before")
    @classmethod
    def _null_to_empty(cls, v: object) -> object:
        return v if v is not None else []


class RawRelationshipList(BaseModel):
    """Instructor wrapper for relationship extraction."""
    relationships: List[RawRelationshipExtraction] = Field(default_factory=list)


class SystemRelationship(BaseModel):
    """Validated edge in the knowledge graph."""
    source: str
    target: str
    relation: str
    direction: str
    trigger: Optional[str] = None
    data_entities: List[str] = Field(default_factory=list)
    evidence: str
    source_document: str
    confidence: float


class SystemNode(BaseModel):
    """Canonical system after deduplication and confidence scoring — graph node."""
    name: str
    canonical_name: str
    category: str
    auth_method: Optional[str] = None
    key_entities: List[str] = Field(default_factory=list)
    business_processes: List[str] = Field(default_factory=list)
    criticality: str = "unknown"
    confidence: float = 0.0
    needs_human_review: bool = False
    review_note: Optional[str] = None
    source_documents: List[str] = Field(default_factory=list)
    evidence: List[str] = Field(default_factory=list)
    mention_count: int = 1


class GraphStats(BaseModel):
    total_nodes: int
    total_edges: int


class InventoryOutput(BaseModel):
    """Final pipeline output."""
    systems: List[SystemNode]
    relationships: List[SystemRelationship]
    graph_stats: GraphStats
    total_documents_processed: int
    total_systems_found: int
    systems_flagged_for_review: int
    # Diagnostic fields — all optional with defaults for backward compatibility
    run_id: str = ""
    stage_timings: Dict[str, float] = Field(default_factory=dict)
    extraction_errors: int = 0
    failed_chunk_ids: List[str] = Field(default_factory=list)
    total_chunks_processed: int = 0
