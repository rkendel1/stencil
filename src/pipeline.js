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
 * Quality score target — the loop continues as long as the score is below this
 * AND each iteration still produces a meaningful improvement.
 */
const QUALITY_TARGET = 80;

/**
 * Minimum score improvement required to justify another iteration.
 * If the delta between two consecutive runs falls below this, we declare
 * convergence and return the best result seen so far.
 */
const MIN_IMPROVEMENT = 3;

/**
 * Run the full stencil generation pipeline with infinite AI refinement.
 *
 * When AI is enabled the pipeline:
 *   0. AI pre-assesses the image and recommends initial settings
 *   1-6. Core processing (preprocess → segment → mask → validate → vectorize)
 *   7. Assemble shaded composite
 *   8. AI evaluates quality (fidelity score 0-100)
 *   9. AI corrections applied to masks
 *  10. If score < QUALITY_TARGET and score improved ≥ MIN_IMPROVEMENT vs. the
 *      previous iteration, settings are tightened and the loop repeats from step 1.
 *      The loop runs indefinitely until the score converges or the target is met.
 *
 * @param {ImageData}  imageData
 * @param {object}     settings
 * @param {number}     settings.layerCount
 * @param {'kmeans'|'threshold'|'posterize'} settings.segmentationMode
 * @param {number}     settings.smoothing        - 0–5 blur radius
 * @param {number}     settings.simplify         - Douglas-Peucker epsilon
 * @param {boolean}    settings.autoFix
 * @param {number}     settings.bridgeThickness
 * @param {boolean}    settings.enableAI
 * @param {ImageData}  settings.originalImageData
 * @param {number}     settings.minIslandArea    - 0 = auto-scale
 * @param {Function}   [onProgress]  (step, total, message, iterCtx) where
 *                     iterCtx = { iteration, bestScore, converged }
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
    minIslandArea    = 0,
  } = settings;

  // Auto-scale minIslandArea based on image resolution.
  const imageArea = imageData.width * imageData.height;
  const baseMinArea = minIslandArea > 0
    ? minIslandArea
    : Math.max(50, Math.floor(imageArea * 0.0002));

  // Step 0 is AI pre-assessment; steps 8-10 are AI eval/refine.
  const totalSteps = enableAI ? 10 : 7;

  // ---- Step 0: AI Pre-Assessment ----
  let aiSuggestedSettings = null;
  if (enableAI && originalImageData) {
    onProgress?.(0, totalSteps, 'AI assessing image…', { iteration: 0, bestScore: null, converged: false });
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

  // Build initial resolved settings (AI suggestion wins over defaults,
  // but explicit user values always take precedence).
  let currentOpts = {
    layerCount: Math.max(2, Math.min(12,
      (settings.layerCount !== undefined)
        ? settings.layerCount
        : (aiSuggestedSettings?.layerCount ?? layerCount)
    )),
    segmentationMode: (settings.segmentationMode !== undefined)
      ? settings.segmentationMode
      : (aiSuggestedSettings?.segmentationMode ?? segmentationMode),
    smoothing: (settings.smoothing !== undefined)
      ? settings.smoothing
      : (aiSuggestedSettings?.smoothing ?? smoothing),
    simplify: (settings.simplify !== undefined)
      ? settings.simplify
      : (aiSuggestedSettings?.simplify ?? simplify),
    doAutoFix,
    bridgeThickness: (settings.bridgeThickness !== undefined)
      ? settings.bridgeThickness
      : (aiSuggestedSettings?.bridgeThickness ?? bridgeThickness),
    enableAI,
    originalImageData,
    effectiveMinArea: minIslandArea > 0
      ? minIslandArea
      : (aiSuggestedSettings?.minIslandArea ?? baseMinArea),
    aiSuggestedSettings,
  };

  // ---- Infinite refinement loop ----
  let bestLayers     = null;
  let bestScore      = -1;
  let priorScore  = -1;
  let iteration      = 0;

  while (true) {
    iteration++;
    const iterCtx = { iteration, bestScore, converged: false };

    const iterLabel = iteration > 1 ? ` (pass ${iteration})` : '';
    const wrapProgress = (step, total, msg) =>
      onProgress?.(step, total, msg ? msg + iterLabel : `Step ${step}/${total}${iterLabel}`, iterCtx);

    const { layers, fidelityScore, evaluation } =
      await _runPipelineCore(imageData, currentOpts, wrapProgress, totalSteps);

    const score = fidelityScore ?? -1;
    console.log(`Iteration ${iteration}: fidelity = ${score}`);

    // Keep the best result regardless of convergence decision
    if (score > bestScore || bestLayers === null) {
      bestScore  = score;
      bestLayers = layers;
    }

    // If AI is disabled or evaluation was skipped, exit immediately
    if (!enableAI || score < 0) break;

    // ---- Convergence check ----
    const improvement = score - priorScore;
    const targetMet   = score >= QUALITY_TARGET;
    const converged   = priorScore >= 0 && improvement < MIN_IMPROVEMENT;

    if (targetMet || converged) {
      // Stamp convergence info onto layer metadata
      const convergeMsg = targetMet
        ? `AI target met (${bestScore}/100) after ${iteration} pass${iteration > 1 ? 'es' : ''}`
        : `AI converged at ${bestScore}/100 after ${iteration} pass${iteration > 1 ? 'es' : ''}`;
      bestLayers.forEach(l => {
        l.metadata.refinementPasses    = iteration;
        l.metadata.convergenceMessage  = convergeMsg;
        // Replace or prepend quality note so it reflects final score
        l.warnings = [
          `AI quality score: ${bestScore}/100 (${evaluation?.overall_quality ?? 'n/a'}) — ${convergeMsg}`,
          ...(l.warnings ?? []).filter(w => !w.startsWith('AI quality score:')),
        ];
      });
      onProgress?.(totalSteps, totalSteps, convergeMsg, { iteration, bestScore, converged: true });
      break;
    }

    // ---- Adjust settings for next iteration ----
    priorScore = score;
    currentOpts   = _tightenSettings(currentOpts, evaluation, score, imageArea);

    // If nothing changed, there's nothing more we can do
    if (!currentOpts) break;
  }

  return bestLayers;
}

/**
 * Derive tighter settings for the next refinement iteration based on the AI
 * evaluation result.  Returns null if no meaningful changes are possible.
 *
 * @param {object} opts     - current pipeline options
 * @param {object} evaluation - AI evaluation from the just-completed iteration
 * @param {number} score    - fidelity score (0-100)
 * @param {number} imageArea - total image pixel count
 * @returns {object|null}
 */
function _tightenSettings(opts, evaluation, score, imageArea) {
  const next = { ...opts };
  let changed = false;

  // More smoothing for noisy/fragmented outputs
  if (score < 60 && next.smoothing < 5) {
    next.smoothing = Math.min(5, next.smoothing + 2);
    changed = true;
  } else if (score < 80 && next.smoothing < 4) {
    next.smoothing = next.smoothing + 1;
    changed = true;
  }

  // Increase minimum island area to eliminate micro-fragments
  const maxMinArea = Math.max(800, Math.floor(imageArea * 0.0008));
  if (next.effectiveMinArea < maxMinArea) {
    const bump = score < 50
      ? Math.floor(next.effectiveMinArea * 0.6)   // aggressive: +60%
      : Math.floor(next.effectiveMinArea * 0.3);  // moderate:  +30%
    next.effectiveMinArea = Math.min(maxMinArea, next.effectiveMinArea + Math.max(50, bump));
    changed = true;
  }

  // Increase path simplification to reduce noisy contours
  if (score < 65 && next.simplify < 4.0) {
    next.simplify = Math.min(4.0, parseFloat((next.simplify + 0.5).toFixed(1)));
    changed = true;
  }

  // If there are thin/weak bridge issues, thicken bridges
  const hasBridgeIssues = evaluation?.airbrush_issues?.some(
    i => i.issue === 'weak_bridge' || i.severity === 'high'
  );
  if (hasBridgeIssues && next.bridgeThickness < 8) {
    next.bridgeThickness = Math.min(8, next.bridgeThickness + 2);
    changed = true;
  }

  // If there are many fragmented layers and we have room, reduce layer count
  const fragmentedLayers = (evaluation?.airbrush_issues ?? []).filter(
    i => i.issue === 'detail_too_fine'
  ).length;
  if (fragmentedLayers >= 2 && next.layerCount > 2) {
    next.layerCount = Math.max(2, next.layerCount - 1);
    changed = true;
  }

  return changed ? next : null;
}

/**
 * Internal pipeline core.  Runs steps 1-10 once and returns layers plus the AI
 * evaluation result so the outer refinement loop can make decisions.
 *
 * @returns {Promise<{ layers: Layer[], fidelityScore: number|null, evaluation: object|null }>}
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

  // Replace the darkest cluster mask with the simplest possible outer silhouette.
  // A real airbrush Layer 1 is the broad, filled base-coat shape — no internal
  // holes or detail cuts (like the left panel of a two-layer skull stencil set).
  // Union all subject clusters + aggressive morphological closing fills ALL holes.
  masks[0] = _buildSilhouetteMask(masks, width, height);
  // Clear the background cluster (lightest centroid = masks[k-1]) so it sorts
  // last and the silhouette is guaranteed to become Layer 1.
  masks[k - 1] = new Uint8Array(width * height);

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

      // Signal progress for step 10 (outer loop will decide whether to iterate)
      onProgress?.(10, totalSteps, 'AI pass complete…');
      await tick();

      return { layers, fidelityScore, evaluation };

    } catch (error) {
      console.error('AI evaluation failed:', error);
      // Return layers without score — outer loop will stop iterating
      return { layers, fidelityScore: null, evaluation: null };
    }
  }

  // ---- Final Step: Complete (non-AI path) ----
  onProgress?.(totalSteps, totalSteps, 'Complete');

  return { layers, fidelityScore: null, evaluation: null };
}

/**
 * Build a solid outer silhouette mask suitable for Layer 1 (base coat).
 *
 * This produces the "left panel" of a layered stencil set: a completely filled,
 * hole-free shape of the subject with no internal cutouts.  Subsequent layers
 * add progressively finer detail on top.
 *
 * Algorithm:
 *   1. Union all subject k-means clusters (masks[0..k-2]; masks[k-1] is background)
 *   2. Apply aggressive morphological closing (radius 5) to fill ALL interior holes
 *      (eyes, teeth, decorations) and smooth the outer boundary
 *   3. This produces the simplest possible solid silhouette — just the broad
 *      outer shape with zero internal detail
 *
 * @param {Uint8Array[]} masks  - k segment masks, ordered darkest → lightest
 * @param {number}       width
 * @param {number}       height
 * @returns {Uint8Array} silhouette mask (1 = subject, 0 = background)
 */
function _buildSilhouetteMask(masks, width, height) {
  const k = masks.length;
  const n = width * height;

  // Union all subject clusters (skip masks[k-1] which is the lightest/background)
  const union = new Uint8Array(n);
  for (let c = 0; c < k - 1; c++) {
    const m = masks[c];
    for (let i = 0; i < n; i++) {
      if (m[i]) union[i] = 1;
    }
  }

  // Aggressive morphological closing: fills ALL interior holes and smooths boundary
  // Radius 5 is large enough to close eye sockets, teeth gaps, and decorative cutouts
  morphologicalClose(union, width, height, 5);

  return union;
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
