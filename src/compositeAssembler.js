/**
 * compositeAssembler.js
 * Assembles layer masks into a shaded composite image for AI evaluation.
 * 
 * Layers are visualized in airbrush buildup order (layer 0 = broadest/base coat,
 * layer N-1 = finest detail). Each layer darkens the composite, simulating
 * progressive paint buildup from a light background toward darker details.
 */

/**
 * Opacity factor for each paint layer (0–1).
 * 0.85 gives a natural ink-like coverage: heavy enough to show clearly while
 * still allowing subtle lightness variations from the underlying surface.
 */
const PAINT_OPACITY = 0.85;

/**
 * Assemble layers into a shaded composite image representing the final sprayed result.
 * 
 * Layers are applied in sequence: the first (broadest) layer sets the base tone,
 * and each subsequent layer adds darker paint on top — matching how an airbrush
 * artist would build up the image layer by layer.
 * 
 * @param {Array<Uint8Array>} masks - Array of binary masks ordered broadest→finest
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {ImageData} Shaded composite as ImageData
 */
export function assembleShadedComposite(masks, width, height) {
  const numLayers = masks.length;
  
  // Start with a white canvas (unpainted surface)
  const composite = new Float32Array(width * height).fill(1.0);
  
  // Each layer multiplies the surface by its darkness factor, simulating paint buildup.
  // Earlier (broader) layers use a lighter shade; later (detail) layers are darker.
  const shades = getLayerShades(numLayers);
  
  for (let layerIdx = 0; layerIdx < numLayers; layerIdx++) {
    const paintDarkness = 1 - shades[layerIdx]; // 0 = transparent, 1 = fully opaque
    for (let i = 0; i < width * height; i++) {
      if (masks[layerIdx][i] !== 0) {
        // Blend: surface = surface * (1 - darkness) + darkness * 0 (black paint)
        composite[i] *= (1 - paintDarkness * PAINT_OPACITY);
      }
    }
  }
  
  // Convert to ImageData (RGBA format)
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const gray = Math.round(composite[i] * 255);
    data[i * 4]     = gray; // R
    data[i * 4 + 1] = gray; // G
    data[i * 4 + 2] = gray; // B
    data[i * 4 + 3] = 255;  // A
  }
  
  return new ImageData(data, width, height);
}

/**
 * Convert ImageData to base64-encoded PNG for AI submission.
 * 
 * @param {ImageData} imageData
 * @returns {Promise<string>} Base64-encoded PNG data URL
 */
export async function imageDataToBase64(imageData) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Failed to create blob from canvas'));
        return;
      }
      
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

/**
 * Generate individual layer previews for AI evaluation.
 * 
 * @param {Array<Uint8Array>} masks - Array of binary masks
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Promise<Array<string>>} Array of base64-encoded layer images
 */
export async function generateLayerPreviews(masks, width, height) {
  const previews = [];
  
  for (const mask of masks) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const val = mask[i] !== 0 ? 255 : 0;
      data[i * 4]     = val;
      data[i * 4 + 1] = val;
      data[i * 4 + 2] = val;
      data[i * 4 + 3] = 255;
    }
    
    const imageData = new ImageData(data, width, height);
    const base64 = await imageDataToBase64(imageData);
    previews.push(base64);
  }
  
  return previews;
}

/**
 * Get shade values for each layer, ordered for airbrush buildup.
 * Layer 0 (broadest/base) gets a lighter shade; later (detail) layers get darker shades.
 * This matches the airbrush technique of spraying light base coats first, then
 * progressively darker details on top.
 * 
 * @param {number} numLayers - Number of layers
 * @returns {Array<number>} Array of shade values [0=darkest … 1=lightest]
 */
export function getLayerShades(numLayers) {
  // Distribute shades from light (base) to dark (detail):
  // layer 0 → lightest shade, layer N-1 → darkest shade
  return Array.from({ length: numLayers }, (_, i) => 
    1 - (i + 1) / (numLayers + 1)
  );
}
