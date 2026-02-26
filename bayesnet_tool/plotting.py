"""Matplotlib-based plotting helpers for network visualization and query results."""

from typing import Any
import matplotlib.pyplot as plt


# draw_network, plot_two_factors, plot_1D_query, plot_one_factor stubs

def draw_network(edges: Any, figsize=(8,6), margin=0.2) -> plt.Figure:
    """Return a figure showing a DAG given by edges."""
    raise NotImplementedError


def plot_two_factors(phi: Any, title: str, x_state: str, y_state: str) -> plt.Figure:
    """Heatmap for joint distribution of two variables."""
    raise NotImplementedError


def plot_1D_query(phi: Any, title: str = None, xlabel: str = None) -> plt.Figure:
    """Bar chart for a single-variable marginal."""
    raise NotImplementedError


def plot_one_factor(phi: Any, title: str, state: str) -> plt.Figure:
    """Bar chart for single factor (one variable CPD)."""
    raise NotImplementedError
