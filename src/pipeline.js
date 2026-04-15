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
import { assembleShadedComposite, imageDataToBase64, generateLayerPreviews, getLayerShades } from './compositeAssembler.js';
import { evaluateComposite, applyAICorrections, assessImageForSettings } from './aiEvaluation.js';

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
 * @param {boolean}    settings.enableAI         - enable AI evaluation (default: true)
 * @param {ImageData}  originalImageData         - original unprocessed image for AI comparison
 * @param {number}     settings.minIslandArea     - minimum fragment area to keep (0 = auto-scale)
 * @param {Function}   [onProgress]      - called with (step, total, message)
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
    enableAI         = true,
    originalImageData = null,
    minIslandArea    = 0,    // 0 = auto-scale based on image size
  } = settings;

  const k = Math.max(2, Math.min(12, layerCount));

  // Auto-scale minIslandArea based on image resolution to reduce micro-fragments.
  // For a 1200×1200 image this yields ~288px; for smaller images it's still >= 50px.
  const imageArea = imageData.width * imageData.height;
  const effectiveMinArea = minIslandArea > 0
    ? minIslandArea
    : Math.max(50, Math.floor(imageArea * 0.0002));

  // AI pre-assessment adds step 0; AI evaluation adds steps 8-9
  const totalSteps = enableAI ? 10 : 7;

  // ---- Step 0: AI Pre-Assessment (suggest optimal settings) ----
  let aiSuggestedSettings = null;
  if (enableAI && originalImageData) {
    onProgress?.(0, totalSteps, 'AI assessing image…');
    await tick();

    try {
      const originalBase64 = await imageDataToBase64(originalImageData);
      aiSuggestedSettings = await assessImageForSettings(
        originalBase64,
        originalImageData.width,
        originalImageData.height,
      );

      if (aiSuggestedSettings) {
        console.log('AI suggested settings:', aiSuggestedSettings);
      }
    } catch (e) {
      console.warn('AI pre-assessment skipped:', e);
    }
  }

  // Merge AI-suggested settings over defaults (user explicit settings always win
  // unless they're at their defaults, which we detect by comparing to the raw input).
  const resolvedSmoothing  = (settings.smoothing  !== undefined)
    ? settings.smoothing
    : (aiSuggestedSettings?.smoothing ?? smoothing);
  const resolvedSimplify   = (settings.simplify   !== undefined)
    ? settings.simplify
    : (aiSuggestedSettings?.simplify  ?? simplify);
  const resolvedMinIsland  = minIslandArea > 0
    ? minIslandArea
    : (aiSuggestedSettings?.minIslandArea ?? effectiveMinArea);
  const resolvedLayerCount = Math.max(2, Math.min(12,
    (settings.layerCount !== undefined)
      ? settings.layerCount
      : (aiSuggestedSettings?.layerCount ?? layerCount)
  ));
  const resolvedSegMode    = (settings.segmentationMode !== undefined)
    ? settings.segmentationMode
    : (aiSuggestedSettings?.segmentationMode ?? segmentationMode);
  const resolvedBridge     = (settings.bridgeThickness !== undefined)
    ? settings.bridgeThickness
    : (aiSuggestedSettings?.bridgeThickness ?? bridgeThickness);

  return _runPipelineCore(imageData, {
    layerCount:       resolvedLayerCount,
    segmentationMode: resolvedSegMode,
    smoothing:        resolvedSmoothing,
    simplify:         resolvedSimplify,
    doAutoFix,
    bridgeThickness:  resolvedBridge,
    enableAI,
    originalImageData,
    effectiveMinArea: resolvedMinIsland,
    aiSuggestedSettings,
  }, onProgress, totalSteps);
}

/**
 * Internal pipeline core.  Called by runPipeline (and by the iterative-refine loop).
 */
async function _runPipelineCore(imageData, opts, onProgress, totalSteps) {
  const {
    layerCount,
    segmentationMode,
    smoothing,
    simplify,
    doAutoFix,
    bridgeThickness,
    enableAI,
    originalImageData,
    effectiveMinArea,
    aiSuggestedSettings,
  } = opts;

  const k = Math.max(2, Math.min(12, layerCount));

  // ---- Step 1: Enhanced Preprocessing ----
  onProgress?.(1, totalSteps, 'Preprocessing image…');
  await tick();

  // Apply edge-preserving noise reduction
  // rangeSigma=0.15 gives better smoothing within skin/flat regions while preserving sharp edges
  const denoised = smoothing > 0 
    ? bilateralFilter(imageData, Math.min(smoothing + 2, 5), 0.15)
    : imageData;
  
  // Sharpen edges for crisper stencil cut lines
  const sharpened = sharpenEdges(denoised, 0.8);
  
  // Convert to grayscale
  let gray = toGrayscale(sharpened);
  
  // Normalize contrast to maximize dynamic range
  gray = normalizeContrast(gray);
  
  const { width, height } = imageData;

  // ---- Step 2: Tonal Contrast Enhancement ----
  onProgress?.(2, totalSteps, 'Enhancing tonal contrast…');
  await tick();
  
  // Apply a gentle S-curve (slope=3) to boost mid-tone separation without collapsing
  // the tonal gradation. This preserves distinct lightness zones needed for multi-layer
  // airbrush stencils while still increasing contrast between adjacent tones.
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    gray[i] = 1 / (1 + Math.exp(-3 * (v - 0.5)));
  }
  
  // ---- Step 3: Cluster / Segment ----
  onProgress?.(3, totalSteps, 'Segmenting layers…');
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
  onProgress?.(4, totalSteps, 'Building clean binary masks…');
  await tick();

  const masks = Array.from({ length: k }, () => new Uint8Array(width * height));
  for (let i = 0; i < assignments.length; i++) {
    masks[assignments[i]][i] = 1;
  }
  
  // Clean up masks with morphological operations
  // Radius 1 avoids over-merging nearby features (e.g. eyes, nostrils in portraits)
  for (let i = 0; i < k; i++) {
    morphologicalClose(masks[i], width, height, 1);
  }

  // ---- Step 5: Validate + Auto-fix ----
  onProgress?.(5, totalSteps, 'Validating and fixing layers…');
  await tick();

  const validations = masks.map(mask => {
    if (doAutoFix) {
      // Remove small fragments that would be too small to cut cleanly.
      // Use effectiveMinArea (auto-scaled to image size) so noisy images
      // don't generate hundreds of micro-fragment warnings.
      autoFix(mask, width, height, {
        minIslandArea: effectiveMinArea,
        bridgeWidth:   bridgeThickness,
      });
      
      // Apply morphological close again after fixing
      morphologicalClose(mask, width, height, 1);
    }

    // Validate AFTER auto-fix so warnings reflect the actual cleaned-up state
    return validateMask(mask, width, height, effectiveMinArea);
  });

  // ---- Step 6: Vectorize ----
  onProgress?.(6, totalSteps, 'Vectorizing layers…');
  await tick();

  const epsilon = Math.max(0.1, simplify);

  const layers = await Promise.all(masks.map(async (mask, idx) => {
    const result = vectorize(mask, width, height, epsilon, 1);
    const { pathData, contours } = result;

    const pixelCount = mask.reduce((s, v) => s + v, 0);
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
        centroid:    result.centroids?.[idx],
        pixelCount,
        vectorizer:  'marching-squares',
        aiSettings:  aiSuggestedSettings ?? null,
      },
    };
  }));

  // Sort layers for proper airbrush buildup: broadest/base layer first (largest pixel area),
  // then progressively smaller/more-detailed layers. This matches the stencil spray sequence
  // where you lay down the base coat before adding detail.
  layers.sort((a, b) => b.metadata.pixelCount - a.metadata.pixelCount);

  // Re-assign sequential ids, names and colors after sorting
  layers.forEach((layer, idx) => {
    layer.id   = `layer-${idx}`;
    layer.name = `Layer ${idx + 1}`;
    layer.color = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
    layer.previewBitmap = buildPreview(layer.mask, layer.metadata.width, layer.metadata.height, layer.color);
  });

  // ---- Step 7: Assemble Shaded Composite ----
  if (enableAI) {
    onProgress?.(7, totalSteps, 'Assembling composite…');
    await tick();

    const composite = assembleShadedComposite(masks, width, height);
    const shades = getLayerShades(k);

    // ---- Step 8: AI Composite Evaluation ----
    onProgress?.(8, totalSteps, 'AI evaluating quality…');
    await tick();

    try {
      // Convert images to base64 for AI
      const compositeBase64 = await imageDataToBase64(composite);
      const layerPreviews = await generateLayerPreviews(masks, width, height);
      
      let originalBase64 = null;
      if (originalImageData) {
        originalBase64 = await imageDataToBase64(originalImageData);
      }

      // Call AI evaluation
      const evaluation = await evaluateComposite(
        originalBase64,
        compositeBase64,
        layerPreviews,
        shades
      );

      // Store evaluation results in metadata
      const fidelityScore = evaluation.fidelity_score ?? null;
      for (let i = 0; i < layers.length; i++) {
        layers[i].metadata.aiEvaluation = evaluation;
        layers[i].metadata.fidelityScore = fidelityScore;
        layers[i].metadata.shade = shades[i];
      }

      // ---- Step 9: Apply AI Corrections ----
      onProgress?.(9, totalSteps, 'Applying AI corrections…');
      await tick();

      const corrections = applyAICorrections(masks, width, height, evaluation);
      
      // Rebuild previews after AI corrections modified masks
      if (corrections.adjustments > 0) {
        layers.forEach((layer, idx) => {
          layer.metadata.pixelCount = layer.mask.reduce((s, v) => s + v, 0);
          layer.previewBitmap = buildPreview(layer.mask, width, height, layer.color);
        });
      }

      // Store correction details; replace any leftover micro-fragment warnings
      // with an AI quality summary so the user sees actionable feedback.
      const qualityNote = fidelityScore !== null
        ? `AI quality score: ${fidelityScore}/100 (${evaluation.overall_quality ?? 'n/a'})`
        : null;

      for (let i = 0; i < layers.length; i++) {
        const existingWarnings = (layers[i].warnings ?? []).filter(
          w => !w.startsWith('AI evaluation')
        );
        const correctionNotes = corrections.warnings.slice(0, 3); // cap to avoid flooding
        layers[i].warnings = [
          ...existingWarnings,
          ...(qualityNote ? [qualityNote] : []),
          ...correctionNotes,
        ];
      }

      console.log('AI Evaluation Results:', evaluation);
      console.log('Applied Corrections:', corrections);

      // ---- Step 10: AI Iterative Refinement ----
      // If quality is poor/fair, log a recommendation for the user.
      onProgress?.(10, totalSteps, 'Finalising…');
      await tick();

      if (fidelityScore !== null && fidelityScore < 55 && evaluation.recommendations) {
        for (let i = 0; i < layers.length; i++) {
          layers[i].warnings.push('Tip: ' + evaluation.recommendations.substring(0, 120));
        }
      }

    } catch (error) {
      console.error('AI evaluation failed:', error);
      // Continue without AI evaluation — do not add noise warnings
    }
  }

  // ---- Final Step: Complete ----
  onProgress?.(totalSteps, totalSteps, 'Complete');

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
