/**
 * pipeline.js
 * Orchestrates the full stencil generation pipeline.
 *
 * Flow:
 *   imageData → grayscale → clustering → masks → validation → vectorization → Layer[]
 */

import { toGrayscale, applySmoothing } from './imageLoader.js';
import { kmeans, posterize, adaptiveThreshold } from './kmeans.js';
import { vectorize } from './vectorizer.js';
import { validateMask, autoFix } from './validator.js';

// Palette of default layer colors
const DEFAULT_COLORS = [
  '#1a1a2e', '#e94560', '#0f3460', '#533483',
  '#f5a623', '#4ecdc4', '#2c3e50', '#e74c3c',
  '#27ae60', '#8e44ad', '#16a085', '#d35400',
];

/**
 * @typedef {Object} Layer
 * @property {string}     id
 * @property {string}     name
 * @property {string}     pathData       - SVG path data string
 * @property {Array}      contours       - simplified contour arrays
 * @property {string}     color          - hex color for preview
 * @property {number}     opacity        - 0–1
 * @property {boolean}    visible
 * @property {Uint8Array} mask           - binary mask (processing resolution)
 * @property {ImageData}  previewBitmap  - thumbnail ImageData
 * @property {string[]}   warnings
 * @property {object}     metadata
 */

/**
 * Run the full stencil generation pipeline.
 *
 * @param {ImageData}  imageData        - original or pre-processed image
 * @param {object}     settings
 * @param {number}     settings.layerCount
 * @param {'kmeans'|'threshold'|'posterize'} settings.segmentationMode
 * @param {number}     settings.smoothing        - 0–5 blur radius
 * @param {number}     settings.simplify         - Douglas-Peucker epsilon
 * @param {boolean}    settings.autoFix
 * @param {number}     settings.bridgeThickness
 * @param {Function}   [onProgress]      - called with (step, total)
 * @returns {Promise<Layer[]>}
 */
export async function runPipeline(imageData, settings, onProgress) {
  const {
    layerCount       = 4,
    segmentationMode = 'kmeans',
    smoothing        = 1,
    simplify         = 1.0,
    autoFix: doAutoFix    = true,
    bridgeThickness  = 4,
  } = settings;

  const k = Math.max(2, Math.min(12, layerCount));

  // ---- Step 1: Preprocess ----
  onProgress?.(1, 6, 'Preprocessing image…');
  await tick();

  const smoothed = applySmoothing(imageData, smoothing);
  const gray = toGrayscale(smoothed);
  const { width, height } = imageData;

  // ---- Step 2: Cluster / Segment ----
  onProgress?.(2, 6, 'Segmenting layers…');
  await tick();

  // Subsample for K-Means if image is large (keeps it fast)
  let graySample = gray;
  const MAX_SAMPLE = 80_000;
  let sampleStep = 1;

  if (gray.length > MAX_SAMPLE && segmentationMode === 'kmeans') {
    sampleStep = Math.ceil(gray.length / MAX_SAMPLE);
    const sampled = new Float32Array(Math.ceil(gray.length / sampleStep));
    for (let i = 0; i < sampled.length; i++) sampled[i] = gray[i * sampleStep];
    graySample = sampled;
  }

  let result = null;
  switch (segmentationMode) {
    case 'threshold':
      result = adaptiveThreshold(graySample, k);
      break;
    case 'posterize':
      result = posterize(graySample, k);
      break;
    case 'kmeans':
    default:
      result = kmeans(graySample, k);
      break;
  }

  // If we used a sample, re-assign all pixels using final centroids
  let assignments;
  if (sampleStep > 1) {
    assignments = new Int32Array(gray.length);
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i];
      let bestC = 0, bestD = Math.abs(v - result.centroids[0]);
      for (let c = 1; c < k; c++) {
        const d = Math.abs(v - result.centroids[c]);
        if (d < bestD) { bestD = d; bestC = c; }
      }
      assignments[i] = bestC;
    }
  } else {
    assignments = result.assignments;
  }

  // ---- Step 3: Build masks ----
  onProgress?.(3, 6, 'Building masks…');
  await tick();

  const masks = Array.from({ length: k }, () => new Uint8Array(width * height));
  for (let i = 0; i < assignments.length; i++) {
    masks[assignments[i]][i] = 1;
  }

  // ---- Step 4: Validate + Auto-fix ----
  onProgress?.(4, 6, 'Validating structure…');
  await tick();

  const validations = masks.map(mask => {
    const v = validateMask(mask, width, height, 50);

    if (doAutoFix) {
      autoFix(mask, width, height, {
        minIslandArea: 16,
        bridgeWidth:   bridgeThickness,
      });
    }

    return v;
  });

  // ---- Step 5: Vectorize ----
  onProgress?.(5, 6, 'Vectorizing layers…');
  await tick();

  const epsilon = Math.max(0.1, simplify);

  const layers = masks.map((mask, idx) => {
    const { pathData, contours } = vectorize(mask, width, height, epsilon, 1);
    const color = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
    const preview = buildPreview(mask, width, height, color);

    return {
      id:            `layer-${idx}`,
      name:          `Layer ${idx + 1}`,
      pathData,
      contours,
      color,
      opacity:       1,
      visible:       true,
      mask,
      previewBitmap: preview,
      warnings:      validations[idx].warnings,
      metadata: {
        width,
        height,
        dpi:         72,
        algorithm:   segmentationMode,
        centroid:    result.centroids[idx],
        pixelCount:  mask.reduce((s, v) => s + v, 0),
      },
    };
  });

  // ---- Step 6: Done ----
  onProgress?.(6, 6, 'Complete');

  return layers;
}

/**
 * Build a small preview ImageData for a layer (mask + color tint).
 * @param {Uint8Array} mask
 * @param {number}     width
 * @param {number}     height
 * @param {string}     color  - hex color
 * @returns {ImageData}
 */
function buildPreview(mask, width, height, color) {
  const [r, g, b] = hexToRGB(color);
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      data[i * 4]     = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    } else {
      data[i * 4 + 3] = 0; // transparent
    }
  }

  return new ImageData(data, width, height);
}

/**
 * Rebuild a single layer's preview after a color change.
 * @param {Layer}  layer
 * @param {string} newColor
 */
export function updateLayerColor(layer, newColor) {
  layer.color = newColor;
  layer.previewBitmap = buildPreview(layer.mask, layer.metadata.width, layer.metadata.height, newColor);
}

/**
 * Parse a hex color to [r, g, b].
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRGB(hex) {
  const clean = hex.replace('#', '');
  const val   = parseInt(clean, 16);
  return [(val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff];
}

/** Yield to browser between heavy steps */
function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
