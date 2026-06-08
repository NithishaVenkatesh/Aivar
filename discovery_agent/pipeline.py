from __future__ import annotations
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional

from .config import generate_run_id
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

# Maximum parallel workers for chunk extraction.
# Groq rate-limits per key; 4 workers balance throughput against key exhaustion.
_MAX_EXTRACTION_WORKERS = 4

# If this fraction of chunks fail LLM extraction, emit a high-severity warning.
_HIGH_ERROR_RATE_THRESHOLD = 0.8


def run(
    document_paths: List[str],
    output_path: Optional[str] = None,
    run_id: Optional[str] = None,
) -> InventoryOutput:
    """
    Full discovery pipeline.

    Args:
        document_paths: list of file paths to process.
        output_path:    optional path to write inventory JSON.
        run_id:         optional correlation ID; auto-generated if not provided.

    Returns:
        InventoryOutput with systems, relationships, graph stats, and diagnostics.
    """
    if run_id is None:
        run_id = generate_run_id()

    stage_timings: Dict[str, float] = {}
    extraction_errors = 0
    failed_chunk_ids: List[str] = []

    logger.info(f"[{run_id}] Discovery pipeline starting — {len(document_paths)} file(s)")

    # -----------------------------------------------------------------------
    # Stage 1: Ingest
    # -----------------------------------------------------------------------
    t0 = time.perf_counter()
    all_chunks = []
    processed_docs: List[str] = []

    for path in document_paths:
        doc_type = detect_type(path)

        if doc_type == DocType.UNSUPPORTED:
            logger.warning(f"[{run_id}] Unsupported file type — skipping: {path}")
            continue

        logger.info(f"[{run_id}] Ingesting [{doc_type.value}] {Path(path).name}")

        try:
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
        except Exception as exc:
            logger.error(
                f"[{run_id}] Failed to parse {Path(path).name}: {exc}"
            )
            continue

        if chunks:
            processed_docs.append(Path(path).name)
            all_chunks.extend(chunks)
            logger.info(f"[{run_id}]   → {len(chunks)} chunk(s)")
        else:
            logger.warning(
                f"[{run_id}]   → No content extracted from {Path(path).name}"
            )

    stage_timings["ingest"] = round(time.perf_counter() - t0, 3)
    logger.info(
        f"[{run_id}] Chunks before size check: {len(all_chunks)} "
        f"[t={stage_timings['ingest']:.2f}s]"
    )

    # -----------------------------------------------------------------------
    # Stage 2: Enforce chunk size limits
    # -----------------------------------------------------------------------
    t0 = time.perf_counter()
    all_chunks = enforce_size_limit(all_chunks)
    stage_timings["size_enforcement"] = round(time.perf_counter() - t0, 3)
    logger.info(f"[{run_id}] Chunks after size enforcement: {len(all_chunks)}")

    if not all_chunks:
        logger.warning(f"[{run_id}] No content to process — returning empty inventory")
        return _empty_output(len(processed_docs), run_id, stage_timings)

    total_chunks = len(all_chunks)

    # -----------------------------------------------------------------------
    # Stage 3: Pass 1 — system extraction (parallel)
    # -----------------------------------------------------------------------
    t0 = time.perf_counter()
    all_mentions = []
    workers = min(_MAX_EXTRACTION_WORKERS, total_chunks)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_chunk = {
            pool.submit(extract_systems, chunk): chunk
            for chunk in all_chunks
        }
        for future in as_completed(future_to_chunk):
            chunk = future_to_chunk[future]
            try:
                mentions = future.result()
                if mentions:
                    logger.info(
                        f"[{run_id}]   Chunk {chunk.chunk_id}: {len(mentions)} system(s)"
                    )
                all_mentions.extend(mentions)
            except Exception as exc:
                # extract_systems is defensive and shouldn't raise;
                # this catches any unexpected crash from a worker thread.
                logger.error(
                    f"[{run_id}]   Chunk {chunk.chunk_id} worker crashed: {exc}"
                )
                failed_chunk_ids.append(chunk.chunk_id)
                extraction_errors += 1

    stage_timings["extraction"] = round(time.perf_counter() - t0, 3)
    logger.info(
        f"[{run_id}] Raw mentions: {len(all_mentions)} from {total_chunks} chunks "
        f"[t={stage_timings['extraction']:.2f}s]"
    )

    # Error rate gate — flag potential LLM outage
    if extraction_errors > 0:
        rate = extraction_errors / total_chunks
        if rate >= _HIGH_ERROR_RATE_THRESHOLD:
            logger.error(
                f"[{run_id}] HIGH EXTRACTION FAILURE RATE: "
                f"{extraction_errors}/{total_chunks} workers crashed ({rate*100:.0f}%). "
                "Check Groq API keys and connectivity."
            )

    if not all_mentions:
        logger.warning(f"[{run_id}] No systems found in any document")
        return _empty_output(
            len(processed_docs), run_id, stage_timings,
            extraction_errors, failed_chunk_ids, total_chunks,
        )

    # -----------------------------------------------------------------------
    # Stage 4: Resolve duplicates → canonical nodes
    # -----------------------------------------------------------------------
    t0 = time.perf_counter()
    nodes = resolve(all_mentions)
    stage_timings["deduplication"] = round(time.perf_counter() - t0, 3)
    logger.info(f"[{run_id}] Unique systems after deduplication: {len(nodes)}")

    # -----------------------------------------------------------------------
    # Stage 5: Score confidence
    # -----------------------------------------------------------------------
    t0 = time.perf_counter()
    nodes = score(nodes)
    stage_timings["confidence_scoring"] = round(time.perf_counter() - t0, 3)
    flagged = sum(1 for n in nodes if n.needs_human_review)
    logger.info(f"[{run_id}] Systems flagged for human review: {flagged}")

    # -----------------------------------------------------------------------
    # Stage 6: Pass 2 — relationship extraction
    # -----------------------------------------------------------------------
    t0 = time.perf_counter()
    relationships = extract_relationships(all_chunks, nodes)
    stage_timings["relationship_extraction"] = round(time.perf_counter() - t0, 3)
    logger.info(
        f"[{run_id}] Relationships found: {len(relationships)} "
        f"[t={stage_timings['relationship_extraction']:.2f}s]"
    )

    # -----------------------------------------------------------------------
    # Stage 7: Build knowledge graph
    # -----------------------------------------------------------------------
    t0 = time.perf_counter()
    graph = build_graph(nodes, relationships)
    stage_timings["graph_build"] = round(time.perf_counter() - t0, 3)
    logger.info(
        f"[{run_id}] Graph built — {graph.number_of_nodes()} node(s), "
        f"{graph.number_of_edges()} edge(s)"
    )

    # -----------------------------------------------------------------------
    # Stage 8: Format and return
    # -----------------------------------------------------------------------
    output = build_output(nodes, relationships, graph, len(processed_docs))
    output = output.model_copy(update={
        "run_id": run_id,
        "stage_timings": stage_timings,
        "extraction_errors": extraction_errors,
        "failed_chunk_ids": failed_chunk_ids,
        "total_chunks_processed": total_chunks,
    })

    if output_path:
        to_json(output, output_path)
        logger.info(f"[{run_id}] Inventory written to: {output_path}")

    total_time = sum(stage_timings.values())
    logger.info(f"[{run_id}] Pipeline complete — total time: {total_time:.2f}s")

    return output


def _empty_output(
    total_docs: int,
    run_id: str = "",
    stage_timings: Optional[Dict[str, float]] = None,
    extraction_errors: int = 0,
    failed_chunk_ids: Optional[List[str]] = None,
    total_chunks: int = 0,
) -> InventoryOutput:
    return InventoryOutput(
        systems=[],
        relationships=[],
        graph_stats=GraphStats(total_nodes=0, total_edges=0),
        total_documents_processed=total_docs,
        total_systems_found=0,
        systems_flagged_for_review=0,
        run_id=run_id,
        stage_timings=stage_timings or {},
        extraction_errors=extraction_errors,
        failed_chunk_ids=failed_chunk_ids or [],
        total_chunks_processed=total_chunks,
    )
