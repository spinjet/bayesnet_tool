"""Discretisation utilities for continuous variables.

This module currently hosts the uniform discretiser used in the demo.
Additional schemes may be added later.
"""

from typing import Any, Dict, Tuple
import numpy as np
import pandas as pd


class UniformDiscretiser1D:
    def __init__(self, data: np.ndarray, n_levels: int, decimals: int = 2):
        """Create a uniform-width discretiser for one-dimensional data."""
        # placeholder implementation
        pass

    def transform(self, data: np.ndarray) -> np.ndarray:
        """Map raw values to integer bins."""
        raise NotImplementedError

    def transform_map(self, data: np.ndarray) -> np.ndarray:
        """Map raw values to human-readable range labels."""
        raise NotImplementedError

    def map_2_range(self, value: Any) -> Tuple[float, float]:
        """Given a label return the numeric interval it represents."""
        raise NotImplementedError


def build_discrete_df(df: pd.DataFrame, node_config: Dict[str, Any]) -> Tuple[pd.DataFrame, Dict[str, UniformDiscretiser1D]]:
    """Return a discretised dataframe and the used discretisers."""
    raise NotImplementedError
