"""General-purpose utility functions used across the package."""

from typing import Tuple, Any, Dict, List


def dag_layout(G: Any) -> Dict[Any, Tuple[float, float]]:
    """Return positions for nodes using a simple topological layering."""
    raise NotImplementedError


def add_vertical_jitter(pos: Dict[Any, Tuple[float, float]], jitter: float = 0.15) -> Dict[Any, Tuple[float, float]]:
    """Offset nodes that share exactly the same position."""
    raise NotImplementedError
