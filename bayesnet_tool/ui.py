"""Streamlit user interface wrappers for the BayesNet tool.

Each tab of the application is implemented as a function that can be
called from :mod:`app`.

This module should import the core logic from the other modules and keep
widget-specific state handling here.  Unit tests can exercise these
functions using the ``streamlit`` testing helpers or by mocking.
"""

import streamlit as st

# Imports from package modules will go here once they are implemented


def tab_data_loading():
    """Widget code for the 'Data Loading' tab."""
    raise NotImplementedError


def tab_sustainability():
    raise NotImplementedError


def tab_requirements():
    raise NotImplementedError


def tab_structure():
    raise NotImplementedError


def tab_discretisation():
    raise NotImplementedError


def tab_training():
    raise NotImplementedError


def tab_query():
    raise NotImplementedError
