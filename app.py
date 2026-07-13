"""
Central Image Downloader — Web App
เปิด browser แล้วใช้งานได้เลย

Requirements: pip install flask requests Pillow
Run:          python app.py
Open:         http://localhost:5000
"""
import io, re, time, json, zipfile, threading, os, sys, functools, platform, subprocess
from pathlib import Path
from urllib.parse import unquote, quote_plus
from queue import Queue, Empty
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from flask import Flask, Response, request, send_file, stream_with_context, abort
from PIL import Image

IS_MAC = platform.system() == 'Darwin'
_CURL_COOKIE_FILE = '/tmp/central_dl_cookies.txt'
_curl_warmed = False

# เมื่อ pack เป็น .exe (frozen): บอก rembg ให้หาโมเดล AI จากในตัว .exe ที่ฝังไว้
# → ทำงานได้ทันทีแบบ offline ไม่ต้องดาวน์โหลดโมเดลครั้งแรก
if getattr(sys, 'frozen', False):
    _bundle = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    _model_dir = os.path.join(_bundle, 'u2net_models')
    if os.path.isdir(_model_dir):
        os.environ.setdefault('U2NET_HOME', _model_dir)

try:
    from curl_cffi import requests as cffi_requests
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False

try:
    from rembg import remove as _rembg_remove, new_session as _rembg_new_session
    HAS_REMBG = True
    REMBG_IMPORT_ERROR = ''
except Exception as _rembg_error:
    HAS_REMBG = False
    REMBG_IMPORT_ERROR = str(_rembg_error)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'central-dl-secret')
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_UPLOAD_MB', '25')) * 1024 * 1024

# Public-hosting guardrails. The desktop/LAN build could use the whole machine;
# a shared web process needs bounded jobs and bounded model concurrency.
MAX_SKUS_PER_JOB = int(os.environ.get('MAX_SKUS_PER_JOB', '80'))
_download_slots = threading.BoundedSemaphore(int(os.environ.get('MAX_ACTIVE_DOWNLOADS', '2')))
_ai_lock = threading.Lock()
_ai_session = None

# ── Optional password protection ──────────────────────────────────────────────
# ตั้งค่า env var ACCESS_PASSWORD เพื่อเปิดใช้ password (ถ้าไม่ตั้งค่า = เข้าได้เลย)
ACCESS_PASSWORD = os.environ.get('ACCESS_PASSWORD', '')

def require_auth(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if ACCESS_PASSWORD:
            token = request.headers.get('X-Access-Token') or request.args.get('token') or request.cookies.get('access_token')
            if token != ACCESS_PASSWORD:
                abort(401)
        return f(*args, **kwargs)
    return decorated

# ── HTTP Headers ──────────────────────────────────────────────────────────────
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
}
GOOGLE_HEADERS = {
    **HEADERS,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://www.google.com/',
}

# ── Cloudflare-bypass HTTP helpers ────────────────────────────────────────────

def _curl_warmup():
    cmd = ['curl', '-sL', '--max-time', '10', '--compressed',
           '-c', _CURL_COOKIE_FILE, '-b', _CURL_COOKIE_FILE,
           '-H', f'User-Agent: {HEADERS["User-Agent"]}',
           '-H', 'Accept-Language: th-TH,th;q=0.9,en;q=0.8',
           'https://www.central.co.th/']
    subprocess.run(cmd, capture_output=True, timeout=15)

def _curl_get_html(url):
    cmd = ['curl', '-sL', '--max-time', '15', '--compressed',
           '-c', _CURL_COOKIE_FILE, '-b', _CURL_COOKIE_FILE,
           '-H', f'User-Agent: {HEADERS["User-Agent"]}',
           '-H', 'Accept-Language: th-TH,th;q=0.9,en;q=0.8',
           '-w', '\n__STATUS__%{http_code}',
           url]
    result = subprocess.run(cmd, capture_output=True, timeout=20)
    output = result.stdout.decode('utf-8', errors='replace')
    if '\n__STATUS__' in output:
        body, code_str = output.rsplit('\n__STATUS__', 1)
        code = int(code_str.strip()) if code_str.strip().isdigit() else 0
        if code in (403, 429, 503):
            raise requests.exceptions.HTTPError(f'{code}')
        return body
    return output

# Shared session — reuse TCP/TLS connection เดิม (เร็วกว่าเปิดใหม่ทุก request ~0.3-0.5 วิ)
_http = requests.Session()
_http.headers.update(HEADERS)
_http.mount('https://', requests.adapters.HTTPAdapter(
    pool_connections=16, pool_maxsize=16))

def _get_central_html(url):
    global _curl_warmed
    if IS_MAC:
        # Mac โดน Cloudflare บล็อก TLS ของ Python — ต้องใช้ curl_cffi/curl
        if HAS_CURL_CFFI:
            r = cffi_requests.get(url, headers=HEADERS,
                                  impersonate='chrome124', timeout=15)
            if r.status_code in (403, 429, 503):
                raise requests.exceptions.HTTPError(str(r.status_code))
            r.raise_for_status()
            return r.text
        if not _curl_warmed:
            _curl_warmup()
            _curl_warmed = True
        return _curl_get_html(url)
    r = _http.get(url, timeout=15)
    if r.status_code in (403, 429, 503) and HAS_CURL_CFFI:
        # โดนบล็อก → ลองใหม่ด้วย TLS ปลอมเป็น Chrome
        try:
            r2 = cffi_requests.get(url, headers=HEADERS,
                                   impersonate='chrome124', timeout=15)
            r2.raise_for_status()
            return r2.text
        except Exception:
            # curl uses another HTTP/TLS implementation and keeps a cookie jar;
            # it is the final fallback for datacenter-hosted deployments.
            if not _curl_warmed:
                _curl_warmup()
                _curl_warmed = True
            return _curl_get_html(url)
    r.raise_for_status()
    return r.text

# ── Core Functions ─────────────────────────────────────────────────────────────

def _get_central_html_cffi(url):
    """ดึงหน้า central ด้วย curl_cffi โดยตรง (TLS ปลอมเป็น Chrome) — ใช้เป็นไม้ตาย
    ตอนหน้า search ตอบ 'ไม่พบ' ปลอมๆ ให้ session ปกติ (คนละ TLS fingerprint)"""
    r = cffi_requests.get(url, headers=HEADERS,
                          impersonate='chrome124', timeout=15)
    r.raise_for_status()
    return r.text

def _try_central_direct_once(sku, fetcher=None):
    page_text = (fetcher or _get_central_html)(
        f'https://www.central.co.th/en/search/{sku}')
    no_result_phrases = [
        "couldn't find any results",
        "couldn&#x27;t find any results",
        "couldn&apos;t find any results",
        "find any results matching",
        "sorry, we couldn",
        "could not find any results",
    ]
    if any(p.lower() in page_text.lower() for p in no_result_phrases):
        return None, 'not_found', page_text
    matches = re.findall(r'imageSrcSet="[^"]*url=([^&"]+)', page_text)
    if not matches:
        return None, 'not_found', page_text
    img_url = unquote(matches[0])
    if not sku.upper().startswith('GR') and sku.upper() not in img_url.upper():
        return None, 'not_found', page_text
    return img_url, None, page_text

def try_central_direct(sku):
    """ยิงค้น Central 1 ครั้ง — ถ้า 'ไม่พบ' ลองซ้ำอีกครั้งก่อนสรุปผล
    (เมื่อยิงหลาย SKU พร้อมกัน บางครั้ง Central ตอบหน้า 'ไม่พบ' ปลอมๆ ชั่วคราว
    การ retry ครั้งเดียวช่วยกู้ false-negative แบบนี้ได้ โดยแทบไม่กระทบความเร็ว)"""
    result = _try_central_direct_once(sku)
    if result[1] == 'not_found':
        time.sleep(0.6)
        result = _try_central_direct_once(sku)
    return result

def recheck_central_thorough(sku):
    """ตรวจซ้ำแบบละเอียด (STEP 1.5) — ใช้ตอนระบบเงียบแล้ว หลัง STEP 1 ขนานจบ
    สำหรับ SKU ที่ 'ไม่พบ' ยิงหลายรอบ + สลับไปใช้ curl_cffi (TLS คนละแบบ)
    เพื่อกู้ false-negative ที่เกิดตอนยิงพร้อมกันหลายตัว
    คืน (img_url, status, page_html) เหมือน try_central_direct"""
    fetchers = [_get_central_html]
    if HAS_CURL_CFFI:
        fetchers.append(_get_central_html_cffi)
    for attempt in range(2):
        for fetcher in fetchers:
            try:
                result = _try_central_direct_once(sku, fetcher=fetcher)
                if result[1] != 'not_found':
                    return result
            except Exception:
                pass
        if attempt == 0:
            time.sleep(0.7)
    return None, 'not_found', ''

def _google_lucky(query):
    """ยิง Google I'm Feeling Lucky แล้วคืน URL ปลายทาง (ใช้ curl_cffi ถ้ามี เพื่อเลี่ยง bot-detection)"""
    url = f'https://www.google.com/search?q={quote_plus(query)}&btnI=1'
    if HAS_CURL_CFFI:
        r = cffi_requests.get(url, impersonate='chrome124',
                              allow_redirects=False, timeout=15)
    else:
        r = requests.get(url, headers=GOOGLE_HEADERS,
                         allow_redirects=False, timeout=15)
    location = r.headers.get('Location', '')
    if r.status_code in (429, 503) or '/sorry' in location:
        return None, 'google_blocked'
    if r.status_code in (301, 302, 303, 307, 308) and location:
        m = re.search(r'[?&]q=(https?://[^&]+)', location)
        return (unquote(m.group(1)) if m else location), None
    return None, 'not_found'

def try_google_search(sku):
    """ค้นหา product URL ผ่าน Google I'm Feeling Lucky — ได้ URL ตรงโดยไม่ต้อง render JS

    ใช้ site:central.co.th บังคับให้ผลลัพธ์เป็น central เท่านั้น
    แล้วตรวจว่า SKU อยู่ใน URL จริง (URL สินค้า central ลงท้ายด้วย -sku เสมอ)
    เพื่อกัน Google ส่งสินค้าผิดตัวกลับมา"""
    try:
        # ลองหลาย query ตามลำดับ — รับตัวแรกที่ SKU อยู่ใน URL สินค้าจริง
        queries = [
            f'site:central.co.th {sku}',          # แม่นสุดสำหรับส่วนใหญ่
            f'site:central.co.th inurl:{sku.lower()}',  # บังคับ SKU ใน URL (กู้เคสที่ rank เพี้ยน)
            sku,                                   # เผื่อ Google index แปลกๆ
        ]
        for q in queries:
            time.sleep(0.4)
            dest, err = _google_lucky(q)
            if err == 'google_blocked':
                return None, 'google_blocked'
            if dest and 'central.co.th' in dest and '/search' not in dest \
                    and sku.lower() in dest.lower():
                return dest, None
        return None, 'not_found'
    except Exception as e:
        return None, str(e)

def fetch_image_bytes(image_url, referer='https://www.central.co.th/', fmt='jpg'):
    """โหลดรูป + แปลงฟอร์แมต — fmt='jpg' (q95, ไฟล์เล็ก) หรือ 'png' (lossless, คมสุด)"""
    image_headers = {**HEADERS, 'Referer': referer,
                     'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'}
    r = _http.get(image_url, headers=image_headers, timeout=15)
    if r.status_code in (403, 429, 503) and HAS_CURL_CFFI:
        r = cffi_requests.get(image_url, headers=image_headers,
                              impersonate='chrome124', timeout=15)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert('RGB')
    w, h = img.size
    buf = io.BytesIO()
    if fmt == 'png':
        img.save(buf, 'PNG')
    else:
        img.save(buf, 'JPEG', quality=95)
    buf.seek(0)
    return buf.getvalue(), w, h

def extract_gallery(html, sku, first_img_url=None):
    """ดึงรูปแกลเลอรีทั้งหมดของสินค้าจากหน้า product เรียงตามลำดับ -1, -2, -3, ...

    รูป Central ลงท้าย -{SKU}-{n}.webp — กรองด้วย SKU เพื่อไม่ปนรูปสินค้าแนะนำอื่น
    ถ้า SKU ที่ค้นหาไม่ตรงกับชื่อรูปแรก (เช่น GR parent, หรือ child sku ในสินค้า group
    ที่หน้าเว็บโชว์แกลเลอรีของ variant อื่น) → ดึง token จากชื่อไฟล์รูปแรกแทน"""
    text = html.replace('\\u002F', '/').replace('\\/', '/')
    token = sku
    if first_img_url and sku.upper() not in first_img_url.upper():
        # child SKU มักต่อท้ายด้วย -N (ลำดับรูป) แต่บางรูป (เช่น PROMO) ไม่มีเลข
        # ต่อท้าย — ดึงจาก token ที่อยู่ก่อน -N หรือก่อน -PROMO/นามสกุลไฟล์ก็ได้
        fname = first_img_url.split('/')[-1]
        m = (re.search(r'-([A-Za-z]+\d+)-(?:\d+|PROMO)\.(?:webp|jpe?g|png)$', fname, re.I)
             or re.search(r'-([A-Za-z]+\d+)\.(?:webp|jpe?g|png)$', fname, re.I))
        if m:
            token = m.group(1)
    imgs = re.findall(r'https?://[^"\'\s<>\\]+?\.(?:webp|jpe?g|png)', text)
    out = {}
    for u in imgs:
        u = unquote(u)
        if 'CDSPIM' not in u or 'Product-Overlay' in u:
            continue
        fname = u.split('/')[-1]
        m = re.search(r'-(\d+)\.(?:webp|jpe?g|png)$', fname)
        if not m or token.upper() not in fname.upper():
            continue
        out.setdefault(int(m.group(1)), u)
    return [out[k] for k in sorted(out)]

def pick_from_gallery(gallery, img_index):
    """เลือกรูปตามลำดับที่ขอ — ถ้าลำดับนั้นไม่มี fallback เป็นรูปแรก"""
    if gallery and 1 <= img_index <= len(gallery):
        return gallery[img_index - 1]
    return gallery[0] if gallery else None

def fetch_from_product_url(product_url, sku=None, img_index=1, fmt='jpg'):
    html = _get_central_html(product_url)
    matches = re.findall(r'imageSrcSet="[^"]*url=([^&"]+)', html)
    if not matches:
        raise ValueError('ไม่พบรูปในหน้าสินค้า')
    img_url = unquote(matches[0])
    if img_index > 1 and sku:
        gallery = extract_gallery(html, sku, first_img_url=img_url)
        # เรียงตามที่ตาเห็นบนเว็บ: รูปแรกของหน้า (อาจเป็นรูป PROMO ไม่มีเลขลำดับ)
        # ต้องนับเป็นลำดับ 1 เสมอ แล้วค่อยตามด้วยรูปที่เหลือ
        if img_url not in gallery:
            gallery = [img_url] + gallery
        # แกลเลอรีมีรูปลำดับที่ขอ → ใช้เลย
        if 1 <= img_index <= len(gallery):
            return fetch_image_bytes(gallery[img_index - 1], referer=product_url, fmt=fmt)
        # ไม่มีในแกลเลอรี → ลองเดาจาก CDN pattern ก่อน fallback รูปแรก
        got = fetch_by_cdn_index(img_url, img_index, fmt=fmt)
        if got:
            return got
    return fetch_image_bytes(img_url, referer=product_url, fmt=fmt)

def find_product_link(search_html, sku):
    """หา URL หน้าสินค้าจากหน้า search (ใช้เมื่อต้องการรูปลำดับอื่นที่ไม่ใช่รูปแรก)"""
    text = search_html.replace('\\u002F', '/').replace('\\/', '/')
    # 1) แม่นสุด: URL ที่ลงท้ายด้วย SKU ที่ค้นหาตรงๆ
    m = re.search(r'/(?:en|th)/[^"\s\\]*' + re.escape(sku.lower()), text, re.I)
    if m:
        return 'https://www.central.co.th' + m.group(0)
    # 2) สินค้าบางตัว URL ลงท้ายด้วย parent SKU (GRCDS...) ไม่ใช่ child SKU ที่ค้นหา
    #    หน้า search ของ 1 SKU มีลิงก์สินค้าเดียว → ใช้ลิงก์รูปแบบ /slug-(cds|mkp|grcds)NNN ตัวแรก
    m2 = re.search(r'/(?:en|th)/[a-z0-9][a-z0-9\-]{3,}-(?:cds|mkp|grcds)\d+', text, re.I)
    return ('https://www.central.co.th' + m2.group(0)) if m2 else None

def fetch_by_cdn_index(first_img_url, img_index, fmt='jpg'):
    """Fallback: เดา URL รูปลำดับที่ต้องการจากรูปแรก โดยเปลี่ยนเลขท้าย -1 เป็น -N
    ใช้เมื่อหาลิงก์หน้าสินค้าไม่เจอ (Central บางหน้า render ลิงก์ด้วย JS)
    คืน (bytes, w, h) ถ้ารูปลำดับนั้นมีจริง — ไม่งั้นคืน None"""
    m = re.search(r'-(\d+)\.(webp|jpe?g|png)$', first_img_url)
    if not m:
        return None  # รูปแรกไม่มีเลขลำดับ (เช่น PROMO) — เดาไม่ได้
    cand = first_img_url[:m.start()] + f'-{img_index}.{m.group(2)}'
    try:
        r = _http.head(cand, headers=HEADERS, timeout=8)
        if r.status_code != 200:
            return None
        return fetch_image_bytes(cand, fmt=fmt)
    except Exception:
        return None

def _cdn_probe_series(first_img_url, max_n=20):
    """ไล่หารูปแกลเลอรีของ SKU จาก CDN โดยตรง โดยเปลี่ยนเลขท้าย -1,-2,-3,... จนกว่าจะ 404
    ใช้กับ URL รูปที่มีเลขลำดับต่อท้าย (-N) — คืน list ของ URL รูป (ว่าง = ใช้ไม่ได้)
    วิธีนี้ได้แกลเลอรี 'ของ variant ที่ค้นหาจริง' ไม่ใช่ variant หลักของ group"""
    m = re.search(r'-(\d+)\.(webp|jpe?g|png)$', first_img_url)
    if not m:
        return []
    base = first_img_url[:m.start()]
    ext = m.group(2)
    urls = []
    for i in range(1, max_n + 1):
        cand = f'{base}-{i}.{ext}'
        try:
            r = _http.head(cand, headers=HEADERS, timeout=8)
        except Exception:
            break
        if r.status_code == 200:
            urls.append(cand)
        elif i == 1:
            return []       # ไม่มีแม้แต่ -1 = pattern ใช้ไม่ได้
        else:
            break           # เจอช่องว่างหลัง -1 = จบแกลเลอรี
    return urls

def resolve_variant_gallery(sku):
    """คืน list ของ URL รูปทั้งหมด 'ของ SKU/variant ที่ค้นหาจริง' เรียงตามลำดับ
    หัวใจ: ใช้รูปจากหน้า search (variant ถูกต้อง) แล้ว CDN-probe แกลเลอรีของมันเอง
    เผื่อกรณี group product ที่หน้า product โชว์แต่ variant หลัก (สีอื่น)
    ลำดับความสำคัญ:
      A) CDN-probe จากรูป search (variant ตรง + มีเลข -N) ← แก้บั๊กสีเพี้ยน
      B) แกลเลอรีจากหน้า product (เคส GR parent / รูปแรกเป็น PROMO ไม่มีเลข)
      C) รูปเดียวจาก search (สุดท้าย)"""
    img_url, status, page_html = try_central_direct(sku)
    if status == 'not_found':
        url, err = try_google_search(sku)
        if not url:
            return []
        try:
            page_html = _get_central_html(url)
            mm = re.findall(r'imageSrcSet="[^"]*url=([^&"]+)', page_html)
            img_url = unquote(mm[0]) if mm else None
        except Exception:
            img_url = None
    if not img_url:
        return []
    # A) แกลเลอรีของ variant ที่ค้นหาเอง (รูป search มี sku ตรง + เลข -N) → CDN probe
    # BUG FIX: probe เจอใบเดียวไม่ถือว่าจบ — บางสินค้ารูป -2 เป็นต้นไปเปลี่ยน prefix
    # ชื่อไฟล์ (เช่น ESTEELAUDER-...-1 แต่ ESTEE_LAUDER-...-2) ทำให้ probe 404 ตั้งแต่ -2
    # ทั้งที่หน้า product มีอีกหลายรูป → ต้องตกไปเช็ค path B ต่อ
    fname = img_url.split('/')[-1]
    if sku.upper() in fname.upper() and re.search(r'-\d+\.(?:webp|jpe?g|png)$', fname):
        urls = _cdn_probe_series(img_url)
        if len(urls) > 1:
            return urls
    # B) fallback: แกลเลอรีจากหน้า product (GR / PROMO)
    link = find_product_link(page_html, sku)
    if not link:
        url, err = try_google_search(sku)
        link = url
    if link:
        try:
            html = _get_central_html(link)
            mm = re.findall(r'imageSrcSet="[^"]*url=([^&"]+)', html)
            first = unquote(mm[0]) if mm else img_url
            g = extract_gallery(html, sku, first_img_url=first)
            if first not in g:
                g = [first] + g
            if g:
                return g
        except Exception:
            pass
    # C) สุดท้าย: รูปเดียว
    return [img_url]

def _safe_prefix(p):
    """ทำความสะอาด prefix ชื่อไฟล์ — เอาอักขระที่ใช้ในชื่อไฟล์ไม่ได้ออก"""
    p = (p or '').strip()
    if not p:
        return ''
    return re.sub(r'[<>:"/\\|?*]', '', p)[:40]

# ── Dicut (background removal) ─────────────────────────────────────────────────
from PIL import ImageChops

def _png_bytes(img):
    b = io.BytesIO(); img.save(b, 'PNG'); return b.getvalue()

def _jpg_bytes(img):
    b = io.BytesIO(); img.convert('RGB').save(b, 'JPEG', quality=95); return b.getvalue()

def _finish_dicut(rgba, orig_rgb):
    """trim รูปโปร่งใส + crop รูปต้นฉบับให้ตรงกรอบเดียวกัน (สำหรับ comparison slider)
    คืน (png_dicut, size, jpg_orig_cropped)"""
    bbox = rgba.getchannel('A').getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
        orig_rgb = orig_rgb.crop(bbox)
    return _png_bytes(rgba), rgba.size, _jpg_bytes(orig_rgb)

def dicut_white(jpg_bytes, tol=20):
    """ลบพื้นหลังสีขาว/ใกล้ขาวออก → โปร่งใส แล้ว trim (เร็ว ใช้ PIL ล้วน)
    เหมาะกับรูปที่พื้นหลังขาวสะอาด — ถ้าตัวสินค้าเป็นสีขาวด้วยอาจโดนกัด → ใช้ AI แทน
    คืน (png_dicut, size, jpg_orig_cropped)"""
    img = Image.open(io.BytesIO(jpg_bytes)).convert('RGB')
    r, g, b = img.split()
    thr = 255 - tol
    mask_white = ImageChops.darker(
        ImageChops.darker(r.point(lambda v: 255 if v >= thr else 0),
                          g.point(lambda v: 255 if v >= thr else 0)),
        b.point(lambda v: 255 if v >= thr else 0))
    alpha = ImageChops.invert(mask_white)
    rgba = img.convert('RGBA')
    rgba.putalpha(alpha)
    return _finish_dicut(rgba, img)

def dicut_ai(jpg_bytes):
    """ลบพื้นหลังด้วย AI (rembg / U²-Net) แล้ว trim — คมชัด ตัดเฉพาะวัตถุจริง
    ทำงานในเครื่อง (offline หลังโหลดโมเดลครั้งแรก) ไม่ส่งรูปขึ้นเน็ต
    คืน (png_dicut, size, jpg_orig_cropped)"""
    global _ai_session
    # Reuse one model instead of loading it for every image. u2netp is the
    # hosting-friendly default; REMBG_MODEL=u2net restores the larger model.
    with _ai_lock:
        if _ai_session is None:
            _ai_session = _rembg_new_session(os.environ.get('REMBG_MODEL', 'u2netp'))
        png = _rembg_remove(jpg_bytes, session=_ai_session)
    rgba = Image.open(io.BytesIO(png)).convert('RGBA')
    orig = Image.open(io.BytesIO(jpg_bytes)).convert('RGB')
    return _finish_dicut(rgba, orig)

# ── Dicut PS (Photoshop removeBackground ผ่าน COM — Windows เท่านั้น) ──────────
# แนวคิด: browser เป็นคนเลือกว่าจะใช้ Photoshop "เครื่องไหน" — ถ้าเปิดหน้าเว็บผ่าน
# LAN (http://10.x.x.x:5000) JS จะยิงมาที่ http://localhost:5000 ของเครื่องตัวเอง
# (ต้องมีโปรแกรมนี้รันอยู่ในเครื่องนั้นด้วย) ดังนั้น /ps-remove-bg เป็น endpoint
# แบบ stateless (รับรูปดิบ คืน PNG) ไม่ผูกกับ session และรับเฉพาะจาก localhost
_ps_lock = threading.Lock()   # PS COM ยิงพร้อมกันหลายเธรด = crash → คิวทีละรูป

def has_photoshop():
    """เช็คว่าเครื่องนี้เรียก Photoshop ผ่าน COM ได้ (Windows + ติดตั้ง PS + pywin32)"""
    if platform.system() != 'Windows':
        return False
    try:
        import winreg
        import win32com.client  # noqa: F401
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, 'Photoshop.Application'))
        return True
    except Exception:
        return False

_PS_JSX = """
var _src = File(arguments[0]); var _out = File(arguments[1]);
app.displayDialogs = DialogModes.NO;

function fail(step, err) {
    var msg = err && err.message ? err.message : String(err);
    var num = err && err.number ? (" #" + err.number) : "";
    throw new Error("Dicut PS removeBackground failed at " + step + num + ": " + msg);
}

var doc = null;
try {
    try { doc = app.open(_src); } catch (eOpen) { fail("open", eOpen); }
    try {
        if (doc.layers[0].isBackgroundLayer) doc.layers[0].isBackgroundLayer = false;
        doc.activeLayer = doc.layers[0];
    } catch (eLayer) { fail("prepare layer", eLayer); }
    try {
        executeAction(stringIDToTypeID('removeBackground'), undefined, DialogModes.NO);
    } catch (eRemove) { fail("removeBackground", eRemove); }
    try {
        var o = new PNGSaveOptions();
        doc.saveAs(_out, o, true, Extension.LOWERCASE);
    } catch (eSave) { fail("save PNG", eSave); }
} finally {
    if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
}
"""

def ps_remove_bg_bytes(img_bytes):
    """ส่งรูปให้ Photoshop ตัดพื้น (removeBackground) → คืน PNG RGBA เต็มเฟรม
    (ไม่ trim ใน PS — ให้ _finish_dicut ทำ เพื่อได้ orig_crop กรอบเดียวกันเสมอ)"""
    import tempfile
    import pythoncom
    import win32com.client
    with _ps_lock:
        pythoncom.CoInitialize()
        try:
            with tempfile.TemporaryDirectory() as td:
                src = os.path.join(td, 'ps_in.png')
                dst = os.path.join(td, 'ps_out.png')
                Image.open(io.BytesIO(img_bytes)).convert('RGB').save(src, 'PNG')
                ps = win32com.client.Dispatch('Photoshop.Application')
                ps.DoJavaScript(_PS_JSX, [src, dst])
                with open(dst, 'rb') as f:
                    return f.read()
        finally:
            pythoncom.CoUninitialize()

# ── Session store (in-memory) ─────────────────────────────────────────────────
# BUG FIX: เดิมไม่เคยลบ session เก่าเลย — รันยาวๆ (เช่น auto-start 24/7) จะกิน RAM
# เพิ่มขึ้นเรื่อยๆ ไม่มีที่สิ้นสุด เพราะรูปภาพทุก session ถูกเก็บค้างไว้ตลอดอายุโปรเซส
# ใช้ TTL เป็นตัวจำกัดหลัก (หมดอายุอัตโนมัติหลัง 1 ชม.) — MAX_SESSIONS เป็นแค่เพดาน
# กันเหตุสุดวิสัย (ยิงถี่ผิดปกติ) เท่านั้น ตั้งไว้สูงพอที่จะไม่ไปแตะ session ที่ user
# เพิ่งโหลดเสร็จแต่ยังไม่ได้กด ZIP (ค่าเดิม 15 ต่ำเกินไป — เจอบั๊ก: ถ้ามี batch ใหม่
# เกิดขึ้น 15 ครั้งติดกัน session แรกที่ยังไม่ทันกด ZIP จะถูกไล่ออกก่อนเวลาอันควร)
sessions = {}   # session_id → {'images': {sku: bytes}, 'done': bool, 'created': float}
MAX_SESSIONS = int(os.environ.get('MAX_SESSIONS', '60'))
SESSION_TTL_SEC = 3600
# BUG FIX (race condition): Flask รันแบบ threaded=True — ถ้า 2 คำขอ /download มาถึง
# พร้อมกัน (เช่น 2 แท็บกด Download พร้อมกัน) การวน sessions.items() ในเธรดหนึ่ง
# ขณะอีกเธรดกำลังเพิ่ม/ลบ key ทำให้เกิด RuntimeError: dictionary changed size during
# iteration และคำขอนั้นพัง (500) ต้องล็อกทุกจุดที่แก้ไข sessions dict
_sessions_lock = threading.Lock()

def _prune_sessions():
    with _sessions_lock:
        now = time.time()
        expired = [sid for sid, s in list(sessions.items())
                   if now - s.get('created', now) > SESSION_TTL_SEC]
        for sid in expired:
            sessions.pop(sid, None)
        # dict คงลำดับการแทรก (Python 3.7+) — ตัวแรกสุดคือเก่าสุด
        while len(sessions) >= MAX_SESSIONS:
            sessions.pop(next(iter(sessions)), None)

def run_download(session_id, skus, queue, img_index=1, img_format='jpg'):
    """รัน download logic ใน background thread, ส่ง progress ผ่าน queue"""
    # FIX: ใช้ shared reference แทน local variable — /img endpoint อ่านได้ระหว่าง stream
    sess = sessions[session_id]
    images = sess['images']
    orig = sess['orig']       # เก็บต้นฉบับไว้ทำ dicut/คืนค่าได้
    fmtmap = sess['fmt']

    def cancelled():
        return sess.get('cancel', False)

    ok_direct, ok_google, not_found, errors = [], [], [], []

    def emit(data):
        queue.put(json.dumps(data))

    emit({'type': 'start', 'total': len(skus)})

    # ── STEP 1: Central direct (ขนาน 5 ตัวพร้อมกัน) ───────────────────────
    emit({'type': 'step', 'msg': 'STEP 1 — ค้น Central.co.th โดยตรง'})
    need_google = []

    def _direct_one(sku):
        """ค้น + โหลดรูป 1 SKU — คืน (ผลลัพธ์, ข้อมูล) ให้ thread หลัก emit"""
        img_url, status, page_html = try_central_direct(sku)
        if status == 'not_found':
            return 'need_google', None
        img_bytes = None
        # ขอรูปลำดับอื่น → ใช้แกลเลอรีของ variant ที่ค้นหาจริง (CDN-probe จากรูป search)
        if img_index > 1:
            gallery = _cdn_probe_series(img_url)   # แกลเลอรี variant ตรง (สีถูกต้อง)
            # probe เจอใบเดียว = อย่าเพิ่งเชื่อ (เคสรูป -2 เปลี่ยน prefix ชื่อไฟล์)
            # ปล่อยให้ตกไปดึงจากหน้า product ข้างล่าง และไม่ cache gcount=1 ค้างไว้
            if len(gallery) > 1:
                sess.setdefault('gallery', {})[sku] = gallery
                sess.setdefault('gcount', {})[sku] = len(gallery)
                pick = gallery[img_index - 1] if img_index <= len(gallery) else gallery[0]
                try:
                    img_bytes, w, h = fetch_image_bytes(pick, fmt=img_format)
                except Exception:
                    img_bytes = None
            # รูป search ไม่มีเลข -N (เช่น PROMO/GR) → ดึงแกลเลอรีจากหน้า product
            if img_bytes is None:
                link = find_product_link(page_html, sku)
                if link:
                    try:
                        img_bytes, w, h = fetch_from_product_url(
                            link, sku=sku, img_index=img_index, fmt=img_format)
                    except Exception:
                        img_bytes = None
        if img_bytes is None:
            img_bytes, w, h = fetch_image_bytes(img_url, fmt=img_format)  # fallback รูปแรก
        return 'ok', (img_bytes, w, h)

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(_direct_one, sku): sku for sku in skus}
        done_count = 0
        for fut in as_completed(futures):
            sku = futures[fut]
            done_count += 1
            emit({'type': 'progress', 'current': done_count, 'sku': sku,
                  'status': 'searching'})
            try:
                result, payload = fut.result()
                if result == 'need_google':
                    need_google.append(sku)
                    emit({'type': 'item', 'sku': sku, 'status': 'need_google',
                          'msg': 'ไม่พบ → จะค้น Google'})
                else:
                    img_bytes, w, h = payload
                    kb = round(len(img_bytes) / 1024, 2)
                    images[sku] = img_bytes
                    orig[sku] = img_bytes
                    fmtmap[sku] = img_format
                    ok_direct.append({'sku': sku, 'w': w, 'h': h, 'kb': kb})
                    emit({'type': 'item', 'sku': sku, 'status': 'ok',
                          'source': 'direct', 'w': w, 'h': h, 'kb': kb})
            except Exception as e:
                errors.append({'sku': sku, 'reason': str(e)})
                emit({'type': 'item', 'sku': sku, 'status': 'error', 'msg': str(e)})
    # คงลำดับเดิมตามที่ผู้ใช้พิมพ์ (as_completed ทำให้ลำดับสลับ)
    need_google.sort(key=skus.index)

    # ── STEP 1.5: ตรวจซ้ำละเอียดตอนระบบเงียบ (กู้ false-negative จากการยิงขนาน) ──
    # ตอน STEP 1 ยิง 5 ตัวพร้อมกัน Central อาจตอบ 'ไม่พบ' ปลอมให้บาง SKU
    # ทีนี้ระบบเงียบแล้ว ตรวจ SKU ที่ 'ไม่พบ' ใหม่ทีละตัว (หลายรอบ + curl_cffi)
    # ตัวที่กู้ได้จะดึงรูปเลย ไม่ต้องเสียเวลาไป Google
    if need_google and not cancelled():
        emit({'type': 'step',
              'msg': f'STEP 1.5 — ตรวจซ้ำ Central ทีละตัว ({len(need_google)} SKU)'})
        still_missing = []
        for sku in need_google:
            if cancelled():
                still_missing.append(sku)
                continue
            emit({'type': 'progress', 'sku': sku, 'status': 'rechecking'})
            img_url, status, page_html = recheck_central_thorough(sku)
            if status == 'not_found':
                still_missing.append(sku)
                continue
            try:
                img_bytes = None
                if img_index > 1:
                    link = find_product_link(page_html, sku)
                    if link:
                        try:
                            img_bytes, w, h = fetch_from_product_url(
                                link, sku=sku, img_index=img_index, fmt=img_format)
                        except Exception:
                            img_bytes = None
                    if img_bytes is None:
                        got = fetch_by_cdn_index(img_url, img_index, fmt=img_format)
                        if got:
                            img_bytes, w, h = got
                if img_bytes is None:
                    img_bytes, w, h = fetch_image_bytes(img_url, fmt=img_format)
                kb = round(len(img_bytes) / 1024, 2)
                images[sku] = img_bytes
                orig[sku] = img_bytes
                fmtmap[sku] = img_format
                ok_direct.append({'sku': sku, 'w': w, 'h': h, 'kb': kb})
                emit({'type': 'item', 'sku': sku, 'status': 'ok',
                      'source': 'direct', 'w': w, 'h': h, 'kb': kb})
            except Exception as e:
                still_missing.append(sku)
                errors.append({'sku': sku, 'reason': str(e)})
                emit({'type': 'item', 'sku': sku, 'status': 'error', 'msg': str(e)})
        need_google = still_missing

    # ── STEP 2: Google search ──────────────────────────────────────────────
    if need_google and not cancelled():
        emit({'type': 'step', 'msg': f'STEP 2 — ค้น Google ({len(need_google)} SKU)'})
        found_google = []
        for sku in need_google:
            if cancelled():
                break
            emit({'type': 'progress', 'sku': sku, 'status': 'googling'})
            url, err = try_google_search(sku)
            if url:
                found_google.append((sku, url))
                emit({'type': 'item', 'sku': sku, 'status': 'found_google',
                      'msg': 'เจอบน Google'})
            elif err == 'google_blocked':
                not_found.append(sku)
                emit({'type': 'item', 'sku': sku, 'status': 'blocked',
                      'msg': 'Google CAPTCHA'})
            else:
                not_found.append(sku)
                emit({'type': 'item', 'sku': sku, 'status': 'not_found',
                      'msg': 'ไม่พบ'})

        # ── STEP 3: Download Google results (ขนาน — โหลดจาก central เท่านั้น) ──
        if found_google and not cancelled():
            emit({'type': 'step',
                  'msg': f'STEP 3 — ดาวน์โหลดจาก Google ({len(found_google)} SKU)'})
            with ThreadPoolExecutor(max_workers=5) as pool:
                futures = {pool.submit(fetch_from_product_url, prod_url,
                                       sku=sku, img_index=img_index, fmt=img_format): sku
                           for sku, prod_url in found_google}
                for fut in as_completed(futures):
                    sku = futures[fut]
                    emit({'type': 'progress', 'sku': sku, 'status': 'downloading'})
                    try:
                        img_bytes, w, h = fut.result()
                        kb = round(len(img_bytes) / 1024, 2)
                        images[sku] = img_bytes
                        orig[sku] = img_bytes
                        fmtmap[sku] = img_format
                        ok_google.append({'sku': sku, 'w': w, 'h': h, 'kb': kb})
                        emit({'type': 'item', 'sku': sku, 'status': 'ok',
                              'source': 'google', 'w': w, 'h': h, 'kb': kb})
                    except Exception as e:
                        errors.append({'sku': sku, 'reason': str(e)})
                        emit({'type': 'item', 'sku': sku, 'status': 'error',
                              'msg': str(e)})

    # ── Done ───────────────────────────────────────────────────────────────
    # FIX: อัปเดต 'done' ใน-place ไม่ reassign dict ใหม่ (ไม่งั้น shared reference หาย)
    sessions[session_id]['done'] = True
    emit({'type': 'done',
          'ok_direct': ok_direct,
          'ok_google': ok_google,
          'not_found': not_found,
          'errors': errors,
          'has_images': len(images) > 0})
    queue.put(None)  # sentinel

# ── Flask Routes ──────────────────────────────────────────────────────────────

@app.route('/')
def index():
    if ACCESS_PASSWORD:
        token = request.args.get('token') or request.cookies.get('access_token')
        if token != ACCESS_PASSWORD:
            return LOGIN_PAGE
    return HTML_PAGE.replace('__MAX_SKUS__', str(MAX_SKUS_PER_JOB))

@app.route('/auth', methods=['POST'])
def auth():
    from flask import make_response, redirect
    pwd = request.form.get('password', '')
    if pwd == ACCESS_PASSWORD:
        resp = make_response(redirect('/'))
        resp.set_cookie('access_token', pwd, max_age=86400*30, httponly=True,
                        secure=request.is_secure, samesite='Lax')
        return resp
    return LOGIN_PAGE.replace('</form>', '<p style="color:red;margin-top:10px">รหัสผ่านไม่ถูกต้อง</p></form>')

@app.route('/download', methods=['POST'])
@require_auth
def download():
    import uuid
    data = request.get_json(silent=True) or {}
    raw_skus = [s.strip().upper() for s in re.split(r'[\s,]+', data.get('skus', '')) if s.strip()]
    # ตัด SKU ซ้ำออก (คงลำดับเดิม) — กัน SKU เดียวกันโดนยิงค้น/โหลดซ้ำสองรอบ
    # ซึ่งทำให้ตัวเลขสรุปเพี้ยน เปลืองโควตา Google และเพิ่มความเสี่ยงโดน rate-limit
    seen = set()
    skus = [s for s in raw_skus if not (s in seen or seen.add(s))]
    if not skus:
        return {'error': 'ไม่มี SKU'}, 400
    if len(skus) > MAX_SKUS_PER_JOB:
        return {'error': f'ใส่ได้สูงสุด {MAX_SKUS_PER_JOB} SKU ต่อรอบ'}, 400
    try:
        img_index = max(1, min(20, int(data.get('img_index', 1) or 1)))
    except (TypeError, ValueError):
        img_index = 1
    img_format = 'png' if data.get('img_format') == 'png' else 'jpg'

    _prune_sessions()
    session_id = str(uuid.uuid4())
    with _sessions_lock:
        sessions[session_id] = {'images': {}, 'orig': {}, 'fmt': {},
                                'dl_fmt': img_format, 'cancel': False,
                                'done': False, 'created': time.time()}

    queue = Queue()

    def generate():
        # FIX: emit session ID ก่อนสุด เพื่อให้ addImage() เรียก /img ได้ระหว่าง stream
        yield f'data: {json.dumps({"type":"session","id":session_id})}\n\n'
        def guarded_download():
            with _download_slots:
                run_download(session_id, skus, queue, img_index, img_format)
        thread = threading.Thread(target=guarded_download, daemon=True)
        thread.start()
        while True:
            try:
                msg = queue.get(timeout=60)
                if msg is None:
                    break
                yield f'data: {msg}\n\n'
            except Empty:
                yield 'data: {"type":"ping"}\n\n'

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )

@app.route('/zip/<session_id>')
@require_auth
def get_zip(session_id):
    sess = sessions.get(session_id)
    if not sess or not sess['images']:
        return 'ไม่พบไฟล์', 404
    fmt = sess.get('fmt', {})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for sku, img_bytes in sess['images'].items():
            ext = 'png' if fmt.get(sku) == 'png' else 'jpg'
            zf.writestr(f'{sku}.{ext}', img_bytes)
    buf.seek(0)
    return send_file(buf, mimetype='application/zip',
                     as_attachment=True, download_name='central_images.zip')

@app.route('/img/<session_id>/<sku>')
@require_auth
def get_img(session_id, sku):
    sess = sessions.get(session_id)
    if not sess or sku not in sess['images']:
        return 'ไม่พบ', 404
    is_png = sess.get('fmt', {}).get(sku) == 'png'
    return send_file(io.BytesIO(sess['images'][sku]),
                     mimetype='image/png' if is_png else 'image/jpeg')

@app.route('/dicut/<session_id>/<sku>', methods=['POST'])
@require_auth
def dicut_one(session_id, sku):
    """ลบพื้นหลัง 1 รูป — method: 'white' (เร็ว), 'ai' (rembg), 'orig' (คืนต้นฉบับ)
    ทำจากรูปต้นฉบับเสมอ เพื่อสลับวิธี/คืนค่าได้โดยไม่ต้องโหลดใหม่"""
    sess = sessions.get(session_id)
    if not sess or sku not in sess.get('orig', {}):
        return {'ok': False, 'error': 'ไม่พบรูป'}
    method = (request.json or {}).get('method', 'white')
    src = sess['orig'][sku]
    try:
        if method == 'orig':
            sess['images'][sku] = src
            sess['fmt'][sku] = sess.get('dl_fmt', 'jpg')
            sess.get('orig_crop', {}).pop(sku, None)  # ไม่มีอะไรให้เปรียบเทียบแล้ว
            return {'ok': True, 'transparent': False}
        if method == 'ai':
            if not HAS_REMBG:
                return {'ok': False, 'error': 'rembg ยังไม่ได้ติดตั้ง', 'need_install': True}
            out, size, orig_crop = dicut_ai(src)
        else:
            out, size, orig_crop = dicut_white(src)
        sess['images'][sku] = out
        sess['fmt'][sku] = 'png'
        sess.setdefault('orig_crop', {})[sku] = orig_crop  # ต้นฉบับ crop กรอบเดียวกัน
        return {'ok': True, 'transparent': True, 'w': size[0], 'h': size[1]}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

@app.route('/img-orig/<session_id>/<sku>')
@require_auth
def get_img_orig(session_id, sku):
    """รูปต้นฉบับ (crop กรอบเดียวกับ dicut) — สำหรับ comparison slider"""
    sess = sessions.get(session_id)
    if not sess:
        return 'ไม่พบ', 404
    b = sess.get('orig_crop', {}).get(sku)
    if b:
        return send_file(io.BytesIO(b), mimetype='image/jpeg')
    b = sess.get('orig', {}).get(sku)
    if not b:
        return 'ไม่พบ', 404
    is_png = sess.get('dl_fmt') == 'png'
    return send_file(io.BytesIO(b), mimetype='image/png' if is_png else 'image/jpeg')

@app.route('/has-ai')
def has_ai():
    return {'available': HAS_REMBG}

# ── Dicut PS Helper สำหรับ Mac — แจกจากหน้าเว็บ ────────────────────────────────
# เครื่อง Mac ที่เข้าผ่าน LAN ไม่ต้องมาเอาไฟล์จากโฟลเดอร์แจกจ่าย: กดปุ่ม Dicut PS
# แล้วไม่เจอ helper → JS ชวนโหลด /dicut-ps-helper.zip (ตัวติดตั้งไฟล์เดียว ฝังทุกอย่าง)
# ทำไมต้อง zip: ไฟล์ .command ที่โหลดตรงๆ จะเสีย execute bit แต่ unzip ด้วย
# Archive Utility คืน exec bit ให้ (เราตั้ง external_attr 755 ไว้ใน zip)
# browser รันไฟล์ให้เองไม่ได้ (security) — user ต้องดับเบิลคลิกเองครั้งเดียว

_HELPER_PY = r'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dicut PS Helper (Mac) — ตัวช่วยจิ๋วสำหรับปุ่ม "Dicut PS" ของ Central Image Downloader
ฟังที่ http://localhost:5010 (เฉพาะในเครื่อง) สั่ง Photoshop ตัดพื้นหลังให้หน้าเว็บ LAN
ใช้ Python มาตรฐานล้วน ไม่ต้อง pip install"""
import glob
import http.server
import json
import os
import subprocess
import tempfile
import threading

PORT = 5010
_lock = threading.Lock()   # Photoshop ทำทีละรูป

def ps_app_name():
    apps = sorted(glob.glob('/Applications/Adobe Photoshop*/Adobe Photoshop*.app'))
    if not apps:
        return None
    return os.path.splitext(os.path.basename(apps[-1]))[0]

JSX_TEMPLATE = """
var _src = File("%s"); var _out = File("%s");
app.displayDialogs = DialogModes.NO;

function fail(step, err) {
    var msg = err && err.message ? err.message : String(err);
    var num = err && err.number ? (" #" + err.number) : "";
    throw new Error("Dicut PS removeBackground failed at " + step + num + ": " + msg);
}

var doc = null;
try {
    try { doc = app.open(_src); } catch (eOpen) { fail("open", eOpen); }
    try {
        if (doc.layers[0].isBackgroundLayer) doc.layers[0].isBackgroundLayer = false;
        doc.activeLayer = doc.layers[0];
    } catch (eLayer) { fail("prepare layer", eLayer); }
    try {
        executeAction(stringIDToTypeID('removeBackground'), undefined, DialogModes.NO);
    } catch (eRemove) { fail("removeBackground", eRemove); }
    try {
        var o = new PNGSaveOptions();
        doc.saveAs(_out, o, true, Extension.LOWERCASE);
    } catch (eSave) { fail("save PNG", eSave); }
} finally {
    if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
}
"""

def remove_bg(data):
    app_name = ps_app_name()
    if not app_name:
        raise RuntimeError('ไม่พบ Photoshop ใน /Applications')
    ext = '.png' if data[:4] == b'\x89PNG' else '.jpg'
    with _lock, tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, 'in' + ext)
        dst = os.path.join(td, 'out.png')
        jsx = os.path.join(td, 'run.jsx')
        with open(src, 'wb') as f:
            f.write(data)
        # Photoshop ไม่รองรับ do javascript with arguments → ฝัง path ลงไฟล์ jsx ตรงๆ
        with open(jsx, 'w') as f:
            f.write(JSX_TEMPLATE % (src, dst))
        subprocess.run(
            ['osascript', '-e',
             'tell application "%s" to do javascript (POSIX file "%s" as alias)' % (app_name, jsx)],
            check=True, capture_output=True, timeout=180)
        with open(dst, 'rb') as f:
            return f.read()

class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode(), 'application/json')

    def do_GET(self):
        if self.path == '/has-ps':
            self._json({'available': ps_app_name() is not None})
        else:
            self._json({'error': 'not found'}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path != '/ps-remove-bg':
            self._json({'error': 'not found'}, 404)
            return
        try:
            n = int(self.headers.get('Content-Length', '0'))
            data = self.rfile.read(n)
            png = remove_bg(data)
            self._send(200, png, 'image/png')
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or b'').decode('utf-8', 'replace').strip()
            self._json({'ok': False, 'error': 'Photoshop error: ' + msg}, 500)
        except Exception as e:
            self._json({'ok': False, 'error': str(e)}, 500)

    def log_message(self, *a):
        pass

if __name__ == '__main__':
    import sys
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('Dicut PS Helper - http://localhost:%d (Photoshop: %s)' % (PORT, ps_app_name() or 'NOT FOUND'))
    srv.serve_forever()
'''

_HELPER_RUNNER = r'''#!/bin/bash
# รัน Dicut PS Helper เบื้องหลัง (ถูกเรียกอัตโนมัติตอนเปิดเครื่อง — ไม่ต้องกดเอง)
cd "$(dirname "$0")"
if curl -s -o /dev/null --max-time 2 http://localhost:5010/has-ps; then exit 0; fi
PYTHON=""
for p in python3.12 python3.11 python3.10 python3.9 python3; do
    if command -v "$p" >/dev/null 2>&1; then PYTHON="$(command -v $p)"; break; fi
done
[ -z "$PYTHON" ] && exit 1
nohup "$PYTHON" dicut_ps_helper.py >/tmp/dicut_ps_helper.log 2>&1 &
sleep 2
osascript -e 'tell application "Terminal" to close (every window whose name contains "Dicut PS Helper run")' >/dev/null 2>&1 &
exit 0
'''

_HELPER_INSTALLER = r'''#!/bin/bash
# ==============================================================
#  ติดตั้ง Dicut PS Helper (ดับเบิลคลิกครั้งเดียว)
#  ให้ปุ่ม "Dicut PS" ในหน้าเว็บ Central Image Downloader
#  ใช้ Photoshop ของเครื่อง Mac นี้ตัดพื้นหลังได้
# ==============================================================
DIR="$HOME/Library/Application Support/Dicut PS Helper"
RUNNER="$DIR/Dicut PS Helper run.command"

echo "=============================================="
echo "  ติดตั้ง Dicut PS Helper"
echo "=============================================="
echo ""

PSAPP=$(ls -d /Applications/Adobe\ Photoshop*/Adobe\ Photoshop*.app 2>/dev/null | tail -1)
if [ -z "$PSAPP" ]; then
    echo "❌ ไม่พบ Photoshop ใน /Applications — ติดตั้ง Photoshop ก่อนแล้วรันไฟล์นี้ใหม่"
    read -p "กด Enter เพื่อปิด..."
    exit 1
fi
echo "✅ พบ Photoshop: $(basename "$PSAPP")"

PYTHON=""
for p in python3.12 python3.11 python3.10 python3.9 python3; do
    if command -v "$p" >/dev/null 2>&1; then PYTHON="$(command -v $p)"; break; fi
done
if [ -z "$PYTHON" ]; then
    echo "❌ ไม่พบ Python 3 — ติดตั้งจาก python.org หรือรัน 'xcode-select --install' ก่อน"
    read -p "กด Enter เพื่อปิด..."
    exit 1
fi
echo "✅ Python: $PYTHON"

mkdir -p "$DIR"
cat > "$DIR/dicut_ps_helper.py" <<'PYEOF'
__HELPER_PY__
PYEOF
cat > "$RUNNER" <<'RUNEOF'
__HELPER_RUNNER__
RUNEOF
chmod +x "$RUNNER"
echo "✅ ติดตั้งไฟล์ลง $DIR แล้ว"

osascript >/dev/null 2>&1 <<EOF
tell application "System Events"
    try
        delete (every login item whose name contains "Dicut PS Helper run")
    end try
    make login item at end with properties {path:"$RUNNER", hidden:true}
end tell
EOF
echo "✅ ตั้งค่าเปิดอัตโนมัติตอนเปิดเครื่องแล้ว"

pkill -f "dicut_ps_helper\.py" 2>/dev/null
sleep 1
cd "$DIR"
nohup "$PYTHON" dicut_ps_helper.py >/tmp/dicut_ps_helper.log 2>&1 &

OK=""
for i in $(seq 1 10); do
    sleep 1
    if curl -s --max-time 2 http://localhost:5010/has-ps | grep -q true; then OK=1; break; fi
done

if [ -n "$OK" ]; then
    echo ""
    echo "✅ สำเร็จ! กลับไปหน้าเว็บแล้วกดปุ่ม 🖌️ Dicut PS ได้เลย"
    echo "   ⚠ ครั้งแรกที่กด macOS อาจถามสิทธิ์ให้ Python ควบคุม Photoshop — กด OK"
else
    echo ""
    echo "❌ helper ยังไม่ตอบ — error ล่าสุดจาก log:"
    echo "----------------------------------------------"
    tail -15 /tmp/dicut_ps_helper.log 2>/dev/null || echo "(ไม่มี log)"
    echo "----------------------------------------------"
fi
echo ""
# ถ้ารันผ่าน curl|bash (stdin เป็น pipe) ไม่ต้องรอกด Enter
[ -t 0 ] && read -p "กด Enter เพื่อปิดหน้าต่างนี้..."
exit 0
'''

def _helper_installer_cmd():
    return (_HELPER_INSTALLER
            .replace('__HELPER_PY__', _HELPER_PY.strip())
            .replace('__HELPER_RUNNER__', _HELPER_RUNNER.strip()))

@app.route('/dicut-ps-helper.sh')
def dicut_ps_helper_sh():
    """ตัวติดตั้งแบบข้อความ สำหรับ `curl ... | bash` — macOS ใหม่ (Sequoia) บล็อก
    .command ที่ดาวน์โหลดมาแบบไม่มีปุ่มยอม (Gatekeeper) แต่สคริปต์ที่ pipe เข้า
    bash ตรงๆ ไม่โดน quarantine เพราะไม่มีไฟล์ถูกบันทึกลงเครื่อง"""
    resp = app.make_response(_helper_installer_cmd())
    resp.headers['Content-Type'] = 'text/plain; charset=utf-8'
    return resp

@app.route('/dicut-ps-helper.zip')
def dicut_ps_helper_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        info = zipfile.ZipInfo('ติดตั้ง Dicut PS Helper.command')
        info.external_attr = 0o755 << 16      # exec bit — Archive Utility คืนให้ตอน unzip
        z.writestr(info, _helper_installer_cmd())
    buf.seek(0)
    return send_file(buf, mimetype='application/zip', as_attachment=True,
                     download_name='dicut-ps-helper.zip')

# ── Dicut PS endpoints ─────────────────────────────────────────────────────────
# /has-ps + /ps-remove-bg ต้องมี CORS เพราะหน้าเว็บที่เปิดผ่าน LAN (origin
# http://10.x.x.x:5000) จะ fetch ข้าม origin มาที่ http://localhost:5000 ของตัวเอง

def _cors_json(data, code=200):
    resp = app.make_response((json.dumps(data), code))
    resp.headers['Content-Type'] = 'application/json'
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp

@app.route('/has-ps')
def has_ps():
    return _cors_json({'available': has_photoshop()})

@app.route('/ps-remove-bg', methods=['POST', 'OPTIONS'])
def ps_remove_bg():
    """stateless: รับรูปดิบ → คืน PNG ที่ Photoshop ตัดพื้นแล้ว (เต็มเฟรม ไม่ trim)
    รับเฉพาะจาก localhost — เครื่อง LAN ให้ browser ยิงมาที่ instance ของตัวเอง"""
    if request.method == 'OPTIONS':
        resp = app.make_response('')
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return resp
    remote = request.remote_addr or ''
    if remote not in ('127.0.0.1', '::1'):
        return _cors_json({'ok': False, 'error': 'localhost เท่านั้น'}, 403)
    if not has_photoshop():
        return _cors_json({'ok': False, 'error': 'ไม่พบ Photoshop ในเครื่องนี้'}, 501)
    try:
        png = ps_remove_bg_bytes(request.get_data())
        resp = app.make_response(png)
        resp.headers['Content-Type'] = 'image/png'
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp
    except Exception as e:
        return _cors_json({'ok': False, 'error': str(e)}, 500)

@app.route('/img-raw/<session_id>/<sku>')
@require_auth
def get_img_raw(session_id, sku):
    """รูปต้นฉบับดิบ (ไม่ crop) — ให้ browser เอาไปส่งเข้า /ps-remove-bg"""
    sess = sessions.get(session_id)
    if not sess or sku not in sess.get('orig', {}):
        return 'ไม่พบ', 404
    return send_file(io.BytesIO(sess['orig'][sku]), mimetype='application/octet-stream')

@app.route('/apply-dicut/<session_id>/<sku>', methods=['POST'])
@require_auth
def apply_dicut(session_id, sku):
    """รับ PNG โปร่งใส (เต็มเฟรมเท่าต้นฉบับ) ที่ตัดพื้นมาแล้วจากเครื่องอื่น
    → trim + ทำ orig_crop เหมือน dicut ปกติ แล้วเก็บเข้า session"""
    sess = sessions.get(session_id)
    if not sess or sku not in sess.get('orig', {}):
        return {'ok': False, 'error': 'ไม่พบรูป'}
    try:
        rgba = Image.open(io.BytesIO(request.get_data())).convert('RGBA')
        orig = Image.open(io.BytesIO(sess['orig'][sku])).convert('RGB')
        if rgba.size != orig.size:
            orig = orig.resize(rgba.size)
        out, size, orig_crop = _finish_dicut(rgba, orig)
        sess['images'][sku] = out
        sess['fmt'][sku] = 'png'
        sess.setdefault('orig_crop', {})[sku] = orig_crop
        return {'ok': True, 'transparent': True, 'w': size[0], 'h': size[1]}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

@app.route('/cancel/<session_id>', methods=['POST'])
@require_auth
def cancel_download(session_id):
    """ตั้งค่าให้หยุดงานที่กำลังทำ (worker เช็ค flag นี้ระหว่าง STEP 2/3)"""
    sess = sessions.get(session_id)
    if sess:
        sess['cancel'] = True
    return {'ok': True}

@app.route('/default-folder')
def default_folder():
    downloads = Path.home() / 'Downloads' / 'central_images'
    return {'folder': str(downloads)}

@app.route('/pick-folder')
def pick_folder():
    remote = request.remote_addr or ''
    if remote not in ('127.0.0.1', '::1', 'localhost'):
        return {'ok': False, 'error': 'localhost เท่านั้น'}, 403
    if IS_MAC:
        try:
            result = subprocess.run(
                ['osascript', '-e',
                 'set f to POSIX path of (choose folder with prompt "เลือกโฟลเดอร์บันทึกภาพ" default location (path to downloads folder))'],
                capture_output=True, text=True, timeout=60)
            folder = result.stdout.strip().rstrip('/')
            if folder:
                return {'ok': True, 'folder': folder}
            return {'ok': False, 'cancelled': True}
        except subprocess.TimeoutExpired:
            return {'ok': False, 'cancelled': True}
        except Exception as e:
            return {'ok': False, 'error': str(e)}
    # Windows — PowerShell FolderBrowserDialog (ใช้งานได้ทั้ง browser mode และ .exe)
    try:
        ps_script = (
            'Add-Type -AssemblyName System.Windows.Forms;'
            'Add-Type -AssemblyName System.Drawing;'
            '$d = New-Object System.Windows.Forms.FolderBrowserDialog;'
            '$d.Description = "เลือกโฟลเดอร์บันทึกภาพ";'
            '$d.RootFolder = "MyComputer";'
            '$d.SelectedPath = [Environment]::GetFolderPath("MyDocuments");'
            '$h = New-Object System.Windows.Forms.Form;'
            '$h.TopMost = $true; $h.Size = New-Object System.Drawing.Size(0,0);'
            '$h.StartPosition = "CenterScreen";'
            'if ($d.ShowDialog($h) -eq "OK") { $d.SelectedPath }'
        )
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', ps_script],
            capture_output=True, text=True, timeout=60)
        folder = result.stdout.strip()
        if folder:
            return {'ok': True, 'folder': folder}
        return {'ok': False, 'cancelled': True}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'cancelled': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

@app.route('/is-local')
def is_local():
    remote = request.remote_addr or ''
    local = remote in ('127.0.0.1', '::1', 'localhost')
    return {'local': local}

@app.route('/prepare-folder', methods=['POST'])
def prepare_folder():
    remote = request.remote_addr or ''
    if remote not in ('127.0.0.1', '::1', 'localhost'):
        return {'ok': False, 'error': 'localhost เท่านั้น'}, 403
    data = request.json or {}
    folder = data.get('folder', '').strip()
    if not folder:
        return {'ok': False, 'error': 'ไม่ได้ระบุโฟลเดอร์'}
    try:
        Path(folder).mkdir(parents=True, exist_ok=True)
        return {'ok': True, 'folder': folder}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

@app.route('/save-folder', methods=['POST'])
def save_folder():
    remote = request.remote_addr or ''
    if remote not in ('127.0.0.1', '::1', 'localhost'):
        return {'ok': False, 'error': 'localhost เท่านั้น'}, 403
    data = request.json or {}
    session_id = data.get('session_id', '')
    sku = data.get('sku', '')
    folder = data.get('folder', '').strip()
    prefix = _safe_prefix(data.get('prefix', ''))
    sess = sessions.get(session_id)
    if not sess or sku not in sess['images']:
        return {'ok': False, 'error': 'ไม่พบรูป'}
    if not folder:
        return {'ok': False, 'error': 'ไม่ได้ระบุโฟลเดอร์'}
    try:
        Path(folder).mkdir(parents=True, exist_ok=True)
        ext = 'png' if sess.get('fmt', {}).get(sku) == 'png' else 'jpg'
        base = f'{prefix}{sku}'
        out = Path(folder) / f'{base}.{ext}'
        out.write_bytes(sess['images'][sku])
        # ลบไฟล์นามสกุล "อีกอัน" ของ SKU เดียวกันทิ้งเสมอ กันไฟล์ซ้ำ 2 นามสกุล
        # (เช่น dicut → .png ต้องลบ .jpg เดิม / กดต้นฉบับ → .jpg ต้องลบ .png ที่ dicut สร้างไว้)
        other = Path(folder) / f'{base}.{"jpg" if ext == "png" else "png"}'
        if other.exists():
            try: other.unlink()
            except OSError: pass
        return {'ok': True, 'path': str(out)}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

@app.route('/open-folder', methods=['POST'])
def open_folder():
    """เปิดโฟลเดอร์ใน File Explorer / Finder (localhost เท่านั้น)"""
    remote = request.remote_addr or ''
    if remote not in ('127.0.0.1', '::1', 'localhost'):
        return {'ok': False, 'error': 'localhost เท่านั้น'}, 403
    folder = (request.json or {}).get('folder', '').strip()
    if not folder or not Path(folder).exists():
        return {'ok': False, 'error': 'ไม่พบโฟลเดอร์'}
    try:
        if IS_MAC:
            subprocess.Popen(['open', folder])
        else:
            os.startfile(folder)  # type: ignore[attr-defined]
        return {'ok': True}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

def _get_gallery_urls(sess, sku):
    """คืน list URL แกลเลอรีของ SKU (มี cache ต่อ session) — ใช้ resolve_variant_gallery"""
    cache = sess.setdefault('gallery', {})
    if sku not in cache:
        cache[sku] = resolve_variant_gallery(sku)
        sess.setdefault('gcount', {})[sku] = max(len(cache[sku]), 1)
    return cache[sku]

@app.route('/set-image/<session_id>/<sku>', methods=['POST'])
@require_auth
def set_image(session_id, sku):
    """เปลี่ยนรูปของ SKU เดียวเป็นลำดับที่ต้องการ (per-card image order)
    ใช้แกลเลอรีของ variant ที่ค้นหาจริง (สีถูกต้อง) — ดึงรูปลำดับที่ขอตรงจาก CDN"""
    sess = sessions.get(session_id)
    if not sess:
        return {'ok': False, 'error': 'session หมดอายุ'}
    try:
        index = max(1, min(20, int((request.json or {}).get('index', 1))))
    except (TypeError, ValueError):
        index = 1
    dl_fmt = sess.get('dl_fmt', 'jpg')
    try:
        gallery = _get_gallery_urls(sess, sku)
        if not gallery:
            return {'ok': False, 'error': 'หารูปไม่เจอ'}
        total_imgs = len(gallery)
        pick = gallery[index - 1] if 1 <= index <= total_imgs else gallery[0]
        img_bytes, w, h = fetch_image_bytes(pick, fmt=dl_fmt)
        sess['images'][sku] = img_bytes
        sess['orig'][sku] = img_bytes
        sess['fmt'][sku] = dl_fmt
        sess.get('orig_crop', {}).pop(sku, None)   # เปลี่ยนรูป = ล้างต้นฉบับ crop เดิม
        return {'ok': True, 'total': total_imgs, 'index': min(index, total_imgs)}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

@app.route('/img-count/<session_id>/<sku>')
@require_auth
def img_count(session_id, sku):
    """นับจำนวนรูปในแกลเลอรีของ SKU (สำหรับแสดงปุ่มเลขต่อการ์ดตามจริง) — มี cache"""
    sess = sessions.get(session_id)
    if not sess:
        return {'ok': False}
    cache = sess.setdefault('gcount', {})
    if sku in cache:
        return {'ok': True, 'total': cache[sku], 'cached': True}
    try:
        gallery = _get_gallery_urls(sess, sku)
        total = max(len(gallery), 1)
        return {'ok': True, 'total': total}
    except Exception:
        return {'ok': False}

@app.route('/thumb/<session_id>/<sku>/<int:index>')
@require_auth
def get_thumb(session_id, sku, index):
    """รูปย่อ (thumbnail) ของแกลเลอรีลำดับที่ N — สำหรับโชว์เป็นปุ่มเลือกลำดับ (มี cache)"""
    sess = sessions.get(session_id)
    if not sess:
        return 'ไม่พบ', 404
    tcache = sess.setdefault('thumbs', {})
    key = f'{sku}#{index}'
    if key not in tcache:
        try:
            gallery = _get_gallery_urls(sess, sku)
            if not gallery or index < 1 or index > len(gallery):
                return 'ไม่พบ', 404
            r = _http.get(gallery[index - 1],
                          headers={**HEADERS, 'Referer': 'https://www.central.co.th/'}, timeout=15)
            r.raise_for_status()
            im = Image.open(io.BytesIO(r.content)).convert('RGB')
            im.thumbnail((130, 130))
            buf = io.BytesIO()
            im.save(buf, 'JPEG', quality=80)
            tcache[key] = buf.getvalue()
        except Exception:
            return 'ไม่พบ', 404
    return send_file(io.BytesIO(tcache[key]), mimetype='image/jpeg')

# ── Login Page ────────────────────────────────────────────────────────────────

LOGIN_PAGE = '''<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Central Image Downloader — เข้าสู่ระบบ</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: #f0f2f5; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; }
  .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,.1);
          padding: 40px 36px; width: 100%; max-width: 380px; text-align: center; }
  .logo { background: #0066cc; color: #fff; width: 60px; height: 60px; border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
          font-size: 28px; margin: 0 auto 20px; }
  h1 { font-size: 1.2rem; font-weight: 700; margin-bottom: 6px; }
  p  { color: #888; font-size: .9rem; margin-bottom: 24px; }
  input { width: 100%; border: 1.5px solid #d0d7de; border-radius: 8px;
          padding: 12px 14px; font-size: 1rem; outline: none; transition: border .2s; }
  input:focus { border-color: #0066cc; }
  button { width: 100%; background: #0066cc; color: #fff; border: none;
           border-radius: 8px; padding: 12px; font-size: 1rem; font-weight: 600;
           cursor: pointer; margin-top: 14px; transition: opacity .15s; }
  button:hover { opacity: .88; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">🛍</div>
  <h1>Central Image Downloader</h1>
  <p>กรอกรหัสผ่านเพื่อเข้าใช้งาน</p>
  <form method="POST" action="/auth">
    <input type="password" name="password" placeholder="รหัสผ่าน" autofocus>
    <button type="submit">เข้าสู่ระบบ</button>
  </form>
</div>
</body>
</html>'''

# ── HTML (embedded) ────────────────────────────────────────────────────────────

HTML_PAGE = '''<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Central Image Downloader</title>
<script>try{var _t=localStorage.getItem('theme');if(_t)document.documentElement.setAttribute('data-theme',_t);}catch(e){}</script>
<style>
  :root {
    --red:#e53935; --red-dark:#b71c1c;
    --bg:#f4f3f2; --card:#ffffff; --ink:#242020; --ink-soft:#6f6764;
    --line:#e9e2e0; --field:#fbfafa; --field-line:#d8cecb;
    --ok:#15803d; --ok-bg:#dcfce7; --warn:#b45309; --warn-bg:#fef3c7;
    --miss:#64748b; --miss-bg:#eef1f4; --info:#0d6efd; --ai:#7c3aed; --green:#198754;
    --log-bg:#1e1e1e;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#181514; --card:#242020; --ink:#efe9e7; --ink-soft:#a89f9c;
      --line:#352d2b; --field:#1e1a19; --field-line:#423836;
      --ok:#4ade80; --ok-bg:#14321f; --warn:#fbbf24; --warn-bg:#33260a;
      --miss:#94a3b8; --miss-bg:#232a33; --log-bg:#141414; }
  }
  :root[data-theme="dark"] { --bg:#181514; --card:#242020; --ink:#efe9e7; --ink-soft:#a89f9c;
    --line:#352d2b; --field:#1e1a19; --field-line:#423836;
    --ok:#4ade80; --ok-bg:#14321f; --warn:#fbbf24; --warn-bg:#33260a;
    --miss:#94a3b8; --miss-bg:#232a33; --log-bg:#141414; }
  :root[data-theme="light"] { --bg:#f4f3f2; --card:#ffffff; --ink:#242020; --ink-soft:#6f6764;
    --line:#e9e2e0; --field:#fbfafa; --field-line:#d8cecb;
    --ok:#15803d; --ok-bg:#dcfce7; --warn:#b45309; --warn-bg:#fef3c7;
    --miss:#64748b; --miss-bg:#eef1f4; --log-bg:#1e1e1e; }

  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Sarabun",sans-serif;
         background:var(--bg); color:var(--ink); min-height:100vh; -webkit-font-smoothing:antialiased; }
  .tnum { font-variant-numeric:tabular-nums; }

  header { background:var(--red); color:#fff; padding:16px 26px; display:flex; align-items:center; gap:12px; }
  header h1 { font-size:1.25rem; font-weight:700; }
  header span { font-size:.82rem; opacity:.85; }
  .theme-toggle { margin-left:auto; background:rgba(255,255,255,.16); color:#fff; border:none;
    border-radius:8px; padding:8px 12px; font-size:.85rem; cursor:pointer; font-weight:600; }
  .theme-toggle:hover { background:rgba(255,255,255,.26); }

  .container { max-width:880px; margin:26px auto; padding:0 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
          box-shadow:0 1px 3px rgba(0,0,0,.05); padding:22px; margin-bottom:18px; }
  .card h2 { font-size:1rem; font-weight:600; margin-bottom:14px; color:var(--ink);
             display:flex; align-items:center; gap:8px; }

  textarea { width:100%; height:110px; border:1.5px solid var(--field-line); background:var(--field);
    color:var(--ink); border-radius:8px; padding:11px 13px; font-family:'Menlo','Consolas',monospace;
    font-size:.9rem; resize:vertical; outline:none; transition:border .15s; }
  textarea:focus { border-color:var(--red); }
  textarea.drag { border-color:var(--info); border-style:dashed; background:var(--miss-bg); }

  .btn-row { display:flex; gap:10px; margin-top:13px; align-items:center; flex-wrap:wrap; }
  button { border:none; border-radius:8px; cursor:pointer; font-size:.92rem; font-weight:600;
    padding:10px 20px; transition:opacity .15s, transform .08s; }
  button:active { transform:scale(.97); }
  button:disabled { opacity:.5; cursor:not-allowed; transform:none; }
  .btn-primary { background:var(--red); color:#fff; }
  .btn-primary:hover:not(:disabled) { background:var(--red-dark); }
  .btn-stop { background:#374151; color:#fff; }
  .btn-secondary { background:var(--field); color:var(--ink); border:1px solid var(--field-line); }
  .btn-secondary:hover:not(:disabled) { border-color:var(--red); color:var(--red); }
  .btn-green { background:var(--green); color:#fff; }

  .field-group { display:flex; align-items:center; gap:6px; font-size:.85rem; color:var(--ink-soft); }
  select, input[type=text] { border:1.5px solid var(--field-line); background:var(--field); color:var(--ink);
    border-radius:8px; font-size:.88rem; outline:none; padding:8px 10px; }
  select { cursor:pointer; }
  select:focus, input[type=text]:focus { border-color:var(--red); }
  .count-live { margin-left:auto; font-size:.85rem; color:var(--ink-soft); }
  .count-live b { color:var(--red); font-size:1rem; }

  .prog-wrap { background:var(--field); border:1px solid var(--line); border-radius:99px; height:8px;
    margin:13px 0 6px; overflow:hidden; }
  .prog-bar { height:100%; background:var(--red); border-radius:99px; width:0; transition:width .3s; }
  #prog-label { font-size:.8rem; color:var(--ink-soft); }

  .opts { display:flex; gap:16px; flex-wrap:wrap; margin-top:14px; padding-top:14px; border-top:1px solid var(--line); }
  .opt { display:flex; align-items:center; gap:7px; font-size:.85rem; color:var(--ink-soft); }

  .save-section { border-top:1px solid var(--line); margin-top:14px; padding-top:14px; }
  .save-toggle { display:flex; align-items:center; gap:10px; cursor:pointer; font-size:.9rem;
    color:var(--ink-soft); user-select:none; }
  .save-toggle input { width:18px; height:18px; accent-color:var(--red); cursor:pointer; }
  #folder-area { margin-top:12px; display:none; }
  .folder-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  #folder-input { flex:1; min-width:200px; }
  .folder-hint { font-size:.78rem; color:var(--ink-soft); margin-top:7px; }

  /* summary */
  .summary { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px; }
  .stat { flex:1; min-width:96px; border-radius:11px; padding:13px 15px; }
  .stat .n { font-size:1.6rem; font-weight:800; line-height:1; }
  .stat .l { font-size:.72rem; font-weight:600; margin-top:5px; }
  .stat.ok { background:var(--ok-bg); color:var(--ok); }
  .stat.miss { background:var(--miss-bg); color:var(--miss); }
  .stat.warn { background:var(--warn-bg); color:var(--warn); }
  .stat.time { background:var(--field); color:var(--ink-soft); }
  .stat.time .n { color:var(--ink); }
  .sum-actions { display:flex; gap:9px; margin-top:13px; flex-wrap:wrap; }
  .save-path { margin-top:12px; font-size:.82rem; color:var(--ok); background:var(--ok-bg);
    padding:9px 12px; border-radius:8px; display:none; align-items:center; gap:8px; word-break:break-all; }

  .log-wrap { background:var(--log-bg); border-radius:10px; padding:13px 15px; max-height:300px;
    overflow-y:auto; font-family:'Menlo','Consolas',monospace; font-size:.8rem; line-height:1.6; margin-top:14px; }
  .log-wrap p { white-space:pre-wrap; }
  .c-ok{color:#4ec9b0}.c-warn{color:#dcdcaa}.c-err{color:#f44747}.c-info{color:#9cdcfe}.c-head{color:#fff;font-weight:bold}

  /* dicut bar */
  #dicut-bar { display:none; border:1px solid var(--line); border-radius:10px; padding:12px 14px;
    margin-bottom:16px; background:var(--field); }
  .dicut-btns { display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap; }
  .dicut-col { text-align:center; }
  .dicut-col .desc { font-size:.68rem; color:var(--ink-soft); margin-top:5px; max-width:150px; }
  #dicut-prog { margin-left:auto; font-size:.85rem; color:var(--ink-soft); align-self:center; }

  .img-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:13px; }
  .img-card { border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--field); }
  .img-card .imgwrap { position:relative; cursor:zoom-in; overflow:hidden;
    background:repeating-conic-gradient(#e0e0e0 0% 25%, #fafafa 0% 50%) 50%/16px 16px; }
  :root[data-theme="dark"] .img-card .imgwrap { background:repeating-conic-gradient(#333 0% 25%, #262626 0% 50%) 50%/16px 16px; }
  .img-card img { width:100%; aspect-ratio:3/4; object-fit:contain; display:block; }
  /* comparison slider (หลัง dicut) */
  .img-card .cmp-before { position:absolute; inset:0; width:100%; height:100%;
    object-fit:contain; display:none; background:#fff; }
  .img-card .cmp-divider { position:absolute; top:0; bottom:0; width:2px; background:var(--red);
    display:none; pointer-events:none; box-shadow:0 0 4px rgba(0,0,0,.4); }
  .img-card .cmp-divider::after { content:'⇄'; position:absolute; top:50%; left:50%;
    transform:translate(-50%,-50%); background:var(--red); color:#fff; font-size:.7rem;
    width:20px; height:20px; border-radius:50%; display:grid; place-items:center; }
  .img-card.has-cmp .imgwrap { cursor:ew-resize; }
  .img-card.has-cmp .imgwrap::before { content:'⇄ ลากเทียบ'; position:absolute; top:5px; left:5px;
    z-index:3; background:rgba(0,0,0,.55); color:#fff; font-size:.6rem; padding:2px 6px; border-radius:4px; }
  .img-card .meta { padding:7px 8px 9px; }
  .img-card .metarow { display:flex; align-items:center; gap:6px; }
  .img-card .sku { font-size:.72rem; color:var(--ink); font-weight:600; word-break:break-all;
    font-family:'Menlo','Consolas',monospace; flex:1; }
  .lock-btn { flex-shrink:0; width:24px; height:24px; border-radius:6px; border:1px solid var(--field-line);
    background:var(--card); cursor:pointer; font-size:.8rem; display:grid; place-items:center; padding:0; }
  .lock-btn:hover { border-color:var(--red); }
  .img-card.locked { outline:2px solid #f59e0b; outline-offset:-2px; }
  .img-card.locked .lock-btn { background:#fef3c7; border-color:#f59e0b; }
  :root[data-theme="dark"] .img-card.locked .lock-btn { background:#3a2e0a; }
  .chips { display:grid; grid-template-columns:repeat(4, 1fr); gap:5px; margin-top:7px; }
  .chips .lbl { font-size:.62rem; color:var(--ink-soft); grid-column:1 / -1; margin-bottom:1px; }
  .chips .cnt-load { grid-column:1 / -1; }
  /* ปุ่มเลือกลำดับ = รูปย่อจริง คลิกได้ (4 คอลัมน์ต่อการ์ด) */
  .chip { position:relative; aspect-ratio:3/4; border-radius:6px; border:2px solid var(--field-line);
    background:var(--field); cursor:pointer; padding:0; overflow:hidden; display:block; width:100%; }
  .chip img { width:100%; height:100%; object-fit:contain; display:block; background:#fff; }
  .chip .num { position:absolute; top:0; left:0; background:rgba(0,0,0,.55); color:#fff;
    font-size:.6rem; font-weight:700; padding:0 4px; border-radius:0 0 5px 0; line-height:1.4; }
  .chip:hover { border-color:var(--red); }
  .chip.on { border-color:var(--red); box-shadow:0 0 0 1px var(--red); }
  .chip.on .num { background:var(--red); }
  .chip:disabled { opacity:.5; cursor:wait; }

  /* lightbox */
  #lightbox { position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:2000; display:none;
    align-items:center; justify-content:center; padding:30px; cursor:zoom-out; }
  #lightbox img { max-width:100%; max-height:100%; object-fit:contain;
    background:repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50%/22px 22px; border-radius:8px; }

  /* floating zip */
  #btn-zip { position:fixed; bottom:22px; right:22px; z-index:999; background:var(--green); color:#fff;
    border:none; border-radius:50px; padding:15px 26px; font-size:1.05rem; font-weight:700;
    box-shadow:0 4px 18px rgba(25,135,84,.45); cursor:pointer; display:none; }
  #btn-zip:hover { background:#157347; }

  /* toast */
  #toast { position:fixed; bottom:22px; left:50%; transform:translateX(-50%) translateY(80px);
    background:#242020; color:#fff; padding:13px 22px; border-radius:10px; font-size:.9rem; font-weight:600;
    box-shadow:0 6px 24px rgba(0,0,0,.3); z-index:3000; opacity:0; transition:all .3s; pointer-events:none; }
  #toast.show { transform:translateX(-50%) translateY(0); opacity:1; }

  /* history */
  #history-box { margin-top:10px; font-size:.82rem; }
  .hist-item { display:inline-flex; align-items:center; gap:6px; background:var(--field);
    border:1px solid var(--field-line); border-radius:99px; padding:5px 12px; margin:3px 4px 0 0;
    cursor:pointer; color:var(--ink-soft); }
  .hist-item:hover { border-color:var(--red); color:var(--red); }
</style>
</head>
<body>

<header>
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
  </svg>
  <div>
    <h1>Central Image Downloader</h1>
    <span>โหลดรูปสินค้าจาก central.co.th ด้วยรหัส SKU</span>
  </div>
  <button class="theme-toggle" onclick="toggleTheme()"><span id="theme-icon">🌙</span> ธีม</button>
</header>

<button id="btn-zip" onclick="downloadZip()">📦 บันทึก ZIP</button>
<div id="lightbox" onclick="closeLightbox()"><img id="lightbox-img" src="" alt=""></div>
<div id="toast"></div>

<div class="container">

  <div class="card">
    <h2>📋 รหัส SKU</h2>
    <textarea id="sku-input" oninput="liveCount()"
      placeholder="วางรหัส SKU ที่นี่ คั่นด้วยช่องว่าง หรือ Enter  (ลากไฟล์ .txt / .csv มาวางได้)&#10;เช่น  CDS10268964  CDS10268995  GRCDS53725060025"></textarea>

    <div class="btn-row">
      <button class="btn-primary" id="btn-start" onclick="startDownload()">⬇ Download</button>
      <button class="btn-stop" id="btn-stop" onclick="stopDownload()" style="display:none">⏹ หยุด</button>
      <div class="field-group">
        <span>รูปเริ่มต้น</span>
        <select id="img-index" onchange="saveSettings()" title="ลำดับรูปเริ่มต้นของทุก SKU (เปลี่ยนรายตัวได้ทีหลังใต้รูป)">
          <option value="1">1 (รูปแรก)</option><option value="2">2</option><option value="3">3</option>
          <option value="4">4</option><option value="5">5</option><option value="6">6</option>
          <option value="7">7</option><option value="8">8</option><option value="9">9</option><option value="10">10</option>
        </select>
      </div>
      <div class="field-group">
        <span>ไฟล์</span>
        <select id="img-format" onchange="saveSettings()" title="JPEG = ไฟล์เล็ก · PNG = คมสุด (ไม่บีบอัด)">
          <option value="jpg">JPEG</option><option value="png">PNG (คมสุด)</option>
        </select>
      </div>
      <button class="btn-secondary" onclick="clearAll()">🗑 ล้าง</button>
      <span class="count-live">พบ <b id="cnt" class="tnum">0</b> SKU · สูงสุด __MAX_SKUS__ SKU ต่อครั้ง</span>
    </div>
    <div class="prog-wrap"><div class="prog-bar" id="prog-bar"></div></div>
    <span id="prog-label"></span>

    <div id="history-box"></div>

    <div class="save-section">
      <label class="save-toggle">
        <input type="checkbox" id="chk-save" onchange="toggleSave()">
        <span>💾 บันทึกภาพอัตโนมัติเมื่อโหลดเสร็จ</span>
      </label>
      <div id="folder-area">
        <div class="folder-row" id="folder-row-local" style="display:none">
          <input type="text" id="folder-input" oninput="saveSettings()" placeholder="เช่น C:\\Users\\me\\Downloads\\central">
          <button class="btn-secondary" onclick="browseFolder()">📁 เลือก</button>
          <button class="btn-secondary" onclick="createAndOpen()">✨ สร้างใหม่</button>
          <button class="btn-secondary" onclick="resetFolder()">✕</button>
        </div>
        <div class="folder-row" style="margin-top:8px">
          <div class="field-group">
            <span>คำนำหน้าชื่อไฟล์</span>
            <input type="text" id="prefix-input" oninput="saveSettings()" placeholder="เช่น KV_ (ไม่ใส่ก็ได้)" style="width:180px">
          </div>
          <span style="font-size:.76rem;color:var(--ink-soft)">→ ตัวอย่าง: <span id="prefix-eg">CDS123.jpg</span></span>
        </div>
        <div id="folder-row-remote" style="display:none">
          <p style="font-size:.85rem;color:var(--ink-soft)">📥 ภาพจะดาวน์โหลดลง Downloads ของเครื่องคุณอัตโนมัติทีละภาพ</p>
        </div>
        <p class="folder-hint" id="folder-hint"></p>
      </div>
    </div>
  </div>

  <div class="card" id="card-log" style="display:none">
    <h2>📊 ผลลัพธ์</h2>
    <div class="summary" id="summary"></div>
    <div class="sum-actions" id="sum-actions"></div>
    <div class="save-path" id="save-path"></div>
    <div class="log-wrap" id="log"></div>
  </div>

  <div class="card" id="card-imgs" style="display:none">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <h2 style="margin-bottom:0">🖼 รูปภาพที่ดาวน์โหลด</h2>
      <button class="btn-green" id="btn-zip-card" onclick="downloadZip()" style="display:none;padding:8px 18px;font-size:.9rem">📦 บันทึก ZIP</button>
    </div>
    <div id="dicut-bar">
      <div class="dicut-btns">
        <div class="dicut-col">
          <button class="btn-secondary" id="btn-dicut" onclick="dicutAll('white')" style="background:var(--info);color:#fff">✂️ Dicut</button>
          <div class="desc">ลบพื้นหลังขาว (เร็ว) เหมาะกับรูปพื้นขาวสะอาด</div>
        </div>
        <div class="dicut-col">
          <button class="btn-secondary" id="btn-dicut-ai" onclick="dicutAll('ai')" style="background:var(--ai);color:#fff">🤖 Dicut AI</button>
          <div class="desc">ลบพื้นหลังด้วย AI (ช้ากว่า) คมชัด ตัดเฉพาะวัตถุจริง</div>
        </div>
        <div class="dicut-col">
          <button class="btn-secondary" id="btn-dicut-ps" onclick="dicutAll('ps')" style="background:#001e36;color:#31a8ff">🖌️ Dicut PS</button>
          <div class="desc">ตัดพื้นด้วย Photoshop ในเครื่องนี้ (คมสุด ~20 วิ/รูป ต้องมี PS)</div>
        </div>
        <div class="dicut-col">
          <button class="btn-secondary" id="btn-dicut-orig" onclick="dicutAll('orig')">↺ ต้นฉบับ</button>
          <div class="desc">คืนรูปเดิมทุกใบ (ยกเลิก dicut)</div>
        </div>
        <div id="dicut-prog"></div>
      </div>
    </div>
    <div class="img-grid" id="img-grid"></div>
  </div>
</div>

<script>
const MAX_SKUS=Number('__MAX_SKUS__');
let sessionId=null, total=0, current=0, autoSave=false, isLocal=false;
let savedSkus=new Set(), loadedSkus=[], notFoundSkus=[], lastFolder='', startTime=0;
let abortCtrl=null, dicutRunning=false;

// ---------- init ----------
fetch('/is-local').then(r=>r.json()).then(d=>{
  isLocal=d.local;
  document.getElementById(isLocal?'folder-row-local':'folder-row-remote').style.display = isLocal?'flex':'block';
  if(isLocal){ fetch('/default-folder').then(r=>r.json()).then(d2=>{
    const inp=document.getElementById('folder-input'); if(!inp.value) inp.value=d2.folder; loadSettings();
  }); } else { loadSettings(); }
});
loadTheme(); renderHistory();

// ---------- theme ----------
function toggleTheme(){
  const r=document.documentElement;
  const cur=r.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  const next=cur==='dark'?'light':'dark';
  r.setAttribute('data-theme',next); localStorage.setItem('theme',next);
  document.getElementById('theme-icon').textContent = next==='dark'?'☀️':'🌙';
}
function loadTheme(){
  const t=localStorage.getItem('theme');
  if(t){ document.documentElement.setAttribute('data-theme',t);
    document.getElementById('theme-icon').textContent = t==='dark'?'☀️':'🌙'; }
  else { document.getElementById('theme-icon').textContent = matchMedia('(prefers-color-scheme: dark)').matches?'☀️':'🌙'; }
}

// ---------- settings persistence ----------
function saveSettings(){
  localStorage.setItem('cid_settings', JSON.stringify({
    folder:document.getElementById('folder-input').value,
    prefix:document.getElementById('prefix-input').value,
    imgIndex:document.getElementById('img-index').value,
    imgFormat:document.getElementById('img-format').value,
    autoSave:document.getElementById('chk-save').checked
  }));
  updatePrefixEg();
}
function loadSettings(){
  try{
    const s=JSON.parse(localStorage.getItem('cid_settings')||'{}');
    if(s.folder) document.getElementById('folder-input').value=s.folder;
    if(s.prefix) document.getElementById('prefix-input').value=s.prefix;
    if(s.imgIndex) document.getElementById('img-index').value=s.imgIndex;
    if(s.imgFormat) document.getElementById('img-format').value=s.imgFormat;
    if(s.autoSave){ document.getElementById('chk-save').checked=true; toggleSave(); }
  }catch(e){}
  updatePrefixEg();
}
function updatePrefixEg(){
  const p=document.getElementById('prefix-input').value.replace(/[<>:"/\\\\|?*]/g,'');
  const f=document.getElementById('img-format').value;
  document.getElementById('prefix-eg').textContent = p+'CDS123.'+f;
}

// ---------- live count ----------
function liveCount(){
  const v=document.getElementById('sku-input').value.trim();
  const n=v? new Set(v.split(/[\\s,]+/).filter(Boolean).map(x=>x.toUpperCase())).size : 0;
  document.getElementById('cnt').textContent=n;
}

// ---------- history ----------
function pushHistory(skus){
  let h=[]; try{h=JSON.parse(localStorage.getItem('cid_history')||'[]')}catch(e){}
  h.unshift({t:Date.now(), skus:skus, n:skus.length});
  h=h.slice(0,8);
  localStorage.setItem('cid_history', JSON.stringify(h));
  renderHistory();
}
function renderHistory(){
  let h=[]; try{h=JSON.parse(localStorage.getItem('cid_history')||'[]')}catch(e){}
  const box=document.getElementById('history-box');
  if(!h.length){ box.innerHTML=''; return; }
  box.innerHTML='<span style="color:var(--ink-soft);font-size:.78rem">🕘 ประวัติล่าสุด:</span> '+
    h.map((x,i)=>`<span class="hist-item" onclick="useHistory(${i})">${x.n} SKU · ${timeAgo(x.t)}</span>`).join('')+
    ` <span class="hist-item" onclick="clearHistory()" style="opacity:.7">✕ ล้างประวัติ</span>`;
}
function useHistory(i){
  let h=[]; try{h=JSON.parse(localStorage.getItem('cid_history')||'[]')}catch(e){}
  if(h[i]){ document.getElementById('sku-input').value=h[i].skus.join(' '); liveCount(); }
}
function clearHistory(){ localStorage.removeItem('cid_history'); renderHistory(); }
function timeAgo(t){
  const s=(Date.now()-t)/1000;
  if(s<60) return 'เมื่อกี้';
  if(s<3600) return Math.floor(s/60)+' นาทีก่อน';
  if(s<86400) return Math.floor(s/3600)+' ชม.ก่อน';
  return Math.floor(s/86400)+' วันก่อน';
}

// ---------- drag & drop ----------
const skuBox=document.getElementById('sku-input');
skuBox.addEventListener('dragover',e=>{e.preventDefault();skuBox.classList.add('drag')});
skuBox.addEventListener('dragleave',()=>skuBox.classList.remove('drag'));
skuBox.addEventListener('drop',e=>{
  e.preventDefault(); skuBox.classList.remove('drag');
  const f=e.dataTransfer.files[0]; if(!f) return;
  if(!/\\.(txt|csv)$/i.test(f.name)){ toast('รองรับเฉพาะไฟล์ .txt / .csv'); return; }
  const rd=new FileReader();
  rd.onload=()=>{ const cur=skuBox.value.trim(); skuBox.value=(cur?cur+' ':'')+rd.result.replace(/[,;\\t\\r\\n]+/g,' ').trim(); liveCount(); };
  rd.readAsText(f);
});

// ---------- folder ----------
function toggleSave(){ autoSave=document.getElementById('chk-save').checked;
  document.getElementById('folder-area').style.display=autoSave?'block':'none'; saveSettings(); }
async function browseFolder(){
  document.getElementById('folder-hint').textContent='⏳ กำลังเปิด dialog...';
  try{ const d=await (await fetch('/pick-folder')).json();
    if(d.ok){ document.getElementById('folder-input').value=d.folder;
      document.getElementById('folder-hint').textContent='✅ เลือกโฟลเดอร์แล้ว'; saveSettings(); }
    else if(d.cancelled) document.getElementById('folder-hint').textContent='';
    else document.getElementById('folder-hint').textContent='❌ '+d.error;
  }catch(e){ document.getElementById('folder-hint').textContent='❌ '+e.message; }
}
async function createAndOpen(){
  const folder=document.getElementById('folder-input').value.trim()||'C:\\\\Users\\\\Public\\\\central_images';
  document.getElementById('folder-input').value=folder; saveSettings();
  const d=await (await fetch('/prepare-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder})})).json();
  document.getElementById('folder-hint').textContent=d.ok?('✅ โฟลเดอร์พร้อม: '+d.folder):('❌ '+d.error);
}
function resetFolder(){ document.getElementById('folder-input').value=''; document.getElementById('folder-hint').textContent=''; saveSettings(); }
function getPrefix(){ return document.getElementById('prefix-input').value.replace(/[<>:"/\\\\|?*]/g,'').slice(0,40); }

// ---------- log / progress ----------
function log(html,cls){ const el=document.getElementById('log');
  el.innerHTML+=`<p class="${cls||''}">${html}</p>`; el.scrollTop=el.scrollHeight; }
function setProgress(cur,tot){ const pct=tot?Math.round(cur/tot*100):0;
  document.getElementById('prog-bar').style.width=pct+'%';
  document.getElementById('prog-label').textContent=tot?`${cur} / ${tot}`:''; }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),3200); }

function clearAll(){
  document.getElementById('sku-input').value=''; document.getElementById('log').innerHTML='';
  document.getElementById('img-grid').innerHTML=''; document.getElementById('summary').innerHTML='';
  document.getElementById('sum-actions').innerHTML=''; document.getElementById('save-path').style.display='none';
  document.getElementById('card-log').style.display='none'; document.getElementById('card-imgs').style.display='none';
  document.getElementById('btn-zip').style.display='none'; document.getElementById('btn-zip-card').style.display='none';
  document.getElementById('dicut-bar').style.display='none'; document.getElementById('dicut-prog').textContent='';
  document.getElementById('prog-bar').style.width='0'; document.getElementById('prog-label').textContent='';
  sessionId=null; total=0; current=0; savedSkus=new Set(); loadedSkus=[]; notFoundSkus=[]; liveCount();
  countQ=[]; countActive=0; dicutRunning=false; dicutCancel=false;
}

// ---------- auto-save ----------
async function autoDownloadImage(sid,sku){
  if(!autoSave||savedSkus.has(sku)) return; savedSkus.add(sku);
  if(isLocal){
    const folder=document.getElementById('folder-input').value.trim(); if(!folder) return;
    lastFolder=folder;
    const d=await (await fetch('/save-folder',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session_id:sid,sku,folder,prefix:getPrefix()})})).json();
    if(!d.ok) log('  ⚠ บันทึก '+sku+' ล้มเหลว: '+d.error,'c-warn');
  } else {
    // เครื่องอื่น (LAN): ดาวน์โหลดทีละภาพลง Downloads ของเครื่องนั้น
    // (ถ้า Chrome เด้ง "Keep" ให้ตั้ง Site settings > Insecure content = Allow ครั้งเดียว)
    const ext=document.getElementById('img-format').value;
    try{ const blob=await (await fetch(`/img/${sid}/${sku}`)).blob();
      const url=URL.createObjectURL(blob); const a=document.createElement('a');
      a.href=url; a.download=getPrefix()+sku+'.'+ext; document.body.appendChild(a); a.click();
      setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},800);
    }catch(e){ log('  ⚠ ดาวน์โหลด '+sku+' ล้มเหลว','c-warn'); }
  }
}

// ---------- image grid + per-card order ----------
function renderChips(sku,totalN){
  const wrap=document.querySelector(`.img-card[data-sku="${sku}"] .chips`);
  if(!wrap) return;
  const cur=parseInt(wrap.getAttribute('data-sel')||'1',10);
  const n=Math.max(1,Math.min(totalN,20));
  wrap.innerHTML=`<span class="lbl">เลือกลำดับรูป (${n})</span>`+
    Array.from({length:n},(_,i)=>i+1).map(x=>
      `<button class="chip${x===cur?' on':''}" title="รูปที่ ${x}" onclick="setCardImage('${sku}',${x},this)"><img src="/thumb/${sessionId}/${sku}/${x}" loading="lazy" alt=""><span class="num">${x}</span></button>`).join('');
}
function addImage(sid,sku){
  document.getElementById('card-imgs').style.display='block';
  const grid=document.getElementById('img-grid');
  const d=document.createElement('div'); d.className='img-card'; d.setAttribute('data-sku',sku);
  d.innerHTML=`<div class="imgwrap" data-sku="${sku}" onclick="openLightbox('${sku}')"
       onmousemove="cmpMove(event)" onmouseleave="cmpLeave(this)">
      <img class="cmp-before" alt="">
      <img class="cmp-after" src="/img/${sid}/${sku}" loading="lazy" alt="${sku}">
      <div class="cmp-divider"></div></div>
    <div class="meta">
    <div class="metarow"><div class="sku">${sku}</div>
      <button class="lock-btn" title="ล็อกรูปนี้ไว้ (ปุ่ม Dicut ทั้งหมดจะข้าม SKU นี้)" onclick="toggleLock('${sku}',this)">🔓</button></div>
    <div class="chips" data-sel="1"><span class="lbl">เลือกลำดับรูป</span>
      <button class="chip on" onclick="setCardImage('${sku}',1,this)"><img src="/thumb/${sid}/${sku}/1" loading="lazy" alt=""><span class="num">1</span></button>
      <span class="cnt-load" style="font-size:.6rem;color:var(--ink-soft);align-self:center">…</span></div></div>`;
  grid.appendChild(d);
  if(!loadedSkus.includes(sku)) loadedSkus.push(sku);
  queueCount(sku);   // เริ่มนับจำนวนรูปทันที (ไม่รอจบทั้งหมด)
}

// นับจำนวนรูปต่อ SKU — คิวรวม ทำทีละ 3 ตัว เริ่มทันทีที่การ์ดโผล่ (โหลดคู่ขนานกับ download)
let countQ=[], countActive=0;
function queueCount(sku){ countQ.push(sku); pumpCount(); }
function pumpCount(){
  while(countActive<3 && countQ.length){
    const sku=countQ.shift(); countActive++;
    fetch(`/img-count/${sessionId}/${sku}`).then(r=>r.json()).then(d=>{
      if(d.ok) renderChips(sku, d.total);
      else { const w=document.querySelector(`.img-card[data-sku="${sku}"] .cnt-load`); if(w) w.remove(); }
    }).catch(()=>{}).finally(()=>{ countActive--; pumpCount(); });
  }
}
function refreshCard(sku){
  const card=document.querySelector(`.img-card[data-sku="${sku}"]`); if(!card) return;
  const t='?t='+Date.now();
  const after=card.querySelector('.cmp-after'); if(after) after.src=`/img/${sessionId}/${sku}`+t;
  // โหลดรูปต้นฉบับสำหรับเทียบเฉพาะตอน dicut แล้ว (has-cmp)
  const before=card.querySelector('.cmp-before');
  if(before && card.classList.contains('has-cmp')) before.src=`/img-orig/${sessionId}/${sku}`+t;
}
async function setCardImage(sku,index,btn){
  const card=btn.closest('.img-card');
  const wrap=card.querySelector('.chips');
  card.querySelectorAll('.chip').forEach(c=>c.disabled=true);
  try{
    const d=await (await fetch(`/set-image/${sessionId}/${sku}`,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({index})})).json();
    if(d.ok){
      wrap.setAttribute('data-sel', d.index||index);
      renderChips(sku, d.total || card.querySelectorAll('.chip').length);
      card.classList.remove('has-cmp');   // เปลี่ยนรูป = ยกเลิก dicut เดิม
      refreshCard(sku);
      if(autoSave&&isLocal){ savedSkus.delete(sku); await autoDownloadImage(sessionId,sku); }
    } else { toast('เปลี่ยนรูปไม่ได้: '+(d.error||'')); }
  }catch(e){ toast('เปลี่ยนรูปล้มเหลว'); }
  card.querySelectorAll('.chip').forEach(c=>c.disabled=false);
}

// ---------- lock ต่อ SKU (กัน Dicut ทั้งหมดมาทับ) ----------
function toggleLock(sku,btn){
  const card=btn.closest('.img-card'); const locked=card.classList.toggle('locked');
  btn.textContent=locked?'🔒':'🔓';
  btn.title=locked?'ปลดล็อก (ปุ่ม Dicut ทั้งหมดจะทำ SKU นี้ด้วย)':'ล็อกรูปนี้ไว้ (ปุ่ม Dicut ทั้งหมดจะข้าม SKU นี้)';
}

// ---------- comparison slider (หลัง dicut) ----------
function cmpMove(e){
  const wrap=e.currentTarget; const card=wrap.closest('.img-card');
  if(!card.classList.contains('has-cmp')) return;
  const rect=wrap.getBoundingClientRect();
  let x=(e.clientX-rect.left)/rect.width*100; x=Math.max(0,Math.min(100,x));
  const before=wrap.querySelector('.cmp-before'); const line=wrap.querySelector('.cmp-divider');
  before.style.display='block';
  before.style.clipPath=`inset(0 0 0 ${x}%)`;   // โชว์ต้นฉบับด้านขวาของเส้น
  line.style.display='block'; line.style.left=x+'%';
}
function cmpLeave(wrap){
  const before=wrap.querySelector('.cmp-before'); const line=wrap.querySelector('.cmp-divider');
  before.style.display='none'; line.style.display='none';   // กลับไปโชว์ภาพ dicut เต็ม
}

// ---------- lightbox ----------
function openLightbox(sku){ const lb=document.getElementById('lightbox');
  document.getElementById('lightbox-img').src=`/img/${sessionId}/${sku}?t=`+Date.now();
  lb.style.display='flex'; }
function closeLightbox(){ document.getElementById('lightbox').style.display='none'; }

// ---------- download ----------
function startDownload(){
  const skus=document.getElementById('sku-input').value.trim();
  if(!skus){ alert('กรุณากรอก SKU ก่อน'); return; }
  const skuList=[...new Set(skus.split(/[\\s,]+/).filter(Boolean).map(x=>x.toUpperCase()))];
  if(skuList.length>MAX_SKUS){
    alert(`ใส่ได้สูงสุด ${MAX_SKUS} SKU ต่อครั้ง (ขณะนี้ ${skuList.length} SKU)`); return;
  }
  clearAll();
  document.getElementById('sku-input').value=skus;
  pushHistory(skuList);
  document.getElementById('card-log').style.display=''; liveCount();
  document.getElementById('btn-start').disabled=true;
  document.getElementById('btn-stop').style.display='';
  startTime=Date.now();
  const imgIndex=parseInt(document.getElementById('img-index').value,10)||1;
  const imgFormat=document.getElementById('img-format').value;
  abortCtrl=new AbortController();
  fetch('/download',{method:'POST',headers:{'Content-Type':'application/json'},
    signal:abortCtrl.signal, body:JSON.stringify({skus, img_index:imgIndex, img_format:imgFormat})})
  .then(async res=>{
    const reader=res.body.getReader(); const dec=new TextDecoder(); let buf='';
    while(true){ const {done,value}=await reader.read(); if(done) break;
      buf+=dec.decode(value,{stream:true}); const lines=buf.split('\\n'); buf=lines.pop();
      for(const line of lines){ if(!line.startsWith('data: ')) continue;
        handleMsg(JSON.parse(line.slice(6))); } }
  }).catch(e=>{ if(e.name!=='AbortError') log('❌ เกิดข้อผิดพลาด: '+e.message,'c-err');
    endDownloadUI(); });
}
function stopDownload(){
  if(sessionId) fetch('/cancel/'+sessionId,{method:'POST'}).catch(()=>{});
  if(abortCtrl) abortCtrl.abort();
  log('\\n⏹ หยุดการทำงานแล้ว','c-warn'); toast('หยุดแล้ว'); endDownloadUI();
}
function endDownloadUI(){
  document.getElementById('btn-start').disabled=false;
  document.getElementById('btn-stop').style.display='none';
}

function handleMsg(msg){
  switch(msg.type){
    case 'start': total=msg.total; log(`📦 กำลังโหลด ${total} SKU\\n`,'c-head'); break;
    case 'step': log('\\n─── '+msg.msg+' ───','c-info'); break;
    case 'progress': if(msg.status==='searching'){ current++; setProgress(current,total); } break;
    case 'session': sessionId=msg.id; break;
    case 'item':
      if(msg.status==='ok'){ const src=msg.source==='direct'?'Central':'Google';
        log(`  ✅  ${msg.sku.padEnd(28)}  ${msg.w}×${msg.h}px   ${msg.kb} KB   [${src}]`,'c-ok');
        if(sessionId){ addImage(sessionId,msg.sku); autoDownloadImage(sessionId,msg.sku); } }
      else if(msg.status==='need_google') log(`  ⏭   ${msg.sku.padEnd(28)}  ไม่พบ → จะค้น Google`,'c-warn');
      else if(msg.status==='found_google') log(`  🔍  ${msg.sku.padEnd(28)}  เจอบน Google`,'c-ok');
      else if(msg.status==='not_found') log(`  ❌  ${msg.sku.padEnd(28)}  ไม่พบ`,'c-err');
      else if(msg.status==='blocked') log(`  🚫  ${msg.sku.padEnd(28)}  Google CAPTCHA`,'c-err');
      else if(msg.status==='error') log(`  ⚠   ${msg.sku.padEnd(28)}  ${msg.msg}`,'c-warn');
      break;
    case 'done': onDone(msg); break;
  }
}

function onDone(msg){
  setProgress(total,total);
  const ok=msg.ok_direct.length+msg.ok_google.length;
  notFoundSkus=msg.not_found.slice();
  const secs=((Date.now()-startTime)/1000).toFixed(1);

  // summary bar
  const sum=document.getElementById('summary');
  sum.innerHTML=`<div class="stat ok"><div class="n tnum">${ok}</div><div class="l">✓ สำเร็จ</div></div>`+
    (msg.not_found.length?`<div class="stat miss"><div class="n tnum">${msg.not_found.length}</div><div class="l">✕ ไม่พบ</div></div>`:'')+
    (msg.errors.length?`<div class="stat warn"><div class="n tnum">${msg.errors.length}</div><div class="l">⚠ error</div></div>`:'')+
    `<div class="stat time"><div class="n tnum">${secs}s</div><div class="l">⏱ ${(ok/(secs||1)).toFixed(1)}/วิ</div></div>`;

  // action buttons
  const acts=document.getElementById('sum-actions'); acts.innerHTML='';
  if(msg.not_found.length){
    acts.innerHTML+=`<button class="btn-secondary" onclick="copyNotFound()">📋 คัดลอก SKU ที่ไม่พบ (${msg.not_found.length})</button>`;
    acts.innerHTML+=`<button class="btn-secondary" onclick="retryNotFound()">↻ ลองใหม่เฉพาะที่ไม่พบ</button>`;
  }

  // log detail
  log('\\n'+'─'.repeat(50),'c-head'); log('  📊  สรุปผล','c-head'); log('─'.repeat(50),'c-head');
  if(msg.not_found.length){ log(`\\n  ❌  ไม่พบ (${msg.not_found.length})`,'c-err');
    msg.not_found.forEach(s=>log('      '+s,'c-err')); }
  if(msg.errors.length){ log(`\\n  ⚠   Error (${msg.errors.length})`,'c-warn');
    msg.errors.forEach(e=>log('      '+e.sku+': '+e.reason,'c-warn')); }
  log(`\\n  รวมสำเร็จ ${ok}/${total} · ${secs} วินาที`,'c-head');

  if(msg.has_images){
    document.getElementById('btn-zip').style.display='';
    document.getElementById('btn-zip-card').style.display='';
    document.getElementById('dicut-bar').style.display='block';
    msg.ok_direct.concat(msg.ok_google).forEach(i=>{
      if(sessionId && !document.querySelector(`.img-card[data-sku="${i.sku}"]`)) addImage(sessionId,i.sku); });
    // จำนวนรูปเริ่มนับตั้งแต่ addImage แล้ว (queueCount) — ไม่ต้องเรียกซ้ำ
  }
  // saved path (เฉพาะเครื่องตัวเอง)
  if(autoSave && isLocal && lastFolder){
    const sp=document.getElementById('save-path'); sp.style.display='flex';
    sp.innerHTML=`💾 บันทึกที่ <b>${lastFolder}</b> <button class="btn-secondary" style="padding:4px 12px;font-size:.8rem" onclick="openSavedFolder()">📂 เปิดโฟลเดอร์</button>`;
  }
  endDownloadUI();
  toast(`เสร็จแล้ว ✅ ${ok}/${total}`+(msg.not_found.length?` · ไม่พบ ${msg.not_found.length}`:''));
}

function copyNotFound(){
  navigator.clipboard.writeText(notFoundSkus.join(' ')).then(()=>toast('คัดลอกแล้ว '+notFoundSkus.length+' SKU'))
    .catch(()=>{ const t=document.createElement('textarea'); t.value=notFoundSkus.join(' ');
      document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('คัดลอกแล้ว'); });
}
function retryNotFound(){
  if(!notFoundSkus.length) return;
  document.getElementById('sku-input').value=notFoundSkus.join(' ');
  liveCount(); startDownload();
}
async function openSavedFolder(){
  const folder=lastFolder||document.getElementById('folder-input').value.trim(); if(!folder) return;
  const d=await (await fetch('/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder})})).json();
  if(!d.ok) toast('เปิดโฟลเดอร์ไม่ได้: '+(d.error||''));
}

// ---------- dicut ----------
let dicutCancel=false;
function stopDicut(){ dicutCancel=true; }
async function dicutAll(method){
  if(dicutRunning||!sessionId||!loadedSkus.length) return;
  if(method==='ai'){ const chk=await (await fetch('/has-ai')).json();
    if(!chk.available){ alert('AI (rembg) ยังไม่ได้ติดตั้งในเวอร์ชันนี้'); return; } }
  // Dicut PS ใช้ Photoshop ของ "เครื่องที่เปิดหน้าเว็บ" เสมอ — ถ้าเปิดผ่าน LAN
  // ให้ไล่หาตัวช่วยบน localhost ของเครื่องตัวเอง: โปรแกรมเต็ม (PC 5000 / Mac 5001)
  // หรือ Dicut PS Helper จิ๋ว (5010, สำหรับ Mac ที่ไม่ได้รันโปรแกรมเต็ม)
  let psBase='';
  if(method==='ps'){
    const pageLocal=['localhost','127.0.0.1'].includes(location.hostname);
    const bases=pageLocal?['']:[...new Set([`http://localhost:${location.port||'5000'}`,
      'http://localhost:5001','http://localhost:5010'])];
    let psOk=false;
    for(const b of bases){
      try{ const chk=await (await fetch(b+'/has-ps',{signal:AbortSignal.timeout(2500)})).json();
        if(chk.available){ psBase=b; psOk=true; break; } }catch(e){}
    }
    if(!psOk){
      if(pageLocal){ alert('ใช้ Dicut PS ไม่ได้ — ไม่พบ Photoshop ในเครื่องนี้'); return; }
      // เครื่อง LAN ยังไม่มีตัวช่วย → ให้คัดลอกคำสั่งไปวางใน Terminal ครั้งเดียว
      // (แจกเป็นไฟล์ .command ไม่ได้แล้ว — macOS Sequoia บล็อกไฟล์ที่โหลดมาแบบ
      //  ไม่มีปุ่มยอม แต่ curl|bash ไม่โดน quarantine เพราะไม่มีไฟล์ลงเครื่อง)
      const cmd=`curl -s http://${location.host}/dicut-ps-helper.sh | bash`;
      prompt('ยังไม่ได้ติดตั้งตัวช่วย Dicut PS ในเครื่องนี้\\n'
        +'(ปุ่มนี้ใช้ Photoshop ของเครื่องคุณเอง — ต้องมี Photoshop ติดตั้งอยู่)\\n\\n'
        +'ติดตั้งครั้งเดียวใช้ได้ถาวร:\\n'
        +'1) คัดลอกคำสั่งข้างล่างนี้ (Cmd+C)\\n'
        +'2) เปิดแอป Terminal → วาง (Cmd+V) → กด Enter\\n'
        +'3) กลับมากดปุ่ม Dicut PS อีกครั้ง', cmd);
      return; }
  }
  // ทำเฉพาะ SKU ที่ "ไม่ได้ล็อก" — SKU ที่ล็อกไว้จะคงรูปเดิม (dicut/ai/ต้นฉบับ ตามที่เลือกไว้)
  const targets=loadedSkus.filter(sku=>{
    const c=document.querySelector(`.img-card[data-sku="${sku}"]`);
    return c && !c.classList.contains('locked');
  });
  const locked=loadedSkus.length-targets.length;
  if(!targets.length){ toast('ทุก SKU ถูกล็อกไว้ — ไม่มีอะไรให้ทำ'); return; }
  dicutRunning=true; dicutCancel=false;
  const btns=['btn-dicut','btn-dicut-ai','btn-dicut-ps','btn-dicut-orig'].map(id=>document.getElementById(id));
  btns.forEach(b=>b.disabled=true);
  const prog=document.getElementById('dicut-prog');
  const label=method==='ai'?'Dicut AI':(method==='ps'?'Dicut PS':(method==='orig'?'คืนต้นฉบับ':'Dicut'));
  prog.innerHTML=`<span id="dicut-prog-txt"></span> <button class="btn-secondary" style="padding:4px 12px;font-size:.8rem" onclick="stopDicut()">⏹ หยุด</button>`;
  const ptxt=document.getElementById('dicut-prog-txt');
  let done=0, fail=0, i=0, firstErr='';
  for(const sku of targets){
    if(dicutCancel){ break; }
    i++; ptxt.textContent=`${label}... ${i}/${targets.length}`+(locked?` (ล็อก ${locked})`:'');
    try{
      let d;
      if(method==='ps'){
        // 1) ดึงต้นฉบับดิบจากแม่ข่าย 2) ส่งให้ PS ในเครื่องตัวเองตัดพื้น 3) ส่งผลกลับแม่ข่าย
        const raw=await (await fetch(`/img-raw/${sessionId}/${sku}`)).blob();
        const psRes=await fetch(psBase+'/ps-remove-bg',{method:'POST',
          headers:{'Content-Type':'application/octet-stream'},body:raw});
        if(!psRes.ok||!(psRes.headers.get('Content-Type')||'').includes('image/png')){
          let msg='PS ตัดพื้นล้มเหลว';
          try{ const ej=await psRes.json(); if(ej.error) msg=ej.error; }catch(_){}
          throw new Error(msg);
        }
        const png=await psRes.blob();
        d=await (await fetch(`/apply-dicut/${sessionId}/${sku}`,{method:'POST',
          headers:{'Content-Type':'application/octet-stream'},body:png})).json();
      }else{
        d=await (await fetch(`/dicut/${sessionId}/${sku}`,{method:'POST',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({method})})).json();
      }
      if(d.ok){ done++;
        const card=document.querySelector(`.img-card[data-sku="${sku}"]`);
        // เปิด/ปิดโหมดเปรียบเทียบ: dicut แล้วมีต้นฉบับให้ลากเทียบ / กดต้นฉบับ = ปิด
        if(card){ if(method==='orig') card.classList.remove('has-cmp'); else card.classList.add('has-cmp'); }
        refreshCard(sku);
        if(autoSave&&isLocal){ const folder=document.getElementById('folder-input').value.trim();
          if(folder){ lastFolder=folder; await fetch('/save-folder',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({session_id:sessionId,sku,folder,prefix:getPrefix()})}); } } }
      else { fail++; if(!firstErr) firstErr=d.error||''; }
    }catch(e){ fail++; if(!firstErr) firstErr=e.message||String(e); }
  }
  const stopped=dicutCancel?' (หยุดกลางคัน)':'';
  prog.textContent=`✅ ${label} เสร็จ ${done} รูป`+(fail?` · ล้มเหลว ${fail}`:'')+(locked?` · ล็อก ${locked}`:'')+stopped;
  // โชว์สาเหตุ error ตัวแรกให้เห็นจอเลย — จะได้ดีบักทางไกลได้ (โดยเฉพาะ Dicut PS)
  if(fail&&firstErr) alert(`${label} ล้มเหลว ${fail} รูป\\nสาเหตุ (รูปแรกที่พัง): ${firstErr}`);
  btns.forEach(b=>b.disabled=false); dicutRunning=false;
  toast(`${label} เสร็จ ${done} รูป`+(locked?` · ข้ามที่ล็อก ${locked}`:''));
}

// ---------- zip ----------
async function downloadZip(){
  if(!sessionId) return;
  if(isLocal){
    let folder='';
    try{ const dp=await (await fetch('/pick-folder')).json();
      if(dp.cancelled) return; if(!dp.ok){ alert('เลือกโฟลเดอร์ล้มเหลว: '+(dp.error||'')); return; }
      folder=dp.folder;
    }catch(e){ alert('เกิดข้อผิดพลาด: '+e.message); return; }
    try{ const d=await (await fetch('/save-zip/'+sessionId,{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({folder,prefix:getPrefix()})})).json();
      if(d.ok){ toast('บันทึก ZIP สำเร็จ'); lastFolder=folder; }
      else alert('บันทึกล้มเหลว: '+d.error);
    }catch(e){ alert('เกิดข้อผิดพลาด: '+e.message); }
  } else {
    try{ const blob=await (await fetch('/zip/'+sessionId)).blob();
      const url=URL.createObjectURL(blob); const a=document.createElement('a');
      a.href=url; a.download='central_images.zip'; document.body.appendChild(a); a.click();
      setTimeout(()=>{URL.revokeObjectURL(url);a.remove()},2000);
    }catch(e){ alert('ดาวน์โหลด ZIP ล้มเหลว: '+e.message); }
  }
}
</script>
</body>
</html>
'''

@app.route('/save-zip/<session_id>', methods=['POST'])
def save_zip_file(session_id):
    # BUG FIX (security): เดิมไม่เช็ค localhost — เพราะ server bind 0.0.0.0 คนอื่นใน
    # LAN เดียวกันที่เดา/ได้ session_id มา จะสั่งเขียนไฟล์ ZIP ไปที่ path ใดก็ได้บน
    # เครื่องนี้ได้ (ผ่านค่า 'folder' ที่ client ส่งมาเอง) — ต้องจำกัดเฉพาะ localhost
    # เหมือน /pick-folder, /prepare-folder, /save-folder
    remote = request.remote_addr or ''
    if remote not in ('127.0.0.1', '::1', 'localhost'):
        return {'ok': False, 'error': 'localhost เท่านั้น'}, 403
    sess = sessions.get(session_id)
    if not sess or not sess['images']:
        return {'ok': False, 'error': 'ไม่พบไฟล์'}
    data = request.json or {}
    folder = data.get('folder', '').strip() or str(Path.home() / 'Downloads')
    prefix = _safe_prefix(data.get('prefix', ''))
    fmt = sess.get('fmt', {})
    try:
        Path(folder).mkdir(parents=True, exist_ok=True)
        out = Path(folder) / 'central_images.zip'
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for sku, img_bytes in sess['images'].items():
                ext = 'png' if fmt.get(sku) == 'png' else 'jpg'
                zf.writestr(f'{prefix}{sku}.{ext}', img_bytes)
        out.write_bytes(buf.getvalue())
        return {'ok': True, 'path': str(out)}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


if __name__ == '__main__':
    import sys, webbrowser, os
    port = int(os.environ.get('PORT', 5000))
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    print(f'\nCentral Image Downloader')
    print(f'   Open browser: http://localhost:{port}\n')
    # NO_BROWSER=1 = รันเบื้องหลัง (LaunchAgent บน Mac) — ไม่ต้องเด้ง browser ทุกครั้งที่เปิดเครื่อง
    if not os.environ.get('NO_BROWSER'):
        webbrowser.open(f'http://localhost:{port}')
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
