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
        """Return a dependency structure matrix as a DataFrame."""
        raise NotImplementedError

    @classmethod
    def from_dsm(cls, df: pd.DataFrame) -> "BayesianNetworkStructure":
        """Create an instance by interpreting a lower-triangular DSM."""
        raise NotImplementedError

    def save(self, path: str) -> None:
        """Serialize structure to JSON file."""
        raise NotImplementedError

    @classmethod
    def load(cls, path: str) -> "BayesianNetworkStructure":
        """Load structure from JSON file and validate DAG."""
        raise NotImplementedError

    def validate(self) -> None:
        """Validate that the current edges form a DAG; raise if not."""
        raise NotImplementedError
