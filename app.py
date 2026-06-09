"""
Central Image Downloader — Web App
เปิด browser แล้วใช้งานได้เลย

Requirements: pip install flask requests Pillow
Run:          python app.py
Open:         http://localhost:5000
"""
import io, re, time, json, zipfile, threading, os, functools
from pathlib import Path
from urllib.parse import unquote, quote_plus
from queue import Queue, Empty

import requests
from flask import Flask, Response, request, send_file, stream_with_context, abort
from PIL import Image

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'central-dl-secret')

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

# ── Core Functions ─────────────────────────────────────────────────────────────

def try_central_direct(sku):
    r = requests.get(f'https://www.central.co.th/en/search/{sku}',
                     headers=HEADERS, timeout=15)
    r.raise_for_status()
    matches = re.findall(r'imageSrcSet="[^"]*url=([^&"]+)', r.text)
    if not matches:
        return None, 'not_found'
    img_url = unquote(matches[0])
    if not sku.upper().startswith('GR') and sku.upper() not in img_url.upper():
        return None, 'not_found'
    return img_url, None

def try_google_search(sku):
    try:
        time.sleep(0.4)
        r = requests.get(
            f'https://www.google.com/search?q={quote_plus(sku)}&hl=th&num=5',
            headers=GOOGLE_HEADERS, timeout=15)
        if r.status_code == 429:
            return None, 'google_blocked'
        m = re.findall(r'href="(https?://www\.central\.co\.th/[^"]+)"', r.text)
        urls = list(dict.fromkeys(u for u in m if '/search' not in u))
        return (urls[0], None) if urls else (None, 'not_found')
    except Exception as e:
        return None, str(e)

def fetch_image_bytes(image_url, referer='https://www.central.co.th/'):
    r = requests.get(image_url, headers={**HEADERS, 'Referer': referer}, timeout=15)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert('RGB')
    w, h = img.size
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=95)
    buf.seek(0)
    return buf.getvalue(), w, h

def fetch_from_product_url(product_url):
    r = requests.get(product_url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    matches = re.findall(r'imageSrcSet="[^"]*url=([^&"]+)', r.text)
    if not matches:
        raise ValueError('ไม่พบรูปในหน้าสินค้า')
    img_url = unquote(matches[0])
    return fetch_image_bytes(img_url, referer=product_url)

# ── Session store (in-memory) ─────────────────────────────────────────────────
sessions = {}   # session_id → {'images': {sku: bytes}, 'done': bool}

def run_download(session_id, skus, queue):
    """รัน download logic ใน background thread, ส่ง progress ผ่าน queue"""
    images = {}
    ok_direct, ok_google, not_found, errors = [], [], [], []

    def emit(data):
        queue.put(json.dumps(data))

    emit({'type': 'start', 'total': len(skus)})

    # ── STEP 1: Central direct ─────────────────────────────────────────────
    emit({'type': 'step', 'msg': 'STEP 1 — ค้น Central.co.th โดยตรง'})
    need_google = []

    for i, sku in enumerate(skus, 1):
        emit({'type': 'progress', 'current': i, 'sku': sku, 'status': 'searching'})
        try:
            img_url, status = try_central_direct(sku)
            if status == 'not_found':
                need_google.append(sku)
                emit({'type': 'item', 'sku': sku, 'status': 'need_google',
                      'msg': 'ไม่พบ → จะค้น Google'})
            else:
                img_bytes, w, h = fetch_image_bytes(img_url)
                kb = round(len(img_bytes) / 1024, 2)
                images[sku] = img_bytes
                ok_direct.append({'sku': sku, 'w': w, 'h': h, 'kb': kb})
                emit({'type': 'item', 'sku': sku, 'status': 'ok',
                      'source': 'direct', 'w': w, 'h': h, 'kb': kb})
        except Exception as e:
            errors.append({'sku': sku, 'reason': str(e)})
            emit({'type': 'item', 'sku': sku, 'status': 'error', 'msg': str(e)})

    # ── STEP 2: Google search ──────────────────────────────────────────────
    if need_google:
        emit({'type': 'step', 'msg': f'STEP 2 — ค้น Google ({len(need_google)} SKU)'})
        found_google = []
        for sku in need_google:
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

        # ── STEP 3: Download Google results ───────────────────────────────
        if found_google:
            emit({'type': 'step',
                  'msg': f'STEP 3 — ดาวน์โหลดจาก Google ({len(found_google)} SKU)'})
            for sku, prod_url in found_google:
                emit({'type': 'progress', 'sku': sku, 'status': 'downloading'})
                try:
                    img_bytes, w, h = fetch_from_product_url(prod_url)
                    kb = round(len(img_bytes) / 1024, 2)
                    images[sku] = img_bytes
                    ok_google.append({'sku': sku, 'w': w, 'h': h, 'kb': kb})
                    emit({'type': 'item', 'sku': sku, 'status': 'ok',
                          'source': 'google', 'w': w, 'h': h, 'kb': kb})
                except Exception as e:
                    errors.append({'sku': sku, 'reason': str(e)})
                    emit({'type': 'item', 'sku': sku, 'status': 'error', 'msg': str(e)})

    # ── Done ───────────────────────────────────────────────────────────────
    sessions[session_id] = {'images': images, 'done': True}
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
    return HTML_PAGE

@app.route('/auth', methods=['POST'])
def auth():
    from flask import make_response, redirect
    pwd = request.form.get('password', '')
    if pwd == ACCESS_PASSWORD:
        resp = make_response(redirect('/'))
        resp.set_cookie('access_token', pwd, max_age=86400*30, httponly=True)
        return resp
    return LOGIN_PAGE.replace('</form>', '<p style="color:red;margin-top:10px">รหัสผ่านไม่ถูกต้อง</p></form>')

@app.route('/download', methods=['POST'])
@require_auth
def download():
    import uuid
    data = request.json
    skus = [s.strip().upper() for s in re.split(r'[\s,]+', data.get('skus', '')) if s.strip()]
    if not skus:
        return {'error': 'ไม่มี SKU'}, 400

    session_id = str(uuid.uuid4())
    sessions[session_id] = {'images': {}, 'done': False}

    queue = Queue()

    def generate():
        thread = threading.Thread(
            target=run_download, args=(session_id, skus, queue), daemon=True)
        thread.start()
        while True:
            try:
                msg = queue.get(timeout=60)
                if msg is None:
                    break
                yield f'data: {msg}\n\n'
            except Empty:
                yield 'data: {"type":"ping"}\n\n'
        yield f'data: {json.dumps({"type":"session","id":session_id})}\n\n'

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )

@app.route('/zip/<session_id>')
def get_zip(session_id):
    sess = sessions.get(session_id)
    if not sess or not sess['images']:
        return 'ไม่พบไฟล์', 404
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for sku, img_bytes in sess['images'].items():
            zf.writestr(f'{sku}.jpg', img_bytes)
    buf.seek(0)
    return send_file(buf, mimetype='application/zip',
                     as_attachment=True, download_name='central_images.zip')

@app.route('/img/<session_id>/<sku>')
def get_img(session_id, sku):
    sess = sessions.get(session_id)
    if not sess or sku not in sess['images']:
        return 'ไม่พบ', 404
    return send_file(io.BytesIO(sess['images'][sku]), mimetype='image/jpeg')

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
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: #f0f2f5; color: #222; min-height: 100vh; }

  /* ── Header ── */
  header { background: #0066cc; color: #fff; padding: 18px 28px;
           display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 1.3rem; font-weight: 700; }
  header span { font-size: .85rem; opacity: .75; }

  /* ── Layout ── */
  .container { max-width: 860px; margin: 28px auto; padding: 0 16px; }

  /* ── Card ── */
  .card { background: #fff; border-radius: 12px;
          box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 24px; margin-bottom: 20px; }
  .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 14px; color: #444; }

  /* ── Input ── */
  textarea { width: 100%; height: 110px; border: 1.5px solid #d0d7de; border-radius: 8px;
             padding: 10px 12px; font-family: 'Menlo','Consolas',monospace; font-size: .9rem;
             resize: vertical; outline: none; transition: border .2s; }
  textarea:focus { border-color: #0066cc; }

  /* ── Buttons ── */
  .btn-row { display: flex; gap: 10px; margin-top: 14px; align-items: center; }
  button { border: none; border-radius: 8px; cursor: pointer;
           font-size: .95rem; font-weight: 600; padding: 10px 22px;
           transition: opacity .15s, transform .1s; }
  button:active { transform: scale(.97); }
  .btn-primary { background: #0066cc; color: #fff; }
  .btn-primary:hover { opacity: .88; }
  .btn-primary:disabled { background: #9bb8d8; cursor: not-allowed; transform: none; }
  .btn-secondary { background: #e9ecef; color: #444; }
  .btn-secondary:hover { background: #dee2e6; }
  #btn-zip { background: #198754; color: #fff; display: none; }
  #btn-zip:hover { opacity: .88; }

  /* ── Progress bar ── */
  .prog-wrap { background: #e9ecef; border-radius: 99px; height: 8px;
               margin: 14px 0 6px; overflow: hidden; }
  .prog-bar { height: 100%; background: #0066cc; border-radius: 99px;
              width: 0; transition: width .3s; }
  #prog-label { font-size: .8rem; color: #888; }

  /* ── Log ── */
  .log-wrap { background: #1e1e1e; border-radius: 10px; padding: 14px 16px;
              max-height: 320px; overflow-y: auto; font-family: 'Menlo','Consolas',monospace;
              font-size: .82rem; line-height: 1.65; }
  .log-wrap p { white-space: pre-wrap; }
  .c-ok    { color: #4ec9b0; }
  .c-warn  { color: #dcdcaa; }
  .c-err   { color: #f44747; }
  .c-info  { color: #9cdcfe; }
  .c-head  { color: #fff; font-weight: bold; }
  .c-muted { color: #858585; }

  /* ── Image grid ── */
  .img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
              gap: 12px; margin-top: 6px; }
  .img-card { border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;
              background: #fafafa; text-align: center; }
  .img-card img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }
  .img-card .sku-label { font-size: .72rem; color: #555; padding: 5px 6px;
                          word-break: break-all; line-height: 1.3; }

  /* ── Summary pills ── */
  .pills { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .pill { border-radius: 99px; padding: 5px 14px; font-size: .85rem; font-weight: 600; }
  .pill-ok  { background: #d1fae5; color: #065f46; }
  .pill-err { background: #fee2e2; color: #991b1b; }
  .pill-warn{ background: #fef9c3; color: #713f12; }
</style>
</head>
<body>

<header>
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
  </svg>
  <div>
    <h1>Central Image Downloader</h1>
    <span>โหลดรูปสินค้าจาก central.co.th ด้วยรหัส SKU</span>
  </div>
</header>

<div class="container">

  <!-- Input -->
  <div class="card">
    <h2>📋 รหัส SKU</h2>
    <textarea id="sku-input"
      placeholder="วางรหัส SKU ที่นี่ คั่นด้วยช่องว่าง หรือ Enter&#10;เช่น  CDS10268964  CDS10268995  GRCDS53725060025"></textarea>
    <div class="btn-row">
      <button class="btn-primary" id="btn-start" onclick="startDownload()">⬇ Download</button>
      <button class="btn-secondary" onclick="clearAll()">🗑 ล้าง</button>
      <button id="btn-zip" onclick="downloadZip()">📦 ดาวน์โหลด ZIP</button>
      <span id="prog-label" style="margin-left:auto"></span>
    </div>
    <div class="prog-wrap"><div class="prog-bar" id="prog-bar"></div></div>
  </div>

  <!-- Log -->
  <div class="card" id="card-log" style="display:none">
    <h2>📊 ผลลัพธ์</h2>
    <div class="log-wrap" id="log"></div>
    <div class="pills" id="pills"></div>
  </div>

  <!-- Image grid -->
  <div class="card" id="card-imgs" style="display:none">
    <h2>🖼 รูปภาพที่ดาวน์โหลด</h2>
    <div class="img-grid" id="img-grid"></div>
  </div>

</div>

<script>
let sessionId = null;
let total = 0;
let current = 0;

function log(html, cls='') {
  const el = document.getElementById('log');
  el.innerHTML += `<p class="${cls}">${html}</p>`;
  el.scrollTop = el.scrollHeight;
}

function clearAll() {
  document.getElementById('sku-input').value = '';
  document.getElementById('log').innerHTML = '';
  document.getElementById('img-grid').innerHTML = '';
  document.getElementById('pills').innerHTML = '';
  document.getElementById('card-log').style.display = 'none';
  document.getElementById('card-imgs').style.display = 'none';
  document.getElementById('btn-zip').style.display = 'none';
  document.getElementById('prog-bar').style.width = '0';
  document.getElementById('prog-label').textContent = '';
  sessionId = null; total = 0; current = 0;
}

function setProgress(cur, tot) {
  const pct = tot ? Math.round(cur / tot * 100) : 0;
  document.getElementById('prog-bar').style.width = pct + '%';
  document.getElementById('prog-label').textContent = tot ? `${cur} / ${tot}` : '';
}

function addImage(sid, sku) {
  document.getElementById('card-imgs').style.display = '';
  const grid = document.getElementById('img-grid');
  const d = document.createElement('div');
  d.className = 'img-card';
  d.innerHTML = `<img src="/img/${sid}/${sku}" loading="lazy" alt="${sku}">
                 <div class="sku-label">${sku}</div>`;
  grid.appendChild(d);
}

function startDownload() {
  const skus = document.getElementById('sku-input').value.trim();
  if (!skus) { alert('กรุณากรอก SKU ก่อน'); return; }

  clearAll();
  document.getElementById('sku-input').value = skus;
  document.getElementById('card-log').style.display = '';
  document.getElementById('btn-start').disabled = true;

  const es = new EventSource('/download?' + new URLSearchParams(), {});
  // ใช้ fetch + SSE
  fetch('/download', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({skus})
  }).then(async res => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += decoder.decode(value, {stream: true});
      const lines = buf.split('\\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const msg = JSON.parse(line.slice(6));
        handleMsg(msg);
      }
    }
  }).catch(e => {
    log('❌ เกิดข้อผิดพลาด: ' + e.message, 'c-err');
    document.getElementById('btn-start').disabled = false;
  });
}

function handleMsg(msg) {
  switch (msg.type) {
    case 'start':
      total = msg.total;
      log(`📦 กำลังโหลด ${total} SKU\\n`, 'c-head');
      break;

    case 'step':
      log('\\n─── ' + msg.msg + ' ───', 'c-info');
      break;

    case 'progress':
      current++;
      setProgress(current, total);
      break;

    case 'item':
      if (msg.status === 'ok') {
        const src = msg.source === 'direct' ? 'Central' : 'Google';
        log(`  ✅  ${msg.sku.padEnd(28)}  ${msg.w}×${msg.h}px   ${msg.kb} KB   [${src}]`, 'c-ok');
        if (sessionId) addImage(sessionId, msg.sku);
      } else if (msg.status === 'need_google') {
        log(`  ⏭   ${msg.sku.padEnd(28)}  ไม่พบ → จะค้น Google`, 'c-warn');
      } else if (msg.status === 'found_google') {
        log(`  🔍  ${msg.sku.padEnd(28)}  เจอบน Google`, 'c-ok');
      } else if (msg.status === 'not_found') {
        log(`  ❌  ${msg.sku.padEnd(28)}  ไม่พบ`, 'c-err');
      } else if (msg.status === 'blocked') {
        log(`  🚫  ${msg.sku.padEnd(28)}  Google CAPTCHA`, 'c-err');
      } else if (msg.status === 'error') {
        log(`  ⚠   ${msg.sku.padEnd(28)}  ${msg.msg}`, 'c-warn');
      }
      break;

    case 'session':
      sessionId = msg.id;
      // แสดงรูปที่ดาวน์โหลดแล้ว (ย้อนหลัง)
      document.querySelectorAll('[data-sku]').forEach(el => {
        addImage(sessionId, el.dataset.sku);
      });
      break;

    case 'done':
      setProgress(total, total);
      const ok = msg.ok_direct.length + msg.ok_google.length;

      log('\\n' + '─'.repeat(54), 'c-head');
      log(`  📊  สรุปผล`, 'c-head');
      log('─'.repeat(54), 'c-head');

      if (msg.ok_direct.length) {
        log(`\\n  ✅  Central โดยตรง  (${msg.ok_direct.length} ตัว)`, 'c-ok');
        msg.ok_direct.forEach(i => log(`      ${i.sku.padEnd(28)}  ${i.w}×${i.h}px  ${i.kb} KB`, 'c-ok'));
      }
      if (msg.ok_google.length) {
        log(`\\n  ✅  ผ่าน Google  (${msg.ok_google.length} ตัว)`, 'c-ok');
        msg.ok_google.forEach(i => log(`      ${i.sku.padEnd(28)}  ${i.w}×${i.h}px  ${i.kb} KB`, 'c-ok'));
      }
      if (msg.not_found.length) {
        log(`\\n  ❌  ไม่พบ  (${msg.not_found.length} ตัว)`, 'c-err');
        msg.not_found.forEach(s => log(`      ${s}`, 'c-err'));
      }
      if (msg.errors.length) {
        log(`\\n  ⚠   Error  (${msg.errors.length} ตัว)`, 'c-warn');
        msg.errors.forEach(e => log(`      ${e.sku}: ${e.reason}`, 'c-warn'));
      }

      log(`\\n  รวมสำเร็จ ${ok}/${total}`, 'c-head');

      // Summary pills
      const pills = document.getElementById('pills');
      if (ok) pills.innerHTML += `<span class="pill pill-ok">✅ ${ok} ดาวน์โหลดสำเร็จ</span>`;
      if (msg.not_found.length) pills.innerHTML += `<span class="pill pill-err">❌ ${msg.not_found.length} ไม่พบ</span>`;
      if (msg.errors.length) pills.innerHTML += `<span class="pill pill-warn">⚠ ${msg.errors.length} error</span>`;

      if (msg.has_images) {
        document.getElementById('btn-zip').style.display = '';
        // แสดงรูปทั้งหมด
        msg.ok_direct.concat(msg.ok_google).forEach(i => {
          if (sessionId) addImage(sessionId, i.sku);
        });
      }

      document.getElementById('btn-start').disabled = false;
      break;
  }
}

function downloadZip() {
  if (sessionId) window.location = '/zip/' + sessionId;
}
</script>
</body>
</html>
'''

if __name__ == '__main__':
    import sys, webbrowser, os
    port = int(os.environ.get('PORT', 5000))
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    print(f'\nCentral Image Downloader')
    print(f'   Open browser: http://localhost:{port}\n')
    webbrowser.open(f'http://localhost:{port}')
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
