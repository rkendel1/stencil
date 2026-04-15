# AI Composite Evaluation & Correction

This document describes the AI-powered composite evaluation feature integrated into the stencil generation pipeline.

## Overview

The AI Composite Evaluation feature uses **Groq's Vision API** to analyze the reconstructed stencil composite and provide intelligent feedback on **airbrush compatibility**.

**Primary Goal**: Ensure layers can be airbrushed one after the next to build up the final image.

### Real-World Use Case

This tool generates **multi-layer airbrush stencils** used for:
- **T-shirt airbrushing** - Custom apparel designs
- **Canvas artwork** - Portrait art and murals
- **Automotive custom paint** - Car hood art, motorcycle tanks
- **Fine art** - Gallery-quality airbrush paintings

**How it works in practice:**
1. Each layer is **cut from stencil material** (vinyl, mylar, acetate)
2. Layer 1 is placed on the surface and **airbrushed** (usually darkest/background color)
3. Layer 1 is removed, Layer 2 is aligned using **registration marks** and airbrushed (mid-tones)
4. This continues for all layers, **building up the image** with each pass
5. The final result combines all layers into a complete, photorealistic image

**Example progression:** See professional multi-layer airbrush stencil examples:
- [Example 1](https://github.com/user-attachments/assets/1704e6c7-fc49-405e-90f5-3417b942b679) - Shows base layer → detail layer → highlight layer progression
- Notice how the **white areas are the stencil** (masked off) and **colored areas are where paint is sprayed**
- Each layer adds specific detail without destroying previous work

### What the AI Evaluates

- **Airbrush sequencing** - Will layers build up properly when airbrushed in order?
- **Overspray prevention** - Are there gaps where paint can bleed through?
- **Layer progression** - Do layers go from dark to light (or vice versa) correctly?
- Fidelity to the original image
- Layer balance and tonal distribution
- Edge consistency across layers (clean transitions when airbrushing)
- Structural correctness (bridges won't tear during handling)
- Cut feasibility (layers thick enough to mask effectively)
- Overall aesthetic coherence

## Pipeline Integration

### Steps 8 & 9: AI Evaluation Flow

The standard 7-step pipeline is extended to 9 steps when AI evaluation is enabled:

1. **Preprocessing** - Image enhancement
2. **B&W Conversion** - Pure black/white conversion
3. **Segmentation** - Layer separation
4. **Build Masks** - Binary mask generation
5. **Validate + Auto-fix** - Structural validation
6. **Vectorize** - Path generation
7. **Assemble Layers** _(NEW)_ - Create shaded composite
8. **AI Evaluation** _(NEW)_ - Groq Vision API analysis
9. **Apply Corrections** _(NEW)_ - Deterministic fixes based on AI feedback

### Step 8: Assemble Shaded Composite

Before AI evaluation, we create a **shaded composite** by:

1. Assigning shade values to each layer (evenly spaced increments using formula: `(i + 1) / (numLayers + 1)`)
   - For 6 layers: 0.143, 0.286, 0.429, 0.571, 0.714, 0.857
   - Layer 1 = darkest shade
   - Layer N = lightest shade

2. Creating a composite image where each pixel value is the sum of all layer contributions
3. Converting the result to a grayscale ImageData for comparison with the original

This composite represents how the stencil layers will look when overlaid, simulating the final cut result.

### Step 9: AI Composite Evaluation

The system sends three images to Groq Vision API:

1. **Original Image** - The source image (unprocessed)
2. **Shaded Composite** - The reconstructed composite from step 8
3. **Individual Layers** - Each layer as a separate binary image

The AI evaluates:

- **Fidelity Score** (0-100): How well does the composite match the original?
- **Layer Balance**: Are some layers too dominant or too empty?
- **Edge Consistency**: Are there ghost edges where layers don't align?
- **Structural Issues**: Missing bridges, unwanted holes
- **Cut Feasibility**: Regions too thin to cut, detail clusters that will burn
- **Aesthetic Quality**: Does it look like a clean, professional stencil?

## AI Response Format

The AI returns structured JSON:

```json
{
  "overall_quality": "good",
  "fidelity_score": 85,
  "layer_balance": {
    "needs_adjustment": true,
    "suggested_weights": [0.18, 0.32, 0.46, 0.62]
  },
  "missing_features": ["left eye highlight", "hair outline"],
  "ghost_edges": [
    {
      "layer": 3,
      "region": [120, 88, 160, 120],
      "severity": "medium"
    }
  ],
  "thin_regions": [
    {
      "layer": 2,
      "description": "fine details in top-right",
      "severity": "high"
    }
  ],
  "bridge_recommendations": [
    {
      "layer": 1,
      "description": "add bridge between isolated regions",
      "priority": "high"
    }
  ],
  "recommendations": "Overall excellent fidelity. Consider thickening layer 2 details for better cut feasibility."
}
```

## Setup & Configuration

### 1. Get Groq API Key

1. Visit [console.groq.com](https://console.groq.com/)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (you won't be able to see it again)

### 2. Configure Vercel Environment Variable

**Option A: Vercel Dashboard (Recommended)**

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Click **Add New**
4. Set:
   - **Name**: `GROQ_API_KEY`
   - **Value**: Your Groq API key
   - **Environment**: All (Production, Preview, Development)
5. Click **Save**
6. Redeploy your application

**Option B: Vercel CLI**

```bash
vercel env add GROQ_API_KEY
# Paste your API key when prompted
# Select all environments
```

### 3. Local Development

For local testing, you can temporarily store the API key in localStorage:

```javascript
// In browser console
localStorage.setItem('GROQ_API_KEY', 'your-api-key-here');
```

**⚠️ Security Warning**: Never commit API keys to git or hardcode them in your source code.

## How It Works

### Client-Side Flow

1. User uploads an image and clicks "Generate Layers"
2. Pipeline processes steps 1-7 (standard processing)
3. If AI is enabled (checkbox in UI):
   - Assemble shaded composite from layer masks
   - Convert composite and original to base64 PNG
   - Call `/api/get-groq-key` to retrieve API key
   - Send images and metadata to Groq Vision API **with airbrush-focused evaluation prompt**
   - Receive structured JSON response with airbrush compatibility analysis
   - Apply deterministic corrections based on feedback
   - Store AI evaluation results in layer metadata (including airbrush_ready status)

### Server-Side (Vercel Serverless Function)

The `/api/get-groq-key.js` function:

1. Runs on Vercel's edge network
2. Reads `GROQ_API_KEY` from environment variables
3. Returns it to the client via JSON

This keeps the API key out of the client-side bundle.

### Groq API Call

```javascript
POST https://api.groq.com/openai/v1/chat/completions
Headers:
  Content-Type: application/json
  Authorization: Bearer <GROQ_API_KEY>
  
Body:
{
  "model": "llama-3.2-90b-vision-preview",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "<evaluation prompt>" },
        { "type": "image_url", "image_url": { "url": "<original-base64>" } },
        { "type": "image_url", "image_url": { "url": "<composite-base64>" } }
      ]
    }
  ],
  "temperature": 0.1,
  "max_tokens": 2000,
  "response_format": { "type": "json_object" }
}
```

## AI Model Details

- **Model**: `llama-3.2-90b-vision-preview`
- **Provider**: Groq (ultra-fast inference)
- **Capabilities**: Multi-modal (text + vision)
- **Response**: Structured JSON via function calling
- **Temperature**: 0.1 (low randomness, consistent results)
- **Max Tokens**: 2000 (sufficient for detailed feedback)

## Corrections & Adjustments

Currently, the system logs AI recommendations but does not automatically modify the layers. Future enhancements could include:

- **Layer Weight Adjustment**: Modify shade values based on balance recommendations
- **Morphological Thickening**: Apply dilation to thin regions
- **Bridge Generation**: Add bridges at recommended locations
- **Edge Alignment**: Apply edge-preserving filters to reduce ghost edges

## Fallback Behavior

If AI evaluation fails (no API key, network error, API limits):

- Pipeline continues without AI evaluation (steps 1-7 only)
- A warning is added to layer metadata: `"AI evaluation unavailable"`
- Generation completes successfully
- User sees standard 7-step progress (not 9)

This ensures the tool remains fully functional even without AI features.

## Performance Considerations

- **Image Size**: Images are downscaled to max 1200px before processing
- **API Latency**: Groq typically responds in 1-3 seconds
- **Fallback**: If API takes >10 seconds, timeout and continue
- **Caching**: Evaluation results stored in layer metadata for export

## Privacy & Security

- API key is stored server-side (Vercel environment variables)
- Images are sent to Groq API for analysis (see Groq privacy policy)
- No images are stored permanently by the application
- All processing happens client-side except AI evaluation
- Serverless function only returns API key to same-origin requests

## Cost Considerations

Groq offers:
- **Free Tier**: Limited requests per day
- **Paid Tiers**: Pay-per-token pricing

Each stencil generation with AI enabled sends:
- 2-3 images (original + composite + potentially layer previews)
- ~1000-2000 tokens of response
- Estimated cost: $0.001-0.01 per generation (depending on tier)

For high-volume usage, consider:
- Disabling AI by default (user opt-in)
- Rate limiting per user session
- Implementing caching for similar images

## Testing & Debugging

### Test AI Integration Locally

```javascript
// In browser console after loading an image
const { evaluateComposite } = await import('./src/aiEvaluation.js');

// Set test API key
localStorage.setItem('GROQ_API_KEY', 'your-test-key');

// Run evaluation manually
const result = await evaluateComposite(
  originalBase64, 
  compositeBase64, 
  layerPreviews, 
  shades
);

console.log(result);
```

### Check API Key Setup

```bash
# Verify environment variable is set
vercel env ls

# Test serverless function locally
vercel dev
# Then visit: http://localhost:3000/api/get-groq-key
```

### View AI Results

After generating layers with AI enabled:
1. Open browser DevTools → Console
2. Look for: `AI Evaluation Results: { ... }`
3. Check layer warnings in the Layers panel

## Future Enhancements

- [ ] Apply AI-recommended corrections automatically
- [ ] Multi-pass evaluation (iterative improvement)
- [ ] Custom evaluation prompts (user-configurable criteria)
- [ ] Comparison with reference stencils (transfer learning)
- [ ] Local AI models (privacy-first option using ONNX/WebNN)
- [ ] A/B testing different layer configurations
- [ ] Evaluation history and analytics

## Troubleshooting

### "AI evaluation unavailable" warning

**Cause**: API key not configured or API call failed

**Solution**:
1. Check Vercel environment variables are set
2. Verify API key is valid at console.groq.com
3. Check browser console for error messages
4. Ensure `/api/get-groq-key` endpoint is accessible

### API returns 401 Unauthorized

**Cause**: Invalid or expired API key

**Solution**:
1. Generate a new API key at console.groq.com
2. Update Vercel environment variable
3. Redeploy application

### API returns 429 Too Many Requests

**Cause**: Rate limit exceeded

**Solution**:
1. Wait for rate limit to reset
2. Upgrade to paid Groq tier
3. Implement client-side rate limiting

### Evaluation takes too long

**Cause**: Large images or slow network

**Solution**:
1. Images are auto-downscaled to 1200px
2. Check network connection
3. Try again with smaller image

## References

- [Groq API Documentation](https://console.groq.com/docs)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel Serverless Functions](https://vercel.com/docs/serverless-functions)
