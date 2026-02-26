"""General-purpose utility functions used across the package."""

from typing import Tuple, Any, Dict, List


def dag_layout(G: Any) -> Dict[Any, Tuple[float, float]]:
    """Return node positions generated from a topological sort of ``G``.

    Nodes without predecessors are placed at layer 0; successors are placed in
    later layers.  Horizontal coordinate equals layer index, vertical coordinate
    determined by order within the layer.
    """
    layers = {}
    for node in nx.topological_sort(G):
        preds = list(G.predecessors(node))
        if not preds:
            layers[node] = 0
        else:
            layers[node] = 1 + max(layers[p] for p in preds)

    pos = {}
    for layer in sorted(set(layers.values())):
        nodes = [n for n, l in layers.items() if l == layer]
        for i, node in enumerate(nodes):
            pos[node] = (layer, -i)

    return pos


def add_vertical_jitter(pos: Dict[Any, Tuple[float, float]], jitter: float = 0.15) -> Dict[Any, Tuple[float, float]]:
    """Add small vertical offsets to nodes sharing the same y-position.

    ``pos`` is a mapping node-&gt;(x,y).  Nodes with identical y values will be
    spread out by multiples of ``jitter`` in alternating directions.
    """
    from collections import defaultdict

    ranks = defaultdict(list)
    for node, (x, y) in pos.items():
        ranks[y].append(node)

    new_pos = pos.copy()

    for y, nodes in ranks.items():
        if len(nodes) == 1:
            continue
        nodes = sorted(nodes)
        for i, node in enumerate(nodes):
            offset = ((i // 2) + 1) * jitter
            if i % 2 == 0:
                offset *= -1
            x, _ = pos[node]
            new_pos[node] = (x, y + offset)

    return new_pos
