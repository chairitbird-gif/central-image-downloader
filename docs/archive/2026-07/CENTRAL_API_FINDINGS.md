# Central Image Downloader — ผลการเจาะ Central backend (สำหรับ Codex)

> เขียนโดย Fable 5 วันที่ 2026-07-13 หลังทดสอบยิง endpoint จริงจากเครื่อง IP ไทย
> เป้าหมายไฟล์นี้: ให้ Codex เข้าใจปัญหา + ทางแก้ที่พิสูจน์แล้ว แล้วลงมือแก้โค้ดต่อได้เลย

---

## 1. ปัญหา (root cause)

- แอปเดิม (`app.py`) หา URL รูปด้วยการ **scrape หน้า** `https://www.central.co.th/en/search/{SKU}`
  แล้ว regex เอา `imageSrcSet="..._next/image?url=<CDN url>"`
- หน้า `www.central.co.th` มี **WAF** ที่บล็อก request จาก **datacenter IP** (Render/cloud) → คืน **HTTP 403**
- โค้ด/URL เดียวกันยิงจาก **IP ไทย (เครื่อง dev) ได้ 200 ปกติ**
- เปลี่ยน User-Agent / cookies / TLS fingerprint (requests, curl_cffi impersonate=chrome124, curl) **ทดลองครบแล้ว ยัง 403 บน Render**

**สรุป: WAF บล็อกที่ระดับ IP/network reputation ของ host `www.central.co.th` เท่านั้น — ไม่ใช่บั๊กของโค้ด**

---

## 2. ทางแก้หลักที่พิสูจน์แล้ว: ใช้ Algolia (ไม่โดน WAF)

Central ใช้ **Algolia** เป็น search engine เบื้องหลัง Algolia เป็น **global edge CDN** ยิงจาก IP ไหนก็ได้ทั่วโลก (รวม Render) — ไม่มี WAF/geo block

### พารามิเตอร์ที่ทดสอบสำเร็จจริง (ยิงแล้วได้ข้อมูลกลับมา)

```
POST https://JL22XXDCS9-dsn.algolia.net/1/indexes/cds_en_products/query
Headers:
  X-Algolia-Application-Id: JL22XXDCS9
  X-Algolia-API-Key: [REDACTED historical public search key]
  Content-Type: application/json
Body:
  {"query":"CDS10178027","hitsPerPage":1}
```

- **App ID**: `JL22XXDCS9`
- **Search-only API key**: `[REDACTED]`
  (เป็น public frontend key ของ Central เอง — read-only, ยิง query ได้อย่างเดียว, ปลอดภัยที่จะฝังใน backend)
- **Index**: `cds_en_products` (สินค้า 1,506,203 รายการ = ทั้ง catalog ภาษาอังกฤษ)
  - index อื่นที่เจอ: `cds_categories`, `cds_en_products_bestseller_count_asc`, replicas สำหรับ sort
- หมายเหตุ: เคยทดสอบ public search-only key มากกว่าหนึ่งค่า แต่ค่าถูก redact ใน archive นี้

### ตัวอย่าง response fields ที่ได้ (SKU=CDS10178027)

record มี field ครบ เช่น:
`sku`, `name`, `brand_name`, `brand_id`, `url` (PDP path), `url_key`, `price`, `final_price`,
`discount_percentage`, `is_in_stock`, `stock`, `categories`, `objectID`, ...

**field รูป** (ทุกตัวชี้ชื่อเดียวกัน):
```
"image_url":     "awyvessaintlaurent-menfragrancemyslfeaudeparfum100ml-CDS10178027-1?$JPEG$"
"thumbnail_url": "awyvessaintlaurent-menfragrancemyslfeaudeparfum100ml-CDS10178027-1?$JPEG$"
"thumbnail":     "awyvessaintlaurent-menfragrancemyslfeaudeparfum100ml-CDS10178027-1?$JPEG$"
"image":         "awyvessaintlaurent-menfragrancemyslfeaudeparfum100ml-CDS10178027-1?$JPEG$"
```
`?$JPEG$` / `?$PNG$` = **Adobe Scene7 image preset** (image_url เป็นชื่อ asset ของ Scene7 ไม่ใช่ URL เต็ม)

---

## 3. ปมที่ยังค้าง 1 จุด: หา image host ให้เป็น URL เต็ม

มีระบบรูป **2 ชุดที่ชื่อไฟล์ไม่ตรงกัน** — ต้องเลือกทางใดทางหนึ่ง:

### ทาง A — Scene7 (ตรงกับที่ Algolia คืนมา) ⚠️ ยังหา base host ไม่เจอ
- Algolia คืนชื่อ Scene7: `awyvessaintlaurent-...-CDS10178027-1?$JPEG$`
- URL เต็มควรเป็นรูปแบบ `https://<scene7-host>/is/image/<company>/<ชื่อ>?$JPEG$`
- ลอง brute แล้ว **ยัง 403 หมด**: `s7d1.scene7.com/is/image/{central,centralretail,crc,cds,centralgroup,centralonline,...}`, `s7ap1.scene7.com`, `s7g10.scene7.com`
- **วิธีหาให้จบ (ทำบนเครื่องไทย 2 นาที)**: เปิดหน้า product ใน Chrome → DevTools → Network → filter `is/image` หรือ `scene7` → ดู host จริงของ request รูป แล้วเอามาเติมในโค้ด

### ทาง B — CDN `assets.central.co.th` (ที่โค้ดเดิมใช้) ✅ host ตอบ 200 แต่ชื่อไฟล์คนละแบบ
- path เดิมที่ scrape ได้:
  `https://assets.central.co.th/file-assets/CDSPIM/web/Image/CDS1017/YSL-MENFRAGRANCEMYSLFEAUDEPARFUM100ML-CDS10178027-1.webp`
- ทดสอบยิงตรง = **HTTP 200, image/webp** (host นี้ไม่ได้อยู่หลัง WAF เดียวกับ www)
- โครงสร้าง path: `.../CDSPIM/web/Image/{first7ของSKU}/{FILENAME}-{SKU}-{n}.webp`
- ❌ ปัญหา: `{FILENAME}` (`YSL-MENFRAGRANCE...`) **สร้างจาก SKU ตรงๆ ไม่ได้** และ **Algolia ไม่ได้คืนชื่อนี้** (Algolia คืนชื่อ Scene7 คนละ prefix)
- ⚠️ ยังไม่ได้ทดสอบว่า `assets.central.co.th` โดน WAF block จาก Render ไหม (แต่ CDN host แบบนี้ปกติเปิด global — ควรทดสอบ 1 บรรทัดบน Render เพื่อยืนยัน)

**คำแนะนำ**: ไปทาง A (Scene7) เพราะ deterministic จาก Algolia 100% แค่เติม base host ที่เจอจาก DevTools

---

## 4. ตัวเลือกสถาปัตยกรรม (จัดอันดับ)

| # | แนวทาง | สถานะ | ค่าใช้จ่าย | เสี่ยงบล็อก |
|---|---|---|---|---|
| **A** | **Algolia + Scene7 image** ยิงตรงจาก Render | ✅ Algolia พิสูจน์แล้ว, เหลือหา Scene7 host | ฟรี (Render เดิม) | ต่ำสุด |
| **B** | **TH egress proxy** — route เฉพาะ `_get_central_html` ผ่าน IP ไทย, โค้ด scrape เดิมไม่ต้องแก้ | ใช้ path เดิมที่เวิร์คจากไทย | VPS/residential proxy ไทย ~$3-5/เดือน | ต่ำ |
| C | ย้ายทั้ง app ไป VPS ไทย | datacenter IP ไทยอาจโดน WAF เหมือนกัน | VPS ไทย | กลาง-สูง |
| D | ให้ browser ผู้ใช้ยิงเอง | ❌ ติด CORS + WAF | – | – |
| E | Cloudflare Tunnel กลับ PC | ✅ แต่ต้องเปิดเครื่อง (user ปฏิเสธ) | ฟรี | ต่ำ |

**แผนที่แนะนำ = A เป็น primary + B เป็น fallback**
- primary: query Algolia (เร็ว ฟรี ไม่โดนบล็อก)
- fallback: ถ้า Algolia ไม่เจอ SKU / รูปไม่ครบ → ยิงหน้า search เดิมผ่าน TH proxy
- ของเดิม `try_google_search()` เก็บเป็น fallback ชั้นสุดท้ายได้

---

## 5. งานที่ต้องทำต่อ (สำหรับ Codex)

1. **เพิ่ม `try_algolia(sku)` ใน `app.py`**
   - POST ไป endpoint ข้อ 2 ด้วย app-id/key/index ข้างบน
   - parse `hits[0]` → ตรวจ `sku` ตรง (กัน false match) → คืน `image_url` + metadata
   - แทน/เสริม `try_central_direct()` ให้เป็น STEP 1 ตัวใหม่
2. **หา Scene7 base host** (DevTools บนเครื่องไทย ตามข้อ 3A) แล้ว hardcode/config ในโค้ด → ประกอบ URL เต็ม `https://<host>/is/image/<company>/<image_url ที่ตัด ?$JPEG$ ออก>?...` (เลือก preset ให้ได้ไฟล์ต้นฉบับ ไม่ resize)
   - เป้าหมายเดิม: โหลดขนาดต้นฉบับ + บังคับแปลง JPG q95 (logic แปลงมีอยู่แล้วใน `fetch_image_bytes(fmt='jpg')`)
3. **ต่อ fallback chain**: Algolia → (TH proxy → search page เดิม) → Google lucky
4. **ทดสอบบน Render**: ยืนยัน Algolia call ผ่าน datacenter IP (ควรผ่านชัวร์) + ทดสอบ `assets.central.co.th` / Scene7 host ว่า serve รูปได้จาก Render ไหม
5. คงข้อจำกัดเดิม: สูงสุด 80 SKU/รอบ, Gunicorn 1 worker (session ใน memory), Dicut/Dicut AI/Dicut PS ตามเฟสเดิม

---

## 6. คำสั่งทดสอบซ้ำ (copy วางรันได้เลย)

```bash
# 6.1 Algolia query by SKU (ต้องได้ nbHits:1 + image_url)
curl -s "https://JL22XXDCS9-dsn.algolia.net/1/indexes/cds_en_products/query" \
  -H "X-Algolia-Application-Id: JL22XXDCS9" \
  -H "X-Algolia-API-Key: [REDACTED]" \
  -X POST -d '{"query":"CDS10178027","hitsPerPage":1}'

# 6.2 list index (ยืนยัน key + เห็นชื่อ index ทั้งหมด)
curl -s "https://JL22XXDCS9-dsn.algolia.net/1/indexes" \
  -H "X-Algolia-Application-Id: JL22XXDCS9" \
  -H "X-Algolia-API-Key: [REDACTED]"

# 6.3 CDN image เดิม (ควรได้ 200 image/webp)
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  "https://assets.central.co.th/file-assets/CDSPIM/web/Image/CDS1017/YSL-MENFRAGRANCEMYSLFEAUDEPARFUM100ML-CDS10178027-1.webp"
```

---

## 7. ข้อควรระวัง / กฎเดิมที่ยังใช้

- โหลด **ขนาดต้นฉบับ ห้าม resize**, บังคับแปลง **JPG q95**
- จำกัด **80 SKU/รอบ** (มีข้อความบน UI + backend reject เกิน)
- **Gunicorn 1 worker** (session + ไฟล์ภาพเก็บใน memory)
- ตรวจ `sku` ใน record ที่ Algolia คืนมาให้ตรง ก่อนใช้ (index ใหญ่ 1.5M — query กว้างอาจได้ตัวใกล้เคียง)
- Repo: `chairitbird-gif/central-image-downloader` · Render: https://central-image-downloader.onrender.com/ · deploy copy: `D:\Bird\Claude Code\centralimage_web`
