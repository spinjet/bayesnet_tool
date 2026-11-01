# PDOPT-BN iteration verification

Validated in the managed Linux environment on 1 November 2026. This report covers the event-evidence and export iteration; it is not public-release certification.

## Current results

- Clean `npm ci`, TypeScript checks, formatting and production builds pass.
- **45 unit/numerical tests pass**, covering the original mathematical checks plus state aliases, display precision, uniform CPTs, project migration, query budgets and true joint distributions.
- **17 Chromium browser scenarios pass at `/` and the same 17 pass under `/bayesnet/`**.
- Browser: Chromium 154.0.8037.57 on Linux. No browser-computed probability placeholders are used.

## Numerical evidence

The pinned pgmpy 1.0.0 reference fixture has two unequal-cardinality parents and a nonbinary child. Four evidence scenarios cover no evidence, observed root, observed child and simultaneous root/child evidence. The fixture generator now exports single-, pair-, reversed-axis pair- and three-variable joint tensors, including axes fixed by evidence.

All **144 joint-probability cells** agree with pgmpy to a measured maximum absolute error of **5.551115123125783e-17**. The existing 32 marginal reference cells retain the same maximum error. Tests compare every cell, not formatted values or aggregate means. Assertions use ten decimal places; engine validation checks finite [0,1] values and sums within 1e-9, without silent normalisation.

Independent exhaustive enumeration checks joint cells and joint-to-marginal consistency on correlated deterministic models with zero branches and observed targets. The original twelve seeded DAG comparisons, isolated roots, chains/forks/colliders, disconnected components and impossible-evidence recovery remain covered.

Training fixtures independently verify hand-counted MLE/Dirichlet values, complete-row exclusion, unresolved learned rows, biased-root uniform overrides, conditional uniform rows (including unobserved parent configurations) and retained original counts. Downstream evidence can change a uniform root's posterior. Display names and decimal precision do not change encoding, fitted cuts, CPT signatures or numerical results.

## Browser coverage

The production browser suite verifies:

- CSV import, editable Build graph, training-data review, shared evidence and all-node probability updates.
- Separate workspaces retaining controls, categorical aliases, uniform-mode retraining, numeric precision and exact-boundary evidence mapping.
- Joint heatmaps, multiple query tabs, three-target filtering without renormalisation, displayed probability mass, full JSON/CSV exports and adjustable section heights.
- Data-free project reopening, embedded cyclic drafts, corruption handling, v1/v2-to-v3 migration with unchanged saved CPTs, and cycle repair.
- Cancellation, stale-response rejection and successful recovery from a missing WASM asset.
- Page-error and external-request inspection during the complete CSV workflow: only same-origin static assets are requested.

Rendered screenshots were inspected at desktop dimensions; graph node sizing was adjusted to match saved Build positions and primary actions remain outside scrollable settings. Labelled controls and main/query tab keyboard navigation are provided. Narrow screens stack sections instead of hiding analysis actions.

## Reproduce

From `web/`:

```sh
npm ci
npm run typecheck
npm run test:unit
npm run format:check
npm run build
```

Serve the production build using `npm run preview`, then run `npm run test:e2e`. For subdirectory verification, use `APP_BASE=/bayesnet/` when building and previewing, and `TEST_PATH=/bayesnet/` when testing. See the README for browser executable selection and the optional Python fixture generator.

## Remaining limitations

- Firefox, Playwright WebKit and actual Safari remain **unrun**. The active cloud network policy still lacks browser-download domains; earlier draft additions have not been applied. Actual Safari requires a macOS check. Chromium results do not establish cross-browser certification.
- jsAgrum 0.1.3 is beta and does not reliably diagnose impossible evidence directly. The adapter's conditional-probability guard remains mandatory. Joint queries use exact repeated conditioning because no public joint API is exposed.
- Query outputs are capped at 4,096 combinations per group, 8,192 total and 10 groups. Large models can still exceed the 30-second watchdog; limits are not performance guarantees. Long-duration native-memory profiling and hardware-calibrated benchmarks remain release work.
- V1 drafts with more than 10 targets preserve all migrated groups but require explicit reduction before running. Version 3 is used for new saves; older application versions cannot read it.
- Uniform mode is not balanced sampling or intervention. It removes the selected variable's dependence on its parents in its CPT, while preserving graph edges and original dataset counts.
- Runtime licence texts and core copyright/MIT notices remain shipped. Final provenance/EPL source review, formal accessibility review and production-server CSP validation precede public distribution.
- No website has been published. Structure learning, manual CPT editing, browser recovery, offline/PWA installation and surrogate optimisation remain deferred.

## Event and export checks

The added tests check exact multi-state conditioning on multiple variables against explicit joint-cell enumeration, tautological events, deterministic impossible events and recovery, and no indicator leakage into saved/displayed models. Threshold tests cover all four comparison operators, split-bin draft saves, next-representable boundaries and finite numeric states.

Seeded sampling checks joint forbidden cells, empirical frequency, reproducibility, numeric bounds/bin membership, exact finite numeric values, display labels, CSV text escaping, provenance and allocation guards. Real Graphviz output checks escaped labels, four-side ports and probability annotations. Browser tests exercise rebin/retrain, shared subsets, SVG and PNG signatures, ZIP contents, presentation persistence and same-origin-only asset requests. Graphviz is lazy loaded into the existing worker; its embedded WASM requires no custom compilation. SVG is capped at 10 MiB, PNG at 20 million pixels and 16,000 pixels per dimension.

## Hierarchical image layout

Auto export orientation follows connection-side votes; missing legacy sides remain right → left, and mixed ties prefer a vertical hierarchy. Explicit direction controls are validated at the worker boundary. Layout tests inspect actual Graphviz node coordinates in all four directions and the seven-node engineering fork/join shape (two roots, four outcomes, range). Roots and outcomes share their respective ranks, range follows its parents, and probability annotations preserve hierarchy and model state. Browser checks exercise Auto top-down output and an explicit reverse-direction export, as well as PNG, cancellation and existing connection deletion. Angled routes are used because Graphviz orthogonal routing with fixed compass ports can cross node interiors.
