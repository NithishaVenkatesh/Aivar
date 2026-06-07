from __future__ import annotations
import logging
import re
from collections import Counter
from typing import List

from rapidfuzz import fuzz

from ..models import SystemMention, SystemNode

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD = 88  # token_sort_ratio minimum to consider same system

# ---------------------------------------------------------------------------
# Canonicalization maps — applied BEFORE fuzzy grouping so counts are correct
# ---------------------------------------------------------------------------

# Maps any variant name (lowercased) to a single canonical display name.
# Keys are exact lowercase matches; the value is what gets stored.
PRODUCT_ALIASES: dict[str, str] = {
    "kafka":                  "Apache Kafka",
    "apache kafka":           "Apache Kafka",
    "confluent kafka":        "Apache Kafka",
    "confluent":              "Apache Kafka",
    "mongo":                  "MongoDB",
    "mongodb atlas":          "MongoDB",
    "postgres":               "PostgreSQL",
    "postgresql":             "PostgreSQL",
    "pg":                     "PostgreSQL",
    "elastic":                "Elasticsearch",
    "elasticsearch":          "Elasticsearch",
    "elastic search":         "Elasticsearch",
    "k8s":                    "Kubernetes",
    "kubernetes":             "Kubernetes",
    "gcs":                    "Google Cloud Storage",
    "google cloud storage":   "Google Cloud Storage",
    "s3":                     "Amazon S3",
    "amazon s3":              "Amazon S3",
    "aws s3":                 "Amazon S3",
    "bq":                     "Google BigQuery",
    "bigquery":               "Google BigQuery",
    "google bigquery":        "Google BigQuery",
    "sfdc":                   "Salesforce",
    "salesforce crm":         "Salesforce",
    "gcp":                    "Google Cloud Platform",
    "google cloud":           "Google Cloud Platform",
    "aws":                    "Amazon Web Services",
    "amazon web services":    "Amazon Web Services",
    "azure":                  "Microsoft Azure",
    "microsoft azure":        "Microsoft Azure",
    "ad":                     "Active Directory",
    "active directory":       "Active Directory",
    "azure ad":               "Azure Active Directory",
    "aad":                    "Azure Active Directory",
}

# Normalise LLM-invented category strings to a controlled vocabulary.
CATEGORY_MAP: dict[str, str] = {
    "streaming platform":      "Message Broker",
    "event streaming":         "Message Broker",
    "event streaming platform":"Message Broker",
    "message queue":           "Message Broker",
    "messaging platform":      "Communication",
    "messaging":               "Communication",
    "cloud storage":           "Object Storage",
    "object store":            "Object Storage",
    "search engine":           "Search",
    "search platform":         "Search",
    "container orchestration": "Container Platform",
    "orchestration":           "Container Platform",
    "relational database":     "Database",
    "nosql database":          "Database",
    "document database":       "Database",
    "rdbms":                   "Database",
    "sql database":            "Database",
}

# Vendor prefixes stripped when comparing names (never stripped from display name)
_VENDOR_PREFIXES = re.compile(
    r"^(apache|confluent|google|amazon|aws|microsoft|azure|hashicorp|elastic)\s+",
    re.IGNORECASE,
)

# Words that carry no identity signal and are dropped before token-subset comparison.
# Company qualifiers ("associates", "inc") and generic type words ("system", "platform").
_GENERIC_TOKENS: frozenset[str] = frozenset({
    "inc", "incorporated", "corp", "corporation", "ltd", "limited", "llc",
    "associates", "holdings",
    "system", "systems", "platform", "platforms",
    "service", "services", "solution", "solutions",
    "application", "applications", "tool", "tools",
    "the", "and", "of", "a",
})


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve(mentions: List[SystemMention]) -> List[SystemNode]:
    """Deduplicate and merge mentions into canonical SystemNodes."""
    if not mentions:
        return []
    # Canonicalize names and categories before any counting or grouping
    mentions = [_canonicalize_mention(m) for m in mentions]
    groups = _group_by_similarity(mentions)
    nodes = [_merge_group(group) for group in groups]
    # Second pass: catch identical canonical names that landed in different groups
    nodes = _merge_same_canonical_name(nodes)
    return nodes


# ---------------------------------------------------------------------------
# Canonicalization
# ---------------------------------------------------------------------------

def _canonicalize_mention(m: SystemMention) -> SystemMention:
    canonical_name = PRODUCT_ALIASES.get(m.name.lower(), m.name)
    canonical_cat = CATEGORY_MAP.get(m.category.lower(), m.category)
    if canonical_name != m.name or canonical_cat != m.category:
        return m.model_copy(update={"name": canonical_name, "category": canonical_cat})
    return m


def _comparison_key(name: str) -> str:
    """Strip vendor prefix for fuzzy comparison only — display name is unchanged."""
    return _VENDOR_PREFIXES.sub("", name).lower().strip()


# ---------------------------------------------------------------------------
# Grouping
# ---------------------------------------------------------------------------

def _group_by_similarity(mentions: List[SystemMention]) -> List[List[SystemMention]]:
    groups: List[List[SystemMention]] = []
    assigned: set[int] = set()

    for i, a in enumerate(mentions):
        if i in assigned:
            continue
        group = [a]
        assigned.add(i)
        for j, b in enumerate(mentions):
            if j in assigned:
                continue
            if _should_merge(a, b):
                group.append(b)
                assigned.add(j)
        groups.append(group)

    return groups


def _token_set(name: str) -> frozenset[str]:
    """Lowercase tokens with generic words removed."""
    return frozenset(t for t in name.lower().split() if t not in _GENERIC_TOKENS)


def _should_merge(a: SystemMention, b: SystemMention) -> bool:
    # 1. Token-subset check — deterministic, no threshold.
    #    "Manhattan Associates WMS" → {manhattan, wms}
    #    "Manhattan WMS"            → {manhattan, wms}
    #    One set ⊆ the other and they share a distinctive token → merge.
    ta = _token_set(a.name)
    tb = _token_set(b.name)
    if ta and tb and (ta <= tb or tb <= ta):
        return True

    # 2. Fuzzy fallback — handles typos and spacing variants.
    key_a = _comparison_key(a.name)
    key_b = _comparison_key(b.name)
    same_category = a.category.lower() == b.category.lower()
    return fuzz.token_sort_ratio(key_a, key_b) >= SIMILARITY_THRESHOLD and same_category


# ---------------------------------------------------------------------------
# Merging
# ---------------------------------------------------------------------------

def _merge_group(group: List[SystemMention]) -> SystemNode:
    canonical = _pick_canonical_name(group)

    all_evidence = list({m.evidence for m in group})
    all_sources = list({m.source_document for m in group})
    all_entities = list({e for m in group for e in m.key_entities})
    all_processes = list({p for m in group for p in m.business_processes})

    auth_method = next((m.auth_method for m in group if m.auth_method), None)
    criticality = next(
        (m.criticality for m in group if m.criticality and m.criticality != "unknown"),
        "unknown",
    )
    category = group[0].category

    return SystemNode(
        name=canonical,
        canonical_name=canonical,
        category=category,
        auth_method=auth_method,
        key_entities=all_entities,
        business_processes=all_processes,
        criticality=criticality,
        confidence=0.0,
        source_documents=all_sources,
        evidence=all_evidence,
        mention_count=len(group),
    )


def _pick_canonical_name(group: List[SystemMention]) -> str:
    """Most-mentioned name wins; ties resolved by longer (more specific) name."""
    counts = Counter(m.name for m in group)
    return max(counts.keys(), key=lambda n: (counts[n], len(n)))


def _merge_same_canonical_name(nodes: List[SystemNode]) -> List[SystemNode]:
    """
    Merge nodes that share a canonical_name after first-pass grouping.
    Handles identical system names that landed in different category buckets.
    """
    seen: dict[str, SystemNode] = {}
    for node in nodes:
        key = node.canonical_name.lower()
        if key not in seen:
            seen[key] = node
        else:
            existing = seen[key]
            winner = existing if existing.mention_count >= node.mention_count else node
            loser = node if winner is existing else existing
            merged = SystemNode(
                name=winner.canonical_name,
                canonical_name=winner.canonical_name,
                category=winner.category,
                auth_method=winner.auth_method or loser.auth_method,
                key_entities=list(set(winner.key_entities) | set(loser.key_entities)),
                business_processes=list(set(winner.business_processes) | set(loser.business_processes)),
                criticality=winner.criticality if winner.criticality != "unknown" else loser.criticality,
                confidence=0.0,
                source_documents=list(set(winner.source_documents) | set(loser.source_documents)),
                evidence=list(set(winner.evidence) | set(loser.evidence)),
                mention_count=winner.mention_count + loser.mention_count,
            )
            seen[key] = merged
            logger.info(
                f"Merged duplicate '{node.canonical_name}' "
                f"({existing.category} + {node.category}) → {merged.category}"
            )
    return list(seen.values())
