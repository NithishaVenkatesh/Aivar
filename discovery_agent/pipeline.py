from __future__ import annotations
import logging
from pathlib import Path
from typing import List, Optional

from .models import GraphStats, InventoryOutput
from .ingestion.router import detect_type, DocType
from .ingestion.parser import parse_document, parse_text, parse_spreadsheet
from .ingestion.vision import parse_image
from .ingestion.chunker import enforce_size_limit
from .extraction.extractor import extract_systems
from .extraction.resolver import resolve
from .extraction.confidence import score
from .extraction.relationship_extractor import extract_relationships
from .graph.builder import build_graph
from .output.formatter import build_output, to_json

logger = logging.getLogger(__name__)


def run(
    document_paths: List[str],
    output_path: Optional[str] = None,
) -> InventoryOutput:
    """
    Full discovery pipeline.

    Args:
        document_paths: list of file paths to process.
        output_path:    optional path to write inventory JSON.

    Returns:
        InventoryOutput with systems, relationships, and graph stats.
    """
    logger.info(f"Discovery pipeline starting — {len(document_paths)} file(s)")

    # -----------------------------------------------------------------------
    # Stage 1: Ingest
    # -----------------------------------------------------------------------
    all_chunks = []
    processed_docs: List[str] = []

    for path in document_paths:
        doc_type = detect_type(path)

        if doc_type == DocType.UNSUPPORTED:
            logger.warning(f"Unsupported file type — skipping: {path}")
            continue

        logger.info(f"Ingesting [{doc_type.value}] {Path(path).name}")

        if doc_type in (DocType.PDF, DocType.DOCX, DocType.PPTX):
            chunks = parse_document(path)
        elif doc_type in (DocType.MARKDOWN, DocType.TEXT):
            chunks = parse_text(path)
        elif doc_type == DocType.SPREADSHEET:
            chunks = parse_spreadsheet(path)
        elif doc_type == DocType.IMAGE:
            chunks = parse_image(path)
        else:
            chunks = []

        if chunks:
            processed_docs.append(Path(path).name)
            all_chunks.extend(chunks)
            logger.info(f"  → {len(chunks)} chunk(s)")
        else:
            logger.warning(f"  → No content extracted from {Path(path).name}")

    logger.info(f"Total chunks before size check: {len(all_chunks)}")

    # -----------------------------------------------------------------------
    # Stage 2: Enforce chunk size limits
    # -----------------------------------------------------------------------
    all_chunks = enforce_size_limit(all_chunks)
    logger.info(f"Total chunks after size enforcement: {len(all_chunks)}")

    if not all_chunks:
        logger.warning("No content to process — returning empty inventory")
        return _empty_output(len(processed_docs))

    # -----------------------------------------------------------------------
    # Stage 3: Pass 1 — system extraction
    # -----------------------------------------------------------------------
    all_mentions = []
    for chunk in all_chunks:
        mentions = extract_systems(chunk)
        if mentions:
            logger.info(f"  Chunk {chunk.chunk_id}: {len(mentions)} system(s) found")
        all_mentions.extend(mentions)

    logger.info(f"Raw mentions across all chunks: {len(all_mentions)}")

    if not all_mentions:
        logger.warning("No systems found in any document")
        return _empty_output(len(processed_docs))

    # -----------------------------------------------------------------------
    # Stage 4: Resolve duplicates → canonical nodes
    # -----------------------------------------------------------------------
    nodes = resolve(all_mentions)
    logger.info(f"Unique systems after deduplication: {len(nodes)}")

    # -----------------------------------------------------------------------
    # Stage 5: Score confidence
    # -----------------------------------------------------------------------
    nodes = score(nodes)
    flagged = sum(1 for n in nodes if n.needs_human_review)
    logger.info(f"Systems flagged for human review: {flagged}")

    # -----------------------------------------------------------------------
    # Stage 6: Pass 2 — relationship extraction
    # -----------------------------------------------------------------------
    relationships = extract_relationships(all_chunks, nodes)
    logger.info(f"Relationships found: {len(relationships)}")

    # -----------------------------------------------------------------------
    # Stage 7: Build knowledge graph
    # -----------------------------------------------------------------------
    graph = build_graph(nodes, relationships)
    logger.info(
        f"Graph built — {graph.number_of_nodes()} node(s), "
        f"{graph.number_of_edges()} edge(s)"
    )

    # -----------------------------------------------------------------------
    # Stage 8: Format and return
    # -----------------------------------------------------------------------
    output = build_output(nodes, relationships, graph, len(processed_docs))

    if output_path:
        to_json(output, output_path)
        logger.info(f"Inventory written to: {output_path}")

    return output


def _empty_output(total_docs: int) -> InventoryOutput:
    import networkx as nx
    return InventoryOutput(
        systems=[],
        relationships=[],
        graph_stats=GraphStats(total_nodes=0, total_edges=0),
        total_documents_processed=total_docs,
        total_systems_found=0,
        systems_flagged_for_review=0,
    )
