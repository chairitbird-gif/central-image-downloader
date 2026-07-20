CREATE TABLE IF NOT EXISTS sku_cache (
  sku TEXT PRIMARY KEY,
  record_sku TEXT NOT NULL,
  image_url TEXT NOT NULL,
  url_key TEXT NOT NULL DEFAULT '',
  lookup_source TEXT NOT NULL,
  cached_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sku_cache_last_used
  ON sku_cache(last_used_at DESC);
