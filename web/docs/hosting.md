# Build and self-host

## Root deployment

From `web/`, with Node.js 22.12+ and npm:

```sh
npm ci
npm run typecheck
npm run test:unit
npm run build
```

Serve **all of `dist/`** using any conventional static HTTPS server. This includes `assets/`, `vendor/` and `notices/`. End users need no Python, npm, application API or serverless compute. Use HTTPS outside localhost because file hashing uses Web Crypto. No outbound API access is required at runtime. `engine-proof.html` is a synthetic verification page and can be omitted from a public site's navigation.

For a local check, run `npm run preview`. For actual self-hosting, configure Nginx/Caddy/your existing static host to serve `dist/`; Vite preview is a development verification server. There is no client-side routing or API path to rewrite. Missing JS/WASM assets should return 404 rather than the HTML page.

## Subdirectory deployment

Build and verify with the same base path, including its trailing slash:

```sh
APP_BASE=/bayesnet/ npm run build
APP_BASE=/bayesnet/ npm run preview
TEST_PATH=/bayesnet/ npm run test:e2e
```

Deploy the contents of `dist/` under `/bayesnet/`. The browser application computes vendor URLs from the configured Vite base. Do not move only the HTML or remove the unmodified engine directory hierarchy.

## Headers and caching

Serve `.wasm` as `application/wasm`; `.js` and `.mjs` as JavaScript. The current single-threaded engine does not require cross-origin isolation/SharedArrayBuffer headers. ELK's standalone worker is also same-origin.

A suitable starting Content-Security-Policy for the built app is:

```text
 default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

Inline styles are used by Vue Flow and probability bars. No JavaScript `unsafe-eval`, external fonts, analytics or remote CDN is required. Review headers against your actual static server and target browsers before public release.

Revalidate HTML and `vendor/` assets on each visit (`Cache-Control: no-cache`). Hashed `assets/` files can use long immutable caching. Deploy atomically; don't combine old HTML with a partially replaced vendor tree. There is no service worker or offline guarantee.

## Data ownership and later features

Project saves and exports are local downloads. Optional embedded CSV increases file size and includes the complete source, not just selected columns. There is no account, upload endpoint, background sync or recovery database.

This branch does not publish a site. Broader browser checks, release notices, security-header validation and representative performance measurements precede public publication. Surrogate models and optimisation are a later phase; they may use an optional local Python companion without changing the standalone Bayesian workflow.
