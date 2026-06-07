from __future__ import annotations
from enum import Enum
from pathlib import Path


class DocType(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    PPTX = "pptx"
    MARKDOWN = "markdown"
    TEXT = "text"
    SPREADSHEET = "spreadsheet"
    IMAGE = "image"
    UNSUPPORTED = "unsupported"


_EXTENSION_MAP: dict[str, DocType] = {
    ".pdf":      DocType.PDF,
    ".docx":     DocType.DOCX,
    ".doc":      DocType.DOCX,
    ".pptx":     DocType.PPTX,
    ".ppt":      DocType.PPTX,
    ".md":       DocType.MARKDOWN,
    ".markdown": DocType.MARKDOWN,
    ".txt":      DocType.TEXT,
    ".xlsx":     DocType.SPREADSHEET,
    ".xls":      DocType.SPREADSHEET,
    ".csv":      DocType.SPREADSHEET,
    ".png":      DocType.IMAGE,
    ".jpg":      DocType.IMAGE,
    ".jpeg":     DocType.IMAGE,
    ".webp":     DocType.IMAGE,
}


def detect_type(path: str) -> DocType:
    ext = Path(path).suffix.lower()
    return _EXTENSION_MAP.get(ext, DocType.UNSUPPORTED)
