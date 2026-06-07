from __future__ import annotations
from typing import List, Optional

import networkx as nx

from ..models import GraphStats, InventoryOutput, SystemNode, SystemRelationship


def build_output(
    nodes: List[SystemNode],
    relationships: List[SystemRelationship],
    graph: nx.DiGraph,
    total_documents: int,
) -> InventoryOutput:
    return InventoryOutput(
        systems=nodes,
        relationships=relationships,
        graph_stats=GraphStats(
            total_nodes=graph.number_of_nodes(),
            total_edges=graph.number_of_edges(),
        ),
        total_documents_processed=total_documents,
        total_systems_found=len(nodes),
        systems_flagged_for_review=sum(1 for n in nodes if n.needs_human_review),
    )


def to_json(output: InventoryOutput, path: Optional[str] = None) -> str:
    """Serialize InventoryOutput to JSON string and optionally write to file."""
    json_str = output.model_dump_json(indent=2)
    if path:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(json_str)
    return json_str
