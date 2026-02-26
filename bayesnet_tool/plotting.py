"""Matplotlib-based plotting helpers for network visualization and query results."""

from typing import Any
import matplotlib.pyplot as plt


# draw_network, plot_two_factors, plot_1D_query, plot_one_factor stubs

def draw_network(edges: Any, figsize=(8,6), margin=0.2) -> plt.Figure:
    """Return a figure showing a DAG given by edges."""
    import networkx as nx
    from matplotlib.patches import Ellipse
    import numpy as np

    G = nx.DiGraph()
    G.add_edges_from(edges)

    if not nx.is_directed_acyclic_graph(G):
        raise ValueError("Bayesian Network must be a DAG")

    avg_label_len = sum(len(n) for n in G.nodes) / len(G.nodes)
    nodesep = 0.01 * avg_label_len
    ranksep = 1.2 + 0.03 * avg_label_len

    pos = nx.nx_agraph.graphviz_layout(
        G,
        prog="dot",
        args=f"-Grankdir=TB -Granksep={ranksep:.2f} -Gnodesep={nodesep:.2f}"
    )
    try:
        from .utils import add_vertical_jitter
        pos = add_vertical_jitter(pos, jitter=20)
    except ImportError:
        pass

    fig, ax = plt.subplots(figsize=figsize)

    nx.draw_networkx_edges(
        G,
        pos,
        ax=ax,
        arrows=True,
        arrowstyle='-|>',
        arrowsize=18,
        width=1.4,
        edge_color='black',
        connectionstyle='arc3,rad=0.0'
    )

    text_artists = {}
    for node, (x, y) in pos.items():
        t = ax.text(
            x, y,
            str(node),
            ha="center",
            va="center",
            fontsize=10,
            alpha=0.0,
            zorder=3
        )
        text_artists[node] = t

    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()

    for node, (x, y) in pos.items():
        text = text_artists[node]
        bbox = text.get_window_extent(renderer=renderer)
        inv = ax.transData.inverted()
        (x0, y0) = inv.transform((bbox.x0, bbox.y0))
        (x1, y1) = inv.transform((bbox.x1, bbox.y1))

        width  = (x1 - x0) * 1.25
        height = (y1 - y0) * 1.6

        ellipse = Ellipse(
            (x, y),
            width=width,
            height=height,
            facecolor="white",
            edgecolor="black",
            linewidth=1.5,
            zorder=2
        )
        ax.add_patch(ellipse)
        text.set_alpha(1.0)

    ax.set_axis_off()
    xs, ys = zip(*pos.values())
    xs, ys = np.array(xs), np.array(ys)
    dx = margin * (xs.max() - xs.min())
    dy = margin * (ys.max() - ys.min())
    ax.set_xlim(xs.min() - dx, xs.max() + dx)
    ax.set_ylim(ys.min() - dy, ys.max() + dy)
    plt.tight_layout()
    return fig


def plot_two_factors(phi: Any, title: str, x_state: str, y_state: str) -> plt.Figure:
    fig = plt.figure(figsize=(8, 6), dpi=200)
    nodes = list(phi.state_names.keys())

    if ':' in phi.state_names[nodes[0]][0]:
        x_state_names =  [state.split(':')[1] for state in phi.state_names[nodes[0]]]
    else:
        x_state_names = [state for state in phi.state_names[nodes[0]]]

    if ':' in phi.state_names[nodes[1]][0]:
        y_state_names =  [state.split(':')[1] for state in phi.state_names[nodes[1]]]
    else:
        y_state_names = [state for state in phi.state_names[nodes[1]]]

    ax_main = fig.gca()
    c = ax_main.pcolormesh(phi.values.T, cmap='Blues')

    ax_main.set_xticks(np.arange(len(x_state_names)) + 0.5)
    ax_main.set_xticklabels(x_state_names, rotation=90)

    ax_main.set_yticks(np.arange(len(y_state_names)) + 0.5)
    ax_main.set_yticklabels(y_state_names)

    ax_main.set_xlabel(x_state)
    ax_main.set_ylabel(y_state)
    fig.colorbar(c, ax=ax_main, label='probability')
    ax_main.set_title(title, wrap=True)
    plt.tight_layout()
    return fig


def plot_1D_query(phi: Any, title: str = None, xlabel: str = None) -> plt.Figure:
    node = list(phi.state_names.keys())[0]
    state_labels = [
        s.split(":")[1] if ":" in s else s
        for s in phi.state_names[node]
    ]
    values = phi.values
    fig, ax = plt.subplots()
    ax.bar(range(len(values)), values)
    ax.set_xticks(range(len(values)))
    ax.set_xticklabels(state_labels, rotation=45, ha="right")
    ax.set_xlabel(xlabel if xlabel else node)
    ax.set_ylabel("Probability")
    ax.set_title(title, wrap=True)
    plt.tight_layout()
    return fig


def plot_one_factor(phi: Any, title: str, state: str) -> plt.Figure:
    node = list(phi.state_names.keys())[0]
    state_names = [s.split(':')[1] for s in phi.state_names[node]]
    fig, ax = plt.subplots()
    ax.bar(phi.state_names[node], phi.values,)
    ax.set_xlabel(state)
    ax.set_xticklabels(state_names, rotation=90)
    ax.set_title(title)
    ax.set_ylabel('Probability')
    plt.tight_layout()
    return fig
