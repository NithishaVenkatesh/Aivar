from __future__ import annotations
from typing import List
from ..models import Chunk

MAX_WORDS = 3000


def enforce_size_limit(chunks: List[Chunk]) -> List[Chunk]:
    """Split any chunk exceeding MAX_WORDS at paragraph boundaries."""
    result: List[Chunk] = []
    for chunk in chunks:
        if _word_count(chunk.text) <= MAX_WORDS:
            result.append(chunk)
        else:
            result.extend(_split_chunk(chunk))
    return result


def _word_count(text: str) -> int:
    return len(text.split())


def _split_chunk(chunk: Chunk) -> List[Chunk]:
    """Split oversized chunk at paragraph boundaries."""
    paragraphs = chunk.text.split("\n\n")
    sub_chunks: List[Chunk] = []
    current_parts: List[str] = []
    current_words = 0
    sub_index = 0

    for para in paragraphs:
        words = _word_count(para)
        if current_words + words > MAX_WORDS and current_parts:
            sub_chunks.append(Chunk(
                chunk_id=f"{chunk.chunk_id}_sub{sub_index}",
                source_document=chunk.source_document,
                text="\n\n".join(current_parts),
                chunk_type=chunk.chunk_type,
            ))
            sub_index += 1
            current_parts = [para]
            current_words = words
        else:
            current_parts.append(para)
            current_words += words

    if current_parts:
        sub_chunks.append(Chunk(
            chunk_id=f"{chunk.chunk_id}_sub{sub_index}",
            source_document=chunk.source_document,
            text="\n\n".join(current_parts),
            chunk_type=chunk.chunk_type,
        ))

    return sub_chunks
