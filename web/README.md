# BayesNet Studio — browser prototype

A visual Bayesian network workspace. Import CSV data, configure variables, draw a graph, **train CPTs from the data**, and query posterior marginal distributions. Everything runs locally in the browser. The existing Streamlit application remains unchanged in the parent directory.

## Develop

Install Node.js 22.12+ (Node 24 LTS recommended) and npm. From this directory:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. End users of a hosted build need only a modern browser, not Node.js or Python. Use HTTPS for remote hosting; local development uses localhost. Direct `file://` opening is unsupported.

## Try it

1. Click **Load engineering example**, or import your own UTF-8 CSV. Delimiter detection, quoted fields and a UTF-8 BOM are supported. Headers must be unique and nonblank.
2. Add columns to the graph. Numeric columns default to three equal-width bins; inspect a node to change the representation, cuts or binning method. Bin fitting uses the source column’s nonmissing values; training later excludes incomplete selected-variable records. Categorical and finite numeric variables require 2–64 states; constant columns must be excluded in this prototype.
3. Connect source handles to target handles, or use **Connections · keyboard controls**. Select variables using the inspector dropdown if you prefer the keyboard. Cycles remain editable/saveable but block training and inference.
4. Click **Train CPTs**, review retained/excluded record counts, choose MLE or Dirichlet, then **Train model**. Training replaces CPTs together, never partially. CPTs are learned, not manually entered.
5. Set shared evidence and select target marginals. Numeric evidence is mapped through the saved bin boundaries. Click **Run inference** to compare priors and posteriors.
6. Download a project and export result JSON/CSV. Save the project again after changes; there is no recovery storage yet.

Empty fields are missing by default; `NA` is an ordinary category unless you add it under missing tokens. Only complete rows across the selected model variables are used. No imputation is performed. Profiles describe the import; **Review training data** uses the current missing-token policy.

MLE cannot resolve parent combinations absent from the data. Choose explicit Dirichlet smoothing instead (default α=1 **per child-state cell**). Smoothing is not a uniform-prior override or BDeu equivalent sample size. Read-only CPT tables show probabilities, raw cell counts and parent totals; large tables preview the first 100 assignments, with complete values in project JSON.

Project downloads omit the raw CSV by default. They still contain model parameters and labels, which may be sensitive. Saved trained CPTs remain queryable; reattach the exact matching CSV to retrain, or opt into embedding it when saving. Browser storage is not used. No account, telemetry, CDN or data-upload endpoint is included.

## Checks

```sh
npm run typecheck
npm run test:unit
npm run test:numerical
npm run format:check
npm run build
# In a separate terminal, serve that production build:
npm run preview
# Then run Chromium tests (uses /usr/bin/chromium by default):
npm run test:e2e
```

Set `CHROMIUM_PATH` to your installed Chromium/Chrome executable. For Playwright-managed browsers, install them with `npx playwright install chromium firefox webkit` and use `BROWSER=chromium`, `BROWSER=firefox` or `BROWSER=webkit`. Tests run against the production preview, not the development server. Actual Safari needs a separate macOS check; Playwright WebKit is not Safari certification.

The numerical fixtures are generated with the existing Python 3.11 reference environment, pgmpy 1.0.0, NumPy 2.4.6 and pandas 3.1.0:

```sh
# Optional, development/reference testing only; run from web/.
/workspace/venvs/bayesnet/bin/python tools/reference/generate.py
```

Python is not shipped or invoked by the web application. See [verification](docs/verification.md), [architecture](docs/decisions/001-browser-engine.md), and [hosting](docs/hosting.md).

## Current boundaries

Prototype: CSV only, manually specified graph, data-trained CPTs, hard evidence, and separate target marginals. Manual CPT editing, joint queries, structure learning, IndexedDB recovery, PWA/offline installation and optimisation are deferred. Numerical guards are ceilings, not performance guarantees. Surrogate training and optimisation remain a separate later phase; raw CSV data and fitted transformation provenance are retained for it.

Development lives on `prototype/browser-bayesnet`, based on main commit `a196531fdf3dbce9d53088ea2e07a230953caf6f`. No desktop fallback is currently needed for the verified Chromium workflow; broader browser/release checks remain documented separately.
