# ADR 001: browser computation with a guarded jsAgrum adapter

## Decision and evidence

Use the published `jsagrum@0.1.3` package, pinned in the npm lockfile. Its registry tarball integrity is SHA-512 `N4FG5zpl0zjkuQkLIoIuShwBpvkW4nbriiu1TfT/F6ag8ir33PlFDTJ3a+DCKFLlRMP9bggdGy4vW5CqPiKeyw==`. The package includes precompiled WASM (~1.95 MB), public TypeScript declarations, a double-precision model class and explicit `destroy()` disposal.

The root/subpath production-build probes and browser workflows use the actual published JS/WASM. No engine source was patched, no aGrUM compilation was performed, and no Python/server fallback is used.

Application code owns the computation worker and calls `createInProcessBN`. The package's bundled worker has a likely incorrect relative module path (`dist/workers` to `../../lib`); we do not use it. Copying the unmodified published directory structure into the static build preserves the loader's relative WASM path without relying on undocumented package subpath exports. All assets are same-origin.

CSV parsing/profiling, variable fitting, row encoding and CPT counting run in the application worker. ELK uses its supported standalone layout worker, created only for layout and terminated afterward. Loading bundled ELK inside the computation worker can replace its message handler; the standalone-worker integration avoids that global side effect.

## Inference correctness

Upstream binding source at npm `gitHead` `df3c918eeb9e90bc81bd48cbace848ee9db78a42`, `src/JSBayesNet.cpp`, constructs `LazyPropagation<T>`; the published JS selects `BayesNetDouble`. Runtime validation uses numerical fixtures rather than treating source alone as proof.

The beta binding **does not reliably reject impossible evidence**. Direct probes returned plausible probabilities for zero-probability root evidence and contradictory deterministic evidence. The adapter instead performs an inference before applying each assignment, verifies its conditional probability, and rejects a zero conditional probability as `IMPOSSIBLE_EVIDENCE`. This follows the probability chain rule and avoids multiplying small probabilities. Invalid/unnormalised engine outputs are rejected, never clipped or silently normalised. Extremely small probabilities remain subject to engine floating-point limits.

Build a fresh native model for each query and destroy it in `finally`. Read the engine's parent ordering back and explicitly map canonical tensors to its ordering. Repeated valid/invalid queries are tested. Cancellation terminates the whole computation worker; retry creates a fresh one. A 30-second watchdog bounds stuck jobs. No reliable continuous progress percentage is exposed, so the UI shows an indeterminate busy state.

## Domain and training contracts

- The project is authoritative; Vue Flow and native models are projections.
- Variable IDs are UUIDs. Column IDs are stable `c0`, `c1`, … within a hashed dataset. State IDs are immutable ordered integer indices within a variable revision; changing state membership/order invalidates that schema. Display-name changes do not change state identity.
- Parent IDs are sorted deterministically. Canonical CPT arrays are child-state-fastest; the last parent varies fastest. The adapter maps this order to engine tensors, whose first parent varies fastest.
- Complete rows across selected model variables are encoded. Empty fields are the default missing token; no implicit NA conversion or imputation.
- Equal-width/linear-interpolated quantile/manual cuts are fitted explicitly. Exact cuts enter the upper bin. Cuts are fitted to finite nonmissing values in the selected source column when variable settings are applied; training subsequently excludes incomplete selected-variable records. This explicit prototype processing order differs from fitting on the final complete-row subset. Saved cuts apply to numeric evidence and reattached data without refitting. Coincident quantile cuts collapse with the effective count visible; boundary cuts may produce empty states, which are shown in the training preview. Constant columns are rejected with an exclusion explanation.
- MLE uses N(j,k)/N(j) and blocks unobserved rows. Dirichlet uses (N(j,k)+α)/(N(j)+rα), α>0 per cell. Default α=1 is visible.
- Training commits atomically only for matching input revisions. Model/data/query revisions invalidate computations; display/layout edits preserve probabilities. Signatures invalidate only affected CPTs, while missing-policy changes clear all learned CPTs.
- File and worker inputs use Zod runtime validation. Cyclic drafts can be saved. Unsupported schema versions, malformed CPTs, unknown evidence states and oversized allocations are rejected.

## Distribution

jsAgrum's package licence is MIT. Its pinned source build script defaults aGrUM to `f156b12f60e421117dedd7e30f440bc2447af09e`, whose copyright declares LGPL-3.0-or-later OR MIT. Preserve the package and core MIT/copyright notices; the published tarball does not attest the exact core binary build, so record that provenance limit for release review. Runtime dependency licence texts and manifest are copied into `dist/notices`; ELK is EPL-2.0 and its package source URL is retained for corresponding-source access. Third-party terms still require release review for the exact shipped artefacts.

## Consequences and fallback

Keep browser architecture for the demonstrated workflow. Additional browser coverage and public-release review remain outstanding where not verified; do not call the prototype cross-browser certified.

If essential browser capabilities later require patching the published engine or custom compilation, stop browser expansion and issue a desktop handoff. Preserve the Vue interface, canonical projects, fixtures and worker-neutral computation contracts. A desktop shell would start a bundled local Python backend (pgmpy initially; scikit-learn/pymoo for the later surrogate phase), with strict local transport and explicit packaging targets. It is a separately scoped fallback, not a second implementation in this branch.
