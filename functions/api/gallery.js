const ASSETS_HOST = 'assets.central.co.th';
const PRODUCT_API = 'https://www.central.co.th/api/product';
const MAX_SKU_LENGTH = 30;
const MAX_SLUG_LENGTH = 200;
const MAX_IMAGES = 40;

// central.co.th ตอบ 403 ให้ client ที่ header ไม่เหมือน browser จึงต้องส่งชุด header นี้ครบ
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'th,en;q=0.9',
  Referer: 'https://www.central.co.th/',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  'sec-ch-ua': '"Chromium";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

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

function validSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return slug && slug.length <= MAX_SLUG_LENGTH && /^[a-z0-9-]+$/.test(slug) ? slug : '';
}

function validImageUrl(path, sku) {
  const raw = String(path || '').trim();
  if (!raw || raw.includes('?$')) return '';
  let url;
  try { url = new URL(raw, `https://${ASSETS_HOST}/`); } catch (_) { return ''; }
  if (url.protocol !== 'https:' || url.hostname !== ASSETS_HOST) return '';
  if (!url.pathname.toUpperCase().includes(sku)) return '';
  url.search = '';
  url.hash = '';
  return url.href;
}

export async function onRequestGet(context) {
  const params = new URL(context.request.url).searchParams;
  const sku = validSku(params.get('sku'));
  const slug = validSlug(params.get('slug'));
  if (!sku || !slug) return json({ found: false, error: 'invalid_params' }, 400);

  let response;
  try {
    const target = `${PRODUCT_API}?slug=${encodeURIComponent(slug)}&sku=${encodeURIComponent(sku)}&lang=th&isCallStock=false`;
    response = await fetch(target, { headers: BROWSER_HEADERS });
  } catch (_) {
    return json({ found: false, reason: 'product_api_unreachable' }, 502);
  }
  if (!response.ok) return json({ found: false, reason: `product_api_${response.status}` }, 502);

  let data;
  try { data = await response.json(); } catch (_) {
    return json({ found: false, reason: 'product_api_invalid_json' }, 502);
  }
  // API ใช้ sku เป็นรหัสภายใน ส่วนรหัสที่ผู้ใช้กรอกคือ productCode
  const productCode = String(data?.productCode || '').trim().toUpperCase();
  if (productCode && productCode !== sku) return json({ found: false, reason: 'sku_mismatch' }, 404);

  const images = [];
  for (const entry of Array.isArray(data?.images) ? data.images : []) {
    if (entry && entry.type && entry.type !== 'image') continue;
    const url = validImageUrl(entry?.url, sku);
    if (url && !images.includes(url)) images.push(url);
    if (images.length >= MAX_IMAGES) break;
  }
  if (!images.length) return json({ found: false, reason: 'no_images' }, 404);
  return json({ found: true, sku, images });
}
