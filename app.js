(function () {
  'use strict';

  const FONT_BASE = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/';
  const FONTS = {
    poppins: { regular: 'poppins/Poppins-Regular.ttf', bold: 'poppins/Poppins-SemiBold.ttf' },
    lato: { regular: 'lato/Lato-Regular.ttf', bold: 'lato/Lato-Bold.ttf' },
    crimson: { regular: 'crimsontext/CrimsonText-Regular.ttf', bold: 'crimsontext/CrimsonText-SemiBold.ttf' },
    dmserif: { regular: 'dmserifdisplay/DMSerifDisplay-Regular.ttf', bold: 'dmserifdisplay/DMSerifDisplay-Regular.ttf' },
  };

  const DEFAULTS = {
    paper: 'letter',
    font: 'poppins',
    nameSize: 18,
    companySize: 16,
    nameBold: false,
    companyBold: false,
    nameColor: '#262637',
    companyColor: '#4a4a5c',
    logoSize: 24,
    gap: 18,
    logoPos: 'above',
    foldStyle: 'ticks',
    fillBlanks: true,
  };

  const SAMPLE = [
    ['Abhi Dharshan', 'Zerion'],
    ['Reena Verma', 'The Clearing House'],
    ['Brittany Henry', 'Blackrock'],
    ['Suzy Singh', 'Securitize'],
    ['James Durand', 'Bitstamp by Robinhood'],
    ['Erica Lacerenza', 'Mirae Asset Securities'],
    ['Stéphanie Joseph', 'Citi'],
  ];

  const STORE_KEY = 'placecard-maker-v1';
  const $ = (id) => document.getElementById(id);

  // ---------- persistence (best effort) ----------
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState() {
    const data = { settings, rows: rows.filter((r) => r[0] || r[1]), logo: logoState && logoState.dataUrl };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
    catch (e) {
      // Large logos can exceed the quota; keep everything else.
      try { delete data.logo; localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e2) { /* ignore */ }
    }
  }

  const saved = loadState();
  const settings = Object.assign({}, DEFAULTS, saved.settings || {});
  if (settings.foldStyle !== 'none') settings.foldStyle = 'ticks';
  let rows = Array.isArray(saved.rows) && saved.rows.length ? saved.rows.map((r) => [r[0] || '', r[1] || '']) : [];
  let logoState = null;          // { dataUrl, bytes, type, width, height }
  let customFontBytes = null;
  const fontCache = {};

  // ---------- grid ----------
  const tbody = $('grid').querySelector('tbody');

  function ensureBlankRows() {
    let blanks = 0;
    for (let i = rows.length - 1; i >= 0 && !rows[i][0] && !rows[i][1]; i--) blanks++;
    while (blanks < 3) { rows.push(['', '']); blanks++; }
  }

  function renderGrid() {
    ensureBlankRows();
    tbody.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="rownum"></td><td><input type="text" data-col="0"></td><td><input type="text" data-col="1"></td><td class="del"><button type="button" title="Delete row" aria-label="Delete row">×</button></td>';
      tr.querySelector('.rownum').textContent = i + 1;
      const inputs = tr.querySelectorAll('input');
      inputs[0].value = r[0];
      inputs[1].value = r[1];
      inputs.forEach((inp) => { inp.dataset.row = i; });
      tr.querySelector('button').dataset.row = i;
      tbody.appendChild(tr);
    });
    updateCount();
  }

  function filledRows() {
    return rows.filter((r) => r[0].trim() || r[1].trim()).map((r) => ({ name: r[0].trim(), company: r[1].trim() }));
  }

  function updateCount() {
    const n = filledRows().length;
    const sheets = Math.max(1, Math.ceil(n / 4));
    $('guestCount').textContent = n + (n === 1 ? ' card' : ' cards') + ' · ' + sheets + (sheets === 1 ? ' sheet' : ' sheets');
  }

  function focusCell(row, col) {
    const el = tbody.querySelector('input[data-row="' + row + '"][data-col="' + col + '"]');
    if (el) { el.focus(); el.select(); }
  }

  tbody.addEventListener('input', (e) => {
    const t = e.target;
    if (t.tagName !== 'INPUT') return;
    rows[+t.dataset.row][+t.dataset.col] = t.value;
    const before = rows.length;
    ensureBlankRows();
    if (rows.length !== before) {
      const pos = [+t.dataset.row, +t.dataset.col, t.selectionStart];
      renderGrid();
      const el = tbody.querySelector('input[data-row="' + pos[0] + '"][data-col="' + pos[1] + '"]');
      if (el) { el.focus(); el.setSelectionRange(pos[2], pos[2]); }
    }
    updateCount();
    schedule();
  });

  tbody.addEventListener('paste', (e) => {
    const t = e.target;
    if (t.tagName !== 'INPUT') return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return; // single value: normal paste
    e.preventDefault();
    let grid = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
    if (grid.length && /^\s*(full\s*)?name\s*$/i.test(grid[0][0] || '')) grid = grid.slice(1);
    let r = +t.dataset.row;
    const c0 = +t.dataset.col;
    for (const cells of grid) {
      if (!rows[r]) rows[r] = ['', ''];
      for (let k = 0; k < cells.length && c0 + k < 2; k++) rows[r][c0 + k] = cells[k].trim();
      r++;
    }
    renderGrid();
    focusCell(Math.min(r, rows.length - 1), c0);
    schedule();
  });

  tbody.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.tagName !== 'INPUT') return;
    const r = +t.dataset.row, c = +t.dataset.col;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) { e.preventDefault(); focusCell(r + 1, c); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c); }
    else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length && c === 0) { e.preventDefault(); focusCell(r, 1); }
    else if (e.key === 'ArrowLeft' && t.selectionStart === 0 && c === 1) { e.preventDefault(); focusCell(r, 0); }
  });

  tbody.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    rows.splice(+b.dataset.row, 1);
    renderGrid();
    schedule();
  });

  $('addRows').addEventListener('click', () => { for (let i = 0; i < 5; i++) rows.push(['', '']); renderGrid(); });
  $('loadSample').addEventListener('click', () => { rows = SAMPLE.map((r) => r.slice()); renderGrid(); schedule(); });
  $('clearRows').addEventListener('click', () => {
    if (filledRows().length && !confirm('Remove all names?')) return;
    rows = []; renderGrid(); schedule();
  });

  // ---------- logo ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = src;
    });
  }

  function dataUrlToBytes(dataUrl) {
    const bin = atob(dataUrl.split(',')[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // PNG and JPG embed directly; anything else (SVG, WebP) is rasterized to a
  // high-resolution PNG so it stays crisp in print.
  async function setLogoFromDataUrl(dataUrl) {
    const img = await loadImage(dataUrl);
    const isPng = dataUrl.startsWith('data:image/png');
    const isJpg = /^data:image\/jpe?g/.test(dataUrl);
    let finalUrl = dataUrl;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!isPng && !isJpg) {
      if (!w || !h) { w = 1200; h = 400; }
      const scale = Math.max(1, 2400 / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      finalUrl = canvas.toDataURL('image/png');
      w = canvas.width; h = canvas.height;
    }
    logoState = { dataUrl: finalUrl, bytes: dataUrlToBytes(finalUrl), type: isJpg ? 'jpg' : 'png', width: w, height: h };
    $('logoPreview').src = finalUrl;
    $('logoPreview').hidden = false;
    $('logoHint').hidden = true;
    $('logoClear').hidden = false;
  }

  function readFile(file, asDataUrl) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      if (asDataUrl) fr.readAsDataURL(file); else fr.readAsArrayBuffer(file);
    });
  }

  async function handleLogoFile(file) {
    if (!file) return;
    try {
      await setLogoFromDataUrl(await readFile(file, true));
      schedule();
    } catch (err) { setStatus(err.message, true); }
  }

  $('logoInput').addEventListener('change', (e) => handleLogoFile(e.target.files[0]));
  const drop = $('logoDrop');
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('logoInput').click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleLogoFile(e.dataTransfer.files[0]));
  $('logoClear').addEventListener('click', () => {
    logoState = null;
    $('logoInput').value = '';
    $('logoPreview').hidden = true;
    $('logoHint').hidden = false;
    $('logoClear').hidden = true;
    schedule();
  });

  // ---------- settings ----------
  const SETTING_IDS = Object.keys(DEFAULTS);
  const OUTPUTS = { nameSize: 'pt', companySize: 'pt', logoSize: 'pt', gap: 'pt' };

  function syncControls() {
    for (const id of SETTING_IDS) {
      const el = $(id);
      if (el.type === 'checkbox') el.checked = !!settings[id]; else el.value = settings[id];
      if (OUTPUTS[id]) $(id + 'Out').textContent = settings[id] + ' ' + OUTPUTS[id];
    }
    $('customFontWrap').hidden = settings.font !== 'custom';
  }

  for (const id of SETTING_IDS) {
    $(id).addEventListener('input', (e) => {
      const el = e.target;
      settings[id] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      syncControls();
      schedule();
    });
  }

  $('customFont').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    customFontBytes = new Uint8Array(await readFile(f, false));
    schedule();
  });

  async function fetchFont(path) {
    if (!fontCache[path]) {
      fontCache[path] = fetch(FONT_BASE + path).then((r) => {
        if (!r.ok) throw new Error('Font download failed');
        return r.arrayBuffer();
      }).then((b) => new Uint8Array(b)).catch((err) => { delete fontCache[path]; throw err; });
    }
    return fontCache[path];
  }

  async function resolveFonts() {
    const f = settings.font;
    if (f === 'helvetica' || f === 'times') return { standard: f };
    if (f === 'custom') return customFontBytes ? { regular: customFontBytes, bold: customFontBytes } : { standard: 'helvetica' };
    const def = FONTS[f] || FONTS.poppins;
    try {
      const [regular, bold] = await Promise.all([fetchFont(def.regular), fetchFont(def.bold)]);
      return { regular, bold };
    } catch (e) {
      setStatus('Could not load the font, using Helvetica.', true);
      return { standard: 'helvetica' };
    }
  }

  // ---------- PDF generation ----------
  let timer = null, running = false, pending = false, lastBytes = null;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // Draw every sheet of the generated PDF so the preview is exactly what prints.
  async function renderPreview(bytes) {
    const host = $('pages');
    if (!window.pdfjsLib) { host.textContent = 'Preview unavailable. Use Download PDF.'; return; }
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const frag = document.createDocumentFragment();
    const cssWidth = Math.max(240, host.clientWidth - 32);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      canvas.style.width = cssWidth + 'px';
      canvas.className = 'sheet';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      frag.appendChild(canvas);
    }
    host.replaceChildren(frag);
    pdf.destroy();
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (lastBytes) renderPreview(lastBytes); }, 200);
  });

  function setStatus(msg, isError) {
    const el = $('status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function schedule() {
    saveState();
    clearTimeout(timer);
    timer = setTimeout(generate, 350);
  }

  async function generate() {
    if (running) { pending = true; return; }
    running = true;
    setStatus('Updating…');
    try {
      const fonts = await resolveFonts();
      const bytes = await PlaceCards.buildPdf({ cards: filledRows(), settings, fonts, logo: logoState });
      lastBytes = bytes;
      await renderPreview(bytes);
      if (!$('status').classList.contains('error')) setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('Could not build the PDF: ' + err.message, true);
    } finally {
      running = false;
      if (pending) { pending = false; generate(); }
    }
  }

  $('download').addEventListener('click', async () => {
    clearTimeout(timer);
    await generate();
    if (!lastBytes) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lastBytes], { type: 'application/pdf' }));
    a.download = 'placecards.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // ---------- init ----------
  syncControls();
  renderGrid();
  (async () => {
    if (saved.logo) { try { await setLogoFromDataUrl(saved.logo); } catch (e) { /* ignore */ } }
    generate();
  })();
})();
