from __future__ import annotations
import logging
import re
from pathlib import Path
from typing import List

from ..models import Chunk

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Docling-based parser  (PDF / DOCX / PPTX)
# ---------------------------------------------------------------------------

def parse_document(path: str) -> List[Chunk]:
    """Parse PDF, DOCX, or PPTX using Docling. Returns structure-aware chunks."""
    try:
        from docling.document_converter import DocumentConverter
        converter = DocumentConverter()
        result = converter.convert(path)
        md_text = result.document.export_to_markdown()
        return _split_into_chunks(md_text, Path(path).name, Path(path).stem)
    except Exception as exc:
        logger.error(f"Docling failed on {path}: {exc}")
        return []


# ---------------------------------------------------------------------------
# Plain-text / Markdown parser
# ---------------------------------------------------------------------------

def parse_text(path: str) -> List[Chunk]:
    """Read plain text or Markdown files."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
        return _split_into_chunks(text, Path(path).name, Path(path).stem)
    except Exception as exc:
        logger.error(f"Failed to read {path}: {exc}")
        return []


# ---------------------------------------------------------------------------
# Spreadsheet parser  (XLSX / XLS / CSV)
# ---------------------------------------------------------------------------

def parse_spreadsheet(path: str) -> List[Chunk]:
    """Convert spreadsheet rows into readable sentences for extraction."""
    try:
        import pandas as pd

        ext = Path(path).suffix.lower()
        df = pd.read_csv(path) if ext == ".csv" else pd.read_excel(path)

        lines: List[str] = []
        for _, row in df.iterrows():
            parts = [
                f"{col}: {val}"
                for col, val in row.items()
                if val is not None and str(val).strip() not in ("", "nan", "NaN")
            ]
            if parts:
                lines.append(". ".join(parts) + ".")

        text = "\n".join(lines)
        if not text.strip():
            logger.warning(f"Spreadsheet {path} produced no usable text.")
            return []

        return [Chunk(
            chunk_id=f"{Path(path).stem}_spreadsheet",
            source_document=Path(path).name,
            text=text,
            chunk_type="table",
        )]
    except Exception as exc:
        logger.error(f"Failed to parse spreadsheet {path}: {exc}")
        return []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _split_into_chunks(text: str, source_doc: str, stem: str) -> List[Chunk]:
    """Split text by markdown headings and tables into structure-aware chunks."""
    sections = _segment(text)
    chunks: List[Chunk] = []
    for i, (chunk_type, content) in enumerate(sections):
        if content.strip():
            chunks.append(Chunk(
                chunk_id=f"{stem}_{i}",
                source_document=source_doc,
                text=content.strip(),
                chunk_type=chunk_type,
            ))
    return chunks


def _segment(text: str) -> List[tuple[str, str]]:
    """Segment text into (type, content) pairs by headings and tables."""
    lines = text.splitlines()
    sections: List[tuple[str, str]] = []
    current_type = "paragraph"
    current_lines: List[str] = []

    def flush():
        if current_lines:
            sections.append((current_type, "\n".join(current_lines)))

    for line in lines:
        if re.match(r"^#{1,3}\s", line):
            flush()
            current_lines = [line]
            current_type = "section"
        elif line.strip().startswith("|") and line.strip().endswith("|"):
            if current_type != "table":
                flush()
                current_lines = []
                current_type = "table"
            current_lines.append(line)
        else:
            if current_type == "table":
                flush()
                current_lines = []
                current_type = "paragraph"
            current_lines.append(line)

    flush()
    return sections
