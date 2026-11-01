# ADR 002: PDOPT-BN workspaces, presentation metadata and joint queries

## UI and data separation

`BuildWorkspace` owns CSV preparation, graph editing and variable configuration. `InferenceWorkspace` owns estimator/evidence/query controls and selected output; its graph is read-only. Components remain mounted across main-tab switches so controls, filtering and viewport state are retained. Two independent Vue Flow instances prevent editing/projection state from leaking between workspaces. The controls occupy roughly one-third of the analysis workspace, with adjustable height; primary actions stay accessible while settings scroll.

Source `states` and ordered integer state IDs remain authoritative for encoding. `stateLabels` are display aliases only. Categorical aliases must be nonblank and unique. Numeric interval labels are derived from stored thresholds and per-variable `displayDecimals` (0–12, default 2); formatting never rounds stored data or thresholds. Exact cuts remain inspectable. Layout, aliases and precision changes do not invalidate CPTs or numerical output.

## Uniform CPT semantics

`parameterMode` is `learned` or `uniform`. Training always retains original cell/parent counts. Uniform mode fills each parent row with 1/r, records `origin: uniform` and α=0 (unused), and permits rows without observations. Other variables are trained on the original complete records. It is not dataset reweighting, an intervention, or a guarantee of uniform posteriors.

Parameter mode is included only in that variable's CPT signature. Toggling it invalidates its CPT/results and requires training; children's learned counts/CPTs are unchanged when their own schema is unchanged. Project validation checks the mode/provenance agreement and equal probabilities in uniform rows.

## Exact joint inference

The pinned jsAgrum API exposes marginal posteriors, not joint tables. Reuse the published package unmodified. A target-prefix traversal computes P(T1,…,Tk|E) using exact conditional marginals and the probability chain rule. Each prefix is evaluated once; the final axis is read without another inference call. Zero-probability branches are skipped, observed axes remain explicit with zeroes for inconsistent states, and added evidence is removed in `finally` before returning to a parent prefix.

All-node prior/posterior marginals and each group's prior/posterior joint tensor are returned together. Tensor axes follow each group's ordered target IDs, last axis fastest. Guard impossible shared evidence before conditioning; reject nonfinite, out-of-range, unnormalised or underflowed distributions instead of silently repairing them. Native models are disposed in `finally`; the application retains worker termination/restart, 30-second watchdog and revision checks. Late/failed jobs never partially commit graph or group results.

Before creating a native model, enforce 10 groups, 4,096 cells per group and 8,192 total cells. Display estimates before running. These bounds do not promise completion within the watchdog for every graph. Filters are display-only and never renormalise; exporting returns the complete distribution with provenance.

## Version 2 and migration

Schema 2 adds state labels, decimal precision, parameter mode and ordered named `queryGroups`, replacing project-level `targetIds`. Saved results remain ephemeral.

Keep a frozen v1 validator/signature implementation. Validate a legacy file first, migrate metadata, recompute signatures under learned mode, then run v2 validation. CPT numbers, source state values/order, cuts, evidence, dataset descriptors and positions are preserved. Legacy states with blank/trim-colliding labels receive deterministic nonblank unique display aliases; source values remain unchanged.

Each legacy target becomes its own query group. To avoid losing work from old projects with up to 100 targets, stored drafts may retain up to 100 groups. The inference guard still blocks more than 10 and the UI cannot add groups above that limit; users remove surplus migrated groups explicitly. New projects start with one single-target view when the first variable is added.

No backend, native compilation, desktop switch, public website deployment or optimisation feature is introduced.
