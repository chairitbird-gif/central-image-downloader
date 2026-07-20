# Central Image Downloader

Production: `https://central-image-downloader.pages.dev/`

The primary app is a Cloudflare Pages site in `client/`. A Pages Function performs
product lookup and keeps validated last-known-good SKU mappings in D1. CDN image
download, JPEG/PNG conversion, lazy gallery probing, Trim, white-background Dicut,
folder save, and ZIP creation still run in the user's browser; image bytes are never
stored in D1 and there is no server-side image pipeline.

The existing Flask `app.py` remains available as the localhost fallback for
SKUs that are not present in Algolia and therefore need the Central/Google
scraping steps that browsers cannot run.

## Run the client-side site

```powershell
python -m http.server 8766 --bind 127.0.0.1 --directory client
```

Open `http://127.0.0.1:8766/`. Do not open `index.html` through `file://` because
folder access and hosted-origin behavior must be tested from an HTTP origin.

There is no hard SKU limit. For typical computers, use batches of about 100 or
fewer; PNG, Dicut, and ZIP use more memory than JPEG.

## Architecture and API notes

- Current system boundaries and source files: `docs/ARCHITECTURE.md`
- Current Central lookup/CDN findings and operational risks: `docs/API_FINDINGS.md`
- Historical implementation handoffs: `docs/archive/2026-07/`

Treat `client/` and this README as current behavior. Documents under
`docs/archive/` explain prior decisions but are not implementation instructions.

## Run the legacy localhost fallback

```powershell
python -m pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000`.

## Cloudflare Pages hosting

`wrangler.toml` binds the `SKU_CACHE` D1 database and declares `client/` as the
Pages output directory. Apply new migrations before deploying:

```powershell
npx wrangler d1 migrations apply central-image-sku-cache --remote
npx wrangler pages deploy client --project-name central-image-downloader
```

Do not pass `--branch main` for this direct-upload project; that creates a preview
deployment instead of updating the production alias. `client/_headers` contains
the browser security policy for the API, Algolia, and Central asset endpoints.

## Legacy Flask hosting notes

- Run one Gunicorn worker because job sessions and image edits are in memory.
- Product lookup uses Central's public Algolia `cds_products` index first and
  downloads the returned CDSPIM path from `assets.central.co.th`. The existing
  Central page scraper and Google lookup remain as fallbacks.
- The public lookup accepts any non-empty SKU text up to 30 characters. It does
  not enforce a CDS/GRCDS/MKP naming pattern.
- Algolia misses are negative-cached in D1 for 60 seconds. Concurrent requests
  for the same SKU share one in-flight Algolia lookup within a Function isolate.
- A positive D1 mapping verified within 15 minutes is returned immediately and
  revalidated in the background; the UI labels that state explicitly.
- The Algolia defaults can be overridden with `CENTRAL_ALGOLIA_APP_ID`,
  `CENTRAL_ALGOLIA_SEARCH_KEY`, `CENTRAL_ALGOLIA_PRODUCT_INDEX`, and
  `CENTRAL_ASSETS_BASE` if Central rotates its public storefront configuration.
- If Central's asset CDN returns 403 to the host, the app retries that validated
  CDN URL through `images.weserv.nl` at quality 100 without resizing. Override or disable this fallback with
  `CENTRAL_IMAGE_PROXY_BASE` (set it to an empty value to disable it).
- `REMBG_MODEL=u2netp` is the low-memory default for hosted Dicut AI.
- Set `ACCESS_PASSWORD` to protect a private deployment; leave it unset for the
  same link-only public access model as the Strip Banner app.
- Dicut PS still runs Photoshop on the user's computer through the local helper.

## Release checks

For client-side changes, serve `client/` over HTTP and verify lookup, gallery,
JPEG/PNG conversion, Trim, Dicut, folder save, ZIP, and responsive UI as relevant
to the change. Changes to the Central Creative Tools header or feedback widget
must follow the shared contracts in the workspace root and ship with every
consumer in the coordinated release set.
