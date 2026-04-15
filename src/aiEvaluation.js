/**
 * aiEvaluation.js
 * AI-powered composite evaluation and correction using Groq Vision API.
 * 
 * Evaluates the reconstructed composite against the original image
 * and provides structured feedback for corrections.
 */

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
    model: 'llama-3.2-90b-vision-preview', // Groq's vision model
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
  };
  
  // Note: The AI provides recommendations, but applying them requires
  // careful implementation to avoid breaking the stencil structure.
  // For now, we'll log the recommendations and apply simple corrections.
  
  if (evaluation.layer_balance?.needs_adjustment) {
    applied.warnings.push('Layer balance adjustment recommended by AI');
    // In a full implementation, this would adjust layer opacity or re-segment
  }
  
  if (evaluation.thin_regions?.length > 0) {
    applied.warnings.push(`${evaluation.thin_regions.length} thin regions detected`);
    // Could apply morphological operations to thicken
  }
  
  if (evaluation.bridge_recommendations?.length > 0) {
    applied.warnings.push(`${evaluation.bridge_recommendations.length} bridge recommendations`);
    // Could add bridges algorithmically
  }
  
  if (evaluation.ghost_edges?.length > 0) {
    applied.warnings.push(`${evaluation.ghost_edges.length} ghost edges detected`);
    // Could apply edge alignment corrections
  }
  
  return applied;
}
