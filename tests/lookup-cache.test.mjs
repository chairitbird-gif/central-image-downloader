import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet } from '../functions/api/lookup.js';

const SKU = 'CDS10178027';
const IMAGE_URL = 'https://assets.central.co.th/file-assets/CDSPIM/web/Image/CDS1017/YSL-MENFRAGRANCEMYSLFEAUDEPARFUM100ML-CDS10178027-1.webp';

function algoliaResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function mockDb(cachedRow = null) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        async run() { calls.push({ sql, values: this.values, operation: 'run' }); return { success: true }; },
        async first() { calls.push({ sql, values: this.values, operation: 'first' }); return cachedRow; }
      };
      return statement;
    }
  };
}

test('current Algolia result is returned and saved to D1', async () => {
  const originalFetch = globalThis.fetch;
  const db = mockDb();
  globalThis.fetch = async (url) => {
    assert.match(String(url), /algolia\.net/);
    return algoliaResponse({ sku: SKU, url_key: 'ysl-product', image_url: IMAGE_URL });
  };
  try {
    const response = await onRequestGet({
      request: new Request(`https://example.test/api/lookup?sku=${SKU}`),
      env: { SKU_CACHE: db }
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source, 'algolia');
    assert.equal(data.imageUrl, IMAGE_URL);
    assert.ok(db.calls.some((call) => call.operation === 'run' && call.sql.includes('INSERT INTO sku_cache')));
  } finally { globalThis.fetch = originalFetch; }
});

test('D1 result is marked cache when Algolia misses in the current request', async () => {
  const originalFetch = globalThis.fetch;
  const cachedAt = '2026-07-19T12:00:00.000Z';
  const db = mockDb({
    sku: SKU,
    record_sku: SKU,
    image_url: IMAGE_URL,
    url_key: 'ysl-product',
    lookup_source: 'getObject',
    cached_at: cachedAt,
    verified_at: cachedAt,
    last_used_at: cachedAt,
    hit_count: 0
  });
  globalThis.fetch = async (url) => String(url).endsWith('/query')
    ? algoliaResponse({ hits: [] })
    : algoliaResponse({}, 404);
  try {
    const response = await onRequestGet({
      request: new Request(`https://example.test/api/lookup?sku=${SKU}`),
      env: { SKU_CACHE: db }
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source, 'cache');
    assert.equal(data.cacheReason, 'algolia_not_found');
    assert.equal(data.verifiedAt, cachedAt);
    assert.ok(db.calls.some((call) => call.operation === 'run' && call.sql.includes('hit_count = hit_count + 1')));
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid SKU is rejected before external lookup', async () => {
  const response = await onRequestGet({
    request: new Request('https://example.test/api/lookup?sku=../bad'),
    env: { SKU_CACHE: mockDb() }
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_sku');
});
