/**
 * compositeAssembler.js
 * Assembles layer masks into a shaded composite image for AI evaluation.
 * 
 * Each layer is assigned a shade value (evenly spaced increments).
 * The composite is the weighted sum of all layers with their assigned shades.
 */

/**
 * Assemble layers into a shaded composite image.
 * 
 * @param {Array<Uint8Array>} masks - Array of binary masks (1 = foreground, 0 = background)
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {ImageData} Shaded composite as ImageData
 */
export function assembleShadedComposite(masks, width, height) {
  const numLayers = masks.length;
  
  // Calculate evenly spaced shade values (darkest to lightest)
  const shades = getLayerShades(numLayers);
  
  // Create composite grayscale image
  const composite = new Float32Array(width * height);
  
  // For each pixel, sum the contributions from all layers
  for (let i = 0; i < width * height; i++) {
    let pixelValue = 0;
    for (let layerIdx = 0; layerIdx < numLayers; layerIdx++) {
      if (masks[layerIdx][i]) {
        pixelValue += shades[layerIdx];
      }
    }
    // Clamp to [0, 1]
    composite[i] = Math.min(1, pixelValue);
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
      const val = mask[i] ? 255 : 0;
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
 * Get shade values for each layer.
 * 
 * @param {number} numLayers - Number of layers
 * @returns {Array<number>} Array of shade values
 */
export function getLayerShades(numLayers) {
  return Array.from({ length: numLayers }, (_, i) => 
    (i + 1) / (numLayers + 1)
  );
}
