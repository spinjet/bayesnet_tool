# -*- coding: utf-8 -*-
"""
Created on Fri Feb  6 10:10:04 2026

@author: s345001
"""

import numpy as np
import pandas as pd
import re

import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
from matplotlib.patches import Ellipse


from pgmpy.models import DiscreteBayesianNetwork
from pgmpy.estimators import BayesianEstimator, MaximumLikelihoodEstimator
from pgmpy.inference import VariableElimination
from pgmpy.factors.discrete import TabularCPD

import streamlit as st
import networkx as nx
import json 


# Save and Load
def save_bn_structure(path, nodes, edges, node_config):
    data = {
        "nodes": list(nodes),
        "edges": [list(e) for e in edges],
        "node_config": node_config
    }
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def load_bn_structure(path):
    with open(path, "r") as f:
        data = json.load(f)

    nodes = data["nodes"]
    edges = [tuple(e) for e in data["edges"]]
    node_config = data.get("node_config", {})

    # Safety: ensure DAG
    G = nx.DiGraph(edges)
    if not nx.is_directed_acyclic_graph(G):
        raise ValueError("Loaded structure is not a DAG")

    return nodes, edges, node_config



# Topological sorting for NetworkX
def dag_layout(G):
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


# Draw network function
# def draw_network(nodes, edges):
#     G = nx.DiGraph()
#     G.add_nodes_from(nodes)
#     G.add_edges_from(edges)

#     fig, ax = plt.subplots(figsize=(8, 6))

#     #pos = nx.spring_layout(G, seed=42)  # stable layout
#     pos = dag_layout(G)
#     nx.draw(
#         G,
#         pos,
#         ax=ax,
#         with_labels=True,
#         node_size=2500,
#         node_color="lightblue",
#         edge_color="black",
#         arrows=True,
#         font_size=9
#     )

#     return fig


def add_vertical_jitter(pos, jitter=0.15):
    """
    Add small vertical offsets to nodes sharing the same y-position.
    pos: dict {node: (x, y)}
    jitter: vertical spacing unit
    """
    from collections import defaultdict

    # Group nodes by y (rank)
    ranks = defaultdict(list)
    for node, (x, y) in pos.items():
        ranks[y].append(node)

    new_pos = pos.copy()

    for y, nodes in ranks.items():
        if len(nodes) == 1:
            continue

        # Sort for deterministic layout
        nodes = sorted(nodes)

        for i, node in enumerate(nodes):
            offset = ((i // 2) + 1) * jitter
            if i % 2 == 0:
                offset *= -1

            x, _ = pos[node]
            new_pos[node] = (x, y + offset)

    return new_pos

def draw_network(edges, figsize=(8, 6), margin=0.2):
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
        args=f"-Grankdir=TB -Granksep={ranksep:.2f} -Gnodesep={nodesep:.2f}"#"-Grankdir=TB -Granksep=2.2 -Gnodesep=2.0 -Gordering=out"
    )
    pos = add_vertical_jitter(pos, jitter=20)

    fig, ax = plt.subplots(figsize=figsize)

    # --- Draw edges first ---
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
            alpha=0.0,   # invisible for sizing
            zorder=3
        )
        text_artists[node] = t

    fig.canvas.draw()  
    renderer = fig.canvas.get_renderer()

    # --- Second pass: draw ellipses sized to text ---
    for node, (x, y) in pos.items():
        text = text_artists[node]
        bbox = text.get_window_extent(renderer=renderer)

        # Convert pixel size → data coordinates
        inv = ax.transData.inverted()
        (x0, y0) = inv.transform((bbox.x0, bbox.y0))
        (x1, y1) = inv.transform((bbox.x1, bbox.y1))

        width  = (x1 - x0) * 1.25  # padding
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

        # redraw visible text
        text.set_alpha(1.0)

    ax.set_axis_off()

    # --- Margins ---
    xs, ys = zip(*pos.values())
    xs, ys = np.array(xs), np.array(ys)
    dx = margin * (xs.max() - xs.min())
    dy = margin * (ys.max() - ys.min())
    ax.set_xlim(xs.min() - dx, xs.max() + dx)
    ax.set_ylim(ys.min() - dy, ys.max() + dy)

    plt.tight_layout()
    return fig

# Discretiser 
class UniformDiscretiser1D:
    def __init__(self, data, n_levels, decimals=2):
        
        self.n_levels = n_levels
        x = data.flatten()
        
        self.level_width  = (x.max() - x.min())/self.n_levels
        self.split_points = [
                x.min() + self.level_width * (n + 1) for n in range(self.n_levels - 1)
            ]
        
        self.ranges = [data.min()] + list(self.split_points) + [data.max()]
        self.range_map = { i-1 : f'[{i-1:02d}]:({self.ranges[i-1]:.{decimals}f}-{self.ranges[i]:.{decimals}f})'  for i in range(1,len(self.ranges))}

    
    def transform(self, data):
        return np.digitize(data, self.split_points)
    
    def transform_map(self, data):
        tf_data  = self.transform(data)
        map_data = np.vectorize(self.range_map.get)(tf_data)
        
        return map_data
        
    def map_2_range(self, value):
        range_idx =  list(self.range_map.keys())[list(self.range_map.values()).index(value)]
        return (self.ranges[range_idx], self.ranges[range_idx+1])


# Build discrete DF
def build_discrete_df(df, node_config):
    out = {}
    discretisers = {}

    for node, cfg in node_config.items():
        if cfg["type"] == "Continuous":
            d = UniformDiscretiser1D(
                df[node].to_numpy(),
                n_levels=cfg["bins"],
                decimals=cfg["precision"]
            )
            discretisers[node] = d
            out[node] = d.transform_map(df[node].to_numpy())
        else:
            out[node] = df[node]

    return pd.DataFrame(out), discretisers


# Plot Two factors function
def plot_two_factors(phi, title, x_state, y_state):
    
    #st.write(phi.state_names)
    
    fig = plt.figure(figsize=(8, 6), dpi=200)
    #gs = GridSpec(3, 2, figure=fig, height_ratios=[1, 1, 1], width_ratios=[2, 1])
    
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

def plot_1D_query(phi, title=None, xlabel=None):
    node = list(phi.state_names.keys())[0]

    # Extract state names safely
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

# Plot Single factor function
def plot_one_factor(phi, title, state):
    node = list(phi.state_names.keys())[0]
    
    state_names = [state.split(':')[1] for state in phi.state_names[node]]
    
    fig, ax = plt.subplots()
    ax.bar(phi.state_names[node], phi.values,)
    ax.set_xlabel(state)
    ax.set_xticklabels(state_names, rotation=90)
    ax.set_title(title)
    ax.set_ylabel('Probability')
    plt.tight_layout()
    
    return fig


### STREAMLIT APP

st.set_page_config(layout='wide')

# Initialise states

if 'disc_df' not in st.session_state:
    st.session_state.disc_df = None

if 'discretisers' not in st.session_state:
    st.session_state.discretisers = None


if 'edges' not in st.session_state:
    st.session_state.edges = []

if 'nodes' not in st.session_state:
    st.session_state.nodes = []

if 'col_nodes' not in st.session_state:
    st.session_state.col_nodes = None


if 'model' not in st.session_state:
    st.session_state.model = None

if 'infer' not in st.session_state:
    st.session_state.infer = None


st.title("PDOPT - Bayesian Network Analysis Demo")
st.caption("Interactive design-space exploration using Bayesian Networks")
st.markdown("---")

tabs = st.tabs([
    "Data Loading",
    "Sustainability Indicators",
    "Add Requirements",
    "Model Structure",
    "Data Discretisation",
    "Model Training",
    "Model Query"
    ])


with tabs[0]:
    st.header("Data Loading")
    # uploader widget
    uploaded_file = st.file_uploader(
        "Upload CSV",
        type="csv",
        key="csv_uploader"
    )
    
    # gate logic
    if uploaded_file is None:
        st.info("Please upload a CSV file to continue.")
        st.stop()
    
    # Load once
    if "df" not in st.session_state:
        st.session_state.df = pd.read_csv(uploaded_file)
    
    df = st.session_state.df
    st.success("Dataset loaded")
    st.write(st.session_state.df)
    
    st.session_state.col_nodes = df.columns
    
    
    # Nan check
    
    st.subheader("Missing Data Management")

    df = st.session_state.df.copy()
    
    total_rows = len(df)
    total_cols = len(df.columns)
    
    nan_per_col = df.isna().sum()
    nan_percent = (nan_per_col / total_rows) * 100
    
    nan_summary = (
        pd.DataFrame({
            "NaN Count": nan_per_col,
            "NaN %": nan_percent.round(2)
        })
        .sort_values("NaN %", ascending=False)
    )
    
    
    st.write("NaN summary per column:")
    st.dataframe(nan_summary)
    
    threshold = st.slider(
        "Drop columns with more than this % of NaNs",
        min_value=0,
        max_value=100,
        value=50
    )
    
    if st.button("Drop Columns with Excessive NaNs"):

        cols_to_drop = nan_summary[nan_summary["NaN %"] > threshold].index.tolist()
    
        if not cols_to_drop:
            st.info("No columns exceed the selected threshold.")
        else:
            df = df.drop(columns=cols_to_drop)
    
            st.session_state.df = df
            st.session_state.col_nodes = list(df.columns)
    
            st.success(f"Dropped {len(cols_to_drop)} columns.")
            st.rerun()
            
    remaining_nan_rows = st.session_state.df.isna().any(axis=1).sum()
    st.write(f"Rows still containing NaNs: {remaining_nan_rows}")
    
    if st.button("Drop Remaining Rows with NaNs"):

        df_clean = st.session_state.df.dropna().reset_index(drop=True)
    
        removed = len(st.session_state.df) - len(df_clean)
    
        st.session_state.df = df_clean
        st.session_state.col_nodes = list(df_clean.columns)
    
        st.success(f"Dropped {removed} rows with NaNs.")
        st.rerun()

### Add Requirements tab
def requirement_editor(req_id):
    cols = st.columns([2,2,1,2,1])

    with cols[0]:
        name = st.text_input(
            "Requirement name",
            key=f"req_name_{req_id}"
        )

    with cols[1]:
        variable = st.selectbox(
            "Variable",
            st.session_state.df.columns,
            key=f"req_var_{req_id}"
        )

    with cols[2]:
        operator = st.selectbox(
            "Operator",
            [">", "<"],
            key=f"req_op_{req_id}"
        )

    with cols[3]:
        distribution = st.selectbox(
            "Distribution",
            ["constant", "uniform", "triangular"],
            key=f"req_dist_{req_id}"
        )

    with cols[4]:
        value = st.number_input(
            "Value",
            key=f"req_val_{req_id}"
        )

    variability = None
    if distribution in ["uniform", "triangular"]:
        variability = st.number_input(
            "± variability",
            key=f"req_varb_{req_id}"
        )

    return {
        "name": name,
        "variable": variable,
        "operator": operator,
        "distribution": distribution,
        "value": value,
        "variability": variability
    }

with tabs[1]:
    st.header("Add Sustainability Indicators")
    
    indicators = ["Sustainability.Performance", "Sustainability.Environment", 
                  "Sustainability.Cost", "Sustainability.Society"]
    
    if "indicator_config" not in st.session_state:
        st.session_state.indicator_config = {
            name: [] for name in indicators
        }
        
    for indicator in indicators:
        st.subheader(indicator)
        
        selected_vars = st.multiselect(
            f"Select factors affecting {indicator}",
            options = st.session_state.df.columns,
            key=f"{indicator}_vars"
            )
        
        effects = {}
        
        for var in selected_vars:
            effect = st.radio(
                f"{var} effect",
                options=["Positive", "Negative"],
                horizontal=True,
                key=f"{indicator}_{var}_effect"
                )
            effects[var] = effect
            
        st.session_state.indicator_config[indicator] = effects
        
    if st.button("Compute Sustainability Indicators"):
        df = st.session_state.df.copy()

        for indicator, factors in st.session_state.indicator_config.items():
        
            if not factors:
                continue
        
            k_values = []
        
            for factor, effect in factors.items():
        
                col = df[factor]
        
                min_val = col.min()
                max_val = col.max()
        
                # Avoid division by zero
                if max_val == min_val:
                    k = pd.Series(0.0, index=df.index)
                else:
                    k = (col - min_val) / (max_val - min_val)
        
                if effect == "Negative":
                    k = 1 - k
        
                k_values.append(k)
        
            indicator_value = pd.concat(k_values, axis=1).mean(axis=1)
        
            df[indicator] = indicator_value
        
        st.session_state.df = df
        st.session_state.col_nodes = list(df.columns)
        # st.session_state.nodes = list(df.columns)
        
        st.success("Sustainability indicators computed and added.")
        st.rerun()
            
            
with tabs[2]:
    st.header("Define Requirements")

    if "df" not in st.session_state:
        st.warning("Load data first.")
        st.stop()

    if "requirements" not in st.session_state:
        st.session_state.requirements = []
        
    if "req_list" not in st.session_state:
        st.session_state.req_list = [{}]

    for i in range(len(st.session_state.req_list)):
        st.subheader(f"Requirement {i+1}")
        st.session_state.req_list[i] = requirement_editor(i)

        if st.button("Remove", key=f"remove_req_{i}"):
            st.session_state.req_list.pop(i)
            st.rerun()

    if st.button("Add Requirement"):
        st.session_state.req_list.append({})
        st.rerun()
        
    if st.button("Apply Requirements"):
        df = st.session_state.df.copy()

        for req in st.session_state.req_list:

            name = req["name"]
            var = req["variable"]
            op = req["operator"]
            dist = req["distribution"]
            val = req["value"]
            varb = req["variability"]

            if not name:
                continue

            # Create distribution column if needed
            if dist == "uniform":
                lower = val - varb
                upper = val + varb
                dist_col = f"{name}_dist"
                df[dist_col] = np.random.uniform(
                    lower, upper, size=len(df)
                )
                compare_target = df[dist_col]

            elif dist == "triangular":
                lower = val - varb
                upper = val + varb
                dist_col = f"{name}_dist"
                df[dist_col] = np.random.triangular(
                    lower, val, upper, size=len(df)
                )
                compare_target = df[dist_col]

            else:  # constant
                compare_target = val

            # Compare and create requirement column
            req_col = f"{name}_requirement"

            if op == ">":
                df[req_col] = (df[var] > compare_target).astype(int)
            else:
                df[req_col] = (df[var] < compare_target).astype(int)

        # Update dataframe + nodes
        st.session_state.df = df
        st.session_state.nodes = list(df.columns)

        st.success("Requirements applied successfully.")


with tabs[3]:
    st.header("Model Structure")

    if "df" not in st.session_state:
        st.warning("Load data first.")
        st.stop()

    # Visualise the network 
    
    if "dsm_selected_vars" not in st.session_state:
        st.session_state.dsm_selected_vars = list(st.session_state.nodes)
    
    
    st.subheader("Save / Load Bayesian Network Structure")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("#### Save structure")
    
        filename = st.text_input(
            "Filename",
            value="bayesian_network.json"
        )
    
        if st.button("Save structure"):
            if not st.session_state.edges:
                st.warning("No edges to save.")
            else:
                save_bn_structure(
                    filename,
                    st.session_state.nodes,
                    st.session_state.edges,
                    st.session_state.node_config
                )
                st.success(f"Structure saved to {filename}")
    
    with col2:
        st.markdown("#### Load structure")
    
        uploaded_json = st.file_uploader(
            "Upload BN JSON",
            type="json",
            key="bn_json_uploader"
        )
    
        if st.button("Load structure", key="load_structure_button"):
    
            if uploaded_json is None:
                st.warning("Please upload a JSON file first.")
            else:
                try:
                    data = json.load(uploaded_json)

                    nodes = data["nodes"]
                    edges = [tuple(e) for e in data["edges"]]
                    node_config = data.get("node_config", {})
                    
                    G = nx.DiGraph(edges)
                    
                    if not nx.is_directed_acyclic_graph(G):
                        st.error("Uploaded network is not a DAG.")
                    else:
                        # Core model state
                        st.session_state.nodes = nodes
                        st.session_state.edges = edges
                        st.session_state.node_config = node_config
                    
                        # 2 Update available columns
                        st.session_state.col_nodes = list(nodes)
                    
                        # 3 Update selected vars for DSM
                        st.session_state.dsm_selected_vars = list(nodes)
                    
                    
                        # 4️⃣ Rebuild DSM DataFrame
                        # Convention:
                        # Row = child
                        # Column = parent
                        # Only lower triangular allowed
                    
                        dsm_df = pd.DataFrame(
                            0,
                            index=nodes,
                            columns=nodes
                        )
                    
                        for parent, child in edges:
                            if parent in nodes and child in nodes:
                                dsm_df.loc[child, parent] = 1
                    
                        st.session_state.dsm_df = dsm_df
                    
                        # ---------------------------------------
                        # 5️⃣ Clear widget keys (important)
                        # ---------------------------------------
                        for key in list(st.session_state.keys()):
                            if key.startswith("dsm_") or key.startswith("type_") or key.startswith("bins_") \
                               or key.startswith("precision_") or key.startswith("uniform_"):
                                del st.session_state[key]
                    
                        st.success("Bayesian network structure loaded and UI synchronised.")
                        st.rerun()
    
                except Exception as e:
                    st.error(f"Failed to load structure: {e}")
    
    st.subheader("Select Variables for Structure Definition")

    
    selected_vars = st.multiselect(
        "Choose variables to include in structure matrix",
        options=st.session_state.col_nodes,
        key="dsm_selected_vars"
        #default=st.session_state.dsm_selected_vars
    )
    
    if not selected_vars:
        st.warning("Select at least one variable.")
        st.stop()
    
    #st.session_state.dsm_selected_vars = selected_vars
    variables = selected_vars
    n = len(variables)
    
    st.subheader("Structure Connections Matrix")
    st.write("Column: Parent node, Row: Child node")
    
    # ---------------------------------------------------
    # Update Available Nodes Button
    # ---------------------------------------------------
    if st.button("Update Available Nodes"):
        st.session_state.nodes = list(variables)
        st.session_state.dsm_matrix = np.zeros(
            (len(st.session_state.col_nodes),
             len(st.session_state.col_nodes)),
            dtype=int
        )
        
        st.success("Available nodes updated and matrix reset.")
        st.rerun()
    
    #variables = list(st.session_state.col_nodes)
    #n = len(variables)
    
    # current_vars = variables

    # if "dsm_df" not in st.session_state:
    #     st.session_state.dsm_df = pd.DataFrame(
    #         0, index=current_vars, columns=current_vars
    #     )
    
    # else:
    #     existing_df = st.session_state.dsm_df
    
    #     # If variables changed, rebuild matrix
    #     if list(existing_df.index) != list(current_vars):
    
    #         new_df = pd.DataFrame(
    #             0, index=current_vars, columns=current_vars
    #         )
    
    #         # Preserve overlapping values
    #         for row in current_vars:
    #             for col in current_vars:
    #                 if row in existing_df.index and col in existing_df.columns:
    #                     new_df.loc[row, col] = existing_df.loc[row, col]
    
    #         st.session_state.dsm_df = new_df
    
    variables = st.session_state.dsm_selected_vars
    edges = st.session_state.get("edges", [])
    
    # Always rebuild DSM from edges
    dsm_df = pd.DataFrame(
        0,
        index=variables,
        columns=variables
    )
    
    for parent, child in edges:
        if parent in variables and child in variables:
            dsm_df.loc[child, parent] = 1
    
    st.session_state.dsm_df = dsm_df
    
    st.subheader("Structure Matrix")

    # if "dsm_df" not in st.session_state:
    #     st.session_state.dsm_df = pd.DataFrame(
    #         0, index=variables, columns=variables
    #     )
    
    edited_df = st.data_editor(
        st.session_state.dsm_df,
        use_container_width=True,
        num_rows="fixed",
        key="dsm_editor"
    )
        
    
    # Store raw edits temporarily
    #st.session_state._dsm_temp = dsm_df
    
    if st.button("Update Edges"):
    
        new_edges = []
    
        for child in variables:
            for parent in variables:
                if edited_df.loc[child, parent] == 1:
                    new_edges.append((parent, child))
    
        G = nx.DiGraph(new_edges)
    
        if not nx.is_directed_acyclic_graph(G):
            st.error("The selected dependencies create a cycle.")
        else:
            st.session_state.edges = new_edges
            st.success("Edges updated.")
            st.rerun()

    # st.markdown(
    #     """
    #     <style>
    #     .dsm-scroll {
    #         overflow-x: auto;
    #         white-space: nowrap;
    #         padding-bottom: 1rem;
    #     }
    #     </style>
    #     """,
    #     unsafe_allow_html=True
    # )
    
    # st.markdown('<div class="dsm-scroll">', unsafe_allow_html=True)
    
    # # ---------------------------------------------------
    # # Header row
    # # ---------------------------------------------------
    # header_cols = st.columns(n + 1)
    # header_cols[0].markdown("**Output \\ Input**")
    
    # for j, var in enumerate(variables):
    #     header_cols[j + 1].markdown(f"**{var}**")
    
    # # ---------------------------------------------------
    # # Matrix rows (LOWER TRIANGULAR ONLY)
    # # ---------------------------------------------------
    # for i, row_var in enumerate(variables):
    
    #     row_cols = st.columns(n + 1)
    #     row_cols[0].markdown(f"**{row_var}**")
    
    #     for j, col_var in enumerate(variables):
    
    #         # Diagonal → no self-loop
    #         if i == j:
    #             row_cols[j + 1].write("—")
    #             continue
    
    #         # Upper triangle → disabled
    #         if j > i:
    #             row_cols[j + 1].write("")
    #             continue
    
    #         # Lower triangle → editable
    #         key = f"dsm_{i}_{j}"
    
    #         checked = row_cols[j + 1].checkbox(
    #             "",
    #             value=bool(st.session_state.dsm_matrix[i, j]),
    #             key=key
    #         )
    
    #         st.session_state.dsm_matrix[i, j] = int(checked)
    
    # st.markdown('</div>', unsafe_allow_html=True)
    
    # # ---------------------------------------------------
    # # Convert DSM → Edges
    # # ---------------------------------------------------
    # if st.button("Update Edges"):
    
    #     edges = []
    
    #     for i in range(n):
    #         for j in range(i):  # lower triangle only
    #             if st.session_state.dsm_matrix[i, j] == 1:
    #                 parent = variables[j]
    #                 child = variables[i]
    #                 edges.append((parent, child))
    
    #     st.session_state.edges = edges
    #     st.session_state.nodes = variables
    
    #     st.success("Edges updated from matrix.")
    
    #st.write(variables)
    
    if st.button("Reset Structure"):
    # Clear DSM and BN graph
        st.session_state.edges = []
        st.session_state.nodes = []
        st.session_state.dsm_matrix = np.zeros((n, n), dtype=int)
    
        # Clear checkbox states
        for i in range(n):
            for j in range(n):
                key = f"dsm_{i}_{j}"
                if key in st.session_state:
                    del st.session_state[key]
    
        st.success("Structure and DSM reset.")
        st.rerun()
    
    
    
    st.subheader("Bayesian Network Structure")
    if st.session_state.edges == []:
        st.warning("Add a structure first.")
        st.stop()
    else:
        fig = draw_network(st.session_state.edges)
        #draw_network(st.session_state.nodes, st.session_state.edges)
        st.pyplot(fig)
    
    #st.write("Edges:", st.session_state.edges)
    
    
    # Discretise the data
with tabs[4]:
    st.header("Data Discretisation and Node Type")
    
    
    if "edges" not in st.session_state or not st.session_state.edges:
        st.warning("Define the network structure first.")
        st.stop()

    
    if "node_config" not in st.session_state:
        st.session_state.node_config = {}
    
    #st.subheader("Node Type & Discretisation")
    
    st.write(st.session_state.nodes)
    if not st.session_state.nodes:
        st.info("Add at least one edge to define network nodes.")
    else:
        
        if "edges" in st.session_state:
            G = nx.DiGraph(st.session_state.edges)
        
            if nx.is_directed_acyclic_graph(G):
                topo_nodes = list(nx.topological_sort(G))
            else:
                topo_nodes = list(st.session_state.col_nodes)
        else:
            topo_nodes = list(st.session_state.col_nodes)
        
        # Layout: Name | Type | Bins | Precision | Uniform
        # Column Titles
        col_labels = ["Node Name", "Type",
                      "Number of Bins", "Decimal Precision", "Force Non-Informative Uniform"]
        
        cols = st.columns([2, 2, 1.5, 1.5, 1])
        
        for i, col in enumerate(cols):
            with col:
                st.markdown(f"**{col_labels[i]}**")
        
        
        
        for node in topo_nodes:
    
            # Initialise defaults per node
            if node not in st.session_state.node_config:
                st.session_state.node_config[node] = {
                    "type": "Discrete",
                    "uniform_prior" : False
                }
    
            cfg = st.session_state.node_config[node]
            col1, col2, col3, col4, col5 = st.columns([2, 2, 1.5, 1.5, 1])
            
            
            # -----------------------
            # Column 1 — Node Name
            # -----------------------
            with col1:
                st.markdown(f"**{node}**")
            
            # -----------------------
            # Column 2 — Type
            # -----------------------
            with col2:
                node_type = st.selectbox(
                    "Type",
                    ["Discrete", "Continuous"],
                    index=0 if cfg["type"] == "Discrete" else 1,
                    key=f"type_{node}",
                    label_visibility="collapsed"
                )
            
            cfg["type"] = node_type
            
            # -----------------------
            # Column 3 — Bins
            # -----------------------
            with col3:
                if node_type == "Continuous":
                    bins = st.number_input(
                        "Bins",
                        min_value=2,
                        max_value=50,
                        value=cfg.get("bins", 10),
                        step=1,
                        key=f"bins_{node}",
                        label_visibility="collapsed"
                    )
                    cfg["bins"] = int(bins)
                else:
                    st.write("—")
                    cfg.pop("bins", None)
            
            # -----------------------
            # Column 4 — Precision
            # -----------------------
            with col4:
                if node_type == "Continuous":
                    precision = st.number_input(
                        "Precision",
                        min_value=0,
                        max_value=6,
                        value=cfg.get("precision", 3),
                        step=1,
                        key=f"precision_{node}",
                        label_visibility="collapsed"
                    )
                    cfg["precision"] = int(precision)
                else:
                    st.write("—")
                    cfg.pop("precision", None)

            # -----------------------
            # Column 5 — Uniform Prior
            # -----------------------
            with col5:
                uniform = st.checkbox(
                    "Uniform",
                    value=cfg.get("uniform_prior", False),
                    key=f"uniform_{node}",
                    label_visibility="collapsed"
                )
                cfg["uniform_prior"] = uniform
            
            # Save back
            st.session_state.node_config[node] = cfg
    
    
with tabs[5]:
    st.header("Train Bayesian Network")
    
    if "node_config" not in st.session_state:
        st.warning("Configure nodes first.")
        st.stop()
    
    if st.button("Run Discretisation"):
        st.session_state.disc_df, st.session_state.discretisers = build_discrete_df(st.session_state.df, st.session_state.node_config)
        
        st.write(st.session_state.disc_df)
        st.write(st.session_state.nodes)
        
    ## Train model
    if st.button("Train Bayesian Network"):
        model = DiscreteBayesianNetwork(st.session_state.edges)
        
        
    
        model.fit(st.session_state.disc_df, estimator=MaximumLikelihoodEstimator)
        
        # model.fit(st.session_state.disc_df, estimator=BayesianEstimator,
        #           prior_type="dirichlet", pseudo_counts=2)
        infer = VariableElimination(model)
        
        st.session_state.model = model
        
        # Impose uniform distributions 
        # to avoid frequency bias on selected
        # nodes
        for node in model.nodes():

            cfg = st.session_state.node_config.get(node, {})
            apply_uniform = cfg.get("uniform_prior", False)
        
            if apply_uniform:
                cpd = model.get_cpds(node)
        
                if cpd is not None:
                    card = cpd.variable_card
                    p = 1.0 / card
        
                    cpd.values = np.full_like(cpd.values, p)
                    cpd.normalize()
                    model.add_cpds(cpd)
        
        #model.check_model()
        
        st.write(model.check_model())
        
        
        st.session_state.infer = infer
        st.success("Model trained successfully.")
        
        

## Query frontend

## Helper function for plotting queries
def query_panel(panel_id):
    
    st.subheader(f"Query {panel_id+1}")

    # -----------------------------
    # Query variables
    # -----------------------------
    query_vars = st.multiselect(
        "Query variables (1 or 2)",
        st.session_state.nodes,
        max_selections=2,
        key=f"qvars_{panel_id}"
    )

    # -----------------------------
    # Evidence state initialization
    # -----------------------------
    evidence_key = f"evidence_{panel_id}"
    result_key = f"result_{panel_id}"

    if evidence_key not in st.session_state:
        st.session_state[evidence_key] = [
            {"node": None, "state": None}
        ]

    # -----------------------------
    # Evidence editor
    # -----------------------------
    st.markdown("**Evidence**")

    for i, ev in enumerate(st.session_state[evidence_key]):
        cols = st.columns([3, 3, 1])

        with cols[0]:
            node = st.selectbox(
                "Node",
                st.session_state.nodes,
                key=f"ev_node_{panel_id}_{i}"
            )

        with cols[1]:
            if node is not None:
                state = st.selectbox(
                    "State",
                    st.session_state.model.states[node],
                    key=f"ev_state_{panel_id}_{i}"
                )
            else:
                state = None
                st.selectbox(
                    "State", [], disabled=True,
                    key=f"ev_state_{panel_id}_{i}"
                )

        with cols[2]:
            if st.button("✖", key=f"remove_ev_{panel_id}_{i}"):
                st.session_state[evidence_key].pop(i)
                st.rerun()

        st.session_state[evidence_key][i] = {
            "node": node,
            "state": state
        }

    if st.button("➕ Add evidence", key=f"add_ev_{panel_id}"):
        st.session_state[evidence_key].append(
            {"node": None, "state": None}
        )
        st.rerun()

    # -----------------------------
    # Build evidence dictionary
    # -----------------------------
    evidence = {}
    for ev in st.session_state[evidence_key]:
        if ev["node"] is not None and ev["state"] is not None:
            evidence[ev["node"]] = ev["state"]

    # -----------------------------
    # Compute button
    # -----------------------------
    compute = st.button("Compute", key=f"compute_{panel_id}")

    if compute:
        if len(query_vars) not in [1, 2]:
            st.warning("Select 1 or 2 query variables.")
        else:
            with st.spinner("Running inference..."):
                phi = st.session_state.infer.query(
                    query_vars,
                    evidence=evidence if evidence else None
                )
            st.session_state[result_key] = {
                "phi": phi,
                "query_vars": query_vars,
                "evidence": evidence
            }
        
    # -----------------------------
    # Plot stored result
    # -----------------------------
    if result_key in st.session_state:
        result = st.session_state[result_key]
    
        query_vars = result["query_vars"]
        evidence = result["evidence"]
    
        # Build title (same style as 2D)
        title = f"P({query_vars}"
        if evidence:
            evidence_str = ", ".join(
                f"{k}={v}" for k, v in evidence.items()
            )
            title += f" | {evidence_str}"
        title += ")"
    
        # Automatic plot selection
        if len(query_vars) == 1:
            fig = plot_1D_query(
                result["phi"],
                title=title,
                xlabel=query_vars[0]
            )
    
        elif len(query_vars) == 2:
            fig = plot_two_factors(
                result["phi"],
                title=title,
                x_state=query_vars[0],
                y_state=query_vars[1]
            )
    
        else:
            st.warning("Select 1 or 2 query variables.")
            return
    
        st.pyplot(fig)


with tabs[6]:
    st.header("Query the Model")
    
    
    
    if "infer" not in st.session_state or st.session_state.infer == None:
        st.warning("Train the model first.")
        st.stop()
        
    else:
        st.session_state.nodes = st.session_state.model.nodes
        row1 = st.columns(2)
        row2 = st.columns(2)
        
        with row1[0]:
            query_panel(0)
        
        with row1[1]:
            query_panel(1)
    
        with row2[0]:
            query_panel(2)
    
        with row2[1]:
            query_panel(3)    
    
    # query_vars = st.multiselect(
    #     "Query variables (max 2)",
    #     st.session_state.nodes,
    #     max_selections=2
    # )
    
    # evidence_node = st.selectbox("Evidence node", st.session_state.nodes)
    # evidence_state = st.selectbox(
    #     "State",
    #     st.session_state.model.states[evidence_node]
    # )
    
    # phi = st.session_state.infer.query(
    #     query_vars,
    #     evidence={evidence_node: evidence_state}
    # )
    
    # fig = plot_two_factors(
    #     phi,
    #     title=f"P({query_vars} | {evidence_node}={evidence_state})",
    #     x_state=query_vars[0],
    #     y_state=query_vars[1]
    # )
    
    # st.pyplot(fig)

