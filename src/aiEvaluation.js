/**
 * aiEvaluation.js
 * AI-powered composite evaluation and correction using Groq Vision API.
 * 
 * Evaluates the reconstructed composite against the original image
 * and provides structured feedback for corrections.
 * 
 * ALSO provides AI-native Layer 1 silhouette generation (replacing
 * all algorithmic k-means/border-detection approaches).
 */

import { removeMicroFragments, morphologicalClose } from './validator.js';

/**
 * Assess an image to recommend optimal pipeline settings before running.
 * 
 * @param {string} imageBase64 - Base64-encoded original image
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {Promise<Object>} Recommended settings and rationale
 */
export async function assessImageForSettings(imageBase64, width, height) {
  const apiKey = await getGroqApiKey();

  if (!apiKey) {
    return null; // Caller falls back to defaults
  }

  const prompt = buildSettingsPrompt(width, height);

  try {
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    const payload = {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageBase64 } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content);
  } catch (e) {
    console.warn('AI settings assessment failed:', e);
    return null;
  }
}

/**
 * Build a prompt asking the AI to recommend pipeline settings for this image.
 */
function buildSettingsPrompt(width, height) {
  return `You are an expert airbrush stencil artist analyzing an image to recommend optimal multi-layer stencil settings.

Image dimensions: ${width} x ${height} pixels.

Analyze this image and recommend settings for converting it into a clean multi-layer airbrush stencil with MINIMAL micro-fragments and clean, cuttable edges.

Consider:
- How many tonal bands does the image have (shadows, midtones, highlights)?
- How complex/detailed is the image?
- How much noise or texture is present?
- Is it a portrait, graphic, landscape, or other type?

Return ONLY a JSON object with these fields:
{
  "layerCount": <integer 2-8, based on tonal complexity>,
  "segmentationMode": <"kmeans" | "posterize" | "threshold">,
  "smoothing": <integer 1-5, higher for noisy/photo images, lower for clean graphics>,
  "simplify": <float 0.5-4.0, higher for simpler output>,
  "minIslandArea": <integer 50-2000, minimum fragment area in px to keep — increase for noisy images>,
  "bridgeThickness": <integer 2-8>,
  "rationale": "<one sentence explanation>"
}

IMPORTANT: For photographic portraits, recommend smoothing >= 3 and minIslandArea >= 400 to eliminate micro-fragments.
For clean vector-style graphics, smoothing 1-2 and minIslandArea 100-300 is sufficient.`;
}

/**
 * Evaluate composite image using Groq Vision AI.
 * 
 * @param {string} originalBase64 - Base64-encoded original image
 * @param {string} compositeBase64 - Base64-encoded shaded composite
 * @param {Array<string>} layerPreviews - Array of base64-encoded layer images
 * @param {Array<number>} shades - Shade values for each layer
 * @returns {Promise<Object>} AI evaluation results with recommendations
 */
export async function evaluateComposite(originalBase64, compositeBase64, layerPreviews, shades) {
  // Check if we're running on Vercel or if API key is available
  const apiKey = await getGroqApiKey();
  
  if (!apiKey) {
    console.warn('Groq API key not available. Skipping AI evaluation.');
    return {
      skipped: true,
      reason: 'API key not configured',
      layer_balance: { needs_adjustment: false },
      missing_features: [],
      ghost_edges: [],
      thin_regions: [],
      bridge_recommendations: [],
    };
  }
  
  try {
    const response = await callGroqVisionAPI(
      apiKey,
      originalBase64,
      compositeBase64,
      layerPreviews,
      shades
    );
    
    return response;
  } catch (error) {
    console.error('AI evaluation failed:', error);
    return {
      error: true,
      message: error.message,
      layer_balance: { needs_adjustment: false },
      missing_features: [],
      ghost_edges: [],
      thin_regions: [],
      bridge_recommendations: [],
    };
  }
}

/**
 * Get Groq API key from environment or Vercel environment variables.
 * 
 * @returns {Promise<string|null>} API key or null if not available
 */
async function getGroqApiKey() {
  // Check if running in browser with injected environment
  if (typeof window !== 'undefined' && window.GROQ_API_KEY) {
    return window.GROQ_API_KEY;
  }
  
  // Check if there's a serverless function endpoint to get the key
  // This would be set up in Vercel to avoid exposing the key in the client
  try {
    const response = await fetch('/api/get-groq-key');
    if (response.ok) {
      const data = await response.json();
      return data.apiKey;
    }
  } catch (e) {
    // API endpoint not available, continue
  }
  
  // For development, check localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem('GROQ_API_KEY');
  }
  
  return null;
}

/**
 * Call Groq Vision API for image analysis.
 * 
 * @param {string} apiKey - Groq API key
 * @param {string} originalBase64 - Original image
 * @param {string} compositeBase64 - Shaded composite
 * @param {Array<string>} layerPreviews - Layer images
 * @param {Array<number>} shades - Shade values
 * @returns {Promise<Object>} AI evaluation results
 */
async function callGroqVisionAPI(apiKey, originalBase64, compositeBase64, layerPreviews, shades) {
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  
  // Build the prompt for the AI
  const prompt = buildEvaluationPrompt(shades, layerPreviews.length);
  
  // Prepare the request payload
  const payload = {
    model: 'meta-llama/llama-4-scout-17b-16e-instruct', // Groq's vision model
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: originalBase64,
            },
          },
          {
            type: 'image_url',
            image_url: {
              url: compositeBase64,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  };
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }
  
  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error('No response from Groq API');
  }
  
  // Parse the JSON response
  try {
    return JSON.parse(content);
  } catch (e) {
    console.error('Failed to parse AI response:', content);
    throw new Error('Invalid JSON response from AI');
  }
}

/**
 * Build the evaluation prompt for the AI.
 * 
 * @param {Array<number>} shades - Shade values for each layer
 * @param {number} numLayers - Number of layers
 * @returns {string} Evaluation prompt
 */
function buildEvaluationPrompt(shades, numLayers) {
  return `You are an expert multi-layer airbrush stencil artist evaluating a stencil design.

I'm showing you two images:
1. The ORIGINAL image (first image)
2. The RECONSTRUCTED COMPOSITE (second image) - created by overlaying ${numLayers} stencil layers with shades: ${shades.map(s => s.toFixed(2)).join(', ')}

**CRITICAL USE CASE**: 
This is a MULTI-LAYER AIRBRUSH STENCIL where:
- Each layer will be CUT from stencil material (vinyl, mylar, or acetate)
- Layers are airbrushed SEQUENTIALLY (layer 1 first, layer 2 on top, etc.)
- Each layer adds specific tonal values to build up the complete image
- Proper REGISTRATION/ALIGNMENT between layers is critical
- Gaps, bridges, and overspray zones must be carefully managed

Think of this like the professional multi-layer airbrush stencils used for:
- T-shirt airbrushing
- Canvas artwork
- Automotive custom paint
- Mural work

Your task is to evaluate if these layers will produce a clean, professional result when airbrushed sequentially.

Evaluate FOR SEQUENTIAL AIRBRUSHING:

1. **Layer Sequencing & Build-up**:
   - Do layers progress logically (typically darkest/background first, lightest/highlights last)?
   - Will each new layer add detail without destroying the work from previous layers?
   - Are tonal values properly distributed across layers?

2. **Registration & Alignment**:
   - Are edges aligned so layers will overlay correctly?
   - Will registration marks allow accurate positioning?
   - Are there alignment issues that will create visible artifacts?

3. **Overspray Protection**:
   - Are there GAPS between masked areas where paint from one layer will contaminate another?
   - Are bridges positioned to prevent paint bleeding into unwanted areas?
   - Will negative space be properly protected?

4. **Cut & Mask Quality**:
   - Are all masked regions thick enough to cut cleanly (minimum 2-3mm for vinyl)?
   - Are there thin sections that will tear when removing cut stencils?
   - Will the stencil lay flat against the surface for clean masking?
   - Are bridges strong enough to hold the stencil together during handling?

5. **Airbrush Feasibility**:
   - Are there areas too small for effective airbrush coverage?
   - Will fine details hold up when cut and airbrushed?
   - Are there delicate features that need reinforcement?

6. **Fidelity When Airbrushed**:
   - Does the composite accurately represent what the final airbrushed result will look like?
   - Are important features preserved?
   - Is the tonal range appropriate for airbrush application?

7. **Professional Quality**:
   - Will this produce a clean, professional-looking result?
   - Are transitions smooth between layers?
   - Is the overall composition suitable for the airbrush medium?

Return a JSON object with this structure:
{
  "overall_quality": "excellent" | "good" | "fair" | "poor",
  "airbrush_ready": true/false,
  "fidelity_score": 0-100,
  "layer_sequence": {
    "order_correct": true/false,
    "build_up_quality": "smooth" | "acceptable" | "problematic",
    "tonal_progression": "proper" | "needs_adjustment",
    "recommendations": "specific advice on layer ordering for airbrushing"
  },
  "registration_quality": {
    "alignment_issues": true/false,
    "problem_areas": ["description of misalignments"],
    "registration_marks_needed": true/false
  },
  "overspray_risks": [
    {
      "between_layers": [1, 2],
      "location": "description of where overspray can occur",
      "severity": "low|medium|high|critical",
      "fix": "add bridge | adjust edge | fill gap"
    }
  ],
  "layer_balance": {
    "needs_adjustment": true/false,
    "suggested_weights": [0.18, 0.32, ...] // only if needs_adjustment
  },
  "airbrush_issues": [
    {
      "layer": 2,
      "issue": "too_thin" | "overspray_gap" | "weak_bridge" | "detail_too_fine",
      "location": "description",
      "severity": "low|medium|high",
      "fix": "specific correction needed"
    }
  ],
  "cut_quality": {
    "cuttable": true/false,
    "thin_regions": [{"layer": N, "location": "...", "minimum_width_mm": 1.5}],
    "weak_bridges": [{"layer": N, "location": "...", "recommendation": "..."}]
  },
  "missing_features": ["features lost in layer separation"],
  "recommendations": "Overall professional advice for making this work as a multi-layer airbrush stencil. Be SPECIFIC about what needs to change for successful sequential airbrushing."
}

Think like a professional airbrush artist who needs to cut these layers and spray them in sequence. Be practical and detailed.`;
}

/**
 * Apply AI corrections to masks (deterministic operations based on AI feedback).
 * 
 * @param {Array<Uint8Array>} masks - Layer masks to modify
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} evaluation - AI evaluation results
 * @returns {Object} Summary of applied corrections
 */
export function applyAICorrections(masks, width, height, evaluation) {
  const applied = {
    adjustments: 0,
    warnings: [],
    fidelityScore: evaluation.fidelity_score ?? null,
  };

  const imageArea = width * height;

  // If thin regions are flagged, apply morphological dilation to thicken
  if (evaluation.thin_regions?.length > 0) {
    const affectedLayers = new Set(evaluation.thin_regions.map(r => r.layer - 1));
    for (const layerIdx of affectedLayers) {
      if (layerIdx >= 0 && layerIdx < masks.length) {
        morphologicalClose(masks[layerIdx], width, height, 2);
        applied.adjustments++;
      }
    }
    applied.warnings.push(`Thickened thin regions in ${affectedLayers.size} layer(s)`);
  }

  // Apply larger fragment removal based on airbrush_issues
  if (evaluation.airbrush_issues?.length > 0) {
    const detailTooFine = evaluation.airbrush_issues.filter(i => i.issue === 'detail_too_fine');
    if (detailTooFine.length > 0) {
      const affectedLayers = new Set(detailTooFine.map(i => i.layer - 1));
      const aggressiveMinArea = Math.max(200, Math.floor(imageArea * 0.0003));
      for (const layerIdx of affectedLayers) {
        if (layerIdx >= 0 && layerIdx < masks.length) {
          removeMicroFragments(masks[layerIdx], width, height, aggressiveMinArea);
          morphologicalClose(masks[layerIdx], width, height, 1);
          applied.adjustments++;
        }
      }
      applied.warnings.push(`Removed overly fine details in ${affectedLayers.size} layer(s)`);
    }
  }

  // If overall quality is poor or fair, apply a global cleanup pass
  if (evaluation.overall_quality === 'poor' || evaluation.overall_quality === 'fair') {
    const globalMinArea = Math.max(100, Math.floor(imageArea * 0.0002));
    for (let i = 0; i < masks.length; i++) {
      removeMicroFragments(masks[i], width, height, globalMinArea);
    }
    applied.adjustments += masks.length;
    applied.warnings.push('Applied global fragment cleanup (quality was ' + evaluation.overall_quality + ')');
  }

  if (evaluation.layer_balance?.needs_adjustment) {
    applied.warnings.push('AI recommends re-balancing layer distribution');
  }

  if (evaluation.ghost_edges?.length > 0) {
    applied.warnings.push(`${evaluation.ghost_edges.length} ghost edge(s) detected between layers`);
  }

  return applied;
}

/**
 * AI-NATIVE LAYER 1 SILHOUETTE GENERATION
 * 
 * Uses Groq Vision AI to generate a negative-space silhouette mask of the
 * main subject, completely replacing algorithmic approaches (k-means, border
 * detection, flood-fill, morphological operations).
 * 
 * @param {string} imageBase64 - Base64-encoded original image (data:image/...)
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Promise<Uint8Array|null>} Binary mask (1=subject, 0=background) or null if AI unavailable
 */
export async function generateAISilhouette(imageBase64, width, height) {
  const apiKey = await getGroqApiKey();
  
  if (!apiKey) {
    console.warn('Groq API key not available. Cannot generate AI silhouette.');
    return null;
  }

  const prompt = buildSilhouettePrompt(width, height);

  try {
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    const payload = {
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageBase64 } },
          ],
        },
      ],
      temperature: 0.05, // Very low for consistent segmentation
      max_tokens: 3000,
      response_format: { type: 'json_object' },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Groq API error (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      console.error('No response from Groq API');
      return null;
    }

    // Parse the JSON response
    const result = JSON.parse(content);
    
    // Convert the AI's mask description to a binary mask
    return await parseSilhouetteMask(result, width, height, imageBase64);
    
  } catch (e) {
    console.error('AI silhouette generation failed:', e);
    return null;
  }
}

/**
 * Build the prompt asking AI to identify and segment the main subject.
 */
function buildSilhouettePrompt(width, height) {
  return `You are an expert image segmentation AI creating a NEGATIVE-SPACE SILHOUETTE for multi-layer airbrush stenciling.

Image dimensions: ${width} × ${height} pixels.

Your task: Identify the MAIN SUBJECT in this image and create a SOLID FILLED SILHOUETTE (outline + interior completely filled).

This will become LAYER 1 of a multi-layer stencil, so it must:
1. Include the ENTIRE subject (all parts, including interior regions)
2. Be a single, continuous, FILLED shape (no holes for eyes, teeth, decorations, etc.)
3. Exclude the background completely
4. Have smooth, clean edges suitable for cutting

Think of this like a cookie cutter shape - the broadest possible outline of the subject with everything inside filled solid.

Examples:
- Portrait of a person → solid head/shoulders silhouette (filled, no facial features cut out)
- Sugar skull → solid skull outline filled completely (eyes, teeth, decorations all filled in)
- Animal → complete body shape filled solid
- Object → full object outline filled

Return ONLY a JSON object with:
{
  "subject_description": "<brief description of what the main subject is>",
  "confidence": <0.0-1.0, how confident you are this is the correct subject>,
  "mask_data": "<run-length encoded binary mask: alternating run counts of 0s and 1s, starting with 0s. Format: 'R0,R1,R0,R1,...' where each R is pixel count>",
  "bbox": {"x": <left>, "y": <top>, "width": <w>, "height": <h>}
}

CRITICAL: mask_data must be run-length encoded (RLE) to fit in token limit.
Total pixels = ${width * height}. Start with background (0), alternate to subject (1).

Example RLE for a 10×10 image with centered 4×4 subject:
- First 23 pixels are background (0)
- Next 4 pixels are subject (1)  
- Next 2 pixels are background (0)
- Next 4 pixels are subject (1)
- ... continuing the pattern
→ "23,4,2,4,2,4,2,4,45"`;
}

/**
 * Parse the AI's silhouette response into a binary mask.
 * 
 * @param {Object} result - AI response with mask_data (RLE encoded)
 * @param {number} width - Image width
 * @param {number} height - Image height  
 * @param {string} imageBase64 - Original image for fallback analysis
 * @returns {Promise<Uint8Array>} Binary mask (1=subject, 0=background)
 */
async function parseSilhouetteMask(result, width, height, imageBase64) {
  const n = width * height;
  const mask = new Uint8Array(n);
  
  try {
    if (!result.mask_data) {
      throw new Error('No mask_data in AI response');
    }

    // Decode run-length encoding
    const runs = result.mask_data.split(',').map(r => parseInt(r.trim(), 10));
    
    // Validate all runs are valid numbers
    if (runs.some(r => isNaN(r) || r < 0)) {
      throw new Error('Invalid RLE mask_data: contains non-numeric or negative values');
    }
    
    let idx = 0;
    let value = 0; // Start with background (0)
    
    for (const runLength of runs) {
      for (let i = 0; i < runLength && idx < n; i++) {
        mask[idx++] = value;
      }
      value = 1 - value; // Alternate between 0 and 1
    }
    
    // Fill remaining pixels if RLE was shorter than expected
    while (idx < n) {
      mask[idx++] = 0; // Background
    }
    
    // Apply gentle morphological closing to smooth edges
    morphologicalClose(mask, width, height, 3);
    
    console.log(`✅ AI silhouette: ${result.subject_description} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
    
    return mask;
    
  } catch (e) {
    console.error('Failed to parse AI silhouette mask:', e);
    console.error('AI response:', result);
    
    // Fallback: try to use bounding box if available
    if (result.bbox) {
      console.warn('Using bbox fallback for silhouette');
      const { x, y, width: w, height: h } = result.bbox;
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          if (px >= x && px < x + w && py >= y && py < y + h) {
            mask[py * width + px] = 1;
          }
        }
      }
      morphologicalClose(mask, width, height, 5);
      return mask;
    }
    
    throw e;
  }
}
