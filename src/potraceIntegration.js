/**
 * potraceIntegration.js
 * Professional bitmap-to-vector tracing using Potrace
 */

import Potrace from 'potrace';

/**
 * Trace a binary mask to SVG path using Potrace
 * @param {Uint8Array} mask - binary mask (0 or 1)
 * @param {number} width
 * @param {number} height
 * @param {object} options - Potrace options
 * @returns {Promise<string>} SVG path data
 */
export async function traceMaskWithPotrace(mask, width, height, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      // Convert mask to ImageData-like structure for Potrace
      const imageData = {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height
      };
      
      // Convert binary mask to RGBA (black for 1, white for 0)
      for (let i = 0; i < mask.length; i++) {
        const value = mask[i] ? 0 : 255; // Inverted: potrace traces black
        imageData.data[i * 4] = value;
        imageData.data[i * 4 + 1] = value;
        imageData.data[i * 4 + 2] = value;
        imageData.data[i * 4 + 3] = 255;
      }
      
      // Default Potrace parameters
      const params = {
        threshold: 128,
        turdSize: 2,           // Suppress speckles of up to this size
        alphaMax: 1.0,         // Corner threshold parameter
        optCurve: true,        // Optimize curves
        optTolerance: 0.2,     // Curve optimization tolerance
        ...options
      };
      
      // Trace the image
      Potrace.trace(imageData, params, (err, svg) => {
        if (err) {
          console.error('Potrace tracing failed:', err);
          reject(err);
          return;
        }
        
        // Extract path data from SVG
        const pathMatch = svg.match(/<path[^>]*d="([^"]*)"/);
        if (pathMatch && pathMatch[1]) {
          resolve(pathMatch[1]);
        } else {
          reject(new Error('Failed to extract path from Potrace SVG'));
        }
      });
    } catch (error) {
      console.error('Potrace integration error:', error);
      reject(error);
    }
  });
}

/**
 * Trace with posterization (multiple layers)
 * @param {ImageData} imageData
 * @param {number} levels - number of levels to trace
 * @param {object} options
 * @returns {Promise<Array<string>>} array of SVG path data strings
 */
export async function posterizeTrace(imageData, levels = 4, options = {}) {
  const promises = [];
  
  for (let i = 0; i < levels; i++) {
    const threshold = Math.floor((256 / levels) * (i + 1));
    
    promises.push(new Promise((resolve, reject) => {
      Potrace.trace(imageData, {
        threshold,
        turdSize: 2,
        alphaMax: 1.0,
        optCurve: true,
        optTolerance: 0.2,
        ...options
      }, (err, svg) => {
        if (err) {
          reject(err);
          return;
        }
        
        const pathMatch = svg.match(/<path[^>]*d="([^"]*)"/);
        resolve(pathMatch ? pathMatch[1] : '');
      });
    }));
  }
  
  try {
    return await Promise.all(promises);
  } catch (error) {
    console.error('Posterize trace failed:', error);
    return [];
  }
}

/**
 * Get full SVG from Potrace (not just path data)
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {object} options
 * @returns {Promise<string>} complete SVG string
 */
export async function getFullSVG(mask, width, height, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const imageData = {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height
      };
      
      for (let i = 0; i < mask.length; i++) {
        const value = mask[i] ? 0 : 255;
        imageData.data[i * 4] = value;
        imageData.data[i * 4 + 1] = value;
        imageData.data[i * 4 + 2] = value;
        imageData.data[i * 4 + 3] = 255;
      }
      
      const params = {
        threshold: 128,
        turdSize: 2,
        alphaMax: 1.0,
        optCurve: true,
        optTolerance: 0.2,
        color: 'black',
        background: 'transparent',
        ...options
      };
      
      Potrace.trace(imageData, params, (err, svg) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(svg);
      });
    } catch (error) {
      reject(error);
    }
  });
}
