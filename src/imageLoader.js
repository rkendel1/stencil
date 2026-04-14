/**
 * imageLoader.js
 * Handles image loading via drag-drop, file picker, and URL input.
 */

/**
 * Load an image from a File object.
 * @param {File} file
 * @returns {Promise<{img: HTMLImageElement, width: number, height: number, name: string}>}
 */
export function loadFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Unsupported file type. Please use PNG, JPG, WebP, or SVG.'));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ img, width: img.naturalWidth, height: img.naturalHeight, name: file.name });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image file.'));
    };

    img.src = url;
  });
}

/**
 * Load an image from a remote URL (with CORS handling via proxy fallback).
 * @param {string} url
 * @returns {Promise<{img: HTMLImageElement, width: number, height: number, name: string}>}
 */
export function loadFromURL(url) {
  return new Promise((resolve, reject) => {
    if (!url || !url.trim()) {
      reject(new Error('Please enter a valid URL.'));
      return;
    }

    let parsedURL;
    try {
      parsedURL = new URL(url.trim());
    } catch {
      reject(new Error('Invalid URL format.'));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const name = parsedURL.pathname.split('/').pop() || 'remote-image';
      resolve({ img, width: img.naturalWidth, height: img.naturalHeight, name });
    };

    img.onerror = () => {
      reject(new Error(
        'Could not load image from URL. The server may not allow cross-origin requests (CORS).'
      ));
    };

    img.src = parsedURL.href;
  });
}

/**
 * Draw image onto a canvas and return its ImageData.
 * Downscales to maxDim if the image is very large.
 * @param {HTMLImageElement} img
 * @param {number} maxDim  - max dimension for processing (0 = no limit)
 * @returns {{imageData: ImageData, scale: number, canvas: HTMLCanvasElement}}
 */
export function imageToData(img, maxDim = 0) {
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  let scale = 1;

  if (maxDim > 0 && (w > maxDim || h > maxDim)) {
    scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  return { imageData, scale, canvas };
}

/**
 * Apply smoothing (box blur) to an ImageData.
 * @param {ImageData} imageData
 * @param {number} radius - blur radius (0 = no blur)
 * @returns {ImageData}
 */
export function applySmoothing(imageData, radius) {
  if (radius <= 0) return imageData;

  const { width, height, data } = imageData;
  const output = new ImageData(width, height);
  const out = output.data;

  // Simple box blur (separable: horizontal then vertical pass)
  const tmp = new Uint8ClampedArray(data.length);

  const r = Math.min(radius, 5);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const i = (y * width + nx) * 4;
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        count++;
      }
      const i = (y * width + x) * 4;
      tmp[i]     = rSum / count;
      tmp[i + 1] = gSum / count;
      tmp[i + 2] = bSum / count;
      tmp[i + 3] = data[i + 3];
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const i = (ny * width + x) * 4;
        rSum += tmp[i];
        gSum += tmp[i + 1];
        bSum += tmp[i + 2];
        count++;
      }
      const i = (y * width + x) * 4;
      out[i]     = rSum / count;
      out[i + 1] = gSum / count;
      out[i + 2] = bSum / count;
      out[i + 3] = data[i + 3];
    }
  }

  return output;
}

/**
 * Convert ImageData to a Float32Array of grayscale values [0,1].
 * @param {ImageData} imageData
 * @returns {Float32Array}
 */
export function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // Perceptual luminance (BT.601)
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return gray;
}

/**
 * Apply edge-preserving bilateral filter to remove noise while keeping edges sharp.
 * @param {ImageData} imageData
 * @param {number} spatialSigma - spatial standard deviation
 * @param {number} rangeSigma - range (intensity) standard deviation
 * @returns {ImageData}
 */
export function bilateralFilter(imageData, spatialSigma = 3, rangeSigma = 0.1) {
  const { width, height, data } = imageData;
  const output = new ImageData(width, height);
  const out = output.data;
  
  const radius = Math.ceil(spatialSigma * 2);
  const spatialCoeff = -0.5 / (spatialSigma * spatialSigma);
  const rangeCoeff = -0.5 / (rangeSigma * rangeSigma);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const centerR = data[idx] / 255;
      const centerG = data[idx + 1] / 255;
      const centerB = data[idx + 2] / 255;
      
      let sumR = 0, sumG = 0, sumB = 0, sumWeight = 0;
      
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          
          const nidx = (ny * width + nx) * 4;
          const nR = data[nidx] / 255;
          const nG = data[nidx + 1] / 255;
          const nB = data[nidx + 2] / 255;
          
          // Spatial distance
          const spatialDist = dx * dx + dy * dy;
          const spatialWeight = Math.exp(spatialDist * spatialCoeff);
          
          // Range distance (intensity difference)
          const rangeDist = (nR - centerR) * (nR - centerR) + 
                           (nG - centerG) * (nG - centerG) + 
                           (nB - centerB) * (nB - centerB);
          const rangeWeight = Math.exp(rangeDist * rangeCoeff);
          
          const weight = spatialWeight * rangeWeight;
          sumR += nR * weight;
          sumG += nG * weight;
          sumB += nB * weight;
          sumWeight += weight;
        }
      }
      
      out[idx]     = Math.round((sumR / sumWeight) * 255);
      out[idx + 1] = Math.round((sumG / sumWeight) * 255);
      out[idx + 2] = Math.round((sumB / sumWeight) * 255);
      out[idx + 3] = data[idx + 3];
    }
  }
  
  return output;
}

/**
 * Normalize contrast using histogram stretching to maximize dynamic range.
 * @param {Float32Array} gray - grayscale values [0,1]
 * @returns {Float32Array} normalized values [0,1]
 */
export function normalizeContrast(gray) {
  // Find min and max (ignoring extreme outliers - top/bottom 1%)
  const sorted = Float32Array.from(gray).sort();
  const n = sorted.length;
  const minIdx = Math.floor(n * 0.01);
  const maxIdx = Math.floor(n * 0.99);
  const min = sorted[minIdx];
  const max = sorted[maxIdx];
  
  const range = max - min;
  if (range < 0.01) return gray; // avoid division by near-zero
  
  const normalized = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    // Stretch to full [0,1] range
    const val = (gray[i] - min) / range;
    normalized[i] = Math.max(0, Math.min(1, val));
  }
  
  return normalized;
}

/**
 * Apply aggressive sharpening to enhance edges.
 * @param {ImageData} imageData
 * @param {number} strength - sharpening strength (0-2, default 1)
 * @returns {ImageData}
 */
export function sharpenEdges(imageData, strength = 1.0) {
  const { width, height, data } = imageData;
  const output = new ImageData(width, height);
  const out = output.data;
  
  // Unsharp mask: original + strength * (original - blurred)
  const amount = strength;
  
  // Simple 3x3 sharpening kernel
  const kernel = [
    0, -amount, 0,
    -amount, 1 + 4 * amount, -amount,
    0, -amount, 0
  ];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      let sumR = 0, sumG = 0, sumB = 0;
      
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const ny = Math.max(0, Math.min(height - 1, y + ky));
          const nx = Math.max(0, Math.min(width - 1, x + kx));
          const nidx = (ny * width + nx) * 4;
          const kidx = (ky + 1) * 3 + (kx + 1);
          
          sumR += data[nidx] * kernel[kidx];
          sumG += data[nidx + 1] * kernel[kidx];
          sumB += data[nidx + 2] * kernel[kidx];
        }
      }
      
      out[idx]     = Math.max(0, Math.min(255, sumR));
      out[idx + 1] = Math.max(0, Math.min(255, sumG));
      out[idx + 2] = Math.max(0, Math.min(255, sumB));
      out[idx + 3] = data[idx + 3];
    }
  }
  
  return output;
}
