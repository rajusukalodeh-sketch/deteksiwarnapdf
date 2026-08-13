const _pdfWorkerBlob = new Blob([window.PDFJS_WORKER_SOURCE], { type: 'application/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(_pdfWorkerBlob);

const PIXEL_DIFF_THRESHOLD = 20;
const CATEGORY_LABEL = { bw: 'Hitam Putih', color: 'Warna', full: 'Full Warna' };

const uploader = document.getElementById('uploader');
const fileInput = document.getElementById('fileInput');
const filenameEl = document.getElementById('filename');
const errorEl = document.getElementById('error');
const progressWrap = document.getElementById('progressWrap');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const resultsCard = document.getElementById('resultsCard');
const statTotal = document.getElementById('statTotal');
const statBW = document.getElementById('statBW');
const statColor = document.getElementById('statColor');
const statFull = document.getElementById('statFull');
const pagesGrid = document.getElementById('pagesGrid');
const priceBWInput = document.getElementById('priceBW');
const priceColorInput = document.getElementById('priceColor');
const priceFullInput = document.getElementById('priceFull');
const calcTotal = document.getElementById('calcTotal');
const calcBreakdown = document.getElementById('calcBreakdown');
const tier1Input = document.getElementById('tier1');
const tier2Input = document.getElementById('tier2');
const tierRanges = document.getElementById('tierRanges');
const tierError = document.getElementById('tierError');
const exportBtn = document.getElementById('exportBtn');
const resetBtn = document.getElementById('resetBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalImg = document.getElementById('modalImg');
const modalStatus = document.getElementById('modalStatus');
const modalStatusText = document.getElementById('modalStatusText');
const modalStatusPct = document.getElementById('modalStatusPct');
const modalNote = document.getElementById('modalNote');
const catButtons = [document.getElementById('btnCatBW'), document.getElementById('btnCatColor'), document.getElementById('btnCatFull')];

let results = [];
let activePreviewPage = null;

function getTiers(){
  let t1 = parseFloat(tier1Input.value);
  let t2 = parseFloat(tier2Input.value);
  if (isNaN(t1)) t1 = 10;
  if (isNaN(t2)) t2 = 20;
  return { t1, t2 };
}

function classify(ratioPercent, t1, t2){
  if (ratioPercent < t1) return 'bw';
  if (ratioPercent < t2) return 'color';
  return 'full';
}

function effectiveCategory(r){
  return r.manualOverride || r.category;
}

function updateTierUI(){
  const { t1, t2 } = getTiers();
  const valid = t1 < t2;
  tierError.classList.toggle('active', !valid);
  tierRanges.innerHTML = `
    <span class="r"><span class="swatch bw"></span><b>Hitam Putih</b>&nbsp;0%–${t1}%</span>
    <span class="r"><span class="swatch color"></span><b>Warna</b>&nbsp;${t1}%–${t2}%</span>
    <span class="r"><span class="swatch full"></span><b>Full Warna</b>&nbsp;${t2}%–100%</span>
  `;
  return valid;
}

function recategorizeAll(){
  if (!updateTierUI()) return;
  if (results.length === 0) return;
  const { t1, t2 } = getTiers();
  results.forEach(r => {
    if (r.error) return;
    r.category = classify(r.ratio * 100, t1, t2);
    const cell = document.getElementById('cell-' + r.page);
    if (!cell) return;
    const eff = effectiveCategory(r);
    cell.classList.remove('bw', 'color', 'full');
    cell.classList.add(eff);
    cell.classList.toggle('corrected', !!r.manualOverride && r.manualOverride !== r.category);
    cell.title = `Halaman ${r.page} — ${CATEGORY_LABEL[eff]} (${(r.ratio*100).toFixed(2)}% area berwarna) — klik untuk preview`;
  });
  renderSummary();
}

tier1Input.addEventListener('input', recategorizeAll);
tier2Input.addEventListener('input', recategorizeAll);
updateTierUI();

uploader.addEventListener('click', () => fileInput.click());
uploader.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
uploader.addEventListener('dragover', e => { e.preventDefault(); uploader.classList.add('drag'); });
uploader.addEventListener('dragleave', () => uploader.classList.remove('drag'));
uploader.addEventListener('drop', e => {
  e.preventDefault();
  uploader.classList.remove('drag');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file){
  errorEl.textContent = '';
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')){
    errorEl.textContent = 'File harus berformat PDF.';
    return;
  }
  filenameEl.textContent = 'File: ' + file.name;
  resultsCard.style.display = 'none';
  results = [];
  const reader = new FileReader();
  reader.onload = () => processPDF(reader.result);
  reader.onerror = () => errorEl.textContent = 'Gagal membaca file.';
  reader.readAsArrayBuffer(file);
}

async function processPDF(arrayBuffer){
  if (!updateTierUI()){
    errorEl.textContent = 'Perbaiki dulu batas kategori sebelum memproses PDF.';
    return;
  }
  const { t1, t2 } = getTiers();

  progressWrap.classList.add('active');
  pagesGrid.innerHTML = '';

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  } catch (err) {
    errorEl.textContent = 'Gagal membuka PDF. Pastikan file tidak rusak atau terkunci.';
    progressWrap.classList.remove('active');
    return;
  }

  const numPages = pdf.numPages;
  results = new Array(numPages);

  for (let i = 1; i <= numPages; i++){
    const cell = document.createElement('div');
    cell.className = 'page-cell pending';
    cell.textContent = i;
    cell.id = 'cell-' + i;
    pagesGrid.appendChild(cell);
  }

  for (let i = 1; i <= numPages; i++){
    progressText.textContent = `Memproses halaman ${i}/${numPages}`;
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
      const category = classify(ratio * 100, t1, t2);
      const thumb = canvas.toDataURL('image/jpeg', 0.72);
      results[i-1] = { page: i, ratio, category, thumb, manualOverride: null };

      const cell = document.getElementById('cell-' + i);
      cell.classList.remove('pending');
      cell.classList.add(category);
      cell.title = `Halaman ${i} — ${CATEGORY_LABEL[category]} (${(ratio*100).toFixed(2)}% area berwarna) — klik untuk preview`;
      cell.addEventListener('click', () => openPreview(i));

      page.cleanup();
    } catch (err) {
      results[i-1] = { page: i, ratio: 0, category: 'bw', thumb: null, manualOverride: null, error: true };
    }

    await new Promise(r => setTimeout(r, 0));
  }

  progressWrap.classList.remove('active');
  renderSummary();
}

function renderSummary(){
  const total = results.length;
  const bwCount = results.filter(r => effectiveCategory(r) === 'bw').length;
  const colorCount = results.filter(r => effectiveCategory(r) === 'color').length;
  const fullCount = results.filter(r => effectiveCategory(r) === 'full').length;

  statTotal.textContent = total;
  statBW.textContent = bwCount;
  statColor.textContent = colorCount;
  statFull.textContent = fullCount;

  resultsCard.style.display = 'block';
  updateCalc();
}

function updateCalc(){
  const priceBW = parseFloat(priceBWInput.value) || 0;
  const priceColor = parseFloat(priceColorInput.value) || 0;
  const priceFull = parseFloat(priceFullInput.value) || 0;
  const bwCount = results.filter(r => effectiveCategory(r) === 'bw').length;
  const colorCount = results.filter(r => effectiveCategory(r) === 'color').length;
  const fullCount = results.filter(r => effectiveCategory(r) === 'full').length;
  const correctedCount = results.filter(r => !!r.manualOverride).length;

  const total = (bwCount * priceBW) + (colorCount * priceColor) + (fullCount * priceFull);
  calcTotal.textContent = 'Rp ' + total.toLocaleString('id-ID');
  calcBreakdown.textContent = `${bwCount} hal. Hitam Putih × Rp ${priceBW.toLocaleString('id-ID')}  +  ${colorCount} hal. Warna × Rp ${priceColor.toLocaleString('id-ID')}  +  ${fullCount} hal. Full Warna × Rp ${priceFull.toLocaleString('id-ID')}`
    + (correctedCount > 0 ? `  —  ${correctedCount} halaman dikoreksi manual` : '');
}

function openPreview(pageNum){
  const r = results[pageNum - 1];
  if (!r) return;
  activePreviewPage = pageNum;

  modalTitle.textContent = 'Halaman ' + pageNum;
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
  activePreviewPage = null;
}

modalClose.addEventListener('click', closePreview);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closePreview(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });

catButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (activePreviewPage === null) return;
    const r = results[activePreviewPage - 1];
    const chosen = btn.dataset.cat;
    r.manualOverride = (chosen === r.category) ? null : chosen;

    const cell = document.getElementById('cell-' + activePreviewPage);
    const eff = effectiveCategory(r);
    cell.classList.remove('bw', 'color', 'full');
    cell.classList.add(eff);
    cell.classList.toggle('corrected', !!r.manualOverride);
    cell.title = `Halaman ${activePreviewPage} — ${CATEGORY_LABEL[eff]}${r.manualOverride ? ' (dikoreksi manual)' : ''} — klik untuk preview`;

    renderSummary();
    openPreview(activePreviewPage);
  });
});

priceBWInput.addEventListener('input', updateCalc);
priceColorInput.addEventListener('input', updateCalc);
priceFullInput.addEventListener('input', updateCalc);

exportBtn.addEventListener('click', () => {
  let csv = 'Halaman,Kategori,Persentase Warna,Dikoreksi Manual\n';
  results.forEach(r => {
    const cat = CATEGORY_LABEL[effectiveCategory(r)];
    const corrected = r.manualOverride ? 'Ya' : 'Tidak';
    csv += `${r.page},${cat},${(r.ratio*100).toFixed(2)}%,${corrected}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hasil-deteksi-warna.csv';
  a.click();
  URL.revokeObjectURL(url);
});

resetBtn.addEventListener('click', () => {
  results = [];
  closePreview();
  resultsCard.style.display = 'none';
  filenameEl.textContent = '';
  errorEl.textContent = '';
  fileInput.value = '';
  pagesGrid.innerHTML = '';
});