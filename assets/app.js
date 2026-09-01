/* ============================================================
   Periksa Warna Cetak — app.js
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc = (function(){
  const blob = new Blob([window.PDFJS_WORKER_SOURCE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
})();

const PIXEL_DIFF_THRESHOLD = 20;
const CATEGORY_LABEL = { bw: 'Hitam Putih', color: 'Warna', full: 'Full Warna', block: 'Block Warna' };
const CATEGORY_ORDER = ['bw', 'color', 'full', 'block'];

// ---- Pricing config (locked by default; editable via "Ubah Harga") ----
let pricing = {
  bw:    { normal: 500,  discount: 300,  minQty: 50 },
  color: { normal: 1200, discount: 900,  minQty: 50 },
  full:  { normal: 1800, discount: 1400, minQty: 50 },
  block: { normal: 2500, discount: 2000, minQty: 50 }
};
let pricingLocked = true;

// ---- Document state ----
let documents = []; // { id, name, numPages, results: [...] }
let docCounter = 0;
let activePreview = null; // { docId, page }

// ---- DOM refs ----
const uploader = document.getElementById('uploader');
const fileInput = document.getElementById('fileInput');
const filelistEl = document.getElementById('filelist');
const errorEl = document.getElementById('error');
const progressWrap = document.getElementById('progressWrap');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const tier1Input = document.getElementById('tier1');
const tier2Input = document.getElementById('tier2');
const tier3Input = document.getElementById('tier3');
const tierRanges = document.getElementById('tierRanges');
const tierError = document.getElementById('tierError');
const priceTableBody = document.getElementById('priceTableBody');
const priceLockToggle = document.getElementById('priceLockToggle');
const priceLockNote = document.getElementById('priceLockNote');
const grandCard = document.getElementById('grandCard');
const grandTotalValue = document.getElementById('grandTotalValue');
const grandBreakdown = document.getElementById('grandBreakdown');
const documentsContainer = document.getElementById('documentsContainer');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportPngBtn = document.getElementById('exportPngBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalImg = document.getElementById('modalImg');
const modalStatus = document.getElementById('modalStatus');
const modalStatusText = document.getElementById('modalStatusText');
const modalStatusPct = document.getElementById('modalStatusPct');
const modalNote = document.getElementById('modalNote');
const catButtons = Array.from(document.querySelectorAll('.modal-cat-btn'));

/* ============================================================
   Tier classification
   ============================================================ */
function getTiers(){
  let t1 = parseFloat(tier1Input.value);
  let t2 = parseFloat(tier2Input.value);
  let t3 = parseFloat(tier3Input.value);
  if (isNaN(t1)) t1 = 20;
  if (isNaN(t2)) t2 = 60;
  if (isNaN(t3)) t3 = 90;
  return { t1, t2, t3 };
}

function classify(pct, t1, t2, t3){
  if (pct < t1) return 'bw';
  if (pct < t2) return 'color';
  if (pct < t3) return 'full';
  return 'block';
}

function effectiveCategory(r){
  return r.manualOverride || r.category;
}

function updateTierUI(){
  const { t1, t2, t3 } = getTiers();
  const valid = t1 < t2 && t2 < t3 && t3 <= 100;
  tierError.classList.toggle('active', !valid);
  tierRanges.innerHTML = `
    <span class="r"><span class="swatch bw"></span><b>Hitam Putih</b>&nbsp;0%–${t1}%</span>
    <span class="r"><span class="swatch color"></span><b>Warna</b>&nbsp;${t1}%–${t2}%</span>
    <span class="r"><span class="swatch full"></span><b>Full Warna</b>&nbsp;${t2}%–${t3}%</span>
    <span class="r"><span class="swatch block"></span><b>Block Warna</b>&nbsp;${t3}%–100%</span>
  `;
  return valid;
}

function recategorizeAllDocuments(){
  if (!updateTierUI()) return;
  const { t1, t2, t3 } = getTiers();
  documents.forEach(doc => {
    doc.results.forEach(r => {
      if (r.error) return;
      r.category = classify(r.ratio * 100, t1, t2, t3);
    });
    refreshDocumentUI(doc);
  });
  renderGrandTotal();
}

tier1Input.addEventListener('input', recategorizeAllDocuments);
tier2Input.addEventListener('input', recategorizeAllDocuments);
tier3Input.addEventListener('input', recategorizeAllDocuments);
updateTierUI();

/* ============================================================
   Price table
   ============================================================ */
function fmtRp(n){ return 'Rp ' + Math.round(n).toLocaleString('id-ID'); }

function renderPriceTable(){
  priceTableBody.innerHTML = CATEGORY_ORDER.map(cat => {
    const p = pricing[cat];
    if (pricingLocked){
      return `<tr>
        <td class="cat-name"><span class="swatch ${cat}"></span>${CATEGORY_LABEL[cat]}</td>
        <td>${fmtRp(p.normal)}</td>
        <td>${fmtRp(p.discount)}</td>
        <td>${p.minQty} lembar</td>
      </tr>`;
    }
    return `<tr>
      <td class="cat-name"><span class="swatch ${cat}"></span>${CATEGORY_LABEL[cat]}</td>
      <td><input type="number" min="0" step="50" value="${p.normal}" data-cat="${cat}" data-field="normal"></td>
      <td><input type="number" min="0" step="50" value="${p.discount}" data-cat="${cat}" data-field="discount"></td>
      <td><input type="number" min="0" step="1" value="${p.minQty}" data-cat="${cat}" data-field="minQty"></td>
    </tr>`;
  }).join('');

  if (!pricingLocked){
    priceTableBody.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const cat = inp.dataset.cat, field = inp.dataset.field;
        const val = parseFloat(inp.value);
        pricing[cat][field] = isNaN(val) ? 0 : val;
        renderGrandTotal();
        documents.forEach(refreshDocumentUI);
      });
    });
  }
}

const PRICE_EDIT_PASSWORD = 'password123';

priceLockToggle.addEventListener('click', () => {
  if (pricingLocked){
    const input = prompt('Masukkan password untuk mengubah harga:');
    if (input === null) return; // user cancelled
    if (input !== PRICE_EDIT_PASSWORD){
      errorEl.textContent = 'Password salah. Tabel harga tetap terkunci.';
      return;
    }
    errorEl.textContent = '';
  }

  pricingLocked = !pricingLocked;
  priceLockToggle.textContent = pricingLocked ? 'Ubah Harga' : 'Simpan & Kunci';
  priceLockNote.textContent = pricingLocked
    ? 'Harga terkunci (readonly). Klik "Ubah Harga" untuk menyesuaikan, lalu simpan untuk mengunci kembali. Harga per lembar otomatis memakai tarif diskon begitu jumlah halaman kategori tsb (gabungan semua dokumen yang diunggah) mencapai minimum.'
    : 'Mode edit aktif — ubah angka pada tabel di atas, lalu klik "Simpan & Kunci" untuk mengunci kembali.';
  renderPriceTable();
});

renderPriceTable();

/* ============================================================
   Aggregate counts & pricing across ALL uploaded documents
   (bulk discount applies to the combined quantity per category)
   ============================================================ */
function aggregateCounts(){
  const counts = { bw: 0, color: 0, full: 0, block: 0 };
  documents.forEach(doc => {
    doc.results.forEach(r => {
      if (r.error) return;
      counts[effectiveCategory(r)]++;
    });
  });
  return counts;
}

function unitPriceFor(cat, counts){
  const p = pricing[cat];
  return counts[cat] >= p.minQty ? p.discount : p.normal;
}

function unitPrices(){
  const counts = aggregateCounts();
  const prices = {};
  CATEGORY_ORDER.forEach(cat => { prices[cat] = unitPriceFor(cat, counts); });
  return prices;
}

function renderGrandTotal(){
  if (documents.length === 0){
    grandCard.style.display = 'none';
    return;
  }
  grandCard.style.display = 'block';
  const counts = aggregateCounts();
  const prices = unitPrices();
  let total = 0;
  const lines = CATEGORY_ORDER.map(cat => {
    const subtotal = counts[cat] * prices[cat];
    total += subtotal;
    const discounted = counts[cat] >= pricing[cat].minQty;
    return `${CATEGORY_LABEL[cat]}: ${counts[cat]} hal. × ${fmtRp(prices[cat])}${discounted ? ' (harga diskon)' : ''} = ${fmtRp(subtotal)}`;
  });
  grandTotalValue.textContent = fmtRp(total);
  const totalPages = documents.reduce((s,d) => s + d.results.length, 0);
  grandBreakdown.innerHTML = `${documents.length} dokumen, ${totalPages} halaman total<br>` + lines.join('<br>');
}

exportPdfBtn.addEventListener('click', () => exportCombinedReport('pdf'));
exportPngBtn.addEventListener('click', () => exportCombinedReport('png'));

/* ============================================================
   Upload handling (multiple files)
   ============================================================ */
uploader.addEventListener('click', () => fileInput.click());
uploader.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
uploader.addEventListener('dragover', e => { e.preventDefault(); uploader.classList.add('drag'); });
uploader.addEventListener('dragleave', () => uploader.classList.remove('drag'));
uploader.addEventListener('drop', e => {
  e.preventDefault();
  uploader.classList.remove('drag');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => {
  if (e.target.files.length) handleFiles(e.target.files);
  fileInput.value = '';
});

async function handleFiles(fileList){
  errorEl.textContent = '';
  const files = Array.from(fileList).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  const rejected = fileList.length - files.length;
  if (rejected > 0){
    errorEl.textContent = `${rejected} file dilewati karena bukan PDF.`;
  }
  if (files.length === 0) return;

  progressWrap.classList.add('active');
  for (let fi = 0; fi < files.length; fi++){
    const file = files[fi];
    filelistEl.textContent = `Memproses dokumen ${fi+1}/${files.length}: ${file.name}`;
    try {
      const arrayBuffer = await file.arrayBuffer();
      await processPDF(file.name, arrayBuffer, fi+1, files.length);
    } catch (err) {
      errorEl.textContent = `Gagal memproses "${file.name}". Pastikan file tidak rusak atau terkunci.`;
    }
  }
  progressWrap.classList.remove('active');
  filelistEl.textContent = `${documents.length} dokumen sudah diproses.`;
}

async function processPDF(fileName, arrayBuffer, fileIndex, fileTotal){
  if (!updateTierUI()){
    errorEl.textContent = 'Perbaiki dulu batas kategori sebelum memproses PDF.';
    throw new Error('invalid tiers');
  }
  const { t1, t2, t3 } = getTiers();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  const docId = 'doc' + (++docCounter);
  const doc = { id: docId, name: fileName, numPages, results: new Array(numPages) };
  documents.push(doc);
  const docCard = buildDocumentCard(doc);
  documentsContainer.appendChild(docCard);

  const cellsWrap = docCard.querySelector('.pages-grid');
  for (let i = 1; i <= numPages; i++){
    const cell = document.createElement('div');
    cell.className = 'page-cell pending';
    cell.textContent = i;
    cell.id = 'cell-' + docId + '-' + i;
    cellsWrap.appendChild(cell);
  }

  for (let i = 1; i <= numPages; i++){
    progressText.textContent = `Dokumen ${fileIndex}/${fileTotal} — halaman ${i}/${numPages} (${fileName})`;
    progressFill.style.width = ((i / numPages) * 100) + '%';

    try {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const targetWidth = 500;
      const scale = targetWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(scaledViewport.width);
      canvas.height = Math.ceil(scaledViewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0, sampled = 0;
      const stride = 3;
      const w = canvas.width, h = canvas.height;
      for (let y = 0; y < h; y += stride){
        for (let x = 0; x < w; x += stride){
          const idx = (y * w + x) * 4;
          const r = imgData[idx], g = imgData[idx+1], b = imgData[idx+2];
          const diff = Math.max(r,g,b) - Math.min(r,g,b);
          if (diff > PIXEL_DIFF_THRESHOLD) colored++;
          sampled++;
        }
      }
      const ratio = sampled > 0 ? colored / sampled : 0;
      const category = classify(ratio * 100, t1, t2, t3);
      const thumb = canvas.toDataURL('image/jpeg', 0.72);
      doc.results[i-1] = { page: i, ratio, category, thumb, manualOverride: null };

      const cell = document.getElementById('cell-' + docId + '-' + i);
      cell.classList.remove('pending');
      cell.classList.add(category);
      cell.title = `Halaman ${i} — ${CATEGORY_LABEL[category]} (${(ratio*100).toFixed(2)}% area berwarna) — klik untuk preview`;
      cell.addEventListener('click', () => openPreview(docId, i));

      page.cleanup();
    } catch (err) {
      doc.results[i-1] = { page: i, ratio: 0, category: 'bw', thumb: null, manualOverride: null, error: true };
    }
    await new Promise(res => setTimeout(res, 0));
  }

  refreshDocumentUI(doc);
  renderGrandTotal();
}

/* ============================================================
   Document card (per uploaded PDF)
   ============================================================ */
function buildDocumentCard(doc){
  const el = document.createElement('div');
  el.className = 'doc-card';
  el.id = 'card-' + doc.id;
  el.innerHTML = `
    <div class="doc-head">
      <div>
        <div class="doc-name">${escapeHTML(doc.name)}</div>
        <div class="doc-meta">${doc.numPages} halaman</div>
      </div>
      <button class="doc-remove" data-doc="${doc.id}">Hapus</button>
    </div>

    <div class="summary-grid">
      <div class="stat"><div class="stat-num" data-stat="total">0</div><div class="stat-label">Total</div></div>
      <div class="stat bw"><div class="stat-num" data-stat="bw">0</div><div class="stat-label">Hitam Putih</div></div>
      <div class="stat color"><div class="stat-num" data-stat="color">0</div><div class="stat-label">Warna</div></div>
      <div class="stat full"><div class="stat-num" data-stat="full">0</div><div class="stat-label">Full Warna</div></div>
      <div class="stat block"><div class="stat-num" data-stat="block">0</div><div class="stat-label">Block Warna</div></div>
    </div>

    <div class="doc-subtotal">
      <span class="label">Estimasi dokumen ini</span>
      <span class="value" data-stat="subtotal">Rp 0</span>
    </div>

    <div class="pages-hint">Klik kotak untuk melihat preview halaman &amp; koreksi kategori jika deteksi kurang tepat</div>
    <div class="pages-grid"></div>
    <div class="legend">
      <span class="item"><span class="swatch bw"></span>Hitam putih</span>
      <span class="item"><span class="swatch color"></span>Warna</span>
      <span class="item"><span class="swatch full"></span>Full warna</span>
      <span class="item"><span class="swatch block"></span>Block warna</span>
      <span class="item"><span class="dot-marker"></span>Dikoreksi manual</span>
    </div>

    <div class="doc-actions">
      <button class="btn small secondary" data-action="remove" data-doc="${doc.id}">Hapus Dokumen</button>
    </div>
  `;

  el.querySelector('[data-action="remove"]').addEventListener('click', () => removeDocument(doc.id));
  el.querySelector('.doc-remove').addEventListener('click', () => removeDocument(doc.id));

  return el;
}

function removeDocument(docId){
  documents = documents.filter(d => d.id !== docId);
  const card = document.getElementById('card-' + docId);
  if (card) card.remove();
  renderGrandTotal();
}

function refreshDocumentUI(doc){
  const card = document.getElementById('card-' + doc.id);
  if (!card) return;

  const counts = { bw: 0, color: 0, full: 0, block: 0 };
  doc.results.forEach(r => {
    if (!r || r.error) return;
    const eff = effectiveCategory(r);
    counts[eff]++;
    const cell = document.getElementById('cell-' + doc.id + '-' + r.page);
    if (cell){
      cell.classList.remove('bw', 'color', 'full', 'block');
      cell.classList.add(eff);
      cell.classList.toggle('corrected', !!r.manualOverride && r.manualOverride !== r.category);
      cell.title = `Halaman ${r.page} — ${CATEGORY_LABEL[eff]} (${(r.ratio*100).toFixed(2)}% area berwarna) — klik untuk preview`;
    }
  });

  card.querySelector('[data-stat="total"]').textContent = doc.results.length;
  card.querySelector('[data-stat="bw"]').textContent = counts.bw;
  card.querySelector('[data-stat="color"]').textContent = counts.color;
  card.querySelector('[data-stat="full"]').textContent = counts.full;
  card.querySelector('[data-stat="block"]').textContent = counts.block;

  const prices = unitPrices();
  const subtotal = CATEGORY_ORDER.reduce((s, cat) => s + counts[cat] * prices[cat], 0);
  card.querySelector('[data-stat="subtotal"]').textContent = fmtRp(subtotal);
}

function escapeHTML(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ============================================================
   Preview modal (per document + page)
   ============================================================ */
function openPreview(docId, pageNum){
  const doc = documents.find(d => d.id === docId);
  if (!doc) return;
  const r = doc.results[pageNum - 1];
  if (!r) return;
  activePreview = { docId, page: pageNum };

  modalTitle.textContent = doc.name + ' — Halaman ' + pageNum;
  modalImg.src = r.thumb || '';
  const eff = effectiveCategory(r);

  modalStatus.className = 'modal-status is-' + eff;
  modalStatusText.textContent = 'Terdeteksi: ' + CATEGORY_LABEL[eff];
  modalStatusPct.textContent = (r.ratio*100).toFixed(2) + '% area berwarna';

  const corrected = !!r.manualOverride;
  modalNote.textContent = corrected
    ? `Kategori sudah dikoreksi manual dari hasil deteksi otomatis (${CATEGORY_LABEL[r.category]}).`
    : 'Kalau kategori otomatis kurang tepat, pilih kategori yang benar di bawah ini.';

  catButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.cat === eff));
  modalOverlay.classList.add('active');
}

function closePreview(){
  modalOverlay.classList.remove('active');
  activePreview = null;
}

modalClose.addEventListener('click', closePreview);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closePreview(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });

catButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!activePreview) return;
    const doc = documents.find(d => d.id === activePreview.docId);
    if (!doc) return;
    const r = doc.results[activePreview.page - 1];
    const chosen = btn.dataset.cat;
    r.manualOverride = (chosen === r.category) ? null : chosen;

    refreshDocumentUI(doc);
    renderGrandTotal();
    openPreview(activePreview.docId, activePreview.page);
  });
});

/* ============================================================
   Export: ONE combined report covering all uploaded documents
   ============================================================ */
function categoryRowsHTML(counts, prices){
  const colorMap = { bw:'#1C63B7', color:'#D9A400', full:'#C81E2C', block:'#141414' };
  let total = 0;
  const rows = CATEGORY_ORDER.map(cat => {
    const subtotal = counts[cat] * prices[cat];
    total += subtotal;
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #DDD9CC;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colorMap[cat]};margin-right:8px;vertical-align:-1px;"></span>
        ${CATEGORY_LABEL[cat]}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #DDD9CC;text-align:right;">${counts[cat]}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #DDD9CC;text-align:right;">${fmtRp(prices[cat])}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #DDD9CC;text-align:right;font-weight:600;">${fmtRp(subtotal)}</td>
    </tr>`;
  }).join('');
  return { rows, total };
}

function pageMapHTML(doc){
  const colorMap = { bw:'#1C63B7', color:'#D9A400', full:'#C81E2C', block:'#141414' };
  return doc.results.map(r => {
    if (!r || r.error) return `<div style="width:22px;height:22px;background:#E3E0D7;border-radius:2px;"></div>`;
    const eff = effectiveCategory(r);
    return `<div style="width:22px;height:22px;background:${colorMap[eff]};border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:7px;color:#fff;font-family:monospace;">${r.page}</div>`;
  }).join('');
}

function legendHTML(){
  return `<div style="display:flex;gap:18px;margin-top:10px;font-size:10.5px;color:#5B584F;flex-wrap:wrap;">
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#1C63B7;margin-right:5px;vertical-align:-1px;"></span>Hitam Putih</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#D9A400;margin-right:5px;vertical-align:-1px;"></span>Warna</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#C81E2C;margin-right:5px;vertical-align:-1px;"></span>Full Warna</span>
    <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#141414;margin-right:5px;vertical-align:-1px;"></span>Block Warna</span>
  </div>`;
}

function buildCombinedReportNode(){
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' }) + ' ' + now.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });

  const aggCounts = aggregateCounts();
  const prices = unitPrices();
  const { rows: grandRows, total: grandTotal } = categoryRowsHTML(aggCounts, prices);
  const totalPages = documents.reduce((s,d) => s + d.results.length, 0);

  const docSections = documents.map((doc, idx) => {
    const counts = { bw: 0, color: 0, full: 0, block: 0 };
    doc.results.forEach(r => { if (r && !r.error) counts[effectiveCategory(r)]++; });
    const { rows, total } = categoryRowsHTML(counts, prices);
    return `
      <div style="margin-top:${idx === 0 ? '10' : '30'}px;padding-top:${idx === 0 ? '0' : '20'}px;${idx > 0 ? 'border-top:1px dashed #DDD9CC;' : ''}">
        <div style="font-size:13px;font-weight:700;">${idx+1}. ${escapeHTML(doc.name)}</div>
        <div style="font-size:10.5px;color:#96927F;margin:3px 0 12px;">${doc.results.length} halaman</div>
        <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:7px 10px;border-bottom:2px solid #1C1B19;font-size:9.5px;text-transform:uppercase;">Kategori</th>
              <th style="text-align:right;padding:7px 10px;border-bottom:2px solid #1C1B19;font-size:9.5px;text-transform:uppercase;">Halaman</th>
              <th style="text-align:right;padding:7px 10px;border-bottom:2px solid #1C1B19;font-size:9.5px;text-transform:uppercase;">Harga/lbr</th>
              <th style="text-align:right;padding:7px 10px;border-bottom:2px solid #1C1B19;font-size:9.5px;text-transform:uppercase;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;font-size:12px;font-weight:700;">
          Subtotal dokumen: ${fmtRp(total)}
        </div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;margin:16px 0 8px;color:#615E54;">Peta Halaman</div>
        <div style="display:grid;grid-template-columns:repeat(22,22px);gap:3px;">${pageMapHTML(doc)}</div>
      </div>
    `;
  }).join('');

  const root = document.createElement('div');
  root.className = 'report-root';
  root.innerHTML = `
    <div style="font-family:Arial,Helvetica,sans-serif;padding:36px;color:#1C1B19;">
      <div style="background:#1C1B19;color:#EFEDE7;padding:18px 22px;border-radius:4px;margin-bottom:22px;">
        <div style="font-size:22px;font-weight:800;letter-spacing:0.3px;text-transform:uppercase;">Periksa Warna Cetak</div>
        <div style="font-size:11px;color:#C9C6BB;margin-top:5px;">Laporan Gabungan Hasil Deteksi &amp; Estimasi Biaya</div>
      </div>

      <div style="font-size:12px;margin-bottom:4px;"><b>Jumlah dokumen:</b> ${documents.length}</div>
      <div style="font-size:12px;margin-bottom:4px;"><b>Total halaman:</b> ${totalPages}</div>
      <div style="font-size:12px;margin-bottom:18px;"><b>Tanggal dibuat:</b> ${dateStr}</div>

      <div style="font-size:13px;font-weight:700;text-transform:uppercase;margin:18px 0 10px;">Ringkasan Total (Semua Dokumen)</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 10px;border-bottom:2px solid #1C1B19;font-size:10px;text-transform:uppercase;">Kategori</th>
            <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #1C1B19;font-size:10px;text-transform:uppercase;">Halaman</th>
            <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #1C1B19;font-size:10px;text-transform:uppercase;">Harga/lbr</th>
            <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #1C1B19;font-size:10px;text-transform:uppercase;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${grandRows}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;background:#1C1B19;color:#EFEDE7;padding:14px 16px;border-radius:4px;margin-top:14px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#C9C6BB;">Total Estimasi Cetak Keseluruhan</span>
        <span style="font-size:20px;font-weight:800;">${fmtRp(grandTotal)}</span>
      </div>
      ${legendHTML()}

      <div style="font-size:13px;font-weight:700;text-transform:uppercase;margin:30px 0 4px;border-top:2px solid #1C1B19;padding-top:20px;">Rincian per Dokumen</div>
      ${docSections}
    </div>
  `;
  return root;
}

async function exportCombinedReport(format){
  if (documents.length === 0) return;
  const node = buildCombinedReportNode();
  document.body.appendChild(node);

  try {
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true });

    if (format === 'png'){
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'laporan-gabungan-warna-cetak.png';
      a.click();
    } else {
      const { jsPDF } = window.jspdf;
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pageWidthMM = 210, pageHeightMM = 297; // A4
      const imgWidthMM = pageWidthMM;
      const imgHeightMM = (canvas.height * imgWidthMM) / canvas.width;

      const pdf = new jsPDF('p', 'mm', 'a4');
      if (imgHeightMM <= pageHeightMM){
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidthMM, imgHeightMM);
      } else {
        let heightLeftMM = imgHeightMM;
        let positionMM = 0;
        pdf.addImage(imgData, 'JPEG', 0, positionMM, imgWidthMM, imgHeightMM);
        heightLeftMM -= pageHeightMM;
        while (heightLeftMM > 0){
          positionMM = heightLeftMM - imgHeightMM;
          pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, positionMM, imgWidthMM, imgHeightMM);
          heightLeftMM -= pageHeightMM;
        }
      }
      pdf.save('laporan-gabungan-warna-cetak.pdf');
    }
  } catch (err) {
    errorEl.textContent = 'Gagal membuat laporan. Coba lagi.';
  } finally {
    document.body.removeChild(node);
  }
}

function safeFileName(name){
  return name.replace(/\.pdf$/i, '').replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 60) || 'dokumen';
}
