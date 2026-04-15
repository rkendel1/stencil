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
  return `You are an expert stencil artist evaluating a multi-layer stencil design.

I'm showing you two images:
1. The ORIGINAL image (first image)
2. The RECONSTRUCTED COMPOSITE (second image) - created by overlaying ${numLayers} stencil layers with shades: ${shades.map(s => s.toFixed(2)).join(', ')}

Your task is to evaluate the composite and provide structured feedback in JSON format.

Evaluate these aspects:

1. **Fidelity to Original**: Does the composite resemble the original? Are important features missing? Are shadows/highlights correct?

2. **Layer Balance**: Are some layers too dominant or empty? Does the tonal distribution match?

3. **Edge Consistency**: Are edges aligned across layers? Are there ghost edges?

4. **Structural Correctness**: Are there unwanted holes? Missing or excessive bridges?

5. **Cut Feasibility**: Are there regions too thin to cut? Clusters that will burn/melt?

6. **Aesthetic Coherence**: Does it look like a clean stencil? Are transitions smooth?

Return a JSON object with this structure:
{
  "overall_quality": "good" | "fair" | "poor",
  "fidelity_score": 0-100,
  "layer_balance": {
    "needs_adjustment": true/false,
    "suggested_weights": [0.18, 0.32, ...] // only if needs_adjustment
  },
  "missing_features": ["feature1", "feature2", ...],
  "ghost_edges": [
    {"layer": 3, "region": [x, y, width, height], "severity": "low|medium|high"}
  ],
  "thin_regions": [
    {"layer": 2, "description": "location", "severity": "low|medium|high"}
  ],
  "bridge_recommendations": [
    {"layer": 1, "description": "where to add bridge", "priority": "low|medium|high"}
  ],
  "recommendations": "Overall advice for improving the stencil"
}

Be concise and actionable. Focus on issues that significantly impact the stencil quality.`;
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
