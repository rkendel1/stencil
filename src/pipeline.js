/**
 * pipeline.js
 * Orchestrates the full stencil generation pipeline.
 *
 * Flow:
 *   imageData → grayscale → clustering → masks → validation → vectorization → Layer[]
 */

import { toGrayscale, applySmoothing, bilateralFilter, normalizeContrast, sharpenEdges } from './imageLoader.js';
import { kmeans, posterize, adaptiveThreshold, toBinaryMask } from './kmeans.js';
import { vectorize } from './vectorizer.js';
import { validateMask, autoFix, morphologicalClose } from './validator.js';

// Optional integrations (load asynchronously to avoid blocking)
let opencvIntegration = null;
let potraceIntegration = null;
let useOpenCV = false;
let usePotrace = false;

// Try to load OpenCV.js integration
(async () => {
  try {
    opencvIntegration = await import('./opencvIntegration.js');
    useOpenCV = await opencvIntegration.initOpenCV();
    if (useOpenCV) {
      console.log('✅ OpenCV.js integration enabled');
    }
  } catch (e) {
    console.log('ℹ️ OpenCV.js not available, using custom implementations');
  }
})();

// Try to load Potrace integration
(async () => {
  try {
    potraceIntegration = await import('./potraceIntegration.js');
    usePotrace = true;
    console.log('✅ Potrace integration enabled');
  } catch (e) {
    console.log('ℹ️ Potrace not available, using marching squares');
  }
})();

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

  // ---- Step 1: Enhanced Preprocessing ----
  onProgress?.(1, 7, 'Preprocessing image…');
  await tick();

  // Apply edge-preserving noise reduction
  const denoised = smoothing > 0 
    ? bilateralFilter(imageData, Math.min(smoothing + 2, 5), 0.1)
    : imageData;
  
  // Sharpen edges for better definition
  const sharpened = sharpenEdges(denoised, 0.5);
  
  // Convert to grayscale
  let gray = toGrayscale(sharpened);
  
  // Normalize contrast to maximize dynamic range
  gray = normalizeContrast(gray);
  
  const { width, height } = imageData;

  // ---- Step 2: Convert to Pure Black & White ----
  onProgress?.(2, 7, 'Converting to pure B&W…');
  await tick();
  
  // For stencil work, we need pure binary values (no gray)
  // Apply aggressive contrast to remove mid-tones
  for (let i = 0; i < gray.length; i++) {
    // Sigmoid curve to push values toward 0 or 1
    const v = gray[i];
    gray[i] = 1 / (1 + Math.exp(-12 * (v - 0.5)));
  }
  
  // ---- Step 3: Cluster / Segment ----
  onProgress?.(3, 7, 'Segmenting layers…');
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

  // ---- Step 4: Build masks ----
  onProgress?.(4, 7, 'Building clean binary masks…');
  await tick();

  const masks = Array.from({ length: k }, () => new Uint8Array(width * height));
  for (let i = 0; i < assignments.length; i++) {
    masks[assignments[i]][i] = 1;
  }
  
  // Clean up masks with morphological operations
  // Try OpenCV for faster performance, fallback to custom implementation
  for (let i = 0; i < k; i++) {
    if (useOpenCV && opencvIntegration) {
      try {
        masks[i] = opencvIntegration.morphologyEx(masks[i], width, height, 'close', 5);
        console.log(`Layer ${i + 1}: Using OpenCV morphological close`);
      } catch (error) {
        console.warn(`Layer ${i + 1}: OpenCV morph failed, using custom`, error);
        morphologicalClose(masks[i], width, height, 2);
      }
    } else {
      morphologicalClose(masks[i], width, height, 2);
    }
  }

  // ---- Step 5: Validate + Auto-fix ----
  onProgress?.(5, 7, 'Validating structure…');
  await tick();

  const validations = masks.map(mask => {
    const v = validateMask(mask, width, height, 50);

    if (doAutoFix) {
      // More aggressive cleanup for cleaner stencils
      autoFix(mask, width, height, {
        minIslandArea: 25, // Remove larger fragments
        bridgeWidth:   bridgeThickness,
      });
      
      // Apply morphological close again after fixing
      morphologicalClose(mask, width, height, 1);
    }

    return v;
  });

  // ---- Step 6: Vectorize ----
  onProgress?.(6, 7, 'Vectorizing layers…');
  await tick();

  const epsilon = Math.max(0.1, simplify);

  const layers = await Promise.all(masks.map(async (mask, idx) => {
    let pathData, contours;
    
    // Try Potrace for better quality, fallback to marching squares
    if (usePotrace && potraceIntegration) {
      try {
        pathData = await potraceIntegration.traceMaskWithPotrace(mask, width, height, {
          turdSize: 2,
          alphaMax: 1.0,
          optTolerance: epsilon * 0.2
        });
        contours = []; // Potrace provides path data directly
        console.log(`Layer ${idx + 1}: Using Potrace vectorization`);
      } catch (error) {
        console.warn(`Layer ${idx + 1}: Potrace failed, using marching squares`, error);
        const result = vectorize(mask, width, height, epsilon, 1);
        pathData = result.pathData;
        contours = result.contours;
      }
    } else {
      const result = vectorize(mask, width, height, epsilon, 1);
      pathData = result.pathData;
      contours = result.contours;
    }
    
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
        vectorizer:  (usePotrace && potraceIntegration) ? 'potrace' : 'marching-squares',
      },
    };
  }));

  // ---- Step 7: Done ----
  onProgress?.(7, 7, 'Complete');

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
