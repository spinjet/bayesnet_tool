"""Entry point for the Streamlit application."""

from . import ui
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
    ui.tab_data_loading()
    ui.tab_sustainability()
    ui.tab_requirements()
    ui.tab_structure()
    ui.tab_discretisation()
    ui.tab_training()
    ui.tab_query()


if __name__ == "__main__":
    main()
