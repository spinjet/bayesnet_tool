# Existing Python behaviour and intended differences

Reference checkout: `spinjet/bayesnet_tool`, main commit `a196531fdf3dbce9d53088ea2e07a230953caf6f`. Inspected actual implementation rather than README claims.

- `bayesnet_tool/data.py`: pandas `read_csv`; pandas default NA tokens; drop columns only when missing percentage is strictly greater than the supplied threshold; drop any row containing NA. Includes sustainability indicators and sampled requirement columns, excluded from this prototype.
- `bayesnet_tool/discretisation.py`: equal-width cuts between min/max, NumPy digitize (exact cuts enter the upper bin), finite-range display labels. The browser keeps the exact-cut rule, adds manual/linear-quantile cuts, explicitly covers outside-range values, and saves fitted thresholds.
- `bayesnet_tool/structure.py`: DAG validation, dependency matrix conversion and structure JSON. No implemented structure-learning algorithm was found in this module despite README wording.
- `bayesnet_tool/training.py`: `DiscreteBayesianNetwork.fit` with `MaximumLikelihoodEstimator` by default; `VariableElimination` for inference. Optional uniform CPD overwrite is not the same as Dirichlet smoothing and is not ported.
- `bayesnet_tool/ui.py`: tabs for loading, sustainability, requirements, structure, discretisation, training and querying; query UI supports one or two variables and multiple panels. The first browser prototype supported multiple marginal cards; PDOPT-BN now adds exact joint-query groups through the conditioning adapter documented in ADR 002.
- Existing six Python tests are placeholders. Their passing status is not numerical evidence. New synthetic fixtures and an independent enumerator provide meaningful comparisons.

Python reference environment: CPython 3.11.17, pgmpy 1.0.0, NumPy 2.4.6, pandas 3.1.0. pgmpy 1.1.2 changed the estimator API and does not work with the original training wrapper; 1.0.0 was verified during environment setup.

`tools/reference/generate.py` exports explicit ordered CPTs and complete marginal vectors from pgmpy. Inference parity uses identical CPTs; training tests separately check hand-counted MLE/Dirichlet formulas. Do not confuse changed preprocessing/prior settings with an inference discrepancy.

Intentional changes: only explicitly configured missing tokens (empty field initially), complete records over selected model variables, no implicit pandas NA coercion, stable IDs independent of labels, explicit per-cell Dirichlet smoothing and blocking unresolved MLE configurations. State labels are ordered deterministically by JavaScript string ordering (finite numeric states by numeric value). Reference fixtures specify ordering explicitly.

`pdopt-code-dev` is unchanged. Its optimisation/surrogate code remains reference material for a later phase, not a browser runtime dependency.
