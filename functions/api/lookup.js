const ALGOLIA_APP_ID = 'JL22XXDCS9';
const ALGOLIA_SEARCH_KEY = '219108856fc945a087d091aebc7eebbb';
const ALGOLIA_INDEX = 'cds_products';
const ASSETS_HOST = 'assets.central.co.th';
const CACHE_LIMIT = 5000;
const MAX_SKU_LENGTH = 30;
const NEGATIVE_CACHE_MS = 60 * 1000;
const FRESH_CACHE_MS = 15 * 60 * 1000;
const inflightLookups = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function validSku(value) {
  const sku = String(value || '').trim().toUpperCase();
  return sku && sku.length <= MAX_SKU_LENGTH ? sku : '';
}

function validateRecord(record, sku) {
  if (!record) return null;
  const recordSku = String(record.sku || '').trim().toUpperCase();
  const urlKey = String(record.url_key || '').trim();
  const exactMatch = recordSku === sku;
  const groupMatch = sku.startsWith('GR') && urlKey.toLowerCase().includes(sku.toLowerCase());
  if (!exactMatch && !groupMatch) return null;

  const imagePath = String(record.image_url || record.thumbnail_url || '').trim();
  let imageUrl;
  try { imageUrl = new URL(imagePath, `https://${ASSETS_HOST}/`); } catch (_) { return null; }
  if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== ASSETS_HOST || imagePath.includes('?$')) return null;
  return { recordSku, urlKey, imageUrl: imageUrl.href };
}

function algoliaHeaders(jsonBody = false) {
  const headers = {
    'X-Algolia-Application-Id': ALGOLIA_APP_ID,
    'X-Algolia-API-Key': ALGOLIA_SEARCH_KEY
  };
  if (jsonBody) headers['Content-Type'] = 'application/json';
  return headers;
}

async function lookupAlgoliaOnce(sku) {
  const base = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${encodeURIComponent(ALGOLIA_INDEX)}`;
  const fields = 'sku,url_key,image_url,thumbnail_url';
  const objectResponse = await fetch(`${base}/${encodeURIComponent(sku)}?attributesToRetrieve=${encodeURIComponent(fields)}`, {
    headers: algoliaHeaders()
  });
  if (objectResponse.ok) {
    const match = validateRecord(await objectResponse.json(), sku);
    if (match) return { ...match, lookupSource: 'getObject' };
  } else if (objectResponse.status !== 404) {
    throw new Error(`Algolia getObject HTTP ${objectResponse.status}`);
  }

  const body = {
    query: sku,
    hitsPerPage: 20,
    attributesToRetrieve: ['sku', 'url_key', 'image_url', 'thumbnail_url']
  };
  if (!sku.startsWith('GR')) body.restrictSearchableAttributes = ['sku'];
  const queryResponse = await fetch(`${base}/query`, {
    method: 'POST', headers: algoliaHeaders(true), body: JSON.stringify(body)
  });
  if (!queryResponse.ok) throw new Error(`Algolia query HTTP ${queryResponse.status}`);
  const hits = (await queryResponse.json()).hits || [];
  const candidate = sku.startsWith('GR')
    ? hits.find((hit) => String(hit.url_key || '').toLowerCase().includes(sku.toLowerCase()))
    : hits.find((hit) => String(hit.sku || '').trim().toUpperCase() === sku);
  const match = validateRecord(candidate, sku);
  return match ? { ...match, lookupSource: 'query fallback' } : null;
}

async function lookupAlgolia(sku) {
  try {
    const result = await lookupAlgoliaOnce(sku);
    if (result) return { result, reason: '' };
    await new Promise((resolve) => setTimeout(resolve, 500));
    const base = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${encodeURIComponent(ALGOLIA_INDEX)}`;
    const fields = 'sku,url_key,image_url,thumbnail_url';
    const response = await fetch(`${base}/${encodeURIComponent(sku)}?attributesToRetrieve=${encodeURIComponent(fields)}`, {
      headers: algoliaHeaders()
    });
    if (response.ok) {
      const retry = validateRecord(await response.json(), sku);
      if (retry) return { result: { ...retry, lookupSource: 'getObject retry' }, reason: '' };
    } else if (response.status !== 404) {
      throw new Error(`Algolia getObject retry HTTP ${response.status}`);
    }
    return { result: null, reason: 'algolia_not_found' };
  } catch (_) {
    return { result: null, reason: 'algolia_error' };
  }
}

function coalescedLookup(sku) {
  if (inflightLookups.has(sku)) return inflightLookups.get(sku);
  const pending = lookupAlgolia(sku).finally(() => inflightLookups.delete(sku));
  inflightLookups.set(sku, pending);
  return pending;
}

async function saveCache(db, sku, match) {
  if (!db) return;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO sku_cache
      (sku, record_sku, image_url, url_key, lookup_source, cached_at, verified_at, last_used_at, hit_count)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6, 0)
    ON CONFLICT(sku) DO UPDATE SET
      record_sku = excluded.record_sku,
      image_url = excluded.image_url,
      url_key = excluded.url_key,
      lookup_source = excluded.lookup_source,
      cached_at = CASE WHEN sku_cache.image_url = excluded.image_url THEN sku_cache.cached_at ELSE excluded.cached_at END,
      verified_at = excluded.verified_at,
      last_used_at = excluded.last_used_at
  `).bind(sku, match.recordSku, match.imageUrl, match.urlKey, match.lookupSource, now).run();
  await db.prepare(`
    DELETE FROM sku_cache WHERE sku IN (
      SELECT sku FROM sku_cache ORDER BY last_used_at DESC LIMIT -1 OFFSET ?1
    )
  `).bind(CACHE_LIMIT).run();
}

async function readCache(db, sku) {
  if (!db) return null;
  const row = await db.prepare(`
    SELECT sku, record_sku, image_url, url_key, lookup_source, cached_at, verified_at, last_used_at, hit_count
    FROM sku_cache WHERE sku = ?1
  `).bind(sku).first();
  if (!row) return null;
  const match = validateRecord({ sku: row.record_sku, url_key: row.url_key, image_url: row.image_url }, sku);
  if (!match) return null;
  const now = new Date().toISOString();
  await db.prepare('UPDATE sku_cache SET last_used_at = ?1, hit_count = hit_count + 1 WHERE sku = ?2')
    .bind(now, sku).run();
  return { ...match, lookupSource: row.lookup_source, cachedAt: row.cached_at, verifiedAt: row.verified_at };
}

async function readNegativeCache(db, sku) {
  if (!db) return false;
  const row = await db.prepare('SELECT expires_at FROM sku_negative_cache WHERE sku = ?1').bind(sku).first();
  if (!row) return false;
  if (Date.parse(row.expires_at) > Date.now()) return true;
  await db.prepare('DELETE FROM sku_negative_cache WHERE sku = ?1').bind(sku).run();
  return false;
}

async function saveNegativeCache(db, sku) {
  if (!db) return;
  const expiresAt = new Date(Date.now() + NEGATIVE_CACHE_MS).toISOString();
  await db.prepare(`
    INSERT INTO sku_negative_cache (sku, expires_at) VALUES (?1, ?2)
    ON CONFLICT(sku) DO UPDATE SET expires_at = excluded.expires_at
  `).bind(sku, expiresAt).run();
}

async function clearNegativeCache(db, sku) {
  if (!db) return;
  await db.prepare('DELETE FROM sku_negative_cache WHERE sku = ?1').bind(sku).run();
}

function cacheResponse(cached, cacheReason) {
  return json({
    found: true,
    source: 'cache',
    cacheReason,
    cachedAt: cached.cachedAt,
    verifiedAt: cached.verifiedAt,
    imageUrl: cached.imageUrl,
    record: { sku: cached.recordSku, url_key: cached.urlKey, image_url: cached.imageUrl }
  });
}

async function refreshLookup(db, sku) {
  const algolia = await coalescedLookup(sku);
  if (algolia.result) {
    try {
      await saveCache(db, sku, algolia.result);
      await clearNegativeCache(db, sku);
    } catch (error) { console.error('D1 cache write failed', error); }
  } else if (algolia.reason === 'algolia_not_found') {
    try { await saveNegativeCache(db, sku); }
    catch (error) { console.error('D1 negative cache write failed', error); }
  }
  return algolia;
}

export async function onRequestGet(context) {
  const sku = validSku(new URL(context.request.url).searchParams.get('sku'));
  if (!sku) return json({ found: false, error: 'invalid_sku' }, 400);

  let cached = null;
  try { cached = await readCache(context.env.SKU_CACHE, sku); }
  catch (error) { console.error('D1 cache read failed', error); }

  const verifiedAge = cached?.verifiedAt ? Date.now() - Date.parse(cached.verifiedAt) : Infinity;
  if (cached && verifiedAge >= 0 && verifiedAge <= FRESH_CACHE_MS) {
    const refresh = refreshLookup(context.env.SKU_CACHE, sku).catch((error) => console.error('Background refresh failed', error));
    if (context.waitUntil) context.waitUntil(refresh);
    return cacheResponse(cached, 'revalidating');
  }

  let negativeHit = false;
  try { negativeHit = await readNegativeCache(context.env.SKU_CACHE, sku); }
  catch (error) { console.error('D1 negative cache read failed', error); }
  if (negativeHit) return cached
    ? cacheResponse(cached, 'algolia_not_found')
    : json({ found: false, reason: 'negative_cache', retryAfter: 60 }, 404);

  const algolia = await refreshLookup(context.env.SKU_CACHE, sku);
  if (algolia.result) {
    return json({
      found: true,
      source: 'algolia',
      lookupSource: algolia.result.lookupSource,
      imageUrl: algolia.result.imageUrl,
      record: { sku: algolia.result.recordSku, url_key: algolia.result.urlKey, image_url: algolia.result.imageUrl }
    });
  }

  if (!cached) return json({ found: false, reason: algolia.reason }, 404);
  return cacheResponse(cached, algolia.reason);
}
