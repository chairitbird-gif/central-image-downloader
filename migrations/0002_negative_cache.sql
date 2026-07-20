CREATE TABLE IF NOT EXISTS sku_negative_cache (
  sku TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sku_negative_cache_expires
  ON sku_negative_cache(expires_at);
