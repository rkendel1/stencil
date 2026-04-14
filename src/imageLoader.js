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
