# PDOPT-BN — browser prototype

A local-first Bayesian network workspace. Import CSV data, build a graph, train CPTs, and explore individual or **joint** posterior probabilities. Everything runs in your browser. The original Python/Streamlit application remains unchanged in the parent directory.

## Develop

Install Node.js 22.12+ (Node 24 LTS recommended) and npm. From `web/`:

```sh
npm ci
npm run dev
```

Open the address Vite prints. Hosted users need only a modern browser, not Node.js or Python. Use HTTPS outside localhost; direct `file://` opening is unsupported.

## Build workspace

The three panes contain dataset controls, the editable network, and variable settings.

1. Import UTF-8 CSV or click **Load engineering example**. Delimiters, quoted fields and UTF-8 BOMs are supported; headers must be unique and nonblank.
2. Add columns as variables. Numeric columns default to three equal-width bins. The inspector offers categorical, finite numeric and discretised representations, with manual, equal-width or quantile cuts.
3. Edit categorical **state display names**, keeping original source values visible. Click **Apply state names** to commit nonblank, unique aliases. This does not change encoding, evidence or CPTs.
4. Set **Decimal places** per numeric variable (0–12, default 2). Thresholds remain full precision; **Exact thresholds** shows stored cuts. Warnings identify indistinguishable rounded boundaries. Exact cuts enter the upper bin.
5. Connect nodes through graph handles or **Connections · keyboard controls**. Cyclic drafts can be saved, but cannot train or run inference.
6. Choose **Learn from data** or **Force uniform CPT** per variable. Changing the mode requires training again.

Uniform mode assigns equal probabilities in **every parent configuration**, retains edges and original observation counts, and leaves other variables trained from the original dataset. It does not rebalance data or guarantee uniform posteriors under evidence. CPT inspection explicitly identifies uniform overrides.

Empty fields are missing initially; strings such as `NA` remain categories unless explicitly configured. Learning excludes incomplete rows across selected variables. Bin fitting uses nonmissing observations in that source column when settings are applied; later row exclusion does not silently refit cuts. Variables need 2–64 states; exclude constant columns. Source data and fitted transformations are retained for reproducibility and later surrogate work.

## Train & Inference workspace

The upper area contains a read-only probability graph and tabbed query results. The bottom controls contain training, shared evidence and query configuration. Resize their height balance with the slider; narrow screens stack the sections.

1. **Review training data**, inspect retained/excluded counts, select MLE or Dirichlet, and click **Train model**. Training commits all CPTs atomically. MLE blocks unobserved learned rows; explicit Dirichlet smoothing defaults to α=1 **per child-state cell**. Uniform rows are valid without observations.
2. Assign a single state, an allowed-state set, or a numeric threshold to any model variables. Numeric observations map through the saved cuts. All query groups share this evidence.
3. Create named query views, select targets, and reorder them using the arrow buttons. One target produces prior/posterior bars; two produce a joint heatmap; three or more produce a combination table. Tables support sorting, pagination and state filtering.
4. Click **Run inference** to update **every graph node** and every configured query group together. Observed targets are restricted to their allowed states. Evidence/model/query changes mark previous output outdated.
5. Filters do not renormalise probabilities. Displayed probability mass describes the matching combinations, while exports contain the full selected distribution.

Joint probabilities are computed exactly through conditional inference, not multiplication of separate marginals. Limits are 4,096 combinations per group, 8,192 total, and 10 groups. These are output guards, not runtime guarantees. Cancellation and a 30-second watchdog preserve work; large queries may need fewer targets/states.

## Save, reopen and export

**Save project** downloads schema-version-3 JSON. Old version-1 and version-2 projects migrate automatically, preserving learned probabilities, cuts, evidence and positions, and creating individual query views for their previous targets. Legacy files with more than 10 targets retain all views but require removing surplus groups before inference.

CSV embedding is off by default. Saved CPTs remain queryable without raw data; reattach the exact matching CSV in Build to retrain. Opting into embedding includes the entire source CSV. Project files and exports contain model parameters and labels, which may be sensitive. There is no recovery database, telemetry, account or upload endpoint.

Export the selected query as JSON/CSV. Exports retain target/state order, original source values and display labels, evidence, training provenance, fitted thresholds and full-precision probabilities. Keep project downloads as portable backups.

## Checks and hosting

```sh
npm run typecheck
npm run test:unit
npm run test:numerical
npm run format:check
npm run build
# Separate terminal: serve the production build
npm run preview
# Then run Chromium browser tests
npm run test:e2e
```

The default test browser is `/usr/bin/chromium`; set `CHROMIUM_PATH` to another local executable. For Playwright-managed browsers, install with `npx playwright install chromium firefox webkit` and set `BROWSER=chromium`, `BROWSER=firefox` or `BROWSER=webkit`. Actual Safari requires a macOS check.

The optional reference generator runs from `web/` using the existing Python 3.11 environment:

```sh
/workspace/venvs/bayesnet/bin/python tools/reference/generate.py
```

Python is not shipped or called by the web runtime. See [hosting](docs/hosting.md), [verification](docs/verification.md), and the [iteration decisions](docs/decisions/002-workspaces-joint-queries.md).

Development continues on `prototype/browser-bayesnet`; `main` and the original Python application are unchanged. Manual CPT editing, structure learning, offline installation, browser recovery and surrogate optimisation remain deferred.

## Events, graph images and sampling (0.3)

Expand **Multiple states / numeric threshold** in Shared evidence to select several allowed states (OR within one variable, AND across variables). Numeric predicates support ≥, >, < and ≤. For discretised variables an exact cut is required; a threshold splitting a bin blocks inference. **Add exact cut & retrain** preserves the predicate, adds the boundary, and invalidates affected CPTs. Reattach the source CSV if necessary. Cuts enter the upper bin; > and ≤ use the next representable IEEE-754 number so equality is handled exactly, without snapping or fractional-bin assumptions. Finite numeric states compare their actual values directly.

Set-valued evidence is computed exactly through disposable deterministic indicator leaves inside the inference worker. These leaves never appear in the model, saved file or images. Unresolved predicates can be saved as drafts. Impossible evidence preserves previous results as outdated.

Each Build node has four connection handles. Drag from any side of a parent to any side of a child. Keyboard connection controls also select From/To sides. Side choices are saved as presentation only. Click an edge in Build, then use **Delete selected connection** or press Delete/Backspace to remove it. The Connections section also lists individual Remove buttons. Removing an edge invalidates affected CPTs and query results.

**Export network image** downloads Graphviz hierarchical SVG or PNG, optionally including current all-node probabilities. It exports the structure, independently of the canvas positions. Probability export requires current inference results. Graphviz runs locally in a cancellable worker; PNG rasterisation uses the browser canvas. Large PNGs are blocked with an SVG alternative.

**Sample queried distribution** exports a ZIP containing samples.csv and manifest.json. Defaults: 1,000 rows, seed 42; maximum 100,000 rows and 100 MiB CSV. The deterministic mulberry32-v1 generator samples whole state combinations from the active query's full joint posterior; visual filters have no effect. Categorical values use display labels; finite numeric states use exact source numbers. Discretised numeric states draw uniformly within their bin intersected with finite editable bounds, defaulting to fitted min/max. This is an explicit within-bin assumption, not a learned continuous density. Bounds excluding any positive-probability state block export rather than changing the distribution. The manifest records ordering, labels, evidence, bounds, posterior, seed and training provenance.

Schema 3 adds event evidence and connection sides. Versions 1 and 2 import with unchanged CPTs and numerical behavior; missing sides default to right → left. Older applications cannot read schema 3. Keep a backup before opening with a newer version. Graphviz/Expat source links and license texts ship under public/notices/graphviz. No backend, network upload, account or website publication is added.
