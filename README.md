# Central Image Downloader

The primary app is now a static, client-side site in `client/`. Product lookup,
CDN download, JPEG/PNG conversion, lazy gallery probing, Trim, white-background
Dicut, folder save, and ZIP creation all run in the user's browser. There is no
server-side image pipeline and no cold start.

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

## Run the legacy localhost fallback

```powershell
python -m pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000`.

## Static hosting

Deploy `client/` as the Cloudflare Pages output directory. No build command is
required. `client/_headers` contains the browser security policy for the
Algolia and Central asset endpoints.

## Legacy Flask hosting notes

- Run one Gunicorn worker because job sessions and image edits are in memory.
- Product lookup uses Central's public Algolia `cds_products` index first and
  downloads the returned CDSPIM path from `assets.central.co.th`. The existing
  Central page scraper and Google lookup remain as fallbacks.
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
