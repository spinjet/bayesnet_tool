"""Entry point for the Streamlit application."""

try:
    # prefer relative import when run as module
    from . import ui
except ImportError:
    # allow running the file directly (e.g. python app.py)
    from bayesnet_tool import ui

import streamlit as st


def main():
    st.set_page_config(layout="wide")
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

    # call functions corresponding to each tab
    with tabs[0]:
        ui.tab_data_loading()
    with tabs[1]:
        ui.tab_sustainability()
    with tabs[2]:
        ui.tab_requirements()
    with tabs[3]:
        ui.tab_structure()
    with tabs[4]:
        ui.tab_discretisation()
    with tabs[5]:
        ui.tab_training()
    with tabs[6]:
        ui.tab_query()


if __name__ == "__main__":
    main()
