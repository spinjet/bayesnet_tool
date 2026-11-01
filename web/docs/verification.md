# Prototype verification

Validated in the managed Linux environment on 1 November 2026. This is a self-hosting prototype report, not public-release certification.

## Final check results

- Clean `npm ci`, TypeScript checks, formatting checks and the production build passed.
- **19 unit/numerical tests passed**, including 12 seeded DAG comparisons within one numerical scenario.
- **7 Chromium end-to-end tests passed at `/` and the same 7 passed at `/bayesnet/`**.
- System browser: Chromium 154.0.8037.57 (version recorded separately if the environment updates).

## Engine decision

Proceed with published jsAgrum 0.1.3 for the demonstrated browser workflow. Real production builds load JS, WASM and workers from both `/` and `/bayesnet/`. No custom engine build or package-source patch is needed. The application adapter guards the beta binding's impossible-evidence behaviour; see ADR 001.

The full browser workflow covers CSV import, graph authoring, data-trained CPTs, shared multiple evidence, multiple target marginals, numeric binning/evidence, project persistence, invalid drafts, cancellation and stale-result rejection. Browser tests inspect page errors and external requests on the complete categorical workflow; only same-origin static assets are requested.

## Numerical evidence

- Four pgmpy golden scenarios: no evidence, one root observed, a nonbinary child observed, and simultaneous root/child evidence.
- The fixture has two unequal-cardinality parents and a nonbinary child; compares all 32 returned probability cells, including observed targets.
- Measured maximum absolute error against pgmpy: **5.551115123125783e-17**.
- Independent exhaustive enumeration also compares complete distributions. Twelve seeded four-node DAGs add varying edges, cardinalities, disconnected components and multiple evidence.
- Deterministic zero-probability evidence is rejected. A subsequent valid query succeeds with a fresh model.
- Separate hand-counted training fixtures verify MLE, α-per-cell Dirichlet smoothing, complete-row exclusion and unresolved MLE configurations.
- Unit assertions use ten decimal places, stricter than the specification's `1e-10 + 1e-8 * abs(reference)` comparison budget. Native output validation also checks finite [0,1] values and row sums within 1e-9.

Reference metadata is embedded in `fixtures/reference.json`. Python generation is development-only, not a deployed API.

## Reproducible checks

From `web/`: `npm ci`, `npm run typecheck`, `npm run test:unit`, `npm run format:check`, `npm run build`. Serve the production build with `npm run preview`, then run `npm run test:e2e`. Repeat with `APP_BASE=/bayesnet/` on build/preview and `TEST_PATH=/bayesnet/` on tests.

The suite checks hand counts, bin boundaries/outside ranges, repeated/constant observations, invalid numerics, CSV quoting/BOM/duplicate headers, selective invalidation, cancellation/watchdog, corrupt/future project files, and reference distributions. Browser tests exercise real workers/WASM rather than mocked probabilities.

## Limitations and release work

- Chromium is available and tested in this environment. Playwright's additional browser download was denied by network policy at `cdn.playwright.dev`; Firefox, WebKit and actual Safari checks are **unrun**, not passed. A draft allowlist addition for that domain and `playwright.download.prss.microsoft.com` is saved for environment review; draft saving alone does not update runtime access. Run the documented browser variants once access is applied.
- Published package is beta. Direct impossible-evidence handling is defective; conditional-probability guarding is mandatory. Native algorithm is identified as Lazy Propagation in pinned source, with double-precision JS bindings and numerical verification.
- Explicit disposal and repeated jobs/cancellation are tested; long-duration native-memory profiling is not complete.
- Licence texts and core copyright/MIT notices are shipped. Final transitive/core binary provenance and EPL corresponding-source review precede public distribution.
- Constant/single-state columns are excluded; engine variables require 2–64 states. Inputs are capped at 100 MiB, 1,000,000 rows and 500 columns, models at 100 variables/1,000 edges, each learned CPT at 1,000,000 cells and total CPTs at 5,000,000 cells. These are allocation guards, not promises that every workload at the ceiling completes in 30 seconds.
- Essential operations have labelled form controls and keyboard alternatives. Formal WCAG review, actual Safari testing, hardware-calibrated performance benchmarks, and production-server CSP validation remain release tasks.
- No site has been published. No PWA/offline promise, optimisation, joint queries or browser recovery storage is included.
