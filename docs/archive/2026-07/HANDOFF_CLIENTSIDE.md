# HANDOFF: เขียน Central Image Downloader ใหม่เป็น Client-Side (static site)

> เป้าหมาย: ย้าย pipeline โหลดรูปทั้งหมดไปทำใน browser (ไทย→ไทย ตรง ไม่ผ่าน server)
> ผลลัพธ์: static site (HTML+JS ล้วน) — ฟรี, เร็วเท่า localhost, ไม่มี cold start, ไม่มี python/Flask/Render web service
> โฮสต์: **Cloudflare Pages** (ไม่มี cold start, edge CDN ใกล้ไทย, static ฟรี)
> อ้างอิง UI/ฟีเจอร์เดิม: `app.py` (Flask เดิม) — พอร์ตหน้าตา+ฟีเจอร์ให้เหมือน แต่ logic โหลดรูปเขียนใหม่เป็น JS

---

## 0) ขอบเขต — เอา/ตัดอะไร

**เก็บ:** วาง SKU หลายตัว → โหลดรูป → แปลง JPEG/PNG → gallery เลือกลำดับรูป → **Trim** + **Dicut ขาว** → auto-save เข้า folder → ZIP → history → theme dark/light → จำกัด 80 SKU/รอบ

**ตัดทิ้ง:** Dicut AI (rembg) และ Dicut PS (Photoshop) — เอาออกหมด (ใช้ข้ามเครื่องไม่ได้). ไม่ต้องมี server, helper, python ใดๆ

---

## 1) หา SKU → รูป: Algolia (ยิงจาก browser ตรง)

CORS ยืนยันแล้ว: Algolia ตอบ `Access-Control-Allow-Origin: *` — fetch จาก browser ได้เลย

```js
POST https://JL22XXDCS9-dsn.algolia.net/1/indexes/cds_products/query
headers:
  X-Algolia-Application-Id: JL22XXDCS9
  X-Algolia-API-Key: [REDACTED historical public search key]
  Content-Type: application/json
body: {"query":"<SKU>","hitsPerPage":1,"attributesToRetrieve":["sku","image_url","thumbnail_url","url_key"]}
```
- response: `record.image_url` = path สัมพัทธ์ เช่น `file-assets/CDSPIM/web/Image/CDS1017/YSL-...-CDS10178027-1.webp`

### ⚠️ ต้องพอร์ต logic **เต็ม** จาก `try_algolia` (app.py บรรทัด 183-260) — อย่าย่อ!
SKU มีหลายชนิด ไม่ใช่แค่ CDS ธรรมดา ลำดับการหา:

1. **getObject by SKU ก่อน** (เร็ว, exact by objectID):
   `GET https://JL22XXDCS9-dsn.algolia.net/1/indexes/cds_products/<SKU>?attributesToRetrieve=sku,url_key,image_url,thumbnail_url`
   - ได้ record → ใช้เลย (ข้าม step 2)
   - 404 → ไป step 2

2. **query fallback** (`POST .../query`):
   - body: `{"query":"<SKU>","hitsPerPage":20}`
   - **ถ้า SKU ไม่ขึ้นต้น "GR"**: เพิ่ม `"restrictSearchableAttributes":["sku"]` แล้วหา hit ที่ `hit.sku.toUpperCase() === SKU`
   - **ถ้า SKU ขึ้นต้น "GR"** (group SKU): **ไม่**ใส่ restrict, หา hit ที่ `SKU.toLowerCase() ⊂ hit.url_key.toLowerCase()` (GR id ฝังใน url_key ของทุก child) → เอา hit ตัวแรกที่เจอ (image_url ของ child variant)
   - ไม่เจอ = "ไม่พบ"

3. **validate record** (กันโหลดผิด/URL มั่ว):
   - `record.sku === SKU` **หรือ** (SKU ขึ้นต้น GR **และ** SKU ⊂ url_key) — ไม่งั้น "ไม่พบ"
   - `image_path = record.image_url || record.thumbnail_url`
   - ถ้าว่าง หรือมี `?$` (Scene7 legacy ใช้ไม่ได้) → "ไม่พบ"
   - ประกอบ URL: ถ้า image_path เป็น http(s) ใช้ตรง; ไม่งั้น `https://assets.central.co.th/` + image_path
   - **security: host ต้องเป็น `assets.central.co.th` + https เท่านั้น** ไม่งั้นทิ้ง (กันกลายเป็น URL fetcher มั่ว)

**ตัวอย่างจริง (เทสแล้ว):** `GRCDS11525010036` → getObject 404 → query 16 hits ทุกตัว url_key ลงท้าย `-grcds11525010036` → เอาตัวแรก (sku CDS24680707) → image `.../yslbeauty-makemeblushboldblurringblush-CDS24680707-1.webp`

- ขอเฉพาะ field ที่ใช้ (attributesToRetrieve) — ประหยัด + เป็น key ของ Central (ดูข้อ 8)

## 2) โหลดรูป: CDN (ยิงจาก browser ตรง)

CORS `*` ยืนยันแล้ว
```
GET https://assets.central.co.th/<image_url>
```
- คืน **webp ต้นฉบับ** (เช่น 900×1200) — ขนาดที่เก็บจริง ไม่ resize, query param ทุกตัวถูก ignore
- 404 = ไม่มีไฟล์

## 3) รูปลำดับอื่น (gallery)

- `image_url` ลงท้าย `-1.webp` — รูปถัดไปแทนเลข: `-2.webp`, `-3.webp`, ...
- แทนเฉพาะเลขก่อน `.webp` ตัวท้าย (regex: `/-(\d+)\.webp$/`)
- probe แบบ **lazy**: โหลดรูปหลัก (-1 หรือ img_index ที่เลือก) ของทุก SKU ก่อน. probe gallery เฉพาะตอนผู้ใช้เปิด card / กดดูรูปอื่น
- **ห้าม** probe 20×80 = 1600 requests รวด. concurrency รวม 4-6, ~5-10 req/s, เจอ 429/503 → exponential backoff (1,2,4,8s + jitter), cache ผล probe ใน IndexedDB (key = SKU+baseURL)
- ถ้ารูป -1 ไม่มีเลข (เช่น PROMO) ก็โหลด image_url ตรงๆ

## 4) แปลงเป็น JPEG/PNG ใน browser (canvas)

```js
const blob = await (await fetch(cdnUrl)).blob();          // webp
const bmp  = await createImageBitmap(blob);
const cv = new OffscreenCanvas(bmp.width, bmp.height);     // ขนาดเดิม ไม่ resize
cv.getContext('2d').drawImage(bmp, 0, 0);
const out = await cv.convertToBlob({type:'image/jpeg', quality:0.95}); // หรือ image/png
bmp.close();                                               // ปล่อย memory ทุกรูป
```
- format ตาม dropdown: JPEG (q 0.95) หรือ PNG
- **ทำทีละรูป** decode→encode→save→ปล่อย (อย่าโหลดทั้ง 80 เข้า canvas พร้อมกัน)
- ⚠️ ก่อนใช้จริง: A/B test 20-30 รูป เทียบ JPEG จาก canvas กับของเดิม (Pillow q100 4:4:4). ตาดูไม่ต่างน่าจะพอ. ถ้าเจอ artifact/สีเพี้ยน → เปลี่ยนไปใช้ **mozjpeg WASM** ใน Web Worker (คุณภาพ/subsampling ใกล้ Pillow) — ทำเฉพาะเมื่อจำเป็น

## 5) Dicut ขาว (client-side, canvas)

พอร์ตจาก `dicut_white` ใน app.py (tol=20):
```js
// ctx.getImageData → วน pixel: ถ้า r>=235 && g>=235 && b>=235 → alpha=0
// putImageData → toBlob PNG → แล้ว trim (ข้อ 6)
```
- เหมาะพื้นขาวสะอาด; ตัวสินค้าขาวอาจโดนกัด (ยอมรับได้ ตัด AI ออกแล้ว)
- ผลเป็น PNG โปร่งใส

## 6) Trim (client-side, canvas)

พอร์ตจาก `trim_to_content` ใน app.py:
- ถ้ารูปมี alpha (PNG dicut แล้ว) → หา bbox ของ pixel ที่ alpha>0
- ถ้า RGB พื้นขาว → หา bbox ของ pixel ที่ไม่ใช่ขาว (tol 20) คงพื้นขาวไว้ ออก JPEG
- crop = drawImage(src, -x,-y) ลง canvas ใหม่ขนาด bbox → export
- ทำจากรูป**ปัจจุบัน** (จะ trim เดี่ยว หรือ dicut ก่อนก็ได้)
- ปุ่ม "↺ ต้นฉบับ" คืนรูปเดิม (เก็บ blob ต้นฉบับต่อ SKU ไว้)

## 7) บันทึก: auto-save folder + ZIP

**Auto-save (เหมือน localhost บน Chrome/Edge):**
```js
handle = await showDirectoryPicker({mode:'readwrite'});   // ครั้งเดียว
// persist ลง IndexedDB (handle serialize ได้) → reload ไม่ต้องเลือกใหม่
// ก่อนเขียนทุกครั้ง: queryPermission({mode:'readwrite'}); ถ้าไม่ granted → requestPermission (ต้องจาก user gesture)
const fh = await handle.getFileHandle(prefix+sku+'.'+ext, {create:true});
const w  = await fh.createWritable(); await w.write(blob); await w.close();  // เขียนทับ ไม่มี (1)(2)
```
- permission หมด/เขียนล้ม → ล้าง handle, โชว์ปุ่มขออนุญาตใหม่, อย่าเงียบตกไป `<a download>`
- ⚠️ Chrome บล็อกโฟลเดอร์ระบบ ("contains system files") → แจ้งผู้ใช้เลือก**โฟลเดอร์ย่อย** (เช่นสร้าง `central` ใน Documents) ไม่ใช่ root Desktop/Documents/Downloads
- Safari/Firefox (ไม่มี showDirectoryPicker) → ใช้ ZIP เป็นโหมดหลัก (ไม่ใช่ fallback แปลก)

**ZIP:**
```js
// JSZip: ชื่อไฟล์ในซิป = prefix+SKU+.ext (deterministic เขียนทับได้ตอนแตก)
// ชื่อซิป = central_images_YYYYMMDD_HHMMSS.zip (ไม่ชนกัน browser ไม่เติม (1)(2))
```
- ZIP สร้างใน RAM ของเครื่องผู้ใช้เอง → **ไม่ต้องจำกัดจำนวน** แค่เขียนคำเตือนใต้ปุ่ม เช่น "โหลดจำนวนมากๆ เครื่องแรมน้อยอาจช้า/ค้าง"

## 7.5) ⚠️⚠️ ข้อจำกัดใหญ่: browser ทำได้แค่ STEP 1 (Algolia)

pipeline เต็มใน app.py มี 5 STEP (`run_download` บรรทัด ~793-965):
- STEP 1: Algolia → ✅ browser ได้ (CORS *)
- STEP 1-direct: scrape `www.central.co.th/search` (`try_central_direct`) → ❌ WAF 403 + ไม่มี CORS
- STEP 1.5: recheck ด้วย curl_cffi ปลอม TLS (`recheck_central_thorough`) → ❌ browser ปลอม TLS/ยิง www.central ไม่ได้
- STEP 2: Google I'm Feeling Lucky (`try_google_search`) → ❌ ไม่มี CORS + redirect + CAPTCHA
- STEP 3: scrape หน้า product ดึง gallery (`fetch_from_product_url`) → ❌ WAF + ไม่มี CORS

**client-side ทำได้เฉพาะ STEP 1.** STEP 1-direct/1.5/2/3 พึ่งการยิง www.central.co.th + Google ซึ่ง browser ทำไม่ได้ (และ Render datacenter IP ก็โดน WAF บล็อกเหมือนกัน — fallback พวกนี้ทำงานจริงเฉพาะบน **localhost IP ไทย**)

**ผลต่อ coverage:**
- SKU ที่อยู่ใน Algolia (CDS ปกติ + GR) → client-side โหลดได้ (น่าจะส่วนใหญ่)
- SKU ที่ Algolia ไม่มี แต่เมื่อก่อนเจอผ่าน Google/scrape → **client-side ทำไม่ได้** → ต้อง flag "ไม่พบ (ลองบน localhost)"
- **ต้องเทสวัดก่อน:** เอา SKU เคสยากที่เคยแก้ (เจอผ่าน Google) มายิง Algolia getObject+query+GR ดูว่ากี่ % เจอ. ถ้า ~95%+ → client-side คุ้ม
- แนะนำ: **คง Flask app.py (localhost) ไว้** สำหรับ batch ที่มี SKU เคสยาก. หรือถ้าต้อง Google fallback บนเว็บจริง → ต้องมี proxy บน **IP ไทย** (Cloudflare Tunnel→เครื่องบ้าน / VPS ไทย) ไม่ใช่ browser/Render

**UI ต้องแยกชัด:** "ไม่พบใน Algolia" ≠ "ไม่มีสินค้า" — บอกผู้ใช้ว่า SKU นี้ต้องใช้ localhost (ที่มี Central/Google fallback) โหลด

## 7.6) 🐛 KNOWN ISSUE + FIX: MKP บางตัว "ไม่พบใน Algolia" เป็นครั้งคราว

**อาการ:** SKU marketplace (ขึ้นต้น MKP) บางตัวขึ้น "ไม่พบใน Algolia" แบบ intermittent — ตัวเดียวกันบางรอบเจอ บางรอบไม่เจอ (โดยเฉพาะตอนยิงหลาย SKU พร้อมกัน). CDS ไม่ค่อยเป็น

**สาเหตุ (วินิจฉัยแล้ว):** `-dsn.algolia.net` route ไป **edge POP ตามพิกัดผู้เรียก**. record MKP (เพิ่งเข้า index) replicate ไป edge POP บางตัวช้า → POP ใกล้ผู้ใช้ตอบ **404 ชั่วคราว** ให้ record ที่ POP อื่นมี. getObject 404 → query fallback ก็โดน POP เดิม miss → สรุป not_found. โค้ดตอนนี้**ไม่ retry** เลยยอมแพ้ทันที
(ยืนยัน: ยิง getObject รัวจาก server + browser = 200 เสมอ; ไม่ใช่ record หาย ไม่ใช่บั๊ก lookup logic — เป็น DSN edge lag ล้วนๆ)

**FIX ที่ต้องทำใน `client/app.js` `lookupAlgolia`:**
1. ถ้าผลลัพธ์เป็น not_found (getObject 404 **และ** query ไม่เจอ exact/GR) → **อย่าเพิ่งคืน null**
2. retry ทั้ง lookup อีก **2 รอบ** หน่วง ~800ms คั่นแต่ละรอบ
3. **รอบ retry เปลี่ยน host** จาก `JL22XXDCS9-dsn.algolia.net` → `JL22XXDCS9.algolia.net` (primary cluster, authoritative, ไม่ผ่าน edge POP → consistent กว่า) — ใช้ทั้ง getObject และ query ในรอบ retry
4. ครบ retry ยังไม่เจอ → ค่อยคืน not_found จริง (ตัว delist จริง ให้ไป localhost)
- ผลลัพธ์: transient edge-lag miss แปลงเป็น hit, ตัดปัญหา MKP หาย ๆ ได้
- เทสยืนยัน: ยิงชุด `CDS31583817 MKP1093255699 MKP1093211817 MKP1093241178` ซ้ำ ~10 รอบ ต้องได้ 4/4 ทุกรอบ

## 8) ⚠️ ข้อควรระวัง (สำคัญ)

1. **Algolia key เป็นของ Central ไม่ใช่ของเรา** — "public/search-only" ไม่ได้แปลว่า Central อนุญาต third-party ใช้. Central rotate/restrict/เปลี่ยน index ได้ตลอด, traffic เราไปกิน Algolia quota เขา. → throttle, exact-match SKU, ขอเฉพาะ field, ไม่ browse/export ทั้ง index. เก็บ APP_ID/key/index ในไฟล์ config แยก (เปลี่ยนง่าย) แต่ไม่ถือเป็น secret. แสดง error ชัดเมื่อ key/index ถูกเปลี่ยน
2. ถ้าวันหน้า Central ปิด CORS หรือเปลี่ยน endpoint → ต้องมี server proxy สำรอง (คง Flask เดิมไว้เป็น legacy/fallback ได้ ไม่ต้องลบ)
3. `showDirectoryPicker` = secure context (https) + user gesture + Chromium เท่านั้น

## 9) UI — พอร์ตจาก app.py ให้เหมือนเดิม

ผู้ใช้คุ้นหน้าตาเดิม (มีคนใช้เยอะ). พอร์ตจาก HTML ใน `app.py`:
- textarea วาง SKU + live count + "พบ N SKU · สูงสุด 80 SKU ต่อครั้ง"
- ปุ่ม Download, dropdown รูปเริ่มต้น (1-20), dropdown ไฟล์ (JPEG q100 / PNG), prefix ชื่อไฟล์, ปุ่มล้าง
- toggle บันทึกภาพอัตโนมัติ + ปุ่มเลือก Folder + ชื่อ folder ที่เลือก
- grid การ์ดต่อ SKU: รูป, ชื่อ SKU, ปุ่ม lock, chips เลือกลำดับรูป (gallery), comparison slider (ต้นฉบับ vs dicut)
- แถวปุ่ม: **🔲 Trim** (ตัวแรก) → **✂️ Dicut** (ขาว) → **↺ ต้นฉบับ** (ตัด Dicut AI/PS ออก)
- ปุ่ม 📦 บันทึก ZIP
- history 8 รายการล่าสุด (localStorage), theme toggle (localStorage), drag-drop ไฟล์ .txt/.csv วาง SKU
- จำกัด 80 SKU (client-side) + ข้อความเตือน
- ดู `app.py` บรรทัด ~1850-2240 (HTML/CSS) และ ~2260-2900 (JS) เป็นต้นแบบหน้าตา+behavior

## 10) POC ก่อน rewrite เต็ม (ทำอันนี้ก่อน!)

ไฟล์ HTML เดียว พิสูจน์ 5 อย่างบน origin จริง (เปิดผ่าน http server ธรรมดา):
1. Algolia POST ด้วย SKU จริง (เช่น CDS10178027) → ได้ image_url
2. fetch CDN → ได้ webp 200
3. fetch CDN เลข -2 ที่ไม่มี → 404 (ยืนยัน gallery probe หยุดถูก)
4. canvas: webp → JPEG blob ขนาดเดิม
5. showDirectoryPicker → เขียนไฟล์เข้า folder ได้
ผ่านครบ + เร็วกว่า Render ชัด → ค่อยยก UI ทั้งหมดไป Cloudflare Pages

## 11) Deploy

- Cloudflare Pages: push repo (หรือ folder static) → เชื่อม → เสร็จ. ไม่มี build ก็ได้ (static ล้วน)
- ทางเลือกรอง: Render Static Site (ไม่มี cold start เหมือนกัน). อย่าใช้ Render Web Service (Flask) เป็นเส้นทางหลักอีก
- domain: ใช้ของ Cloudflare Pages ฟรี หรือผูก custom domain ได้

---

## สรุปสถาปัตยกรรมเป้าหมาย
```
static site (Cloudflare Pages) — ไม่มี server/python/cold start
  browser: Algolia lookup → CDN download → canvas (JPEG/PNG, Dicut ขาว, Trim)
           → save folder (Chrome/Edge) / ZIP (ทุก browser)
  IndexedDB: folder handle + gallery probe cache
  legacy: คง Flask app.py ไว้เป็น fallback เผื่อ Central ปิด CORS (ไม่ลบ)
```
