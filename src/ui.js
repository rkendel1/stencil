/**
 * ui.js
 * UI management: layer panel, canvas rendering, controls.
 */

import { updateLayerColor } from './pipeline.js';

// ---- Canvas rendering state ----
let _canvasEl    = null;
let _ctx         = null;
let _layers      = [];
let _viewMode    = 'composite'; // 'composite' | 'original' | 'vector'
let _originalImg = null;        // HTMLImageElement | null
let _zoom        = 1;
let _panX        = 0;
let _panY        = 0;
let _selectedIdx = -1;

const viewport  = () => document.getElementById('canvas-viewport');
const emptyState = () => document.getElementById('empty-state');

// ---- Init ----

/**
 * Initialise the UI manager.
 * @param {HTMLCanvasElement} canvasEl
 */
export function initUI(canvasEl) {
  _canvasEl = canvasEl;
  _ctx      = canvasEl.getContext('2d');
  setupCanvasPan();
}

// ---- Layers panel ----

/**
 * Render the layers panel from a list of Layer objects.
 * @param {import('./pipeline.js').Layer[]} layers
 */
export function renderLayerPanel(layers) {
  _layers = layers;
  const list = document.getElementById('layers-list');
  list.innerHTML = '';

  if (!layers.length) {
    const emptyMsg = document.createElement('p');
    emptyMsg.id = 'layers-empty-msg';
    emptyMsg.setAttribute('aria-live', 'polite');
    emptyMsg.style.cssText = 'text-align:center;color:var(--text-dim);font-size:11px;padding:24px 8px;line-height:1.6;';
    emptyMsg.textContent = 'No layers yet — upload an image and click Generate';
    list.appendChild(emptyMsg);
    return;
  }

  // Show AI quality score banner if available
  const fidelityScore = layers[0]?.metadata?.fidelityScore ?? null;
  const aiEval = layers[0]?.metadata?.aiEvaluation;
  const refinementPasses = layers[0]?.metadata?.refinementPasses ?? null;
  if (fidelityScore !== null && aiEval) {
    const banner = buildAIScoreBanner(fidelityScore, aiEval, refinementPasses);
    list.appendChild(banner);
  }

  layers.forEach((layer, idx) => {
    const card = buildLayerCard(layer, idx);
    list.appendChild(card);
  });
}

/**
 * Build an AI quality score banner for the top of the layers panel.
 */
function buildAIScoreBanner(score, evaluation, refinementPasses) {
  const banner = document.createElement('div');
  const quality = evaluation.overall_quality ?? 'unknown';
  const color = score >= 80 ? 'var(--accent-green, #27ae60)'
    : score >= 60 ? 'var(--accent-yellow, #f5a623)'
    : 'var(--warn-color, #e67e22)';

  banner.style.cssText = `
    display:flex; align-items:center; gap:8px; padding:8px 10px;
    margin-bottom:6px; border-radius:6px;
    background:color-mix(in srgb, ${color} 15%, transparent);
    border:1px solid color-mix(in srgb, ${color} 40%, transparent);
    font-size:11px; color:var(--text-main);
  `;

  const scoreEl = document.createElement('span');
  scoreEl.style.cssText = `font-size:18px; font-weight:700; color:${color};`;
  scoreEl.textContent = score;

  const passNote = refinementPasses && refinementPasses > 1
    ? ` · ${refinementPasses} AI passes`
    : '';

  const label = document.createElement('div');
  label.style.cssText = 'flex:1; line-height:1.4;';
  label.innerHTML = `<strong>AI Quality Score</strong><br>
    <span style="color:var(--text-dim)">
      ${quality.charAt(0).toUpperCase() + quality.slice(1)} · 
      ${evaluation.airbrush_ready ? '✓ Airbrush ready' : '⚠ Needs attention'}${passNote}
    </span>`;

  banner.append(scoreEl, document.createTextNode('/100'), label);
  return banner;
}


/**
 * Build the DOM element for a layer card.
 */
function buildLayerCard(layer, idx) {
  const card = document.createElement('div');
  card.className = 'layer-card' + (idx === _selectedIdx ? ' selected' : '') +
                   (layer.visible ? '' : ' hidden-layer');
  card.setAttribute('role', 'listitem');
  card.setAttribute('aria-label', `${layer.name}, ${layer.visible ? 'visible' : 'hidden'}`);

  // --- Thumbnail ---
  const thumbCanvas = document.createElement('canvas');
  const thumbSize   = 36;
  thumbCanvas.width  = thumbSize;
  thumbCanvas.height = thumbSize;
  thumbCanvas.className = 'layer-thumb';
  thumbCanvas.setAttribute('aria-hidden', 'true');

  const tc = thumbCanvas.getContext('2d');
  const offscreen = document.createElement('canvas');
  offscreen.width  = layer.metadata.width;
  offscreen.height = layer.metadata.height;
  offscreen.getContext('2d').putImageData(layer.previewBitmap, 0, 0);

  tc.fillStyle = '#ffffff';
  tc.fillRect(0, 0, thumbSize, thumbSize);
  tc.drawImage(offscreen, 0, 0, thumbSize, thumbSize);

  // --- Info ---
  const info = document.createElement('div');
  info.className = 'layer-info';

  const name = document.createElement('div');
  name.className = 'layer-name';
  name.textContent = layer.name;
  name.contentEditable = 'true';
  name.setAttribute('aria-label', 'Layer name');
  name.addEventListener('input', () => { layer.name = name.textContent; });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });

  const meta = document.createElement('div');
  meta.className = 'layer-meta';
  const px = layer.metadata.pixelCount ?? 0;
  // Filter out AI-quality notes from warning count (they're informational, not problems)
  const realWarnings = (layer.warnings ?? []).filter(
    w => !w.startsWith('AI quality score:') && !w.startsWith('Tip:')
  );
  meta.textContent = `${formatNum(px)} px · ${realWarnings.length ? `⚠ ${realWarnings.length} warn` : '✓ ok'}`;

  info.append(name, meta);

  // --- Actions ---
  const actions = document.createElement('div');
  actions.className = 'layer-actions';

  // Visibility toggle — use reliable unicode symbols instead of emoji
  const visBtn = makeBtn(layer.visible ? '◉' : '○', 'Toggle visibility', layer.visible ? 'active' : '');
  visBtn.addEventListener('click', e => {
    e.stopPropagation();
    layer.visible = !layer.visible;
    card.classList.toggle('hidden-layer', !layer.visible);
    visBtn.textContent = layer.visible ? '◉' : '○';
    visBtn.setAttribute('aria-label', layer.visible ? 'Hide layer' : 'Show layer');
    visBtn.classList.toggle('active', layer.visible);
    redraw();
  });

  // Color swatch
  const swatch = document.createElement('div');
  swatch.className    = 'color-swatch';
  swatch.style.background = layer.color;
  swatch.setAttribute('role', 'button');
  swatch.setAttribute('tabindex', '0');
  swatch.setAttribute('aria-label', `Layer color: ${layer.color}`);

  const colorPicker = document.createElement('input');
  colorPicker.type  = 'color';
  colorPicker.value = layer.color;
  colorPicker.style.cssText = 'position:absolute;opacity:0;width:0;height:0;';
  colorPicker.addEventListener('input', () => {
    const newColor = colorPicker.value;
    swatch.style.background = newColor;
    updateLayerColor(layer, newColor);
    renderLayerPanel(_layers);
    redraw();
  });

  swatch.addEventListener('click', () => colorPicker.click());
  swatch.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') colorPicker.click(); });

  // Export btn
  const expBtn = makeBtn('↓', 'Export this layer');
  expBtn.addEventListener('click', e => {
    e.stopPropagation();
    card.dispatchEvent(new CustomEvent('layer-export', { detail: { layer }, bubbles: true }));
  });

  actions.append(visBtn, swatch, colorPicker, expBtn);

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'layer-card-header';
  header.append(thumbCanvas, info, actions);

  // --- Controls (expanded when selected) ---
  const controls = document.createElement('div');
  controls.className = 'layer-controls';

  // Opacity
  const opRow = document.createElement('div');
  opRow.className = 'ctrl-row';
  const opLabel = document.createElement('label');
  opLabel.textContent = 'Opacity';
  opLabel.setAttribute('for', `opacity-${layer.id}`);
  const opSlider = document.createElement('input');
  opSlider.type  = 'range';
  opSlider.id    = `opacity-${layer.id}`;
  opSlider.min   = '0'; opSlider.max = '1'; opSlider.step = '0.05';
  opSlider.value = String(layer.opacity ?? 1);
  opSlider.setAttribute('aria-label', 'Layer opacity');
  const opVal = document.createElement('span');
  opVal.className = 'ctrl-val';
  opVal.textContent = Math.round((layer.opacity ?? 1) * 100) + '%';
  opSlider.addEventListener('input', () => {
    layer.opacity = parseFloat(opSlider.value);
    opVal.textContent = Math.round(layer.opacity * 100) + '%';
    redraw();
  });
  opRow.append(opLabel, opSlider, opVal);
  controls.append(opRow);

  // --- Warnings ---
  let warningsEl = null;
  if (layer.warnings?.length) {
    warningsEl = document.createElement('div');
    warningsEl.className = 'layer-warnings';
    for (const w of layer.warnings) {
      const d = document.createElement('div');
      // AI quality notes get a distinct style
      if (w.startsWith('AI quality score:')) {
        d.className = 'warn-item warn-info';
        d.textContent = '🤖 ' + w;
      } else if (w.startsWith('Tip:')) {
        d.className = 'warn-item warn-tip';
        d.textContent = '💡 ' + w.slice(4).trim();
      } else {
        d.className = 'warn-item';
        d.textContent = w;
      }
      warningsEl.appendChild(d);
    }
  }

  // Assemble card
  card.append(header, controls);
  if (warningsEl) card.append(warningsEl);

  // Select on click
  card.addEventListener('click', () => {
    _selectedIdx = idx;
    document.querySelectorAll('.layer-card').forEach((c, i) => {
      c.classList.toggle('selected', i === idx);
    });
  });

  return card;
}

function makeBtn(text, ariaLabel, extraClass = '') {
  const btn = document.createElement('button');
  btn.className = 'layer-btn' + (extraClass ? ' ' + extraClass : '');
  btn.textContent = text;
  btn.type = 'button';
  btn.setAttribute('aria-label', ariaLabel);
  return btn;
}

// ---- Canvas drawing ----

/**
 * Set the original image for the canvas.
 * @param {HTMLImageElement} img
 */
export function setOriginalImage(img) {
  _originalImg = img;
}

/**
 * Set the view mode and redraw.
 * @param {'composite'|'original'|'vector'} mode
 */
export function setViewMode(mode) {
  _viewMode = mode;
  redraw();
}

/**
 * Redraw the main canvas.
 */
export function redraw() {
  if (!_canvasEl) return;
  const ctx = _ctx;
  const w   = _canvasEl.width;
  const h   = _canvasEl.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  if (_viewMode === 'original' && _originalImg) {
    ctx.drawImage(_originalImg, 0, 0, w, h);
    return;
  }

  if (!_layers.length) return;

  if (_viewMode === 'vector') {
    drawVectorPreview(ctx, w, h);
  } else {
    drawComposite(ctx, w, h);
  }
}

function drawComposite(ctx, w, h) {
  for (const layer of _layers) {
    if (!layer.visible) continue;
    const offscreen = document.createElement('canvas');
    offscreen.width  = w;
    offscreen.height = h;
    const oc = offscreen.getContext('2d');

    // Scale the preview bitmap to canvas size
    const tmp = document.createElement('canvas');
    tmp.width  = layer.metadata.width;
    tmp.height = layer.metadata.height;
    tmp.getContext('2d').putImageData(layer.previewBitmap, 0, 0);
    oc.drawImage(tmp, 0, 0, w, h);

    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(offscreen, 0, 0);
  }
  ctx.globalAlpha = 1;
}

function drawVectorPreview(ctx, w, h) {
  for (const layer of _layers) {
    if (!layer.visible || !layer.pathData) continue;

    const scaleX = w / (layer.metadata.width  || w);
    const scaleY = h / (layer.metadata.height || h);

    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.fillStyle   = layer.color;
    ctx.strokeStyle = layer.color;
    ctx.lineWidth   = 0.5;

    const path = new Path2D(layer.pathData);
    ctx.fill(path);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/**
 * Resize the canvas to match the image and redraw.
 * @param {number} imgWidth
 * @param {number} imgHeight
 */
export function resizeCanvas(imgWidth, imgHeight) {
  if (!_canvasEl) return;

  const wrapperEl = document.getElementById('canvas-wrapper');
  const maxW = wrapperEl.clientWidth  - 32;
  const maxH = wrapperEl.clientHeight - 32;

  const scale = Math.min(1, maxW / imgWidth, maxH / imgHeight);
  const dispW = Math.round(imgWidth  * scale);
  const dispH = Math.round(imgHeight * scale);

  _canvasEl.width  = imgWidth;
  _canvasEl.height = imgHeight;
  _canvasEl.style.width  = `${dispW}px`;
  _canvasEl.style.height = `${dispH}px`;

  emptyState().style.display = 'none';

  redraw();
}

// ---- Zoom ----

export function setZoom(z) {
  _zoom = Math.max(0.1, Math.min(8, z));
  const vp = viewport();
  if (vp) vp.style.transform = `scale(${_zoom})`;
  const label = document.getElementById('zoom-label');
  if (label) label.textContent = Math.round(_zoom * 100) + '%';
}

export function getZoom() { return _zoom; }

// ---- Pan ----

function setupCanvasPan() {
  const wrapper = document.getElementById('canvas-wrapper');
  if (!wrapper) return;

  // --- Mouse pan ---
  let dragging = false;
  let startX = 0, startY = 0, startPX = 0, startPY = 0;

  wrapper.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true;
    startX   = e.clientX;
    startY   = e.clientY;
    startPX  = _panX;
    startPY  = _panY;
    wrapper.classList.add('grabbing');
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    _panX = startPX + (e.clientX - startX);
    _panY = startPY + (e.clientY - startY);
    const vp = viewport();
    if (vp) vp.style.translate = `${_panX}px ${_panY}px`;
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    wrapper.classList.remove('grabbing');
  });

  // Wheel zoom
  wrapper.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(_zoom * delta);
  }, { passive: false });

  // --- Touch pan + pinch-to-zoom ---
  let touchStartPX = 0, touchStartPY = 0;
  let lastTouchDist = 0;
  let inPinch = false;

  /** Return the distance between two Touch objects. */
  function getTouchDist(t0, t1) {
    return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
  }

  wrapper.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      inPinch      = false;
      lastTouchDist = 0;
      startX       = e.touches[0].clientX;
      startY       = e.touches[0].clientY;
      touchStartPX = _panX;
      touchStartPY = _panY;
    } else if (e.touches.length === 2) {
      inPinch = true;
      lastTouchDist = getTouchDist(e.touches[0], e.touches[1]);
    }
  }, { passive: false });

  wrapper.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && !inPinch) {
      _panX = touchStartPX + (e.touches[0].clientX - startX);
      _panY = touchStartPY + (e.touches[0].clientY - startY);
      const vp = viewport();
      if (vp) vp.style.translate = `${_panX}px ${_panY}px`;
    } else if (e.touches.length === 2) {
      inPinch = true;
      const dist = getTouchDist(e.touches[0], e.touches[1]);
      if (lastTouchDist > 0) {
        setZoom(_zoom * (dist / lastTouchDist));
      }
      lastTouchDist = dist;
    }
  }, { passive: false });

  wrapper.addEventListener('touchend', e => {
    if (e.touches.length === 0) {
      inPinch       = false;
      lastTouchDist = 0;
    } else if (e.touches.length === 1) {
      // One finger left after pinch — reset pan origin so there's no jump
      inPinch      = false;
      lastTouchDist = 0;
      startX       = e.touches[0].clientX;
      startY       = e.touches[0].clientY;
      touchStartPX = _panX;
      touchStartPY = _panY;
    }
  }, { passive: false });
}

// ---- Toast notifications ----

/**
 * Show a toast notification.
 * @param {string}  message
 * @param {'success'|'error'|'warn'|''} type
 * @param {number}  duration  - ms
 */
export function toast(message, type = '', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className   = 'toast' + (type ? ` ${type}` : '');
  el.textContent = message;
  el.setAttribute('role', 'status');
  container.appendChild(el);

  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity    = '0';
    setTimeout(() => el.remove(), 350);
  }, duration);
}

// ---- Progress bar ----

export function setProgress(step, total) {
  const bar  = document.getElementById('progress-bar');
  const fill = document.getElementById('progress-fill');
  if (!bar || !fill) return;

  const pct = Math.round((step / total) * 100);
  bar.classList.add('visible');
  fill.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', pct);

  if (pct >= 100) {
    setTimeout(() => {
      bar.classList.remove('visible');
      fill.style.width = '0%';
    }, 600);
  }
}

// ---- Footer status ----

export function setStatus(text) {
  const el = document.getElementById('footer-status');
  if (el) el.textContent = text;
}

// ---- Helpers ----

function formatNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0)     + 'K';
  return String(n);
}
