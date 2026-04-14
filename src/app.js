/**
 * app.js
 * Main entry point — wires together all modules.
 */

import { loadFromFile, loadFromURL, imageToData } from './imageLoader.js';
import { runPipeline } from './pipeline.js';
import {
  initUI, renderLayerPanel, setOriginalImage,
  setViewMode, resizeCanvas, redraw,
  setZoom, getZoom, toast, setProgress, setStatus,
} from './ui.js';
import {
  exportSVG, exportPNG, exportPDF, exportEPS, exportAll,
} from './exporter.js';

// ---- Application state ----
let state = {
  originalImg:  null,   // HTMLImageElement
  imageData:    null,   // ImageData (full resolution)
  layers:       [],     // Layer[]
  processing:   false,
};

// ---- DOM elements ----
const $ = id => document.getElementById(id);

const dropZone      = $('drop-zone');
const fileInput     = $('file-input');
const urlInput      = $('url-input');
const loadUrlBtn    = $('btn-load-url');
const generateBtn   = $('btn-generate');
const imageInfo     = $('image-info');
const mainCanvas    = $('main-canvas');
const layerCount    = $('layer-count');
const segMode       = $('seg-mode');
const smoothing     = $('smoothing');
const simplify      = $('simplify');
const autoFixToggle = $('auto-fix');
const regMarks      = $('reg-marks');
const bridgeThick   = $('bridge-thickness');

// Export buttons
const btnSVG     = $('btn-export-svg');
const btnPDF     = $('btn-export-pdf');
const btnPNG     = $('btn-export-png');
const btnAll     = $('btn-export-all');
const btnOptions = $('btn-export-options');

// Modal
const modalOverlay = $('modal-overlay');
const modalCancel  = $('modal-cancel');
const modalOk      = $('modal-ok');

// About modal
const btnAbout     = $('btn-about');
const aboutOverlay = $('about-overlay');
const aboutClose   = $('about-close');

// ---- Init ----

document.addEventListener('DOMContentLoaded', () => {
  initUI(mainCanvas);
  setupDropZone();
  setupFileInput();
  setupURLInput();
  setupViewTabs();
  setupZoomControls();
  setupGenerateBtn();
  setupExportButtons();
  setupModal();
  setupAboutModal();
  setupLayerListEvents();
  setupKeyboardShortcuts();

  // Focus the drop zone for keyboard users
  dropZone.focus();
});

// ---- Image loading ----

function setupDropZone() {
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

  dropZone.addEventListener('drop', async e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFileLoad(file);
  });

  // Keyboard & click on the zone itself
  dropZone.addEventListener('click', e => {
    if (e.target.closest('.btn-browse')) return; // handled by btn-browse
    fileInput.click();
  });

  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  dropZone.querySelector('.btn-browse').addEventListener('click', e => {
    e.stopPropagation();
    fileInput.click();
  });
}

function setupFileInput() {
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (file) await handleFileLoad(file);
    fileInput.value = '';
  });
}

function setupURLInput() {
  loadUrlBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) return;
    await handleURLLoad(url);
  });

  urlInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter') await handleURLLoad(urlInput.value.trim());
  });
}

async function handleFileLoad(file) {
  try {
    const { img, width, height, name } = await loadFromFile(file);
    await applyImage(img, width, height, name);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleURLLoad(url) {
  if (!url) return;
  try {
    loadUrlBtn.disabled = true;
    loadUrlBtn.textContent = '…';
    const { img, width, height, name } = await loadFromURL(url);
    await applyImage(img, width, height, name);
    urlInput.value = '';
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    loadUrlBtn.disabled  = false;
    loadUrlBtn.textContent = '→';
  }
}

async function applyImage(img, width, height, name) {
  state.originalImg = img;
  setOriginalImage(img);

  // Cap processing resolution to balance quality vs. speed (K-means + marching squares)
  const MAX_PROCESSING_DIM = 1200;
  const { imageData, scale } = imageToData(img, MAX_PROCESSING_DIM);
  state.imageData = imageData;
  state.layers    = [];

  resizeCanvas(width, height);

  // Draw original on canvas
  const ctx = mainCanvas.getContext('2d');
  mainCanvas.width  = width;
  mainCanvas.height = height;
  ctx.drawImage(img, 0, 0);

  // Show image info
  imageInfo.innerHTML =
    `📐 ${width} × ${height} px` +
    (scale < 1 ? `<br>🔽 Processing at ${imageData.width}×${imageData.height} px` : '') +
    `<br>📄 ${name}`;
  imageInfo.classList.add('visible');

  generateBtn.disabled = false;
  setExportEnabled(false);
  setStatus('Image loaded — click Generate to create layers');
  toast('Image loaded', 'success', 2000);
}

// ---- Layer generation ----

function setupGenerateBtn() {
  generateBtn.addEventListener('click', async () => {
    if (!state.imageData || state.processing) return;
    await generateLayers();
  });
}

async function generateLayers() {
  state.processing = true;
  generateBtn.disabled = true;
  generateBtn.textContent = '⏳ Processing…';

  const settings = {
    layerCount:       parseInt(layerCount.value, 10) || 4,
    segmentationMode: segMode.value,
    smoothing:        parseInt(smoothing.value, 10),
    simplify:         parseFloat(simplify.value),
    autoFix:          autoFixToggle.checked,
    bridgeThickness:  parseInt(bridgeThick.value, 10) || 4,
  };

  try {
    const layers = await runPipeline(
      state.imageData,
      settings,
      (step, total, msg) => {
        setProgress(step, total);
        setStatus(msg ?? `Step ${step}/${total}`);
      }
    );

    state.layers = layers;
    renderLayerPanel(layers);

    // Resize canvas to match processing resolution
    resizeCanvas(state.imageData.width, state.imageData.height);
    redraw();

    setExportEnabled(true);
    setStatus(`${layers.length} layers generated`);
    toast(`${layers.length} layers generated`, 'success');

  } catch (err) {
    console.error(err);
    toast('Generation failed: ' + err.message, 'error');
    setStatus('Generation failed');
  } finally {
    state.processing = false;
    generateBtn.disabled = false;
    generateBtn.textContent = '⚡ Generate Layers';
    setProgress(7, 7); // complete
  }
}

// ---- View tabs ----

function setupViewTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      setViewMode(btn.dataset.view);
    });
  });
}

// ---- Zoom controls ----

function setupZoomControls() {
  $('btn-zoom-in') .addEventListener('click', () => setZoom(getZoom() * 1.25));
  $('btn-zoom-out').addEventListener('click', () => setZoom(getZoom() * 0.8));
  $('btn-zoom-fit').addEventListener('click', () => {
    setZoom(1);
    const vp = document.getElementById('canvas-viewport');
    if (vp) vp.style.translate = '0px 0px';
  });
}

// ---- Export ----

function setupExportButtons() {
  btnSVG.addEventListener('click', () => {
    if (!state.layers.length) return;
    exportSVG(state.layers, getExportOpts());
    toast('SVG exported', 'success', 2000);
  });

  btnPDF.addEventListener('click', () => {
    if (!state.layers.length) return;
    exportPDF(state.layers, getExportOpts());
    toast('PDF exported', 'success', 2000);
  });

  btnPNG.addEventListener('click', () => {
    if (!state.layers.length) return;
    exportPNG(state.layers, { ...getExportOpts(), background: 'white' });
    toast('PNG exported', 'success', 2000);
  });

  btnAll.addEventListener('click', () => {
    if (!state.layers.length) return;
    exportAll(state.layers, getExportOpts());
    toast('All formats exported', 'success', 2500);
  });

  btnOptions.addEventListener('click', () => {
    if (!state.layers.length) return;
    openExportModal();
  });
}

function getExportOpts() {
  return {
    includeRegMarks:  regMarks.checked,
    includeColorFill: true,
    bwMode:           false,
    width:  state.imageData?.width,
    height: state.imageData?.height,
  };
}

function setExportEnabled(enabled) {
  [btnSVG, btnPDF, btnPNG, btnAll, btnOptions].forEach(b => {
    b.disabled = !enabled;
  });
}

// ---- Export modal ----

function openExportModal() {
  modalOverlay.classList.add('open');
  $('modal-ok').focus();
}

function setupModal() {
  modalCancel.addEventListener('click', () => modalOverlay.classList.remove('open'));
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) modalOverlay.classList.remove('open');
  });

  modalOk.addEventListener('click', () => {
    const format    = $('export-format').value;
    const dpi       = parseInt($('export-dpi').value, 10) || 300;
    const layerSel  = $('export-layers').value;
    const regM      = $('opt-reg-marks').checked;
    const colorFill = $('opt-color-fill').checked;
    const bw        = $('opt-bw').checked;
    const transp    = $('opt-transparent').checked;

    let layers = state.layers;
    if (layerSel === 'visible')  layers = layers.filter(l => l.visible);
    if (layerSel === 'selected') {
      const card = document.querySelector('.layer-card.selected');
      const idx  = card ? [...document.querySelectorAll('.layer-card')].indexOf(card) : 0;
      layers = [layers[idx]].filter(Boolean);
    }

    const opts = {
      dpi,
      includeRegMarks:  regM,
      includeColorFill: colorFill,
      bwMode:           bw,
      background:       transp ? 'transparent' : 'white',
      width:  state.imageData?.width,
      height: state.imageData?.height,
    };

    switch (format) {
      case 'svg': exportSVG(layers, opts); break;
      case 'pdf': exportPDF(layers, opts); break;
      case 'png': exportPNG(layers, opts); break;
      case 'eps': exportEPS(layers, opts); break;
    }

    modalOverlay.classList.remove('open');
    toast(`Exported as ${format.toUpperCase()}`, 'success', 2500);
  });
}

// ---- About modal ----

function setupAboutModal() {
  btnAbout.addEventListener('click', () => {
    aboutOverlay.style.display = 'flex';
    aboutClose.focus();
  });

  aboutClose.addEventListener('click', () => {
    aboutOverlay.style.display = 'none';
  });

  aboutOverlay.addEventListener('click', e => {
    if (e.target === aboutOverlay) aboutOverlay.style.display = 'none';
  });
}

// ---- Layer list events (bubbled from layer cards) ----

function setupLayerListEvents() {
  $('layers-list').addEventListener('layer-export', e => {
    const { layer } = e.detail;
    if (!layer) return;
    exportSVG([layer], getExportOpts());
    toast(`${layer.name} exported as SVG`, 'success', 2000);
  });
}

// ---- Keyboard shortcuts ----

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.closest('input, select, textarea, [contenteditable]')) return;

    switch (e.key) {
      case 'g': case 'G':
        if (!generateBtn.disabled) generateBtn.click();
        break;
      case '+': case '=':
        setZoom(getZoom() * 1.25);
        break;
      case '-':
        setZoom(getZoom() * 0.8);
        break;
      case '0':
        setZoom(1);
        break;
      case 'Escape':
        modalOverlay.classList.remove('open');
        aboutOverlay.style.display = 'none';
        break;
    }
  });
}
