# Central Lookup and Image Delivery Findings

Updated: 2026-07-18

## Verified current model

- Scraping `www.central.co.th` is unreliable from datacenter networks because its WAF can reject requests by network reputation even when the same request works from a Thai residential/dev connection.
- Central storefront product search uses a public Algolia index. The Pages Function performs exact SKU lookup and uses `image_url`/`thumbnail_url` only after record validation, then records the mapping in D1 as a last-known-good fallback.
- Current results expose CDSPIM paths that resolve under `https://assets.central.co.th/`; the old Scene7-host investigation is no longer the active implementation path.
- Browser CORS support allows the static client to query the configured index and fetch Central assets directly at the time of the latest verification.
- Production lookup uses at most three upstream requests for a miss, negative-caches confirmed misses for 60 seconds, and coalesces concurrent same-SKU lookups within a Function isolate. A D1 mapping verified within 15 minutes is returned immediately while Algolia revalidates it in the background. Plain static local development retains direct client-side Algolia lookup; the Flask localhost fallback retains Central/Google scraping for misses.

## Operational risks

- Algolia app IDs, search-only keys, index names, CORS policy, record fields, and CDN paths are Central-owned storefront implementation details and can change without notice.
- A search-only key being public does not grant an unlimited integration contract. Keep requests exact, bounded, and limited to required fields.
- A CDN or Algolia failure must produce a clear user-facing error; do not silently reinterpret a missing lookup as proof that the product does not exist.
- `images.weserv.nl` is an optional validated-CDN fallback in the Flask path. It can be disabled with an empty `CENTRAL_IMAGE_PROXY_BASE`.

## Diagnostic order

1. Confirm values in `client/config.js` and Flask environment overrides.
2. Test exact Algolia lookup for a known CDS SKU and a GR SKU.
3. Validate returned record identity and asset host/path.
4. Test the asset URL directly and inspect status/content type.
5. Compare browser and localhost fallback behavior before changing lookup rules.

## Historical note

The original July 2026 investigation tested an older Algolia index/key combination and considered Scene7 because early records appeared to return preset-style names. That investigation is preserved under `docs/archive/2026-07/CENTRAL_API_FINDINGS.md`; its endpoint values and remaining-work list must not be copied into current code without fresh verification.
