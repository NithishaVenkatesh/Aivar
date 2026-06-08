"""Unit tests for discovery_agent.extraction.resolver."""
from __future__ import annotations

import pytest

from discovery_agent.extraction.resolver import (
    PRODUCT_ALIASES,
    resolve,
)
from tests.helpers import make_mention


# ---------------------------------------------------------------------------
# PRODUCT_ALIASES
# ---------------------------------------------------------------------------

class TestProductAliases:
    def test_sfdc_maps_to_salesforce(self):
        assert PRODUCT_ALIASES["sfdc"] == "Salesforce"

    def test_kafka_variants_map_to_apache_kafka(self):
        assert PRODUCT_ALIASES["kafka"] == "Apache Kafka"
        assert PRODUCT_ALIASES["confluent kafka"] == "Apache Kafka"
        assert PRODUCT_ALIASES["confluent"] == "Apache Kafka"

    def test_pg_maps_to_postgresql(self):
        assert PRODUCT_ALIASES["pg"] == "PostgreSQL"

    def test_bq_maps_to_bigquery(self):
        assert PRODUCT_ALIASES["bq"] == "Google BigQuery"

    def test_k8s_maps_to_kubernetes(self):
        assert PRODUCT_ALIASES["k8s"] == "Kubernetes"


# ---------------------------------------------------------------------------
# Fuzzy grouping — identical system, different spellings
# ---------------------------------------------------------------------------

class TestFuzzyGrouping:
    def test_exact_duplicates_merge(self):
        mentions = [
            make_mention("Salesforce", chunk_id="c1"),
            make_mention("Salesforce", chunk_id="c2"),
        ]
        nodes = resolve(mentions)
        assert len(nodes) == 1
        assert nodes[0].mention_count == 2

    def test_alias_variants_merge(self):
        mentions = [
            make_mention("sfdc", category="CRM"),
            make_mention("Salesforce", category="CRM"),
        ]
        nodes = resolve(mentions)
        assert len(nodes) == 1
        assert nodes[0].canonical_name == "Salesforce"

    def test_kafka_and_apache_kafka_merge(self):
        mentions = [
            make_mention("kafka", category="Message Broker"),
            make_mention("Apache Kafka", category="Message Broker"),
        ]
        nodes = resolve(mentions)
        assert len(nodes) == 1
        assert nodes[0].canonical_name == "Apache Kafka"

    def test_different_systems_do_not_merge(self):
        mentions = [
            make_mention("Salesforce", category="CRM"),
            make_mention("Workday", category="HRIS"),
        ]
        nodes = resolve(mentions)
        assert len(nodes) == 2

    def test_empty_mentions_returns_empty(self):
        assert resolve([]) == []


# ---------------------------------------------------------------------------
# Second-pass dedup (merge_same_canonical_name)
# ---------------------------------------------------------------------------

class TestSecondPassDedup:
    def test_same_canonical_in_different_categories_merges(self):
        mentions = [
            make_mention("PostgreSQL", category="Database", chunk_id="c1"),
            make_mention("postgresql", category="Relational Database", chunk_id="c2"),
        ]
        nodes = resolve(mentions)
        # Both alias to "PostgreSQL" and should collapse to one node
        assert len(nodes) == 1

    def test_merged_node_accumulates_evidence(self):
        mentions = [
            make_mention("Salesforce", evidence="We use Salesforce for leads.", chunk_id="c1"),
            make_mention("Salesforce", evidence="SFDC syncs nightly.", chunk_id="c2"),
        ]
        nodes = resolve(mentions)
        assert len(nodes) == 1
        evidence_set = set(nodes[0].evidence)
        assert any("leads" in e for e in evidence_set)
        assert any("nightly" in e for e in evidence_set)
