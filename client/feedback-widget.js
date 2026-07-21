(() => {
  const API = window.CENTRAL_FEEDBACK_API || 'https://central-creative-feedback.pages.dev';
  const tool = document.documentElement.dataset.feedbackTool || document.title;
  const root = document.createElement('div');
  root.innerHTML = `<button class="feedback-launch" type="button">ข้อเสนอแนะ</button>
  <div class="feedback-backdrop" role="presentation"><section class="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
    <div class="feedback-head"><div><h2 id="feedback-title">ส่งข้อเสนอแนะ</h2><p>${tool}</p></div><button class="feedback-close" type="button" aria-label="ปิด">×</button></div>
    <form><label class="feedback-field">ประเภท<select name="category"><option value="bug">พบปัญหา</option><option value="usability">ใช้งานยาก</option><option value="feature">อยากเพิ่มฟีเจอร์</option><option value="other">อื่น ๆ</option></select></label>
    <label class="feedback-field">รายละเอียด<textarea name="message" required maxlength="5000" placeholder="บอกสิ่งที่พบหรือสิ่งที่อยากให้ปรับ..."></textarea></label>
    <label class="feedback-field">ชื่อผู้ส่ง (ไม่บังคับ)<input name="sender" maxlength="120" placeholder="ชื่อหรือทีม"></label>
    <div class="feedback-drop" tabindex="0"><strong>ลากรูปหรือ Screenshot มาวาง</strong><span>หรือคลิกเพื่อเลือกรูป หรือกด Ctrl+V วางรูปจากคลิปบอร์ด สูงสุด 3 รูป</span><input type="file" accept="image/*" multiple hidden></div>
    <div class="feedback-files"></div><div class="feedback-files-status"></div>
    <div class="feedback-actions"><span class="feedback-result"></span><button class="feedback-submit" type="submit">ส่งข้อเสนอแนะ</button></div></form>
  </section></div>`;
  document.body.append(root);
  const launch = root.querySelector('.feedback-launch');
  const backdrop = root.querySelector('.feedback-backdrop');
  const close = root.querySelector('.feedback-close');
  const form = root.querySelector('form');
  const drop = root.querySelector('.feedback-drop');
  const input = drop.querySelector('input');
  const filesLabel = root.querySelector('.feedback-files');
  const filesStatus = root.querySelector('.feedback-files-status');
  const result = root.querySelector('.feedback-result');
  const submit = root.querySelector('.feedback-submit');
  let files = [];
  let returnFocus = null;
  let closeTimer = null;

  const openDialog = () => {
    clearTimeout(closeTimer);
    returnFocus = document.activeElement;
    backdrop.classList.remove('closing');
    backdrop.classList.add('open');
    close.focus();
  };
  const closeDialog = () => {
    if (!backdrop.classList.contains('open')) return;
    backdrop.classList.remove('open');
    backdrop.classList.add('closing');
    const finish = () => {
      backdrop.classList.remove('closing');
      const target = returnFocus && document.contains(returnFocus) ? returnFocus : launch;
      returnFocus = null;
      target.focus();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else closeTimer = setTimeout(finish, 130);
  };

  const syncLauncherOffset = () => {
    let obstruction = 0;
    document.querySelectorAll('[data-feedback-obstruction]').forEach(element => {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height && rect.bottom >= innerHeight - 1) obstruction = Math.max(obstruction, innerHeight - rect.top);
    });
    launch.style.setProperty('--feedback-obstruction', Math.ceil(obstruction) + 'px');
  };
  addEventListener('resize', syncLauncherOffset);
  addEventListener('scroll', syncLauncherOffset, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(syncLauncherOffset).observe(document.body);
  requestAnimationFrame(syncLauncherOffset);

  async function compressImage(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    let quality = .82, blob;
    do { blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality)); quality -= .12; } while (blob.size > 400 * 1024 && quality >= .34);
    if (blob.size > 450 * 1024) throw new Error(`${file.name} มีรายละเอียดมากเกินไป กรุณาครอปรูปให้เล็กลง`);
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  }

  const MAX_FILES = 3;
  const previewUrls = new Map();
  const releasePreviews = keep => {
    previewUrls.forEach((url, file) => { if (!keep.includes(file)) { URL.revokeObjectURL(url); previewUrls.delete(file); } });
  };
  const renderFiles = () => {
    releasePreviews(files);
    filesLabel.textContent = '';
    files.forEach((file, index) => {
      if (!previewUrls.has(file)) previewUrls.set(file, URL.createObjectURL(file));
      const item = document.createElement('div');
      item.className = 'feedback-thumb';
      item.innerHTML = `<img alt="" src="${previewUrls.get(file)}"><button type="button" class="feedback-thumb-remove" aria-label="ลบรูปที่ ${index + 1}">×</button><span class="feedback-thumb-size">${Math.round(file.size / 1024)} KB</span>`;
      item.querySelector('.feedback-thumb-remove').addEventListener('click', () => {
        files = files.filter(entry => entry !== file);
        renderFiles();
        filesStatus.textContent = files.length ? `แนบแล้ว ${files.length} รูป` : '';
        drop.focus();
      });
      filesLabel.append(item);
    });
  };
  const addFiles = list => {
    const incoming = Array.from(list).filter(file => file.type.startsWith('image/'));
    if (!incoming.length) return;
    const room = MAX_FILES - files.length;
    if (room <= 0) { filesStatus.textContent = `แนบได้สูงสุด ${MAX_FILES} รูป ลบรูปเดิมก่อน`; return; }
    const accepted = incoming.slice(0, room);
    filesStatus.textContent = 'กำลังย่อรูป...';
    Promise.all(accepted.map(compressImage))
      .then(output => {
        files = files.concat(output).slice(0, MAX_FILES);
        renderFiles();
        filesStatus.textContent = incoming.length > room
          ? `แนบแล้ว ${files.length} รูป (เกิน ${MAX_FILES} รูป ส่วนที่เหลือถูกข้าม)`
          : `แนบแล้ว ${files.length} รูป`;
      })
      .catch(error => { renderFiles(); filesStatus.textContent = error.message; });
  };
  launch.addEventListener('click', openDialog);
  close.addEventListener('click', closeDialog);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeDialog(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && backdrop.classList.contains('open')) closeDialog(); });
  backdrop.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...backdrop.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(element => !element.disabled && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') input.click(); });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  document.addEventListener('paste', event => {
    if (!backdrop.classList.contains('open')) return;
    const items = event.clipboardData && event.clipboardData.files;
    if (!items || !items.length) return;
    const images = Array.from(items).filter(file => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    addFiles(images);
  });
  ['dragenter', 'dragover'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(name => drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', event => addFiles(event.dataTransfer.files));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true; submit.classList.add('is-loading'); result.className = 'feedback-result'; result.textContent = 'กำลังส่ง...';
    const data = new FormData(form);
    data.set('tool', tool); data.set('page_url', location.href); data.set('viewport', `${innerWidth}x${innerHeight}`);
    files.forEach(file => data.append('images', file));
    try {
      const response = await fetch(`${API}/api/feedback`, { method: 'POST', body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'ส่งไม่สำเร็จ');
      result.className = 'feedback-result ok'; result.textContent = `ส่งแล้ว #${body.id.slice(0, 8)}`;
      form.reset(); files = []; renderFiles(); filesStatus.textContent = '';
    } catch (error) {
      result.className = 'feedback-result error'; result.textContent = error.message;
    } finally { submit.disabled = false; submit.classList.remove('is-loading'); }
  });
})();
