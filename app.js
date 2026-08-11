const _pdfWorkerBlob = new Blob([window.PDFJS_WORKER_SOURCE], { type: 'application/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(_pdfWorkerBlob);

const SENSITIVITY = {
  low:    { pixelDiff: 30, ratio: 0.02 },
  medium: { pixelDiff: 20, ratio: 0.003 },
  high:   { pixelDiff: 12, ratio: 0.0005 }
};

const uploader = document.getElementById('uploader');
const fileInput = document.getElementById('fileInput');
const filenameEl = document.getElementById('filename');
const errorEl = document.getElementById('error');
const progressWrap = document.getElementById('progressWrap');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const resultsCard = document.getElementById('resultsCard');
const statTotal = document.getElementById('statTotal');
const statColor = document.getElementById('statColor');
const statBW = document.getElementById('statBW');
const pagesGrid = document.getElementById('pagesGrid');
const priceBWInput = document.getElementById('priceBW');
const priceColorInput = document.getElementById('priceColor');
const calcTotal = document.getElementById('calcTotal');
const calcBreakdown = document.getElementById('calcBreakdown');
const sensitivitySelect = document.getElementById('sensitivity');
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
const modalToggleBtn = document.getElementById('modalToggleBtn');

let results = []; // { page, isColor, ratio, thumb, manualOverride }
let activePreviewPage = null;

function effectiveIsColor(r){
  return (r.manualOverride === null || r.manualOverride === undefined) ? r.isColor : r.manualOverride;
}

uploader.addEventListener('click', () => fileInput.click());
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
  progressWrap.classList.add('active');
  pagesGrid.innerHTML = '';
  const sens = SENSITIVITY[sensitivitySelect.value];

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

  // pre-build grid cells
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
      const stride = 3; // sample every 3rd pixel in each dimension for speed
      const w = canvas.width, h = canvas.height;

      for (let y = 0; y < h; y += stride){
        for (let x = 0; x < w; x += stride){
          const idx = (y * w + x) * 4;
          const r = imgData[idx], g = imgData[idx+1], b = imgData[idx+2];
          const diff = Math.max(r,g,b) - Math.min(r,g,b);
          if (diff > sens.pixelDiff) colored++;
          sampled++;
        }
      }

      const ratio = sampled > 0 ? colored / sampled : 0;
      const isColor = ratio > sens.ratio;
      const thumb = canvas.toDataURL('image/jpeg', 0.72);
      results[i-1] = { page: i, isColor, ratio, thumb, manualOverride: null };

      const cell = document.getElementById('cell-' + i);
      cell.classList.remove('pending');
      cell.classList.add(isColor ? 'color' : 'bw');
      cell.title = `Halaman ${i} — ${isColor ? 'Berwarna' : 'Hitam putih'} (${(ratio*100).toFixed(2)}% area berwarna) — klik untuk preview`;
      cell.addEventListener('click', () => openPreview(i));

      // release page resources
      page.cleanup();
    } catch (err) {
      results[i-1] = { page: i, isColor: false, ratio: 0, thumb: null, manualOverride: null, error: true };
    }

    // yield to keep UI responsive
    await new Promise(r => setTimeout(r, 0));
  }

  progressWrap.classList.remove('active');
  renderSummary();
}

function renderSummary(){
  const total = results.length;
  const colorCount = results.filter(effectiveIsColor).length;
  const bwCount = total - colorCount;

  statTotal.textContent = total;
  statColor.textContent = colorCount;
  statBW.textContent = bwCount;

  resultsCard.style.display = 'block';
  updateCalc();
}

function updateCalc(){
  const priceBW = parseFloat(priceBWInput.value) || 0;
  const priceColor = parseFloat(priceColorInput.value) || 0;
  const colorCount = results.filter(effectiveIsColor).length;
  const bwCount = results.length - colorCount;
  const correctedCount = results.filter(r => r.manualOverride !== null && r.manualOverride !== undefined).length;

  const total = (bwCount * priceBW) + (colorCount * priceColor);
  calcTotal.textContent = 'Rp ' + total.toLocaleString('id-ID');
  calcBreakdown.textContent = `${bwCount} hal. BW × Rp ${priceBW.toLocaleString('id-ID')} + ${colorCount} hal. warna × Rp ${priceColor.toLocaleString('id-ID')}`
    + (correctedCount > 0 ? ` — ${correctedCount} halaman dikoreksi manual` : '');

  statColor.textContent = colorCount;
  statBW.textContent = bwCount;
}

function openPreview(pageNum){
  const r = results[pageNum - 1];
  if (!r) return;
  activePreviewPage = pageNum;

  modalTitle.textContent = 'Halaman ' + pageNum;
  modalImg.src = r.thumb || '';
  const isColor = effectiveIsColor(r);

  modalStatus.className = 'modal-status ' + (isColor ? 'is-color' : 'is-bw');
  modalStatusText.textContent = isColor ? 'Terdeteksi berwarna' : 'Terdeteksi hitam putih';
  modalStatusPct.textContent = (r.ratio*100).toFixed(2) + '% area berwarna';

  const corrected = r.manualOverride !== null && r.manualOverride !== undefined;
  modalNote.textContent = corrected
    ? `Status sudah dikoreksi manual dari hasil deteksi otomatis (${r.isColor ? 'berwarna' : 'hitam putih'}).`
    : 'Jika halaman ini sebenarnya sedikit berwarna (misal ada aksen atau logo kecil) tapi terdeteksi hitam putih, atau sebaliknya, kamu bisa koreksi manual di sini.';

  modalToggleBtn.textContent = isColor ? 'Tandai sebagai Hitam Putih' : 'Tandai sebagai Berwarna';

  modalOverlay.classList.add('active');
}

function closePreview(){
  modalOverlay.classList.remove('active');
  activePreviewPage = null;
}

modalClose.addEventListener('click', closePreview);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closePreview(); });

modalToggleBtn.addEventListener('click', () => {
  if (activePreviewPage === null) return;
  const r = results[activePreviewPage - 1];
  const currentEffective = effectiveIsColor(r);
  r.manualOverride = !currentEffective;

  const cell = document.getElementById('cell-' + activePreviewPage);
  cell.classList.remove('color', 'bw');
  cell.classList.add(r.manualOverride ? 'color' : 'bw');
  cell.classList.toggle('corrected', r.manualOverride !== r.isColor);
  cell.title = `Halaman ${activePreviewPage} — ${r.manualOverride ? 'Berwarna' : 'Hitam putih'} (dikoreksi manual) — klik untuk preview`;

  renderSummary();
  openPreview(activePreviewPage); // refresh modal content to reflect new state
});

priceBWInput.addEventListener('input', updateCalc);
priceColorInput.addEventListener('input', updateCalc);

exportBtn.addEventListener('click', () => {
  let csv = 'Halaman,Status,Persentase Warna,Dikoreksi Manual\n';
  results.forEach(r => {
    const status = effectiveIsColor(r) ? 'Berwarna' : 'Hitam Putih';
    const corrected = (r.manualOverride !== null && r.manualOverride !== undefined) ? 'Ya' : 'Tidak';
    csv += `${r.page},${status},${(r.ratio*100).toFixed(2)}%,${corrected}\n`;
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