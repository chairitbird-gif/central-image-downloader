(() => {
  'use strict';

  const CONFIG = window.CID_CONFIG;
  const THEME_KEY = 'central_tools_theme';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    items: new Map(),
    order: [],
    notFound: [],
    errors: [],
    running: false,
    abortController: null,
    runId: 0,
    total: 0,
    completed: 0,
    startedAt: 0,
    directoryHandle: null,
    processing: false,
    processCancelled: false
  };

  const els = {
    skuInput: $('#sku-input'), skuCount: $('#sku-count'), download: $('#download-button'), stop: $('#stop-button'),
    clear: $('#clear-button'), imageIndex: $('#image-index'), imageFormat: $('#image-format'), batchAdvisory: $('#batch-advisory'),
    progressBar: $('#progress-bar'), progressLabel: $('#progress-label'), history: $('#history'),
    autoSave: $('#auto-save'), autoSaveLabel: $('#auto-save-label'), folderSettings: $('#folder-settings'),
    folderButton: $('#folder-button'), folderName: $('#folder-name'), folderHelp: $('#folder-help'),
    prefix: $('#prefix-input'), prefixExample: $('#prefix-example'), resultsPanel: $('#results-panel'),
    summary: $('#summary'), summaryActions: $('#summary-actions'), log: $('#log'), imagesPanel: $('#images-panel'),
    imageGrid: $('#image-grid'), processStatus: $('#process-status'), zipTop: $('#zip-button-top'),
    themeButton: $('#theme-button'), themeIcon: $('#theme-icon'),
    toast: $('#toast'), lightbox: $('#lightbox'), lightboxImage: $('#lightbox-image'), lightboxClose: $('#lightbox-close')
  };

  class RequestGate {
    constructor(limit, minInterval) {
      this.limit = limit;
      this.minInterval = minInterval;
      this.active = 0;
      this.lastStarted = 0;
      this.queue = [];
      this.timer = null;
    }

    schedule(task, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        const job = { task, resolve, reject, signal, onAbort: null };
        job.onAbort = () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', job.onAbort, { once: true });
        this.queue.push(job);
        this.pump();
      });
    }

    pump() {
      if (this.active >= this.limit || !this.queue.length) return;
      const wait = Math.max(0, this.minInterval - (Date.now() - this.lastStarted));
      if (wait > 0) {
        if (!this.timer) {
          this.timer = setTimeout(() => { this.timer = null; this.pump(); }, wait);
        }
        return;
      }
      const job = this.queue.shift();
      job.signal?.removeEventListener('abort', job.onAbort);
      this.active += 1;
      this.lastStarted = Date.now();
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        this.active -= 1;
        this.pump();
      });
      this.pump();
    }
  }

  const requestGate = new RequestGate(CONFIG.lookupConcurrency, CONFIG.minRequestIntervalMs);

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function parseSkus(value = els.skuInput.value) {
    const tokens = value.toUpperCase().split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
    return [...new Set(tokens)];
  }

  function inspectSkuInput(value = els.skuInput.value) {
    const tokens = value.toUpperCase().split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
    const seen = new Set();
    const duplicates = [];
    const overlong = [];
    for (const sku of tokens) {
      if (sku.length > 30 && !overlong.includes(sku)) overlong.push(sku);
      if (seen.has(sku)) {
        if (!duplicates.includes(sku)) duplicates.push(sku);
      } else seen.add(sku);
    }
    return { skus: [...seen], duplicates, overlong };
  }

  function safePrefix() {
    return els.prefix.value.replace(/[<>:"/\\|?*]/g, '').slice(0, 40);
  }

  function extensionForMime(mime) { return mime === 'image/png' ? 'png' : 'jpg'; }

  async function blobDigest(blob) {
    if (!globalThis.crypto?.subtle) return `${blob.type}:${blob.size}`;
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(els.toast._timer);
    els.toast._timer = setTimeout(() => els.toast.classList.remove('show'), 3000);
  }

  function log(message, type = '') {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    line.textContent = message;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
  }

  const versionInfoPromise = fetch('version.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((info) => {
      if (info?.version) document.getElementById('buildVersion').textContent = `v${info.version}`;
      return info;
    })
    .catch(() => {
      try { return JSON.parse(document.getElementById('cid-version-data')?.textContent || 'null'); }
      catch (error) { return null; }
    });

  const versionModal = document.getElementById('versionModal');
  const versionClose = document.getElementById('versionClose');
  const versionBody = document.getElementById('versionBody');

  async function renderVersionModal() {
    const info = await versionInfoPromise;
    if (!info?.version) return false;
    versionBody.replaceChildren();
    for (const entry of info.changelog || []) {
      const head = Object.assign(document.createElement('div'), { className:'version-entry-title', textContent:`เวอร์ชัน ${entry.version} — ${entry.date}` });
      const list = Object.assign(document.createElement('ul'), { className:'version-entry-list' });
      for (const change of entry.changes || []) list.appendChild(Object.assign(document.createElement('li'), { textContent:change }));
      versionBody.append(head, list);
    }
    return true;
  }

  async function openVersionModal() {
    if (!(await renderVersionModal())) return;
    versionModal.classList.remove('closing');
    versionModal.classList.add('open');
    versionModal.setAttribute('aria-hidden', 'false');
  }

  function closeVersionModal() {
    if (!versionModal.classList.contains('open')) return;
    versionModal.classList.remove('open');
    versionModal.classList.add('closing');
    const finish = () => { versionModal.classList.remove('closing'); versionModal.setAttribute('aria-hidden', 'true'); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish(); else setTimeout(finish, 130);
  }

  function setProgress(done, total, label = '') {
    const percent = total ? Math.round((done / total) * 100) : 0;
    els.progressBar.style.width = `${percent}%`;
    els.progressLabel.textContent = label || (total ? `${done} / ${total}` : '');
  }

  function setRunUi(running) {
    state.running = running;
    els.download.disabled = running;
    els.stop.classList.toggle('hidden', !running);
  }

  function makeTimestamp() {
    const date = new Date();
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }

  async function gatedFetch(url, options = {}) {
    const signal = options.signal || state.abortController?.signal;
    return requestGate.schedule(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = await fetch(url, { ...options, signal });
        if (![429, 503].includes(response.status) || attempt === 4) return response;
        try { await response.body?.cancel(); } catch (_) {}
        const backoff = (2 ** attempt) * 1000 + Math.floor(Math.random() * 350);
        await delay(backoff, signal);
      }
      throw new Error('request retry exhausted');
    }, signal);
  }

  function algoliaHeaders(json = false) {
    const headers = {
      'X-Algolia-Application-Id': CONFIG.algoliaAppId,
      'X-Algolia-API-Key': CONFIG.algoliaSearchKey
    };
    if (json) headers['Content-Type'] = 'application/json';
    return headers;
  }

  function validateRecord(record, sku) {
    if (!record) return null;
    const recordSku = String(record.sku || '').trim().toUpperCase();
    const urlKey = String(record.url_key || '').toLowerCase();
    const exactMatch = recordSku === sku;
    const groupMatch = sku.startsWith('GR') && urlKey.includes(sku.toLowerCase());
    if (!exactMatch && !groupMatch) return null;

    const imagePath = String(record.image_url || record.thumbnail_url || '').trim();
    if (!imagePath || imagePath.includes('?$')) return null;
    let imageUrl;
    try { imageUrl = new URL(imagePath, `${CONFIG.assetsOrigin}/`); } catch (_) { return null; }
    if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'assets.central.co.th') return null;
    return {
      record,
      imageUrl: imageUrl.href,
      matchLabel: exactMatch ? `exact ${recordSku}` : `group ${sku} → child ${recordSku}`
    };
  }

  async function lookupAlgolia(sku, signal) {
    const base = `https://${CONFIG.algoliaAppId}-dsn.algolia.net/1/indexes/${encodeURIComponent(CONFIG.algoliaIndex)}`;
    const fields = 'sku,url_key,image_url,thumbnail_url';
    const objectUrl = `${base}/${encodeURIComponent(sku)}?attributesToRetrieve=${encodeURIComponent(fields)}`;
    const objectResponse = await gatedFetch(objectUrl, { headers: algoliaHeaders(), signal });
    if (objectResponse.ok) {
      const match = validateRecord(await objectResponse.json(), sku);
      return match ? { ...match, source: 'getObject' } : null;
    }
    if (objectResponse.status !== 404) throw new Error(`Algolia getObject HTTP ${objectResponse.status}`);

    const body = {
      query: sku,
      hitsPerPage: 20,
      attributesToRetrieve: ['sku', 'url_key', 'image_url', 'thumbnail_url']
    };
    if (!sku.startsWith('GR')) body.restrictSearchableAttributes = ['sku'];
    const queryResponse = await gatedFetch(`${base}/query`, {
      method: 'POST', headers: algoliaHeaders(true), body: JSON.stringify(body), signal
    });
    if (!queryResponse.ok) throw new Error(`Algolia query HTTP ${queryResponse.status}`);
    const hits = (await queryResponse.json()).hits || [];
    const candidate = sku.startsWith('GR')
      ? hits.find((hit) => String(hit.url_key || '').toLowerCase().includes(sku.toLowerCase()))
      : hits.find((hit) => String(hit.sku || '').trim().toUpperCase() === sku);
    const match = validateRecord(candidate, sku);
    return match ? { ...match, source: 'query fallback' } : null;
  }

  async function lookupProduct(sku, signal) {
    try {
      const response = await gatedFetch(`/api/lookup?sku=${encodeURIComponent(sku)}`, {
        headers: { Accept: 'application/json' }, signal, cache: 'no-store'
      });
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (!response.ok || !data.found) return null;
        const match = validateRecord(data.record, sku);
        if (!match || match.imageUrl !== data.imageUrl) return null;
        return {
          ...match,
          source: data.source === 'cache' ? 'D1 cache' : `Algolia ${data.lookupSource || ''}`.trim(),
          sourceType: data.source === 'cache' ? 'cache' : 'algolia',
          cacheReason: data.cacheReason || '',
          cachedAt: data.cachedAt || '',
          verifiedAt: data.verifiedAt || ''
        };
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
    }
    const direct = await lookupAlgolia(sku, signal);
    return direct ? { ...direct, sourceType: 'algolia' } : null;
  }

  function galleryUrl(baseUrl, index) {
    const url = new URL(baseUrl);
    if (!/-(\d+)\.webp$/i.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/-(\d+)\.webp$/i, `-${index}.webp`);
    url.search = '';
    url.hash = '';
    return url.href;
  }

  async function fetchImage(url, signal) {
    const response = await gatedFetch(url, { signal });
    if (!response.ok) return { response, blob: null };
    return { response, blob: await response.blob() };
  }

  async function fetchPreferredImage(baseUrl, index, signal) {
    const preferred = index > 1 ? galleryUrl(baseUrl, index) : baseUrl;
    if (preferred) {
      const result = await fetchImage(preferred, signal);
      if (result.response.ok) return { url: preferred, rawBlob: result.blob, selectedIndex: index };
      if (result.response.status !== 404) throw new Error(`CDN HTTP ${result.response.status}`);
    }
    const fallback = await fetchImage(baseUrl, signal);
    if (!fallback.response.ok) throw new Error(`CDN HTTP ${fallback.response.status}`);
    return { url: baseUrl, rawBlob: fallback.blob, selectedIndex: 1 };
  }

  function makeCanvas(width, height) {
    if ('OffscreenCanvas' in window) return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }

  function canvasToBlob(canvas, type, quality) {
    if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('canvas encode ไม่สำเร็จ')), type, quality));
  }

  async function decodeToCanvas(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const width = bitmap.width, height = bitmap.height;
    bitmap.close();
    return { canvas, context, width, height };
  }

  async function convertImage(blob, format) {
    const decoded = await decodeToCanvas(blob);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const output = await canvasToBlob(decoded.canvas, mime, CONFIG.jpegQuality);
    const pixels = decoded.context.getImageData(0, 0, decoded.width, decoded.height).data;
    let hasTransparency = false;
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] < 255) { hasTransparency = true; break; } }
    return { blob: output, mime, width: decoded.width, height: decoded.height, hasTransparency };
  }

  function findBounds(data, width, height, useAlpha) {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const content = useAlpha
          ? data[offset + 3] > 0
          : !(data[offset] >= 235 && data[offset + 1] >= 235 && data[offset + 2] >= 235);
        if (!content) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return maxX < minX || maxY < minY ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  async function cropCanvas(source, bounds, mime) {
    if (!bounds || (bounds.x === 0 && bounds.y === 0 && bounds.width === source.width && bounds.height === source.height)) {
      return { blob: await canvasToBlob(source.canvas, mime, CONFIG.jpegQuality), width: source.width, height: source.height };
    }
    const cropped = makeCanvas(bounds.width, bounds.height);
    cropped.getContext('2d').drawImage(source.canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    return { blob: await canvasToBlob(cropped, mime, CONFIG.jpegQuality), width: bounds.width, height: bounds.height };
  }

  async function trimBlob(item) {
    const decoded = await decodeToCanvas(item.currentBlob);
    const imageData = decoded.context.getImageData(0, 0, decoded.width, decoded.height);
    let transparent = item.hasTransparency;
    if (!transparent) {
      for (let i = 3; i < imageData.data.length; i += 4) { if (imageData.data[i] < 255) { transparent = true; break; } }
    }
    const bounds = findBounds(imageData.data, decoded.width, decoded.height, transparent);
    const mime = transparent ? 'image/png' : item.mime;
    const output = await cropCanvas(decoded, bounds, mime);
    return { ...output, mime, hasTransparency: transparent };
  }

  async function dicutWhiteBlob(item) {
    const decoded = await decodeToCanvas(item.currentBlob);
    const comparisonCanvas = makeCanvas(decoded.width, decoded.height);
    comparisonCanvas.getContext('2d').drawImage(decoded.canvas, 0, 0);
    const imageData = decoded.context.getImageData(0, 0, decoded.width, decoded.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] >= 235 && data[i + 1] >= 235 && data[i + 2] >= 235) data[i + 3] = 0;
    }
    decoded.context.putImageData(imageData, 0, 0);
    const bounds = findBounds(data, decoded.width, decoded.height, true);
    const output = await cropCanvas(decoded, bounds, 'image/png');
    const comparison = await cropCanvas({ canvas: comparisonCanvas, width: decoded.width, height: decoded.height }, bounds, item.mime);
    return { ...output, mime: 'image/png', hasTransparency: true, comparisonBlob: comparison.blob };
  }

  function revokeItemUrls(item) {
    for (const key of ['originalUrl', 'currentUrl', 'comparisonUrl']) {
      if (item[key]) URL.revokeObjectURL(item[key]);
      item[key] = '';
    }
  }

  function installOriginal(item, converted, selectedUrl, selectedIndex) {
    revokeItemUrls(item);
    item.originalBlob = converted.blob;
    item.currentBlob = converted.blob;
    item.originalMime = converted.mime;
    item.mime = converted.mime;
    item.originalWidth = converted.width;
    item.originalHeight = converted.height;
    item.width = converted.width;
    item.height = converted.height;
    item.originalTransparency = converted.hasTransparency;
    item.hasTransparency = converted.hasTransparency;
    item.originalUrl = URL.createObjectURL(converted.blob);
    item.currentUrl = URL.createObjectURL(converted.blob);
    item.selectedUrl = selectedUrl;
    item.selectedIndex = selectedIndex;
    item.hasComparison = false;
    item.editState = 'original';
  }

  function replaceCurrent(item, result, compare = false, editState = 'original') {
    if (item.currentUrl) URL.revokeObjectURL(item.currentUrl);
    if (item.comparisonUrl) URL.revokeObjectURL(item.comparisonUrl);
    item.currentBlob = result.blob;
    item.mime = result.mime;
    item.width = result.width;
    item.height = result.height;
    item.hasTransparency = result.hasTransparency;
    item.currentUrl = URL.createObjectURL(result.blob);
    item.comparisonUrl = compare && result.comparisonBlob ? URL.createObjectURL(result.comparisonBlob) : '';
    item.hasComparison = compare;
    item.editState = editState;
    refreshCard(item);
  }

  function resetItem(item) {
    replaceCurrent(item, {
      blob: item.originalBlob, mime: item.originalMime, width: item.originalWidth,
      height: item.originalHeight, hasTransparency: item.originalTransparency
    }, false, 'original');
  }

  function cardFor(sku) { return els.imageGrid.querySelector(`[data-card-sku="${CSS.escape(sku)}"]`); }

  function renderCard(item) {
    els.imagesPanel.classList.remove('hidden');
    els.zipTop.classList.remove('hidden');
    const card = document.createElement('article');
    card.className = 'image-card';
    card.dataset.cardSku = item.sku;
    card.innerHTML = `
      <div class="image-stage" data-action="lightbox" data-sku="${escapeHtml(item.sku)}">
        <img class="compare-before" alt="ต้นฉบับ ${escapeHtml(item.sku)}">
        <img class="current-image" alt="${escapeHtml(item.sku)}">
        <div class="compare-line"></div>
      </div>
      <div class="image-meta">
        <div class="sku-row"><div class="sku-code">${escapeHtml(item.sku)}</div>
          <button class="icon-button lock-button" type="button" data-action="lock" data-sku="${escapeHtml(item.sku)}"
            aria-pressed="false" aria-label="ล็อกรูปนี้เพื่อให้การทำงานแบบกลุ่มข้าม" title="ล็อกรูปนี้เพื่อให้ Batch ข้าม">
            <span class="lock-icon" aria-hidden="true">🔓</span>
          </button></div>
        <div class="sku-context hidden"></div>
        <div class="source-note" aria-live="polite"></div>
        <div class="duplicate-note hidden"></div>
        <div class="image-detail-row"><div class="image-info"></div><span class="edit-state"></span></div>
        <div class="card-actions">
          <button class="button trim" type="button" data-action="trim" data-sku="${escapeHtml(item.sku)}" aria-pressed="false">🔲 Trim</button>
          <button class="button dicut" type="button" data-action="dicut" data-sku="${escapeHtml(item.sku)}" aria-pressed="false">✂️ Dicut</button>
          <button class="button secondary" type="button" data-action="reset" data-sku="${escapeHtml(item.sku)}" aria-pressed="true">↺ ต้นฉบับ</button>
        </div>
        <div class="gallery">
          <div class="gallery-head"><span>เลือกลำดับรูป</span>
            <span class="gallery-status" aria-live="polite">กำลังหา…</span></div>
          <div class="gallery-grid"></div>
          <button class="button secondary gallery-download-all" type="button" data-action="download-gallery"
            data-sku="${escapeHtml(item.sku)}" disabled>⬇ ดาวน์โหลดทุกรูป</button>
        </div>
      </div>`;
    els.imageGrid.appendChild(card);
    const stage = $('.image-stage', card);
    stage.addEventListener('mousemove', compareMove);
    stage.addEventListener('mouseleave', compareLeave);
    refreshCard(item);
    renderGallery(item);
  }

  function refreshCard(item) {
    const card = cardFor(item.sku);
    if (!card) return;
    $('.current-image', card).src = item.currentUrl;
    $('.compare-before', card).src = item.comparisonUrl || item.originalUrl;
    $('.image-info', card).textContent = `${item.width}×${item.height} · ${(item.currentBlob.size / 1024).toFixed(1)} KB · ${extensionForMime(item.mime).toUpperCase()}`;
    card.classList.toggle('has-comparison', item.hasComparison);
    card.classList.toggle('locked', item.locked);
    const lockButton = $('[data-action="lock"]', card);
    $('.lock-icon', lockButton).textContent = item.locked ? '🔒' : '🔓';
    lockButton.setAttribute('aria-pressed', String(item.locked));
    lockButton.setAttribute('aria-label', item.locked ? 'ปลดล็อกรูปนี้ให้ทำงานแบบกลุ่มได้' : 'ล็อกรูปนี้เพื่อให้การทำงานแบบกลุ่มข้าม');
    lockButton.title = item.locked ? 'ปลดล็อกเพื่อให้ Batch ทำรูปนี้' : 'ล็อกเพื่อให้ Batch ข้ามรูปนี้';
    const stateLabels = { original: 'ต้นฉบับ', trim: 'Trim แล้ว', dicut: 'Dicut แล้ว' };
    const editState = item.editState || 'original';
    const stateBadge = $('.edit-state', card);
    stateBadge.textContent = stateLabels[editState];
    stateBadge.dataset.state = editState;
    const sourceNote = $('.source-note', card);
    const fromCache = item.lookup?.sourceType === 'cache';
    sourceNote.classList.toggle('is-cache', fromCache);
    sourceNote.textContent = fromCache
      ? `CACHE · ${item.lookup.cacheReason === 'revalidating' ? 'กำลังตรวจสอบข้อมูลล่าสุด' : item.lookup.cacheReason === 'algolia_error' ? 'ระบบค้นหาขัดข้อง' : 'รอบนี้ค้นหาไม่พบ'}`
      : 'ข้อมูลล่าสุด';
    sourceNote.title = fromCache && item.lookup.verifiedAt
      ? `ใช้ URL สำรองที่ระบบยืนยันล่าสุด ${new Date(item.lookup.verifiedAt).toLocaleString('th-TH')}`
      : 'ค้นพบ SKU จากระบบหลักในรอบนี้';
    for (const action of ['trim', 'dicut', 'reset']) {
      const button = $(`[data-action="${action}"]`, card);
      const active = (action === 'reset' && editState === 'original') || action === editState;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active-state', active);
    }
    refreshIdentityBadges();
    renderGallery(item);
  }

  function refreshIdentityBadges() {
    for (const item of state.items.values()) {
      const card = cardFor(item.sku);
      if (!card) continue;
      const childSku = String(item.lookup?.record?.sku || '').trim().toUpperCase();
      const context = $('.sku-context', card);
      const isGroup = item.sku.startsWith('GR') && childSku && childSku !== item.sku;
      context.textContent = isGroup ? `GR → ${childSku}` : '';
      context.classList.toggle('hidden', !isGroup);

      const duplicateSkus = [...state.items.values()]
        .filter((other) => other.sku !== item.sku && item.contentHash && other.contentHash === item.contentHash)
        .map((other) => other.sku);
      const duplicate = $('.duplicate-note', card);
      duplicate.textContent = duplicateSkus.length ? `ภาพต้นทางซ้ำกับ ${duplicateSkus.join(', ')}` : '';
      duplicate.classList.toggle('hidden', !duplicateSkus.length);
    }
  }

  function renderGallery(item) {
    const card = cardFor(item.sku);
    if (!card) return;
    const grid = $('.gallery-grid', card);
    const status = $('.gallery-status', card);
    const urls = item.gallery?.length ? item.gallery : [item.baseUrl];
    const entries = item.galleryLoaded
      ? urls.map((url, index) => ({ url, index: index + 1 }))
      : [{ url: item.selectedUrl, index: item.selectedIndex }];
    grid.innerHTML = entries.map((entry) => `
      <button class="gallery-chip${entry.index === item.selectedIndex ? ' active' : ''}" type="button"
        data-action="select-gallery" data-sku="${escapeHtml(item.sku)}" data-index="${entry.index}">
        <img src="${escapeHtml(entry.url)}" loading="lazy" alt="รูปที่ ${entry.index}"><span>${entry.index}</span>
      </button>`).join('');
    if (item.galleryLoaded) status.textContent = `${urls.length} รูป`;
    else if (item.galleryError) status.textContent = 'หาไม่สำเร็จ';
    else status.textContent = 'กำลังหา…';
    const downloadAll = $('[data-action="download-gallery"]', card);
    if (downloadAll) {
      downloadAll.disabled = !item.galleryLoaded || item.galleryDownloading;
      downloadAll.textContent = item.galleryDownloading
        ? `กำลังสร้าง ZIP 0/${urls.length}…`
        : `⬇ ดาวน์โหลดทุกรูป (${urls.length})`;
    }
  }

  function renderNotFoundSummary() {
    els.summaryActions.innerHTML = '';
    if (!state.notFound.length) return;
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'button secondary';
    copy.textContent = `📋 คัดลอก SKU ที่ต้องลอง localhost (${state.notFound.length})`;
    copy.addEventListener('click', copyNotFound);
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'button secondary'; retry.textContent = '↻ ลองใหม่เฉพาะที่ไม่พบ';
    retry.addEventListener('click', () => { els.skuInput.value = state.notFound.join(' '); updateCount(); startDownload(); });
    els.summaryActions.append(copy, retry);
  }

  function renderSummary(stopped = false) {
    const seconds = Math.max(.1, (Date.now() - state.startedAt) / 1000);
    const success = state.items.size;
    els.summary.innerHTML = `
      <div class="stat ok"><strong>${success}</strong><span>✓ สำเร็จ</span></div>
      <div class="stat miss"><strong>${state.notFound.length}</strong><span>↗ ลอง localhost</span></div>
      <div class="stat warn"><strong>${state.errors.length}</strong><span>⚠ error</span></div>
      <div class="stat"><strong>${seconds.toFixed(1)}s</strong><span>${stopped ? 'หยุดแล้ว' : `${(success / seconds).toFixed(1)}/วิ`}</span></div>`;
    renderNotFoundSummary();
  }

  async function autoSaveItem(item) {
    if (!els.autoSave.checked || !state.directoryHandle) return;
    try {
      const permission = await state.directoryHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        els.folderName.textContent = `⚠ ${state.directoryHandle.name} — กดเพื่ออนุญาตอีกครั้ง`;
        return;
      }
      await writeBlobToDirectory(item.currentBlob, `${safePrefix()}${item.sku}.${extensionForMime(item.mime)}`);
    } catch (error) {
      log(`⚠ ${item.sku} บันทึกไม่สำเร็จ: ${error.message}`, 'warn');
      state.directoryHandle = null;
      await idbDelete('handles', 'directory');
      updateFolderUi();
    }
  }

  async function writeBlobToDirectory(blob, filename) {
    const fileHandle = await state.directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try { await writable.write(blob); } finally { await writable.close(); }
  }

  async function startDownload() {
    if (state.running) return;
    const inspected = inspectSkuInput();
    const skus = inspected.skus;
    if (!skus.length) { toast('กรุณากรอก SKU ก่อน'); return; }
    if (inspected.overlong.length) {
      const message = `SKU ยาวเกิน 30 ตัว: ${inspected.overlong.join(', ')}`;
      toast(message);
      log(`⚠ ${message}`, 'error');
      return;
    }
    clearResults();
    state.runId += 1;
    const runId = state.runId;
    state.abortController = new AbortController();
    state.total = skus.length;
    state.completed = 0;
    state.startedAt = Date.now();
    setRunUi(true);
    els.resultsPanel.classList.remove('hidden');
    pushHistory(skus);
    log(`📦 เริ่ม ${skus.length} SKU — Algolia client-side`, 'head');
    if (inspected.duplicates.length) {
      const message = `พบ SKU ซ้ำ: ${inspected.duplicates.join(', ')} — ระบบจะประมวลผลเพียงครั้งเดียว`;
      toast(message);
      log(`ℹ ${message}`, 'warn');
    }
    if (skus.length > CONFIG.recommendedBatchSize) {
      log(`ℹ ${skus.length} SKU เกินจำนวนแนะนำ ${CONFIG.recommendedBatchSize} — ระบบจะทำต่อ แต่ PNG/Dicut/ZIP อาจใช้ RAM สูง`, 'warn');
    }
    setProgress(0, skus.length, `กำลังค้น Algolia 0/${skus.length}`);

    const signal = state.abortController.signal;
    const lookups = await Promise.all(skus.map(async (sku) => {
      try {
        const lookup = await lookupProduct(sku, signal);
        if (!lookup) return { sku, status: 'not_found' };
        return { sku, status: 'found', lookup };
      } catch (error) {
        if (error.name === 'AbortError') return { sku, status: 'aborted' };
        return { sku, status: 'error', error };
      }
    }));

    if (runId !== state.runId || signal.aborted) return finishRun(true);
    log('── โหลด CDN + แปลงภาพทีละรูป ──', 'info');
    const initialIndex = Number(els.imageIndex.value) || 1;
    const format = els.imageFormat.value;

    for (const result of lookups) {
      if (signal.aborted || runId !== state.runId) return finishRun(true);
      if (result.status === 'not_found') {
        state.notFound.push(result.sku);
        log(`↗ ${result.sku}  ไม่พบทั้ง Algolia และ D1 cache — ลอง localhost`, 'warn');
      } else if (result.status === 'error') {
        state.errors.push({ sku: result.sku, reason: result.error.message });
        log(`⚠ ${result.sku}  ${result.error.message}`, 'error');
      } else if (result.status === 'found') {
        try {
          const picked = await fetchPreferredImage(result.lookup.imageUrl, initialIndex, signal);
          const converted = await convertImage(picked.rawBlob, format);
          const item = {
            sku: result.sku, lookup: result.lookup, baseUrl: result.lookup.imageUrl,
            gallery: [result.lookup.imageUrl], galleryLoaded: false, galleryLoading: false,
            galleryError: false, galleryController: new AbortController(), disposed: false,
            contentHash: await blobDigest(converted.blob),
            locked: false
          };
          installOriginal(item, converted, picked.url, picked.selectedIndex);
          state.items.set(item.sku, item);
          state.order.push(item.sku);
          renderCard(item);
          refreshIdentityBadges();
          void probeGallery(item);
          await autoSaveItem(item);
          log(`✅ ${item.sku}  ${item.width}×${item.height}px  ${(item.currentBlob.size / 1024).toFixed(0)} KB  [${result.lookup.source}]`, 'ok');
        } catch (error) {
          if (error.name === 'AbortError') return finishRun(true);
          state.errors.push({ sku: result.sku, reason: error.message });
          log(`⚠ ${result.sku}  ${error.message}`, 'error');
        }
      }
      state.completed += 1;
      setProgress(state.completed, state.total, `${state.completed}/${state.total}`);
    }
    finishRun(false);
  }

  function finishRun(stopped) {
    if (!state.running) return;
    setRunUi(false);
    if (!stopped) setProgress(state.total, state.total, `${state.total}/${state.total} เสร็จแล้ว`);
    renderSummary(stopped);
    log(stopped ? '⏹ หยุดแล้ว' : `สรุป: สำเร็จ ${state.items.size}/${state.total} · ลอง localhost ${state.notFound.length} · error ${state.errors.length}`, stopped ? 'warn' : 'head');
    toast(stopped ? 'หยุดแล้ว' : `เสร็จแล้ว ${state.items.size}/${state.total}`);
  }

  function stopDownload() {
    if (!state.running) return;
    state.abortController?.abort();
    state.runId += 1;
    finishRun(true);
  }

  function clearResults() {
    for (const item of state.items.values()) {
      item.disposed = true;
      item.galleryController?.abort();
      revokeItemUrls(item);
    }
    state.items.clear(); state.order = []; state.notFound = []; state.errors = [];
    els.imageGrid.innerHTML = ''; els.log.innerHTML = ''; els.summary.innerHTML = ''; els.summaryActions.innerHTML = '';
    els.resultsPanel.classList.add('hidden'); els.imagesPanel.classList.add('hidden');
    els.zipTop.classList.add('hidden');
    setProgress(0, 0, '');
  }

  function clearAll() {
    stopDownload();
    clearResults();
    els.skuInput.value = '';
    updateCount();
  }

  async function processItem(item, action) {
    const card = cardFor(item.sku);
    card?.classList.add('busy');
    try {
      if (action === 'reset') resetItem(item);
      else if (action === 'trim') replaceCurrent(item, await trimBlob(item), false, 'trim');
      else if (action === 'dicut') replaceCurrent(item, await dicutWhiteBlob(item), true, 'dicut');
      await autoSaveItem(item);
    } finally { card?.classList.remove('busy'); }
  }

  async function processBatch(action) {
    if (state.processing) return;
    const targets = state.order.map((sku) => state.items.get(sku)).filter((item) => item && !item.locked);
    if (!targets.length) { toast('ไม่มีรูปที่ปลดล็อกให้ประมวลผล'); return; }
    state.processing = true;
    $$('[data-batch-action]').forEach((button) => { button.disabled = true; });
    let done = 0;
    try {
      for (const item of targets) {
        els.processStatus.textContent = `${action} ${done + 1}/${targets.length}`;
        try { await processItem(item, action); done += 1; }
        catch (error) { log(`⚠ ${item.sku} ${action}: ${error.message}`, 'error'); }
      }
    } finally {
      state.processing = false;
      $$('[data-batch-action]').forEach((button) => { button.disabled = false; });
      els.processStatus.textContent = `เสร็จ ${done}/${targets.length}`;
      toast(`${action} เสร็จ ${done} รูป`);
    }
  }

  async function probeGallery(item) {
    if (item.galleryLoaded || item.galleryLoading) return;
    const signal = item.galleryController?.signal;
    item.galleryLoading = true; renderGallery(item);
    try {
      const cacheKey = `${item.sku}|${item.baseUrl}`;
      const cached = await idbGet('gallery', cacheKey);
      if (item.disposed || signal?.aborted) return;
      if (Array.isArray(cached) && cached.length) {
        item.gallery = cached; item.galleryLoaded = true; return;
      }
      if (!galleryUrl(item.baseUrl, 2)) {
        item.gallery = [item.baseUrl]; item.galleryLoaded = true;
        return;
      }
      const urls = [item.baseUrl];
      for (let index = 2; index <= CONFIG.galleryMax; index += 1) {
        const candidate = galleryUrl(item.baseUrl, index);
        const response = await gatedFetch(candidate, { signal });
        if (response.status === 404) break;
        if (!response.ok) throw new Error(`gallery -${index} HTTP ${response.status}`);
        urls.push(candidate);
        try { await response.body?.cancel(); } catch (_) {}
      }
      item.gallery = urls;
      item.galleryLoaded = true;
      await idbPut('gallery', cacheKey, urls);
    } catch (error) {
      if (error.name === 'AbortError' || item.disposed) return;
      item.galleryError = true;
      log(`⚠ gallery ${item.sku}: ${error.message}`, 'warn');
    } finally {
      item.galleryLoading = false;
      if (!item.disposed) renderGallery(item);
    }
  }

  async function selectGallery(item, index) {
    const url = item.gallery[index - 1];
    if (!url || item.selectedIndex === index) return;
    const card = cardFor(item.sku); card?.classList.add('busy');
    try {
      const fetched = await fetchImage(url);
      if (!fetched.response.ok) throw new Error(`CDN HTTP ${fetched.response.status}`);
      const converted = await convertImage(fetched.blob, els.imageFormat.value);
      item.contentHash = await blobDigest(converted.blob);
      installOriginal(item, converted, url, index);
      refreshCard(item);
      await autoSaveItem(item);
    } catch (error) { toast(`เปลี่ยนรูปไม่ได้: ${error.message}`); }
    finally { card?.classList.remove('busy'); }
  }

  async function downloadGallery(item) {
    if (!item.galleryLoaded || item.galleryDownloading) return;
    const urls = item.gallery?.length ? item.gallery : [item.baseUrl];
    const card = cardFor(item.sku);
    const button = $('[data-action="download-gallery"]', card);
    const format = els.imageFormat.value;
    item.galleryDownloading = true;
    renderGallery(item);
    card?.classList.add('busy');
    try {
      const entries = [];
      for (let offset = 0; offset < urls.length; offset += 1) {
        if (button) button.textContent = `กำลังสร้าง ZIP ${offset + 1}/${urls.length}…`;
        const fetched = await fetchImage(urls[offset]);
        if (!fetched.response.ok) throw new Error(`รูปที่ ${offset + 1} CDN HTTP ${fetched.response.status}`);
        const converted = await convertImage(fetched.blob, format);
        entries.push({
          name: `${safePrefix()}${item.sku}-${offset + 1}.${extensionForMime(converted.mime)}`,
          blob: converted.blob
        });
      }
      const blob = await buildStoreZip(entries);
      const filename = `${safePrefix()}${item.sku}_all_images.zip`;
      if (state.directoryHandle && await ensureDirectoryPermission(true)) {
        await writeBlobToDirectory(blob, filename);
        toast(`บันทึก ${item.sku} ครบ ${entries.length} รูปลง ${state.directoryHandle.name} แล้ว`);
      } else {
        const url = URL.createObjectURL(blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click();
        setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 1500);
        toast(`ดาวน์โหลด ${item.sku} ครบ ${entries.length} รูปแล้ว`);
      }
    } catch (error) {
      toast(`ดาวน์โหลดทุกรูป ${item.sku} ไม่สำเร็จ: ${error.message}`);
      log(`⚠ ${item.sku} ดาวน์โหลดทุกรูป: ${error.message}`, 'error');
    } finally {
      item.galleryDownloading = false;
      card?.classList.remove('busy');
      renderGallery(item);
    }
  }

  function compareMove(event) {
    const stage = event.currentTarget;
    const card = stage.closest('.image-card');
    if (!card?.classList.contains('has-comparison')) return;
    const rect = stage.getBoundingClientRect();
    const percent = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const before = $('.compare-before', stage), line = $('.compare-line', stage);
    before.style.display = 'block';
    before.style.clipPath = `inset(0 0 0 ${percent}%)`;
    line.style.display = 'block'; line.style.left = `${percent}%`;
  }

  function compareLeave(event) {
    const stage = event.currentTarget;
    $('.compare-before', stage).style.display = 'none';
    $('.compare-line', stage).style.display = 'none';
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      table[value] = crc >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function zipHeader(size, writer) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    writer(view);
    return bytes;
  }

  async function buildStoreZip(entries) {
    const encoder = new TextEncoder();
    const stamp = dosDateTime();
    const localParts = [], centralParts = [];
    let localOffset = 0, centralSize = 0;

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const checksum = crc32(data);
      const local = zipHeader(30, (view) => {
        view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
        view.setUint16(6, 0x0800, true); view.setUint16(8, 0, true);
        view.setUint16(10, stamp.time, true); view.setUint16(12, stamp.date, true);
        view.setUint32(14, checksum, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
        view.setUint16(26, name.length, true); view.setUint16(28, 0, true);
      });
      localParts.push(local, name, data);

      const central = zipHeader(46, (view) => {
        view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true);
        view.setUint16(8, 0x0800, true); view.setUint16(10, 0, true);
        view.setUint16(12, stamp.time, true); view.setUint16(14, stamp.date, true);
        view.setUint32(16, checksum, true); view.setUint32(20, data.length, true); view.setUint32(24, data.length, true);
        view.setUint16(28, name.length, true); view.setUint16(30, 0, true); view.setUint16(32, 0, true);
        view.setUint16(34, 0, true); view.setUint16(36, 0, true); view.setUint32(38, 0, true);
        view.setUint32(42, localOffset, true);
      });
      centralParts.push(central, name);
      localOffset += local.length + name.length + data.length;
      centralSize += central.length + name.length;
    }

    const end = zipHeader(22, (view) => {
      view.setUint32(0, 0x06054b50, true); view.setUint16(4, 0, true); view.setUint16(6, 0, true);
      view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true);
      view.setUint32(12, centralSize, true); view.setUint32(16, localOffset, true); view.setUint16(20, 0, true);
    });
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }

  async function downloadZip() {
    if (!state.items.size) return;
    const entries = state.order.map((sku) => state.items.get(sku)).filter(Boolean).map((item) => ({
      name: `${safePrefix()}${item.sku}.${extensionForMime(item.mime)}`,
      blob: item.currentBlob
    }));
    toast('กำลังสร้าง ZIP…');
    try {
      const blob = await buildStoreZip(entries);
      const filename = `central_images_${makeTimestamp()}.zip`;
      if (state.directoryHandle && await ensureDirectoryPermission(true)) {
        await writeBlobToDirectory(blob, filename);
        toast(`บันทึก ZIP ลง ${state.directoryHandle.name} แล้ว`);
      } else {
        const url = URL.createObjectURL(blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click();
        setTimeout(() => { URL.revokeObjectURL(url); anchor.remove(); }, 1500);
        toast('ZIP พร้อมดาวน์โหลดแล้ว');
      }
    } catch (error) { toast(`สร้าง ZIP ไม่สำเร็จ: ${error.message}`); }
  }

  async function ensureDirectoryPermission(interactive) {
    if (!state.directoryHandle) return false;
    const options = { mode: 'readwrite' };
    try {
      if (await state.directoryHandle.queryPermission(options) === 'granted') return true;
      if (interactive) return await state.directoryHandle.requestPermission(options) === 'granted';
    } catch (_) {}
    return false;
  }

  async function chooseFolder() {
    if (!('showDirectoryPicker' in window)) { toast('เบราว์เซอร์นี้ไม่รองรับ Folder — ใช้ ZIP แทน'); return; }
    try {
      if (state.directoryHandle && await ensureDirectoryPermission(true)) { updateFolderUi(); return; }
      state.directoryHandle = await showDirectoryPicker({ mode: 'readwrite' });
      await idbPut('handles', 'directory', state.directoryHandle);
      updateFolderUi();
    } catch (error) { if (error.name !== 'AbortError') toast(`เลือก Folder ไม่สำเร็จ: ${error.message}`); }
  }

  function updateFolderUi() {
    const supported = 'showDirectoryPicker' in window;
    els.folderButton.disabled = !supported;
    if (!supported) {
      els.folderName.textContent = 'เบราว์เซอร์นี้ใช้ ZIP เป็นหลัก';
      els.folderHelp.textContent = 'เปิดด้วย Chrome/Edge บน HTTPS หรือ localhost เพื่อบันทึกตรงเข้า Folder';
      els.autoSaveLabel.textContent = '💾 เตรียมภาพสำหรับบันทึก ZIP';
    } else if (state.directoryHandle) {
      els.folderName.textContent = `📁 ${state.directoryHandle.name}`;
      els.folderHelp.textContent = 'ถ้าสิทธิ์หมด ให้กดปุ่ม Folder เพื่ออนุญาตอีกครั้ง';
    } else {
      els.folderName.textContent = 'ยังไม่ได้เลือก Folder';
      els.folderHelp.textContent = 'เลือกโฟลเดอร์ย่อย เช่น Documents\\central — ห้ามเลือก root Documents/Downloads';
    }
  }

  function copyNotFound() {
    const text = state.notFound.join(' ');
    navigator.clipboard?.writeText(text).then(() => toast('คัดลอกแล้ว')).catch(() => {
      const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select();
      document.execCommand('copy'); area.remove(); toast('คัดลอกแล้ว');
    });
  }

  function updateCount() {
    const inspected = inspectSkuInput();
    const count = inspected.skus.length;
    els.skuCount.textContent = count;
    if (inspected.overlong.length) {
      els.batchAdvisory.textContent = `⚠ SKU ยาวเกิน 30 ตัว: ${inspected.overlong.join(', ')}`;
      els.batchAdvisory.classList.remove('hidden');
      return;
    }
    const overRecommended = count > CONFIG.recommendedBatchSize;
    els.batchAdvisory.textContent = overRecommended
      ? `⚠ ${count} SKU — ระบบยังทำต่อได้ แต่แนะนำแบ่งรอบไม่เกิน ${CONFIG.recommendedBatchSize} SKU; PNG, Dicut และ ZIP ใช้ RAM มากกว่า JPEG`
      : '';
    els.batchAdvisory.classList.toggle('hidden', !overRecommended);
  }

  function saveSettings() {
    localStorage.setItem('cid_client_settings', JSON.stringify({
      prefix: els.prefix.value, imageIndex: els.imageIndex.value,
      imageFormat: els.imageFormat.value, autoSave: els.autoSave.checked
    }));
    els.prefixExample.textContent = `${safePrefix()}CDS123.${els.imageFormat.value}`;
  }

  function loadSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem('cid_client_settings') || '{}');
      if (settings.prefix) els.prefix.value = settings.prefix;
      if (settings.imageIndex) els.imageIndex.value = settings.imageIndex;
      if (settings.imageFormat) els.imageFormat.value = settings.imageFormat;
      if (settings.autoSave) els.autoSave.checked = true;
    } catch (_) {}
    els.folderSettings.classList.toggle('hidden', !els.autoSave.checked);
    saveSettings();
  }

  function pushHistory(skus) {
    let history = [];
    try { history = JSON.parse(localStorage.getItem('cid_client_history') || '[]'); } catch (_) {}
    history.unshift({ time: Date.now(), skus, count: skus.length });
    localStorage.setItem('cid_client_history', JSON.stringify(history.slice(0, 8)));
    renderHistory();
  }

  function timeAgo(timestamp) {
    const seconds = (Date.now() - timestamp) / 1000;
    if (seconds < 60) return 'เมื่อกี้';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} นาที`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} ชม.`;
    return `${Math.floor(seconds / 86400)} วัน`;
  }

  function renderHistory() {
    let history = [];
    try { history = JSON.parse(localStorage.getItem('cid_client_history') || '[]'); } catch (_) {}
    els.history.innerHTML = history.length ? `<span class="history-label">🕘 ประวัติล่าสุด:</span> ${history.map((entry, index) =>
      `<button class="history-chip" type="button" data-history-index="${index}">${entry.count} SKU · ${timeAgo(entry.time)}</button>`).join('')}
      <button class="history-chip" type="button" data-history-clear>✕ ล้าง</button>` : '';
    $$('[data-history-index]', els.history).forEach((button) => button.addEventListener('click', () => {
      const entry = history[Number(button.dataset.historyIndex)];
      if (entry) { els.skuInput.value = entry.skus.join(' '); updateCount(); }
    }));
    $('[data-history-clear]', els.history)?.addEventListener('click', () => { localStorage.removeItem('cid_client_history'); renderHistory(); });
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    updateThemeControls(next);
  }

  function updateThemeControls(theme) {
    const nextLabel = theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด';
    els.themeButton.setAttribute('aria-label', nextLabel);
    els.themeButton.title = nextLabel;
    $$('[data-tool-link]').forEach((link) => {
      const url = new URL(link.href);
      url.searchParams.set('theme', theme);
      link.href = url.toString();
    });
  }

  function initializeThemeIcon() {
    updateThemeControls(document.documentElement.dataset.theme || 'dark');
  }

  function openLightbox(item) { els.lightboxImage.src = item.currentUrl; els.lightbox.classList.remove('hidden'); }
  function closeLightbox() { els.lightbox.classList.add('hidden'); els.lightboxImage.src = ''; }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('cid_client', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
        if (!db.objectStoreNames.contains('gallery')) db.createObjectStore('gallery');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbGet(store, key) {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const request = db.transaction(store, 'readonly').objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      });
    } catch (_) { return null; }
  }

  async function idbPut(store, key, value) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        transaction.objectStore(store).put(value, key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (_) {}
  }

  async function idbDelete(store, key) {
    try {
      const db = await openDb();
      await new Promise((resolve) => {
        const transaction = db.transaction(store, 'readwrite');
        transaction.objectStore(store).delete(key);
        transaction.oncomplete = resolve; transaction.onerror = resolve;
      });
    } catch (_) {}
  }

  function bindEvents() {
    els.download.addEventListener('click', startDownload);
    els.stop.addEventListener('click', stopDownload);
    els.clear.addEventListener('click', clearAll);
    els.skuInput.addEventListener('input', updateCount);
    els.themeButton.addEventListener('click', toggleTheme);
    document.getElementById('buildVersion').addEventListener('click', openVersionModal);
    versionClose.addEventListener('click', closeVersionModal);
    versionModal.addEventListener('click', (event) => { if (event.target === versionModal) closeVersionModal(); });
    els.autoSave.addEventListener('change', () => { els.folderSettings.classList.toggle('hidden', !els.autoSave.checked); saveSettings(); });
    els.folderButton.addEventListener('click', chooseFolder);
    [els.prefix, els.imageIndex, els.imageFormat].forEach((element) => element.addEventListener('change', saveSettings));
    els.prefix.addEventListener('input', saveSettings);
    els.zipTop.addEventListener('click', downloadZip);
    els.lightboxClose.addEventListener('click', closeLightbox);
    els.lightbox.addEventListener('click', (event) => { if (event.target === els.lightbox) closeLightbox(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLightbox(); });
    // Shared shortcut contract: Ctrl/Cmd+Shift+S = primary export (start download).
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 's' || event.key === 'S')) {
        event.preventDefault();
        if (!els.download.disabled) els.download.click();
      }
    });

    $$('[data-batch-action]').forEach((button) => button.addEventListener('click', () => processBatch(button.dataset.batchAction)));

    els.imageGrid.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const item = state.items.get(button.dataset.sku);
      if (!item) return;
      const action = button.dataset.action;
      if (action === 'lock') { item.locked = !item.locked; refreshCard(item); }
      else if (action === 'select-gallery') await selectGallery(item, Number(button.dataset.index));
      else if (action === 'download-gallery') await downloadGallery(item);
      else if (action === 'lightbox') openLightbox(item);
      else if (['trim', 'dicut', 'reset'].includes(action)) {
        try { await processItem(item, action); } catch (error) { toast(`${action} ไม่สำเร็จ: ${error.message}`); }
      }
    });
    els.skuInput.addEventListener('dragover', (event) => { event.preventDefault(); els.skuInput.classList.add('dragging'); });
    els.skuInput.addEventListener('dragleave', () => els.skuInput.classList.remove('dragging'));
    els.skuInput.addEventListener('drop', (event) => {
      event.preventDefault(); els.skuInput.classList.remove('dragging');
      const file = event.dataTransfer.files[0];
      if (!file || !/\.(txt|csv)$/i.test(file.name)) { toast('รองรับเฉพาะ .txt / .csv'); return; }
      const reader = new FileReader();
      reader.onload = () => { els.skuInput.value = `${els.skuInput.value} ${String(reader.result).replace(/[,;\t\r\n]+/g, ' ')}`.trim(); updateCount(); };
      reader.readAsText(file);
    });
  }

  async function init() {
    for (let index = 1; index <= 20; index += 1) {
      const option = document.createElement('option'); option.value = index; option.textContent = index === 1 ? '1 (รูปแรก)' : String(index);
      els.imageIndex.appendChild(option);
    }
    bindEvents(); initializeThemeIcon(); loadSettings(); renderHistory(); updateCount();
    state.directoryHandle = await idbGet('handles', 'directory');
    updateFolderUi();
  }

  init();
})();
