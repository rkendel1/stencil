/**
 * opencvIntegration.js
 * Integration wrapper for OpenCV.js with fallback to custom implementations
 */

let cv = null;
let cvReady = false;

/**
 * Initialize OpenCV.js
 * @returns {Promise<boolean>} true if loaded successfully
 */
export async function initOpenCV() {
  if (cvReady) return true;
  
  try {
    // Import OpenCV.js
    const opencvModule = await import('opencv.js');
    cv = opencvModule.default || opencvModule;
    
    // Wait for OpenCV to be ready
    await new Promise((resolve) => {
      if (cv.onRuntimeInitialized) {
        cv.onRuntimeInitialized = () => {
          cvReady = true;
          resolve();
        };
      } else {
        cvReady = true;
        resolve();
      }
    });
    
    console.log('OpenCV.js loaded successfully');
    return true;
  } catch (error) {
    console.warn('OpenCV.js failed to load, using fallback implementations:', error);
    return false;
  }
}

/**
 * Apply Gaussian blur using OpenCV (optimized) or fallback
 * @param {ImageData} imageData
 * @param {number} kernelSize - must be odd (e.g., 3, 5, 7)
 * @param {number} sigma
 * @returns {ImageData}
 */
export function gaussianBlur(imageData, kernelSize = 5, sigma = 0) {
  if (!cvReady || !cv) {
    // Fallback to bilateral filter
    console.warn('Using fallback bilateral filter instead of Gaussian blur');
    return imageData; // Return unchanged, or use existing bilateral filter
  }
  
  try {
    const src = cv.matFromImageData(imageData);
    const dst = new cv.Mat();
    
    // Ensure kernel size is odd
    const kSize = kernelSize % 2 === 0 ? kernelSize + 1 : kernelSize;
    const kSizeObj = new cv.Size(kSize, kSize);
    
    cv.GaussianBlur(src, dst, kSizeObj, sigma, sigma, cv.BORDER_DEFAULT);
    
    const result = new ImageData(
      new Uint8ClampedArray(dst.data),
      dst.cols,
      dst.rows
    );
    
    src.delete();
    dst.delete();
    
    return result;
  } catch (error) {
    console.error('OpenCV Gaussian blur failed:', error);
    return imageData;
  }
}

/**
 * Apply morphological operations using OpenCV (faster than custom)
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {string} operation - 'dilate', 'erode', 'open', 'close'
 * @param {number} kernelSize
 * @returns {Uint8Array}
 */
export function morphologyEx(mask, width, height, operation = 'close', kernelSize = 3) {
  if (!cvReady || !cv) {
    console.warn('OpenCV not available, operation skipped');
    return mask;
  }
  
  try {
    // Create Mat from mask
    const src = new cv.Mat(height, width, cv.CV_8UC1);
    src.data.set(mask);
    
    const dst = new cv.Mat();
    const kernel = cv.getStructuringElement(
      cv.MORPH_ELLIPSE,
      new cv.Size(kernelSize, kernelSize)
    );
    
    switch (operation) {
      case 'dilate':
        cv.dilate(src, dst, kernel);
        break;
      case 'erode':
        cv.erode(src, dst, kernel);
        break;
      case 'open':
        cv.morphologyEx(src, dst, cv.MORPH_OPEN, kernel);
        break;
      case 'close':
        cv.morphologyEx(src, dst, cv.MORPH_CLOSE, kernel);
        break;
      default:
        console.warn('Unknown morphology operation:', operation);
        src.delete();
        kernel.delete();
        return mask;
    }
    
    const result = new Uint8Array(dst.data);
    
    src.delete();
    dst.delete();
    kernel.delete();
    
    return result;
  } catch (error) {
    console.error('OpenCV morphology failed:', error);
    return mask;
  }
}

/**
 * Canny edge detection
 * @param {ImageData} imageData
 * @param {number} lowThreshold
 * @param {number} highThreshold
 * @returns {Uint8Array} binary edge map
 */
export function cannyEdgeDetection(imageData, lowThreshold = 50, highThreshold = 150) {
  if (!cvReady || !cv) {
    console.warn('OpenCV not available for Canny edge detection');
    return null;
  }
  
  try {
    const src = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    const edges = new cv.Mat();
    
    // Convert to grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    
    // Apply Canny edge detection
    cv.Canny(gray, edges, lowThreshold, highThreshold);
    
    const result = new Uint8Array(edges.data);
    
    src.delete();
    gray.delete();
    edges.delete();
    
    return result;
  } catch (error) {
    console.error('Canny edge detection failed:', error);
    return null;
  }
}

/**
 * Distance transform for finding optimal bridge placements
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} distance map
 */
export function distanceTransform(mask, width, height) {
  if (!cvReady || !cv) {
    console.warn('OpenCV not available for distance transform');
    return null;
  }
  
  try {
    const src = new cv.Mat(height, width, cv.CV_8UC1);
    src.data.set(mask);
    
    const dst = new cv.Mat();
    
    cv.distanceTransform(src, dst, cv.DIST_L2, cv.DIST_MASK_PRECISE);
    
    const result = new Float32Array(dst.data);
    
    src.delete();
    dst.delete();
    
    return result;
  } catch (error) {
    console.error('Distance transform failed:', error);
    return null;
  }
}

export { cvReady, cv };
