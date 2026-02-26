"""Data handling utilities for the BayesNet tool.

Responsibilities:

* loading CSVs
* missing-data analysis and cleaning
* computing sustainability indicators
* applying requirements
"""

import pandas as pd
import numpy as np


def load_csv(path_or_buffer):
    """Read a CSV into a DataFrame. Retains original behaviour of the demo script."""
    return pd.read_csv(path_or_buffer)


# TODO: implement NaN summary, drop functions, indicator computation, requirements
