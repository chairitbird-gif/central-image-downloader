# Central Image Downloader — Web deployment

Deployment copy of the existing Central Image Downloader UI. It keeps the
current workflow and supports Central image lookup, gallery selection, ZIP,
Dicut, Dicut AI, and the existing local Photoshop-helper flow.

## Run locally

```powershell
python -m pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000`.

## Hosting notes

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
