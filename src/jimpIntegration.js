/**
 * jimpIntegration.js
 * Image preprocessing and manipulation using Jimp
 * Note: Jimp is primarily for Node.js. For browser, we use built-in Canvas APIs.
 * This module provides utilities that can work in both environments.
 */

/**
 * Check if we're in a Node.js environment
 */
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

let Jimp = null;

/**
 * Initialize Jimp (only works in Node.js)
 * @returns {Promise<boolean>}
 */
export async function initJimp() {
  if (!isNode) {
    console.log('Jimp is only available in Node.js environment. Using browser Canvas APIs.');
    return false;
  }
  
  try {
    const jimpModule = await import('jimp');
    Jimp = jimpModule.default || jimpModule;
    console.log('Jimp loaded successfully');
    return true;
  } catch (error) {
    console.warn('Jimp failed to load:', error);
    return false;
  }
}

/**
 * Resize image with high-quality algorithm
 * @param {Buffer|string} input - image buffer or path (Node.js) or HTMLImageElement (browser)
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @returns {Promise<ImageData|Buffer>}
 */
export async function resizeImage(input, maxWidth, maxHeight) {
  if (isNode && Jimp) {
    try {
      const image = await Jimp.read(input);
      image.scaleToFit(maxWidth, maxHeight, Jimp.RESIZE_BICUBIC);
      return await image.getBufferAsync(Jimp.MIME_PNG);
    } catch (error) {
      console.error('Jimp resize failed:', error);
      throw error;
    }
  } else {
    // Browser fallback using Canvas
    console.log('Using browser Canvas API for resize');
    return null; // Caller should use canvas-based resize
  }
}

/**
 * Apply Gaussian blur (Jimp version)
 * @param {Buffer|string} input
 * @param {number} radius - blur radius (1-100)
 * @returns {Promise<Buffer>}
 */
export async function jimpGaussianBlur(input, radius = 5) {
  if (!isNode || !Jimp) {
    throw new Error('Jimp blur is only available in Node.js');
  }
  
  try {
    const image = await Jimp.read(input);
    image.blur(radius);
    return await image.getBufferAsync(Jimp.MIME_PNG);
  } catch (error) {
    console.error('Jimp blur failed:', error);
    throw error;
  }
}

/**
 * Convert image to grayscale (Jimp version)
 * @param {Buffer|string} input
 * @returns {Promise<Buffer>}
 */
export async function toGrayscaleJimp(input) {
  if (!isNode || !Jimp) {
    throw new Error('Jimp grayscale is only available in Node.js');
  }
  
  try {
    const image = await Jimp.read(input);
    image.grayscale();
    return await image.getBufferAsync(Jimp.MIME_PNG);
  } catch (error) {
    console.error('Jimp grayscale failed:', error);
    throw error;
  }
}

/**
 * Adjust image contrast and brightness
 * @param {Buffer|string} input
 * @param {number} contrast - -1 to 1
 * @param {number} brightness - -1 to 1
 * @returns {Promise<Buffer>}
 */
export async function adjustImage(input, contrast = 0, brightness = 0) {
  if (!isNode || !Jimp) {
    throw new Error('Jimp adjustments only available in Node.js');
  }
  
  try {
    const image = await Jimp.read(input);
    
    if (contrast !== 0) {
      image.contrast(contrast);
    }
    
    if (brightness !== 0) {
      image.brightness(brightness);
    }
    
    return await image.getBufferAsync(Jimp.MIME_PNG);
  } catch (error) {
    console.error('Jimp adjustment failed:', error);
    throw error;
  }
}

/**
 * Create thumbnail
 * @param {Buffer|string} input
 * @param {number} size - thumbnail size (square)
 * @returns {Promise<Buffer>}
 */
export async function createThumbnail(input, size = 256) {
  if (!isNode || !Jimp) {
    throw new Error('Jimp thumbnail only available in Node.js');
  }
  
  try {
    const image = await Jimp.read(input);
    image.cover(size, size, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
    return await image.getBufferAsync(Jimp.MIME_PNG);
  } catch (error) {
    console.error('Jimp thumbnail failed:', error);
    throw error;
  }
}

/**
 * Rotate image
 * @param {Buffer|string} input
 * @param {number} degrees - rotation angle
 * @returns {Promise<Buffer>}
 */
export async function rotateImage(input, degrees) {
  if (!isNode || !Jimp) {
    throw new Error('Jimp rotate only available in Node.js');
  }
  
  try {
    const image = await Jimp.read(input);
    image.rotate(degrees);
    return await image.getBufferAsync(Jimp.MIME_PNG);
  } catch (error) {
    console.error('Jimp rotate failed:', error);
    throw error;
  }
}

/**
 * Get image info without loading full image
 * @param {Buffer|string} input
 * @returns {Promise<{width: number, height: number, mime: string}>}
 */
export async function getImageInfo(input) {
  if (!isNode || !Jimp) {
    throw new Error('Jimp info only available in Node.js');
  }
  
  try {
    const image = await Jimp.read(input);
    return {
      width: image.bitmap.width,
      height: image.bitmap.height,
      mime: image.getMIME()
    };
  } catch (error) {
    console.error('Jimp info failed:', error);
    throw error;
  }
}

export { isNode, Jimp };
