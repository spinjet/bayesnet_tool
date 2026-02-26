"""Discretisation utilities for continuous variables.

This module currently hosts the uniform discretiser used in the demo.
Additional schemes may be added later.
"""

from typing import Any, Dict, Tuple
import numpy as np
import pandas as pd


class UniformDiscretiser1D:
    def __init__(self, data: np.ndarray, n_levels: int, decimals: int = 2):
        """Create a uniform-width discretiser for one-dimensional data.

        ``data`` may be any array-like; it will be flattened internally.  The
        generated object can then be used to map new data into the originally
        computed bins.
        """
        self.n_levels = n_levels
        x = data.flatten()

        self.level_width = (x.max() - x.min()) / self.n_levels
        self.split_points = [
            x.min() + self.level_width * (n + 1) for n in range(self.n_levels - 1)
        ]

        self.ranges = [data.min()] + list(self.split_points) + [data.max()]
        self.range_map = {
            i - 1: f"[{i-1:02d}]:({self.ranges[i-1]:.{decimals}f}-{self.ranges[i]:.{decimals}f})"
            for i in range(1, len(self.ranges))
        }

    def transform(self, data: np.ndarray) -> np.ndarray:
        return np.digitize(data, self.split_points)

    def transform_map(self, data: np.ndarray) -> np.ndarray:
        tf_data = self.transform(data)
        map_data = np.vectorize(self.range_map.get)(tf_data)
        return map_data

    def map_2_range(self, value: Any) -> Tuple[float, float]:
        range_idx = list(self.range_map.keys())[list(self.range_map.values()).index(value)]
        return (self.ranges[range_idx], self.ranges[range_idx+1])


def build_discrete_df(df: pd.DataFrame, node_config: Dict[str, Any]) -> Tuple[pd.DataFrame, Dict[str, UniformDiscretiser1D]]:
    """Discretise any continuous nodes according to ``node_config``.

    Returns a new dataframe containing only discrete values as strings and a
    dictionary mapping node names to the instantiated discretisers.
    """
    out = {}
    discretisers: Dict[str, UniformDiscretiser1D] = {}

    for node, cfg in node_config.items():
        if cfg["type"] == "Continuous":
            d = UniformDiscretiser1D(
                df[node].to_numpy(),
                n_levels=cfg["bins"],
                decimals=cfg["precision"],
            )
            discretisers[node] = d
            out[node] = d.transform_map(df[node].to_numpy())
        else:
            out[node] = df[node]

    return pd.DataFrame(out), discretisers
