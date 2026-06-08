"""Unit tests for discovery_agent.extraction.confidence."""
from __future__ import annotations

import pytest

from discovery_agent.extraction.confidence import (
    HIGH_CONFIDENCE,
    REVIEW_THRESHOLD,
    score,
)
from tests.helpers import make_node


# ---------------------------------------------------------------------------
# Tier classification — explicit vs inferred
# ---------------------------------------------------------------------------

class TestExplicitTier:
    def test_multi_mention_is_explicit_high_confidence(self):
        node = make_node(
            mention_count=3,
            evidence=["We use Salesforce for pipeline management."],
            source_documents=["doc.txt"],
        )
        results = score([node])
        assert results[0].confidence >= HIGH_CONFIDENCE

    def test_active_use_language_triggers_explicit(self):
        node = make_node(
            mention_count=1,
            evidence=["We deploy Salesforce across all regions."],
            source_documents=["doc.txt"],
        )
        results = score([node])
        assert results[0].confidence >= HIGH_CONFIDENCE

    def test_structured_source_triggers_explicit(self):
        node = make_node(
            mention_count=1,
            evidence=["Salesforce is listed."],
            source_documents=["inventory.xlsx"],
        )
        results = score([node])
        assert results[0].confidence >= HIGH_CONFIDENCE


class TestInferredTier:
    def test_bare_single_mention_below_review_threshold(self):
        node = make_node(
            name="SomeSystem",
            mention_count=1,
            evidence=["SomeSystem is mentioned."],
            source_documents=["doc.txt"],
            key_entities=[],
            business_processes=[],
            auth_method=None,
        )
        results = score([node])
        assert results[0].confidence < REVIEW_THRESHOLD

    def test_hedged_evidence_penalised(self):
        hedged_node = make_node(
            mention_count=2,
            evidence=["I think Salesforce is used."],
        )
        normal_node = make_node(
            name="Workday",
            mention_count=2,
            evidence=["We use Workday for HR."],
        )
        results = score([hedged_node, normal_node])
        hedged = next(r for r in results if r.name == hedged_node.name)
        normal = next(r for r in results if r.name == "Workday")
        assert hedged.confidence < normal.confidence

    def test_hedged_multi_mention_still_below_explicit(self):
        node = make_node(
            mention_count=3,
            evidence=["Maybe we use Salesforce?"],
        )
        results = score([node])
        assert results[0].confidence < HIGH_CONFIDENCE


# ---------------------------------------------------------------------------
# Review flag
# ---------------------------------------------------------------------------

class TestReviewFlag:
    def test_low_confidence_triggers_review_flag(self):
        node = make_node(
            mention_count=1,
            evidence=["SomeSystem."],
            source_documents=["doc.txt"],
            key_entities=[],
            business_processes=[],
            auth_method=None,
        )
        results = score([node])
        assert results[0].needs_human_review is True
        assert results[0].review_note is not None

    def test_high_confidence_no_review_flag(self):
        node = make_node(
            mention_count=3,
            evidence=["We use Salesforce for pipeline management."],
            auth_method="OAuth2",
            key_entities=["Contacts"],
            business_processes=["Sales pipeline"],
            criticality="high",
        )
        results = score([node])
        assert results[0].needs_human_review is False

    def test_score_clamps_to_100(self):
        node = make_node(
            mention_count=10,
            auth_method="OAuth2",
            key_entities=["Contacts", "Accounts"],
            business_processes=["CRM", "Forecasting"],
            criticality="high",
            evidence=["We use Salesforce across all regions for lead management."],
        )
        results = score([node])
        assert results[0].confidence <= 100.0
