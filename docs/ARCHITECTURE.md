# Central Image Downloader Architecture

## Current primary path

The primary product is the static application in `client/`:

1. `client/app.js` performs exact SKU lookup against the configured public Central Algolia product index.
2. Lookup results provide validated CDSPIM paths hosted by `assets.central.co.th`.
3. The browser downloads source images and performs format conversion, gallery probing, Trim, white-background Dicut, folder save, and ZIP creation locally.
4. `client/index.html`, `client/styles.css`, and `client/app.js` are the frontend source. `client/version.json` is release metadata.

The browser path has no server image pipeline and no cold start. It must be served over HTTP(S); opening through `file://` is unsupported because hosted-origin and File System Access behavior differ.

## Legacy fallback

`app.py` remains a localhost fallback for SKUs that are absent from Algolia and require Central page or Google lookup paths unavailable to the browser because of CORS/WAF restrictions.

The fallback is not the primary hosted architecture. Its in-memory job state requires a single Gunicorn worker when hosted. Photoshop-based Dicut also depends on the local helper and desktop application.

## Configuration boundaries

Client Algolia/CDN defaults live in `client/config.js`. Flask overrides use:

- `CENTRAL_ALGOLIA_APP_ID`
- `CENTRAL_ALGOLIA_SEARCH_KEY`
- `CENTRAL_ALGOLIA_PRODUCT_INDEX`
- `CENTRAL_ASSETS_BASE`
- `CENTRAL_IMAGE_PROXY_BASE`

Algolia storefront identifiers and search-only keys are public client configuration, not privileged credentials, but they are owned by Central and may rotate or be restricted. Do not treat them as a stable third-party API contract.

## Security invariants

- Accept only expected HTTPS asset hosts; never turn lookup results into an unrestricted URL fetcher.
- Require exact SKU matching, with the documented GR group-SKU exception based on `url_key`.
- Request only fields required by the application and keep lookup concurrency bounded.
- Preserve original dimensions unless the user explicitly invokes an image operation.
- Keep the shared header and feedback widget synchronized under the workspace-level contracts.

## Source-of-truth order

1. Current code and automated/static checks
2. `README.md`, this file, and `docs/API_FINDINGS.md`
3. Git history
4. `docs/archive/` for historical rationale only
