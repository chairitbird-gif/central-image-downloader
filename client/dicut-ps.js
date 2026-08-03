/*!
 * Dicut PS client — shared across Central Creative Tools.
 * Canonical source: dicut-bridge/client/dicut-ps.js
 * Contract: docs/contracts/DICUT_PS.md — copies in the tool repositories must
 * stay byte-identical to this file.
 *
 * Talks to the local Dicut PS Bridge (dicut_bridge.py) which drives the
 * Photoshop "Remove Background" command on Windows and macOS alike.
 * No dependencies, no build step: load it with a plain <script> tag.
 */
(function () {
  'use strict';
  if (window.DicutPS) return;

  var VERSION = '1.0.0';
  var ENDPOINT = 'http://127.0.0.1:8799';
  var PROBE_TIMEOUT_MS = 2500;
  var CUT_TIMEOUT_MS = 240000;   // Photoshop's first launch can take minutes
  var PROBE_TTL_OK_MS = 15000;
  var PROBE_TTL_FAIL_MS = 3000;

  var probeCache = null;
  var probeInFlight = null;

  // ---------------------------------------------------------------- helpers
  function isMac() {
    return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    var settings = Object.assign({}, options, { signal: controller.signal });
    if (options && options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
    }
    return fetch(url, settings).finally(function () { clearTimeout(timer); });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('อ่านไฟล์รูปไม่สำเร็จ')); };
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(',');
    var head = dataUrl.slice(0, comma);
    var mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    var binary = atob(dataUrl.slice(comma + 1));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function canvasToDataUrl(canvas) {
    return canvas.toDataURL('image/png');
  }

  // Images that came from another origin have to go through a canvas anyway,
  // so a single normaliser covers every caller in the four tools.
  function toDataUrl(source) {
    if (!source) return Promise.reject(new Error('ไม่มีรูปให้ไดคัท'));
    if (typeof source === 'string') {
      if (source.indexOf('data:') === 0) return Promise.resolve(source);
      return fetch(source).then(function (response) {
        if (!response.ok) throw new Error('โหลดรูปไม่สำเร็จ (' + response.status + ')');
        return response.blob();
      }).then(blobToDataUrl);
    }
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      return Promise.resolve(canvasToDataUrl(source));
    }
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
      var canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
      return Promise.resolve(canvasToDataUrl(canvas));
    }
    if (typeof Blob !== 'undefined' && source instanceof Blob) return blobToDataUrl(source);
    return Promise.reject(new Error('รูปแบบรูปไม่รองรับ'));
  }

  // ----------------------------------------------------------------- probe
  function probe(options) {
    var force = options && options.force;
    var now = Date.now();
    if (!force && probeCache && now < probeCache.expires) return Promise.resolve(probeCache.value);
    if (!force && probeInFlight) return probeInFlight;

    probeInFlight = fetchWithTimeout(ENDPOINT + '/health', { cache: 'no-store' }, PROBE_TIMEOUT_MS)
      .then(function (response) {
        if (!response.ok) throw new Error('bridge ตอบ ' + response.status);
        return response.json();
      })
      .then(function (data) {
        return {
          available: true,
          photoshopFound: !!data.photoshopFound,
          photoshop: data.photoshop || '',
          version: data.version || '',
          platform: data.platform || '',
          busy: !!data.busy,
          error: data.photoshopFound ? '' : 'ไม่พบ Adobe Photoshop บนเครื่องนี้ (ต้องเป็น 2022 ขึ้นไป)'
        };
      })
      .catch(function (error) {
        return {
          available: false,
          photoshopFound: false,
          photoshop: '',
          version: '',
          platform: '',
          busy: false,
          error: error && error.name === 'AbortError'
            ? 'ต่อ Dicut PS Bridge ไม่ทัน (timeout)'
            : 'ยังไม่ได้เปิด Dicut PS Bridge บนเครื่องนี้'
        };
      })
      .then(function (value) {
        probeCache = { value: value, expires: Date.now() + (value.available ? PROBE_TTL_OK_MS : PROBE_TTL_FAIL_MS) };
        probeInFlight = null;
        return value;
      });
    return probeInFlight;
  }

  // ------------------------------------------------------------------- cut
  function cut(source, name, options) {
    var settings = options || {};
    return toDataUrl(source).then(function (dataUrl) {
      return fetchWithTimeout(ENDPOINT + '/dicut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'image', dataUrl: dataUrl }),
        signal: settings.signal
      }, settings.timeoutMs || CUT_TIMEOUT_MS);
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.ok) {
          throw new Error(data.error || ('Dicut PS ไม่สำเร็จ (' + response.status + ')'));
        }
        return {
          dataUrl: data.dataUrl,
          blob: dataUrlToBlob(data.dataUrl),
          bytes: data.bytes || 0,
          ms: data.ms || 0,
          method: data.method || '',
          photoshop: data.photoshop || ''
        };
      });
    }).catch(function (error) {
      probeCache = null;  // a failure may mean the bridge died: re-probe next time
      if (error && error.name === 'AbortError') throw new Error('ยกเลิกหรือรอ Photoshop นานเกินกำหนด');
      if (error instanceof TypeError) throw new Error('ติดต่อ Dicut PS Bridge ไม่ได้ — ตรวจว่าเปิดอยู่หรือยัง');
      throw error;
    });
  }

  // Photoshop is single-instance, so the queue is deliberately sequential.
  function cutMany(items, options) {
    var settings = options || {};
    var list = Array.prototype.slice.call(items || []);
    var results = [];
    var index = 0;

    function step() {
      if (index >= list.length) return Promise.resolve(results);
      if (settings.signal && settings.signal.aborted) return Promise.resolve(results);
      var item = list[index];
      if (settings.onProgress) settings.onProgress({ index: index, total: list.length, item: item, phase: 'start' });
      return cut(item.source, item.name, { signal: settings.signal, timeoutMs: settings.timeoutMs })
        .then(function (result) {
          results.push({ item: item, ok: true, result: result });
          if (settings.onProgress) settings.onProgress({ index: index, total: list.length, item: item, phase: 'done', result: result });
        })
        .catch(function (error) {
          results.push({ item: item, ok: false, error: error });
          if (settings.onProgress) settings.onProgress({ index: index, total: list.length, item: item, phase: 'error', error: error });
        })
        .then(function () { index += 1; return step(); });
    }
    return step();
  }

  // ------------------------------------------------------------ help modal
  var helpNodes = null;
  var helpReturnFocus = null;

  function injectHelpStyles() {
    if (document.getElementById('dicut-ps-style')) return;
    var style = document.createElement('style');
    style.id = 'dicut-ps-style';
    style.textContent = [
      '.dicut-ps-backdrop{position:fixed;inset:0;background:rgba(8,10,14,.62);display:flex;align-items:center;',
      'justify-content:center;padding:16px;z-index:1000;overflow:auto}',
      '.dicut-ps-backdrop[hidden]{display:none}',
      '.dicut-ps-dialog{background:#fff;color:#1b1f27;border-radius:12px;max-width:560px;width:100%;',
      'max-height:calc(100vh - 32px);overflow:auto;padding:20px;box-shadow:0 18px 48px rgba(0,0,0,.35);',
      'font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;',
      'animation:dicutPsIn 200ms cubic-bezier(.2,.7,.3,1) both}',
      '@keyframes dicutPsIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '.dicut-ps-dialog h2{margin:0 0 4px;font-size:16px}',
      '.dicut-ps-dialog p{margin:0 0 10px}',
      '.dicut-ps-dialog ol{margin:0 0 12px;padding-left:18px}',
      '.dicut-ps-dialog li{margin-bottom:6px}',
      '.dicut-ps-dialog code{display:block;background:#f1f3f7;border:1px solid #dfe3ea;border-radius:6px;',
      'padding:8px 10px;margin:6px 0;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;word-break:break-all}',
      '.dicut-ps-status{background:#fdf0f0;border:1px solid #f2c9c9;border-radius:8px;padding:8px 10px;margin:0 0 12px}',
      '.dicut-ps-tabs{display:flex;gap:8px;margin:0 0 12px}',
      '.dicut-ps-tab{min-height:44px;padding:0 14px;border-radius:8px;border:1px solid #d7dbe3;background:#f7f8fa;',
      'color:inherit;cursor:pointer;font:inherit}',
      '.dicut-ps-tab[aria-selected="true"]{background:#1b1f27;border-color:#1b1f27;color:#fff}',
      '.dicut-ps-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
      '.dicut-ps-actions button{min-height:44px;padding:0 16px;border-radius:8px;border:1px solid #d7dbe3;',
      'background:#f7f8fa;color:inherit;cursor:pointer;font:inherit}',
      '.dicut-ps-actions .dicut-ps-primary{background:#1b1f27;border-color:#1b1f27;color:#fff}',
      '@media (prefers-color-scheme:dark){',
      '.dicut-ps-dialog{background:#191c22;color:#e8ebf0}',
      '.dicut-ps-dialog code{background:#22262e;border-color:#333944}',
      '.dicut-ps-status{background:#2a1d1f;border-color:#5a3134}',
      '.dicut-ps-tab,.dicut-ps-actions button{background:#22262e;border-color:#333944}',
      '.dicut-ps-tab[aria-selected="true"],.dicut-ps-actions .dicut-ps-primary{background:#e8ebf0;border-color:#e8ebf0;color:#191c22}}',
      '@media (prefers-reduced-motion:reduce){.dicut-ps-dialog{animation:none}}'
    ].join('');
    document.head.appendChild(style);
  }

  function platformInstructions(target) {
    if (target === 'mac') {
      return [
        '<li>คัดลอกโฟลเดอร์ <b>dicut-bridge</b> ไปไว้บนเครื่อง Mac</li>',
        '<li>เปิด Terminal แล้วรัน<code>bash ~/dicut-bridge/install_mac.command</code></li>',
        '<li>ครั้งแรก macOS จะถามสิทธิ์ควบคุม Photoshop — กด OK ถ้าพลาดให้เปิด System Settings &gt; Privacy &amp; Security &gt; Automation</li>',
        '<li>กลับมาที่หน้านี้แล้วกด “ตรวจอีกครั้ง”</li>'
      ].join('');
    }
    return [
      '<li>เปิดโฟลเดอร์ <b>dicut-bridge</b> บนเครื่อง</li>',
      '<li>คลิกขวาที่ว่าง &gt; Open in Terminal แล้วรัน<code>powershell -ExecutionPolicy Bypass -File install_windows.ps1</code></li>',
      '<li>Bridge จะเริ่มทำงานเองทุกครั้งที่เปิดเครื่อง</li>',
      '<li>กลับมาที่หน้านี้แล้วกด “ตรวจอีกครั้ง”</li>'
    ].join('');
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || !helpNodes) return;
    var focusable = helpNodes.dialog.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
    var items = Array.prototype.filter.call(focusable, function (node) { return node.offsetParent !== null; });
    if (!items.length) { event.preventDefault(); return; }
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function buildHelp() {
    if (helpNodes) return helpNodes;
    injectHelpStyles();
    var backdrop = document.createElement('div');
    backdrop.className = 'dicut-ps-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="dicut-ps-dialog" role="dialog" aria-modal="true" aria-labelledby="dicut-ps-title" tabindex="-1">' +
        '<h2 id="dicut-ps-title">Dicut PS ยังใช้ไม่ได้</h2>' +
        '<p class="dicut-ps-status" role="status"></p>' +
        '<p>ปุ่มนี้เรียก Photoshop บนเครื่องของคุณผ่านตัวช่วยเล็ก ๆ ชื่อ <b>Dicut PS Bridge</b> ' +
        'ต้องติดตั้งครั้งเดียวต่อเครื่อง (ใช้ได้ทั้ง Windows และ Mac) และต้องมี Photoshop 2022 ขึ้นไป</p>' +
        '<div class="dicut-ps-tabs" role="tablist">' +
          '<button class="dicut-ps-tab" type="button" role="tab" data-target="windows">Windows</button>' +
          '<button class="dicut-ps-tab" type="button" role="tab" data-target="mac">Mac</button>' +
        '</div>' +
        '<ol class="dicut-ps-steps"></ol>' +
        '<div class="dicut-ps-actions">' +
          '<button type="button" class="dicut-ps-recheck">ตรวจอีกครั้ง</button>' +
          '<button type="button" class="dicut-ps-primary dicut-ps-close">ปิด</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    helpNodes = {
      backdrop: backdrop,
      dialog: backdrop.querySelector('.dicut-ps-dialog'),
      status: backdrop.querySelector('.dicut-ps-status'),
      steps: backdrop.querySelector('.dicut-ps-steps'),
      tabs: Array.prototype.slice.call(backdrop.querySelectorAll('.dicut-ps-tab')),
      recheck: backdrop.querySelector('.dicut-ps-recheck'),
      close: backdrop.querySelector('.dicut-ps-close')
    };

    helpNodes.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectPlatform(tab.dataset.target); });
    });
    helpNodes.close.addEventListener('click', closeHelp);
    helpNodes.recheck.addEventListener('click', function () {
      helpNodes.recheck.disabled = true;
      helpNodes.status.textContent = 'กำลังตรวจ…';
      probe({ force: true }).then(function (state) {
        helpNodes.recheck.disabled = false;
        if (state.available && state.photoshopFound) {
          helpNodes.status.textContent = 'เชื่อมต่อได้แล้ว (' + (state.photoshop || 'Photoshop') + ') — ปิดหน้าต่างนี้แล้วกด Dicut PS ได้เลย';
        } else {
          helpNodes.status.textContent = state.error || 'ยังเชื่อมต่อไม่ได้';
        }
      });
    });
    backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeHelp(); });
    backdrop.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); closeHelp(); }
      else trapFocus(event);
    });
    return helpNodes;
  }

  function selectPlatform(target) {
    helpNodes.tabs.forEach(function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.target === target));
    });
    helpNodes.steps.innerHTML = platformInstructions(target);
  }

  function showHelp(message, trigger) {
    buildHelp();
    helpReturnFocus = trigger || document.activeElement;
    helpNodes.status.textContent = message || 'ยังไม่ได้เปิด Dicut PS Bridge บนเครื่องนี้';
    selectPlatform(isMac() ? 'mac' : 'windows');
    helpNodes.backdrop.hidden = false;
    helpNodes.dialog.focus();
  }

  function closeHelp() {
    if (!helpNodes || helpNodes.backdrop.hidden) return;
    helpNodes.backdrop.hidden = true;
    if (helpReturnFocus && document.contains(helpReturnFocus)) helpReturnFocus.focus();
    helpReturnFocus = null;
  }

  // Probe first; on failure open the install dialog and report "not ready" so
  // callers never have to duplicate the error path.
  function ensureReady(trigger, options) {
    return probe(options).then(function (state) {
      if (state.available && state.photoshopFound) return true;
      showHelp(state.error, trigger);
      return false;
    });
  }

  window.DicutPS = {
    VERSION: VERSION,
    ENDPOINT: ENDPOINT,
    probe: probe,
    cut: cut,
    cutMany: cutMany,
    ensureReady: ensureReady,
    showHelp: showHelp,
    closeHelp: closeHelp,
    toDataUrl: toDataUrl,
    dataUrlToBlob: dataUrlToBlob
  };
})();
