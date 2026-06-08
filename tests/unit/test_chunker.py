"""Unit tests for discovery_agent.ingestion.chunker."""
from __future__ import annotations

import pytest

from discovery_agent.ingestion.chunker import MAX_WORDS, enforce_size_limit
from tests.helpers import make_chunk


# ---------------------------------------------------------------------------
# Under-limit chunks — no splitting
# ---------------------------------------------------------------------------

class TestNoSplit:
    def test_small_chunk_passes_through_unchanged(self):
        chunk = make_chunk(text="Hello world. " * 10)
        result = enforce_size_limit([chunk])
        assert len(result) == 1
        assert result[0].chunk_id == chunk.chunk_id

    def test_empty_list_returns_empty(self):
        assert enforce_size_limit([]) == []

    def test_exactly_max_words_not_split(self):
        text = " ".join(["word"] * MAX_WORDS)
        chunk = make_chunk(text=text)
        result = enforce_size_limit([chunk])
        assert len(result) == 1

    def test_source_document_preserved(self):
        chunk = make_chunk(text="Short text.", source_document="important.pdf")
        result = enforce_size_limit([chunk])
        assert result[0].source_document == "important.pdf"


# ---------------------------------------------------------------------------
# Over-limit chunks — should split
# ---------------------------------------------------------------------------

class TestSplit:
    def test_oversized_chunk_is_split(self):
        para = " ".join(["word"] * 1600)
        text = f"{para}\n\n{para}\n\n{para}"
        chunk = make_chunk(text=text)
        result = enforce_size_limit([chunk])
        assert len(result) > 1

    def test_sub_chunks_preserve_source_document(self):
        para = " ".join(["word"] * 1600)
        text = f"{para}\n\n{para}\n\n{para}"
        chunk = make_chunk(text=text, source_document="big_doc.pdf")
        result = enforce_size_limit([chunk])
        for sub in result:
            assert sub.source_document == "big_doc.pdf"

    def test_sub_chunk_ids_are_unique(self):
        para = " ".join(["word"] * 1600)
        text = f"{para}\n\n{para}\n\n{para}"
        chunk = make_chunk(text=text, chunk_id="base")
        result = enforce_size_limit([chunk])
        ids = [c.chunk_id for c in result]
        assert len(ids) == len(set(ids))

    def test_sub_chunks_contain_original_text(self):
        para_a = " ".join(["alpha"] * 1600)
        para_b = " ".join(["beta"] * 1600)
        para_c = " ".join(["gamma"] * 1600)
        text = f"{para_a}\n\n{para_b}\n\n{para_c}"
        chunk = make_chunk(text=text)
        result = enforce_size_limit([chunk])
        combined = " ".join(sub.text for sub in result)
        assert "alpha" in combined
        assert "beta" in combined
        assert "gamma" in combined

    def test_mixed_batch_splits_only_oversized(self):
        small = make_chunk(text="Short text.", chunk_id="small")
        para = " ".join(["word"] * 1600)
        big = make_chunk(
            text=f"{para}\n\n{para}\n\n{para}", chunk_id="big"
        )
        result = enforce_size_limit([small, big])
        small_results = [c for c in result if c.chunk_id == "small"]
        big_results = [c for c in result if c.chunk_id.startswith("big")]
        assert len(small_results) == 1
        assert len(big_results) > 1
