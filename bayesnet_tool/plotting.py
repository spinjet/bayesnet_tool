"""Matplotlib-based plotting helpers for network visualization and query results."""

from typing import Any
import matplotlib.pyplot as plt
import networkx as nx
from matplotlib.patches import Ellipse, FancyArrowPatch
import numpy as np
from collections import defaultdict


# ── internal helper ──────────────────────────────────────────────────────────

def _line_clips_ellipse(x1, y1, x2, y2, cx, cy, ew, eh, margin=1.15):
    """Return True if segment (x1,y1)→(x2,y2) passes through the ellipse.

    A small *margin* inflates the ellipse slightly so that lines grazing
    the edge are also treated as blocked.  Intersections within *eps* of
    t=0 or t=1 are ignored because those correspond to the source/target
    node itself.
    """
    a = ew / 2 * margin
    b = eh / 2 * margin
    dx, dy = x2 - x1, y2 - y1
    fx, fy = x1 - cx, y1 - cy
    A_c = (dx/a)**2 + (dy/b)**2
    B_c = 2 * (fx*dx/a**2 + fy*dy/b**2)
    C_c = (fx/a)**2 + (fy/b)**2 - 1
    disc = B_c**2 - 4*A_c*C_c
    if disc < 0:
        return False
    sqd = np.sqrt(disc)
    t1 = (-B_c - sqd) / (2*A_c)
    t2 = (-B_c + sqd) / (2*A_c)
    eps = 0.05
    return (eps < t1 < 1 - eps) or (eps < t2 < 1 - eps)


# ── public API ───────────────────────────────────────────────────────────────

def draw_network(edges):
    """Draw a Bayesian-network DAG with tight ellipse nodes and clean arrows.

    Edge routing strategy
    ---------------------
    * Every edge is drawn **straight** (rad=0) by default.
    * Curvature is added **only** when the straight line would pass through
      an intermediate node (detected via an ellipse–segment intersection
      test).  The curve bends *away* from the blocking node.
    * When two straight edges to the same target arrive at nearly identical
      angles (< 7°), a tiny symmetric nudge (±0.07) is applied so that both
      arrowheads remain individually visible.
    * All arrows use ``FancyArrowPatch`` with ``patchA``/``patchB`` set to the
      source/target ``Ellipse`` objects so that arrowheads are always clipped
      to the ellipse boundary and never hidden behind a node.
    """
    G = nx.DiGraph(edges)

    # ── layer assignment (topological) ───────────────────────────────────────
    layers = {}
    for node in nx.topological_sort(G):
        if G.in_degree(node) == 0:
            layers[node] = 0
        else:
            layers[node] = max(layers[p] + 1 for p in G.predecessors(node))

    nodes_by_layer = defaultdict(list)
    for node, layer in layers.items():
        nodes_by_layer[layer].append(node)

    # ── layout constants (data units) ────────────────────────────────────────
    FONT_SIZE = 25
    CHAR_W    = 0.09    # estimated data-unit width per character
    PAD_X     = 0.14    # total horizontal padding inside ellipse
    NODE_H    = 0.18    # ellipse height
    H_GAP     = 0.22    # gap between sibling nodes in the same layer
    V_SPACING = 1.0    # vertical distance between layer centres
    MARGIN    = 0.12    # border around the whole graph
    SCALE     = 4.0     # figure inches per data unit

    node_w = {n: len(str(n)) * CHAR_W + PAD_X for n in G.nodes()}

    # ── node positions ────────────────────────────────────────────────────────
    pos = {}
    for layer in sorted(nodes_by_layer.keys()):
        layer_nodes = sorted(nodes_by_layer[layer])
        total_w = (sum(node_w[n] for n in layer_nodes)
                   + H_GAP * (len(layer_nodes) - 1))
        x = -total_w / 2.0
        for n in layer_nodes:
            pos[n] = (x + node_w[n] / 2.0, -layer * V_SPACING)
            x += node_w[n] + H_GAP

    # ── figure sized to content (fills canvas, minimal whitespace) ───────────
    x_min = min(pos[n][0] - node_w[n]/2 for n in pos) - MARGIN
    x_max = max(pos[n][0] + node_w[n]/2 for n in pos) + MARGIN
    y_min = min(pos[n][1] for n in pos) - NODE_H/2 - MARGIN
    y_max = max(pos[n][1] for n in pos) + NODE_H/2 + MARGIN

    fig = plt.figure(figsize=((x_max - x_min) * SCALE,
                               (y_max - y_min) * SCALE))
    ax = fig.add_axes([0, 0, 1, 1])   # axes fills the entire canvas
    ax.set_xlim(x_min, x_max)
    ax.set_ylim(y_min, y_max)
    ax.set_aspect('equal', adjustable='box')
    ax.axis('off')

    # ── draw nodes; keep patch refs for FancyArrowPatch clipping ─────────────
    ellipse_patches = {}
    for node, (x, y) in pos.items():
        ell = Ellipse(
            (x, y),
            width=node_w[node],
            height=NODE_H,
            facecolor='#AED6E8',
            edgecolor='#3B7EA1',
            linewidth=1.5,
            zorder=3,
        )
        ax.add_patch(ell)
        ellipse_patches[node] = ell
        ax.text(x, y, str(node),
                ha='center', va='center',
                fontsize=FONT_SIZE, zorder=4)

    # ── determine curvature for each edge ────────────────────────────────────
    edge_rads = {}
    for u, v in G.edges():
        x1, y1 = pos[u]
        x2, y2 = pos[v]
        rad = 0.0   # straight line unless blocked

        for n in G.nodes():
            if n in (u, v):
                continue
            cx, cy = pos[n]
            if _line_clips_ellipse(x1, y1, x2, y2,
                                   cx, cy, node_w[n], NODE_H):
                # signed_side > 0  →  blocker is LEFT of u→v  →  curve right
                side = (x2 - x1) * (cy - y1) - (y2 - y1) * (cx - x1)
                rad  = -0.22 if side > 0 else 0.22
                break   # first blocker sets the direction

        edge_rads[(u, v)] = rad

    # Tiny nudge for straight edges that arrive at the same target
    # from nearly identical angles (keeps both arrowheads visible).
    by_target = defaultdict(list)
    for u, v in G.edges():
        by_target[v].append(u)

    for target, sources in by_target.items():
        tx, ty = pos[target]
        straight = [s for s in sources if edge_rads[(s, target)] == 0.0]
        if len(straight) > 1:
            angs = {s: np.arctan2(ty - pos[s][1], tx - pos[s][0])
                    for s in straight}
            for i, si in enumerate(straight):
                for sj in straight[i+1:]:
                    if abs(angs[si] - angs[sj]) < 0.12:   # ~7°
                        edge_rads[(si, target)] = -0.07
                        edge_rads[(sj, target)] =  0.07

    # ── draw edges ────────────────────────────────────────────────────────────
    for u, v in G.edges():
        rad = edge_rads[(u, v)]
        arrow = FancyArrowPatch(
            posA=pos[u],
            posB=pos[v],
            patchA=ellipse_patches[u],     # clip start at source ellipse
            patchB=ellipse_patches[v],     # clip end   at target ellipse
            arrowstyle='-|>',
            mutation_scale=14,
            connectionstyle=f'arc3,rad={rad:.3f}',
            color='#222222',
            linewidth=2.5,
            zorder=2,
        )
        ax.add_patch(arrow)

    return fig

# draw_network, plot_two_factors, plot_1D_query, plot_one_factor stubs

# def draw_network(edges: Any, figsize=(8,6), margin=0.2) -> plt.Figure:
#     """Return a figure showing a DAG given by edges."""
#     import networkx as nx
#     from matplotlib.patches import Ellipse
#     import numpy as np

#     G = nx.DiGraph()
#     G.add_edges_from(edges)

#     if not nx.is_directed_acyclic_graph(G):
#         raise ValueError("Bayesian Network must be a DAG")

#     avg_label_len = sum(len(n) for n in G.nodes) / len(G.nodes)
#     nodesep = 0.01 * avg_label_len
#     ranksep = 1.2 + 0.03 * avg_label_len

#     pos = nx.nx_agraph.graphviz_layout(
#         G,
#         prog="dot",
#         args=f"-Grankdir=TB -Granksep={ranksep:.2f} -Gnodesep={nodesep:.2f}"
#     )
#     try:
#         from .utils import add_vertical_jitter
#         pos = add_vertical_jitter(pos, jitter=20)
#     except ImportError:
#         pass

#     fig, ax = plt.subplots(figsize=figsize)

#     nx.draw_networkx_edges(
#         G,
#         pos,
#         ax=ax,
#         arrows=True,
#         arrowstyle='-|>',
#         arrowsize=18,
#         width=1.4,
#         edge_color='black',
#         connectionstyle='arc3,rad=0.0'
#     )

#     text_artists = {}
#     for node, (x, y) in pos.items():
#         t = ax.text(
#             x, y,
#             str(node),
#             ha="center",
#             va="center",
#             fontsize=10,
#             alpha=0.0,
#             zorder=3
#         )
#         text_artists[node] = t

#     fig.canvas.draw()
#     renderer = fig.canvas.get_renderer()

#     for node, (x, y) in pos.items():
#         text = text_artists[node]
#         bbox = text.get_window_extent(renderer=renderer)
#         inv = ax.transData.inverted()
#         (x0, y0) = inv.transform((bbox.x0, bbox.y0))
#         (x1, y1) = inv.transform((bbox.x1, bbox.y1))

#         width  = (x1 - x0) * 1.25
#         height = (y1 - y0) * 1.6

#         ellipse = Ellipse(
#             (x, y),
#             width=width,
#             height=height,
#             facecolor="white",
#             edgecolor="black",
#             linewidth=1.5,
#             zorder=2
#         )
#         ax.add_patch(ellipse)
#         text.set_alpha(1.0)

#     ax.set_axis_off()
#     xs, ys = zip(*pos.values())
#     xs, ys = np.array(xs), np.array(ys)
#     dx = margin * (xs.max() - xs.min())
#     dy = margin * (ys.max() - ys.min())
#     ax.set_xlim(xs.min() - dx, xs.max() + dx)
#     ax.set_ylim(ys.min() - dy, ys.max() + dy)
#     plt.tight_layout()
#     return fig


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
