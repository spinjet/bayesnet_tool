"""Module handling Bayesian network structure and DSM.

Classes and functions here will allow building/validating a network structure,
converting between adjacency list and dependency matrix, and saving/loading
structure files.
"""

import networkx as nx
import pandas as pd
from typing import List, Tuple, Dict, Any


class BayesianNetworkStructure:
    """Represent nodes and directed edges of a Bayes net."""

    def __init__(self, nodes: List[str] = None, edges: List[Tuple[str, str]] = None,
                 node_config: Dict[str, Any] = None):
        self.nodes = nodes or []
        self.edges = edges or []
        self.node_config = node_config or {}

    def to_dsm(self) -> pd.DataFrame:
        """Return a dependency structure matrix as a DataFrame.

        Rows correspond to child nodes and columns to parents; a value of 1
        indicates a directed edge parent-&gt;child.  The matrix will contain all
        nodes that are currently in ``self.nodes``.
        """
        df = pd.DataFrame(0, index=self.nodes, columns=self.nodes)
        for parent, child in self.edges:
            if parent in df.columns and child in df.index:
                df.loc[child, parent] = 1
        return df

    @classmethod
    def from_dsm(cls, df: pd.DataFrame) -> "BayesianNetworkStructure":
        """Create an instance by interpreting a dependency structure matrix.

        Any nonzero entry at (child, parent) is interpreted as an edge
        parent-&gt;child.  The result is validated to ensure a DAG.
        """
        nodes = list(df.index)
        edges = []
        for child in nodes:
            for parent in nodes:
                if df.loc[child, parent] == 1:
                    edges.append((parent, child))
        inst = cls(nodes=nodes, edges=edges)
        inst.validate()
        return inst

    def save(self, path: str) -> None:
        """Serialize structure to JSON file."""
        import json

        data = {
            "nodes": list(self.nodes),
            "edges": [list(e) for e in self.edges],
            "node_config": self.node_config,
        }
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    @classmethod
    def load(cls, path: str) -> "BayesianNetworkStructure":
        """Load structure from JSON file and validate DAG."""
        import json

        with open(path, "r") as f:
            data = json.load(f)

        nodes = data.get("nodes", [])
        edges = [tuple(e) for e in data.get("edges", [])]
        node_config = data.get("node_config", {})

        inst = cls(nodes=nodes, edges=edges, node_config=node_config)
        inst.validate()
        return inst

    def validate(self) -> None:
        """Validate that the current edges form a DAG; raise if not."""
        G = nx.DiGraph(self.edges)
        if not nx.is_directed_acyclic_graph(G):
            raise ValueError("Edges do not form a directed acyclic graph")
