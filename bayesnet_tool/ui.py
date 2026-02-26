"""Streamlit user interface wrappers for the BayesNet tool.

Each tab of the application is implemented as a function that can be
called from :mod:`app`.

This module should import the core logic from the other modules and keep
widget-specific state handling here.  Unit tests can exercise these
functions using the ``streamlit`` testing helpers or by mocking.
"""

import streamlit as st
import networkx as nx
import pandas as pd
import numpy as np

# Imports from package modules will go here once they are implemented


def tab_data_loading():
    """Widget code for the 'Data Loading' tab."""
    from .data import load_csv, nan_summary, drop_columns_with_nan, drop_rows_with_nan

    st.header("Data Loading")
    uploaded_file = st.file_uploader(
        "Upload CSV",
        type="csv",
        key="csv_uploader"
    )

    if uploaded_file is None:
        st.info("Please upload a CSV file to continue.")
        st.stop()

    if "df" not in st.session_state:
        st.session_state.df = load_csv(uploaded_file)

    df = st.session_state.df
    st.success("Dataset loaded")
    st.write(df)
    st.session_state.col_nodes = df.columns

    st.subheader("Missing Data Management")
    df_copy = st.session_state.df.copy()
    total_rows = len(df_copy)
    nan_summary_df = nan_summary(df_copy)
    st.write("NaN summary per column:")
    st.dataframe(nan_summary_df)

    threshold = st.slider(
        "Drop columns with more than this % of NaNs",
        min_value=0,
        max_value=100,
        value=50
    )

    if st.button("Drop Columns with Excessive NaNs"):
        new_df, cols_to_drop = drop_columns_with_nan(df_copy, threshold)
        if not cols_to_drop:
            st.info("No columns exceed the selected threshold.")
        else:
            st.session_state.df = new_df
            st.session_state.col_nodes = list(new_df.columns)
            st.success(f"Dropped {len(cols_to_drop)} columns.")
            st.rerun()

    remaining_nan_rows = st.session_state.df.isna().any(axis=1).sum()
    st.write(f"Rows still containing NaNs: {remaining_nan_rows}")

    if st.button("Drop Remaining Rows with NaNs"):
        df_clean, removed = drop_rows_with_nan(st.session_state.df)
        st.session_state.df = df_clean
        st.session_state.col_nodes = list(df_clean.columns)
        st.success(f"Dropped {removed} rows with NaNs.")
        st.rerun()


def tab_sustainability():
    from .data import compute_sustainability_indicators

    st.header("Add Sustainability Indicators")
    indicators = [
        "Sustainability.Performance", "Sustainability.Environment",
        "Sustainability.Cost", "Sustainability.Society"
    ]

    if "indicator_config" not in st.session_state:
        st.session_state.indicator_config = {name: [] for name in indicators}

    for indicator in indicators:
        st.subheader(indicator)
        selected_vars = st.multiselect(
            f"Select factors affecting {indicator}",
            options=st.session_state.df.columns,
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
        df = compute_sustainability_indicators(
            st.session_state.df, st.session_state.indicator_config
        )
        st.session_state.df = df
        st.session_state.col_nodes = list(df.columns)
        st.success("Sustainability indicators computed and added.")
        st.rerun()


def tab_requirements():
    from .data import apply_requirements

    st.header("Define Requirements")

    if "df" not in st.session_state:
        st.warning("Load data first.")
        st.stop()

    if "requirements" not in st.session_state:
        st.session_state.requirements = []
    if "req_list" not in st.session_state:
        st.session_state.req_list = [{}]

    def requirement_editor(req_id):
        cols = st.columns([2,2,1,2,1])
        with cols[0]:
            name = st.text_input("Requirement name", key=f"req_name_{req_id}")
        with cols[1]:
            variable = st.selectbox("Variable", st.session_state.df.columns,
                                    key=f"req_var_{req_id}")
        with cols[2]:
            operator = st.selectbox("Operator", [">", "<"], key=f"req_op_{req_id}")
        with cols[3]:
            distribution = st.selectbox("Distribution", ["constant", "uniform", "triangular"],
                                        key=f"req_dist_{req_id}")
        with cols[4]:
            value = st.number_input("Value", key=f"req_val_{req_id}")
        variability = None
        if distribution in ["uniform", "triangular"]:
            variability = st.number_input("± variability", key=f"req_varb_{req_id}")
        return {
            "name": name,
            "variable": variable,
            "operator": operator,
            "distribution": distribution,
            "value": value,
            "variability": variability
        }

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
        df = apply_requirements(st.session_state.df, st.session_state.req_list)
        st.session_state.df = df
        st.session_state.nodes = list(df.columns)
        st.success("Requirements applied successfully.")


def tab_structure():
    from .structure import BayesianNetworkStructure
    from .plotting import draw_network

    st.header("Model Structure")

    if "df" not in st.session_state:
        st.warning("Load data first.")
        st.stop()

    if "dsm_selected_vars" not in st.session_state:
        st.session_state.dsm_selected_vars = list(st.session_state.nodes)

    st.subheader("Save / Load Bayesian Network Structure")
    col1, col2 = st.columns(2)
    with col1:
        st.markdown("#### Save structure")
        filename = st.text_input("Filename", value="bayesian_network.json")
        if st.button("Save structure"):
            if not st.session_state.edges:
                st.warning("No edges to save.")
            else:
                bn = BayesianNetworkStructure(
                    st.session_state.nodes,
                    st.session_state.edges,
                    st.session_state.node_config,
                )
                bn.save(filename)
                st.success(f"Structure saved to {filename}")
    with col2:
        st.markdown("#### Load structure")
        uploaded_json = st.file_uploader("Upload BN JSON", type="json",
                                         key="bn_json_uploader")
        if st.button("Load structure", key="load_structure_button"):
            if uploaded_json is None:
                st.warning("Please upload a JSON file first.")
            else:
                try:
                    import json
                    data = json.load(uploaded_json)
                    nodes = data["nodes"]
                    edges = [tuple(e) for e in data["edges"]]
                    node_config = data.get("node_config", {})
                    G = nx.DiGraph(edges)
                    if not nx.is_directed_acyclic_graph(G):
                        st.error("Uploaded network is not a DAG.")
                    else:
                        st.session_state.nodes = nodes
                        st.session_state.edges = edges
                        st.session_state.node_config = node_config
                        st.session_state.col_nodes = list(nodes)
                        st.session_state.dsm_selected_vars = list(nodes)
                        dsm_df = pd.DataFrame(0, index=nodes, columns=nodes)
                        for parent, child in edges:
                            if parent in nodes and child in nodes:
                                dsm_df.loc[child, parent] = 1
                        st.session_state.dsm_df = dsm_df
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
    )
    if not selected_vars:
        st.warning("Select at least one variable.")
        st.stop()
    variables = selected_vars
    n = len(variables)

    st.subheader("Structure Connections Matrix")
    st.write("Column: Parent node, Row: Child node")
    if st.button("Update Available Nodes"):
        st.session_state.nodes = list(variables)
        st.session_state.dsm_matrix = np.zeros(
            (len(st.session_state.col_nodes), len(st.session_state.col_nodes)),
            dtype=int
        )
        st.success("Available nodes updated and matrix reset.")
        st.rerun()

    variables = st.session_state.dsm_selected_vars
    edges = st.session_state.get("edges", [])
    dsm_df = pd.DataFrame(0, index=variables, columns=variables)
    for parent, child in edges:
        if parent in variables and child in variables:
            dsm_df.loc[child, parent] = 1
    st.session_state.dsm_df = dsm_df

    st.subheader("Structure Matrix")
    edited_df = st.data_editor(
        st.session_state.dsm_df,
        use_container_width=True,
        num_rows="fixed",
        key="dsm_editor"
    )
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

    if st.button("Reset Structure"):
        st.session_state.edges = []
        st.session_state.nodes = []
        st.session_state.dsm_matrix = np.zeros((n, n), dtype=int)
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
        st.pyplot(fig)


def tab_discretisation():
    from .discretisation import build_discrete_df
    st.header("Data Discretisation and Node Type")
    if "edges" not in st.session_state or not st.session_state.edges:
        st.warning("Define the network structure first.")
        st.stop()
    if "node_config" not in st.session_state:
        st.session_state.node_config = {}

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

        col_labels = ["Node Name", "Type", "Number of Bins", "Decimal Precision", "Force Non-Informative Uniform"]
        cols = st.columns([2, 2, 1.5, 1.5, 1])
        for i, col in enumerate(cols):
            with col:
                st.markdown(f"**{col_labels[i]}**")

        for node in topo_nodes:
            if node not in st.session_state.node_config:
                st.session_state.node_config[node] = {"type": "Discrete", "uniform_prior": False}
            cfg = st.session_state.node_config[node]
            col1, col2, col3, col4, col5 = st.columns([2, 2, 1.5, 1.5, 1])
            with col1:
                st.markdown(f"**{node}**")
            with col2:
                node_type = st.selectbox(
                    "Type",
                    ["Discrete", "Continuous"],
                    index=0 if cfg["type"] == "Discrete" else 1,
                    key=f"type_{node}",
                    label_visibility="collapsed"
                )
                cfg["type"] = node_type
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
            with col5:
                uniform = st.checkbox(
                    "Uniform",
                    value=cfg.get("uniform_prior", False),
                    key=f"uniform_{node}",
                    label_visibility="collapsed"
                )
                cfg["uniform_prior"] = uniform
            st.session_state.node_config[node] = cfg


def tab_training():
    from .training import BayesianNetworkModel

    st.header("Train Bayesian Network")
    if "node_config" not in st.session_state:
        st.warning("Configure nodes first.")
        st.stop()

    if st.button("Run Discretisation"):
        from .discretisation import build_discrete_df
        st.session_state.disc_df, st.session_state.discretisers = build_discrete_df(
            st.session_state.df, st.session_state.node_config
        )
        st.write(st.session_state.disc_df)
        st.write(st.session_state.nodes)

    if st.button("Train Bayesian Network"):
        model = BayesianNetworkModel(st.session_state.edges)
        model.fit(st.session_state.disc_df)
        model.apply_uniform_priors(st.session_state.node_config)
        st.session_state.model = model.model
        st.session_state.infer = model.infer
        st.write(model.model.check_model())
        st.success("Model trained successfully.")


def tab_query():
    from .plotting import plot_two_factors, plot_1D_query

    def query_panel(panel_id):
        st.subheader(f"Query {panel_id+1}")
        query_vars = st.multiselect(
            "Query variables (1 or 2)",
            st.session_state.nodes,
            max_selections=2,
            key=f"qvars_{panel_id}"
        )
        evidence_key = f"evidence_{panel_id}"
        result_key = f"result_{panel_id}"
        if evidence_key not in st.session_state:
            st.session_state[evidence_key] = [{"node": None, "state": None}]
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
                    st.selectbox("State", [], disabled=True,
                                 key=f"ev_state_{panel_id}_{i}")
            with cols[2]:
                if st.button("✖", key=f"remove_ev_{panel_id}_{i}"):
                    st.session_state[evidence_key].pop(i)
                    st.rerun()
            st.session_state[evidence_key][i] = {"node": node, "state": state}
        if st.button("➕ Add evidence", key=f"add_ev_{panel_id}"):
            st.session_state[evidence_key].append({"node": None, "state": None})
            st.rerun()
        evidence = {}
        for ev in st.session_state[evidence_key]:
            if ev["node"] is not None and ev["state"] is not None:
                evidence[ev["node"]] = ev["state"]
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
        if result_key in st.session_state:
            result = st.session_state[result_key]
            query_vars = result["query_vars"]
            evidence = result["evidence"]
            title = f"P({query_vars}"
            if evidence:
                evidence_str = ", ".join(f"{k}={v}" for k, v in evidence.items())
                title += f" | {evidence_str}"
            title += ")"
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

    st.header("Query the Model")
    if "infer" not in st.session_state or st.session_state.infer is None:
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
