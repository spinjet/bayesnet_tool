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


def nan_summary(df: pd.DataFrame) -> pd.DataFrame:
    """Return a summary dataframe with NaN counts and percentages per column."""
    total_rows = len(df)
    nan_per_col = df.isna().sum()
    nan_percent = (nan_per_col / total_rows) * 100
    summary = (
        pd.DataFrame({
            "NaN Count": nan_per_col,
            "NaN %": nan_percent.round(2)
        })
        .sort_values("NaN %", ascending=False)
    )
    return summary


def drop_columns_with_nan(df: pd.DataFrame, threshold: float):
    """Return a copy of ``df`` with columns dropped where NaN % &gt; threshold.

    Also returns the list of dropped columns.
    """
    summary = nan_summary(df)
    cols_to_drop = summary[summary["NaN %"] > threshold].index.tolist()
    return df.drop(columns=cols_to_drop), cols_to_drop


def drop_rows_with_nan(df: pd.DataFrame) -> (pd.DataFrame, int):
    """Drop any row containing at least one NaN and return new DF + count removed."""
    df_clean = df.dropna().reset_index(drop=True)
    removed = len(df) - len(df_clean)
    return df_clean, removed


def compute_sustainability_indicators(
    df: pd.DataFrame,
    indicator_config: dict
) -> pd.DataFrame:
    """Compute and append sustainability indicator columns based on config.

    ``indicator_config`` maps each indicator name to a dict of
    variable-&gt;effect ("Positive" or "Negative").
    """
    out = df.copy()

    for indicator, factors in indicator_config.items():
        if not factors:
            continue

        k_values = []
        for factor, effect in factors.items():
            col = out[factor]
            min_val = col.min()
            max_val = col.max()

            if max_val == min_val:
                k = pd.Series(0.0, index=out.index)
            else:
                k = (col - min_val) / (max_val - min_val)

            if effect == "Negative":
                k = 1 - k

            k_values.append(k)

        indicator_value = pd.concat(k_values, axis=1).mean(axis=1)
        out[indicator] = indicator_value

    return out


def apply_requirements(df: pd.DataFrame, requirements: list) -> pd.DataFrame:
    """Given a list of requirement dicts, add columns to ``df`` to mark passes.

    Each requirement dict should contain keys ``name``, ``variable``, ``operator``
    ("&gt;" or "<"), ``distribution`` ("constant", "uniform", "triangular"),
    ``value`` and optional ``variability``. The function returns a modified copy
    of the dataframe with new ``{name}_requirement`` columns (and intermediate
    distribution columns if needed).
    """
    out = df.copy()

    for req in requirements:
        name = req.get("name")
        var = req.get("variable")
        op = req.get("operator")
        dist = req.get("distribution")
        val = req.get("value")
        varb = req.get("variability")

        if not name or var not in out.columns:
            continue

        if dist == "uniform":
            lower = val - varb
            upper = val + varb
            dist_col = f"{name}_dist"
            out[dist_col] = np.random.uniform(lower, upper, size=len(out))
            compare_target = out[dist_col]
        elif dist == "triangular":
            lower = val - varb
            upper = val + varb
            dist_col = f"{name}_dist"
            out[dist_col] = np.random.triangular(lower, val, upper, size=len(out))
            compare_target = out[dist_col]
        else:  # constant
            compare_target = val

        req_col = f"{name}_requirement"
        if op == ">":
            out[req_col] = (out[var] > compare_target).astype(int)
        else:
            out[req_col] = (out[var] < compare_target).astype(int)

    return out
