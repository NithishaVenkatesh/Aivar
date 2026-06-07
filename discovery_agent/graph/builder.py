from __future__ import annotations
from typing import List

import networkx as nx

from ..models import SystemNode, SystemRelationship


def build_graph(
    nodes: List[SystemNode],
    relationships: List[SystemRelationship],
) -> nx.DiGraph:
    """Build a directed knowledge graph from confirmed nodes and relationships."""
    G = nx.DiGraph()

    for node in nodes:
        G.add_node(
            node.canonical_name,
            category=node.category,
            auth_method=node.auth_method,
            key_entities=node.key_entities,
            business_processes=node.business_processes,
            criticality=node.criticality,
            confidence=node.confidence,
            needs_human_review=node.needs_human_review,
            mention_count=node.mention_count,
            source_documents=node.source_documents,
        )

    for rel in relationships:
        G.add_edge(
            rel.source,
            rel.target,
            relation=rel.relation,
            direction=rel.direction,
            trigger=rel.trigger,
            data_entities=rel.data_entities,
            evidence=rel.evidence,
            confidence=rel.confidence,
            source_document=rel.source_document,
        )

    return G


def graph_to_dict(G: nx.DiGraph) -> dict:
    """Serialize graph to a JSON-serializable dict using node-link format."""
    return nx.node_link_data(G)
