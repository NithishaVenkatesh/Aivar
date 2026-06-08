"""Unit tests for extractor guard logic (no LLM calls)."""
from __future__ import annotations

import pytest

from discovery_agent.extraction.extractor import (
    _NON_SYSTEM_PATTERNS,
    _HEDGE_PATTERNS,
    _MIN_NAME_LENGTH,
    has_hedge_markers,
)


# ---------------------------------------------------------------------------
# Guard 0: minimum name length
# ---------------------------------------------------------------------------

class TestMinNameLength:
    def test_min_length_constant_is_three(self):
        assert _MIN_NAME_LENGTH == 3

    def test_two_char_name_would_be_rejected(self):
        assert len("AI".strip()) < _MIN_NAME_LENGTH

    def test_three_char_name_passes(self):
        assert len("SAP".strip()) >= _MIN_NAME_LENGTH

    def test_whitespace_stripped_before_check(self):
        assert len("  AI  ".strip()) < _MIN_NAME_LENGTH


# ---------------------------------------------------------------------------
# Guard 1: hallucination (evidence substring check — logic is in pipeline,
# but we test the pattern that feeds Guard 2)
# ---------------------------------------------------------------------------

class TestNonSystemPatterns:
    def test_room_named_after_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("We have a room named Kafka")

    def test_named_after_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("named after the Snowflake project")

    def test_deprecated_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("The deprecated legacy system")

    def test_decommission_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("will be decommissioned next quarter")

    def test_decommission_bare_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("scheduled for decommission")

    def test_we_used_to_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("We used to rely on Oracle")

    def test_shut_down_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("The cluster was shut down in 2022")

    def test_was_replaced_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("The system was replaced by Snowflake")

    def test_active_use_does_not_match(self):
        assert not _NON_SYSTEM_PATTERNS.search("We use Kafka for real-time streaming")

    def test_conference_room_matches(self):
        assert _NON_SYSTEM_PATTERNS.search("We hold standups in the Kafka conference room")


# ---------------------------------------------------------------------------
# Hedge markers
# ---------------------------------------------------------------------------

class TestHedgeMarkers:
    def test_i_think_is_a_hedge(self):
        assert has_hedge_markers("I think we use Salesforce")

    def test_not_sure_is_a_hedge(self):
        assert has_hedge_markers("I'm not sure if it's Workday")

    def test_might_be_is_a_hedge(self):
        assert has_hedge_markers("It might be SAP")

    def test_probably_is_a_hedge(self):
        assert has_hedge_markers("We probably use Jira")

    def test_question_mark_is_a_hedge(self):
        assert has_hedge_markers("Is this Snowflake?")

    def test_legacy_word_is_a_hedge(self):
        assert has_hedge_markers("The old legacy system still runs")

    def test_plain_active_use_not_a_hedge(self):
        assert not has_hedge_markers("We use Salesforce for lead management")

    def test_nobody_maintains_is_a_hedge(self):
        assert has_hedge_markers("nobody maintains it anymore")
