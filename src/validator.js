/**
 * validator.js
 * Structural validation for stencil layers:
 *   – connected-component analysis
 *   – island / floating-piece detection
 *   – bridge generation to connect isolated regions
 */

/**
 * Label connected components in a binary mask using 4-connectivity BFS.
 * @param {Uint8Array} mask
 * @param {number}     width
 * @param {number}     height
 * @returns {{ labels: Int32Array, count: number }}
 */
export function labelComponents(mask, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  let count = 0;

  const queue = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;

    // BFS from this pixel
    labels[start] = count;
    queue.length = 0;
    queue.push(start);
    let head = 0;

    while (head < queue.length) {
      const idx = queue[head++];
      const x = idx % width;
      const y = (idx / width) | 0;

      const neighbors = [
        y > 0          ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
        x > 0          ? idx - 1     : -1,
        x < width - 1  ? idx + 1     : -1,
      ];

      for (const nb of neighbors) {
        if (nb >= 0 && mask[nb] && labels[nb] === -1) {
          labels[nb] = count;
          queue.push(nb);
        }
      }
    }

    count++;
  }

  return { labels, count };
}

/**
 * Get the pixel count for each component.
 * @param {Int32Array} labels
 * @param {number}     count
 * @returns {Int32Array}
 */
export function componentSizes(labels, count) {
  const sizes = new Int32Array(count);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] >= 0) sizes[labels[i]]++;
  }
  return sizes;
}

/**
 * Analyse a mask and return validation warnings.
 * @param {Uint8Array} mask
 * @param {number}     width
 * @param {number}     height
 * @param {number}     minIslandArea  - components smaller than this are "islands"
 * @returns {{ warnings: string[], islandCount: number, largestComponent: number }}
 */
export function validateMask(mask, width, height, minIslandArea = 50) {
  const total = mask.reduce((s, v) => s + v, 0);

  if (total === 0) {
    return { warnings: ['Layer is empty (no pixels).'], islandCount: 0, largestComponent: 0 };
  }

  const { labels, count } = labelComponents(mask, width, height);
  const sizes = componentSizes(labels, count);

  const maxSize = Math.max(...sizes);
  const islands = sizes.filter(s => s > 0 && s < minIslandArea).length;
  const floaters = sizes.filter(s => s >= minIslandArea && s < maxSize * 0.05).length;

  const warnings = [];

  if (islands > 0) {
    warnings.push(`${islands} micro-fragment(s) detected (< ${minIslandArea} px). Consider enabling auto-fix.`);
  }

  if (floaters > 0) {
    warnings.push(`${floaters} floating region(s) detected. Bridges will be generated.`);
  }

  if (total < width * height * 0.005) {
    warnings.push('Layer coverage is very low — may not produce a usable stencil.');
  }

  return { warnings, islandCount: islands + floaters, largestComponent: maxSize, componentCount: count };
}

/**
 * Remove micro-fragment components (smaller than minArea pixels) from a mask.
 * @param {Uint8Array} mask   - mutated in place
 * @param {number}     width
 * @param {number}     height
 * @param {number}     minArea
 * @returns {number} number of pixels removed
 */
export function removeMicroFragments(mask, width, height, minArea = 16) {
  const { labels, count } = labelComponents(mask, width, height);
  const sizes = componentSizes(labels, count);

  let removed = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && sizes[labels[i]] < minArea) {
      mask[i] = 0;
      removed++;
    }
  }

  return removed;
}

/**
 * Generate bridges connecting isolated components to the largest component.
 * A bridge is a thin horizontal or vertical line of pixels drawn through
 * the background between the nearest points of two components.
 *
 * @param {Uint8Array} mask          - mutated in place
 * @param {number}     width
 * @param {number}     height
 * @param {number}     bridgeWidth   - thickness of the bridge in pixels
 * @returns {number} number of bridges added
 */
export function generateBridges(mask, width, height, bridgeWidth = 4) {
  const { labels, count } = labelComponents(mask, width, height);
  if (count <= 1) return 0;

  const sizes = componentSizes(labels, count);

  // Find the main (largest) component
  let mainComp = 0;
  for (let c = 1; c < count; c++) {
    if (sizes[c] > sizes[mainComp]) mainComp = c;
  }

  // For each non-main component, find the closest pixel to the main component
  // and draw a horizontal bridge.
  let bridgesAdded = 0;
  const halfBridge = Math.max(1, Math.floor(bridgeWidth / 2));

  // Cache pixel positions per component (sample up to 500 pixels for speed)
  const compPixels = Array.from({ length: count }, () => []);
  for (let i = 0; i < labels.length; i++) {
    const c = labels[i];
    if (c >= 0 && mask[i] && compPixels[c].length < 500) {
      compPixels[c].push(i);
    }
  }

  for (let c = 0; c < count; c++) {
    if (c === mainComp || sizes[c] === 0) continue;

    // Find closest pair between component c and mainComp
    let bestDist = Infinity;
    let bestFrom = -1;
    let bestTo   = -1;

    for (const fi of compPixels[c]) {
      const fx = fi % width;
      const fy = (fi / width) | 0;

      for (const ti of compPixels[mainComp]) {
        const tx = ti % width;
        const ty = (ti / width) | 0;
        const dist = Math.abs(fx - tx) + Math.abs(fy - ty); // Manhattan dist
        if (dist < bestDist) {
          bestDist = dist;
          bestFrom = fi;
          bestTo   = ti;
        }
      }
    }

    if (bestFrom === -1 || bestTo === -1) continue;

    // Draw L-shaped bridge: horizontal then vertical segment
    const x1 = bestFrom % width,  y1 = (bestFrom / width) | 0;
    const x2 = bestTo   % width,  y2 = (bestTo   / width) | 0;

    // Horizontal segment at y1 from x1 to x2
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    for (let x = xMin; x <= xMax; x++) {
      for (let dy = -halfBridge; dy <= halfBridge; dy++) {
        const ny = Math.max(0, Math.min(height - 1, y1 + dy));
        mask[ny * width + x] = 1;
      }
    }

    // Vertical segment at x2 from y1 to y2
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);
    for (let y = yMin; y <= yMax; y++) {
      for (let dx = -halfBridge; dx <= halfBridge; dx++) {
        const nx = Math.max(0, Math.min(width - 1, x2 + dx));
        mask[y * width + nx] = 1;
      }
    }

    bridgesAdded++;
  }

  return bridgesAdded;
}

/**
 * Full auto-fix pipeline for a mask.
 * @param {Uint8Array} mask
 * @param {number}     width
 * @param {number}     height
 * @param {object}     opts
 * @param {number}     [opts.minIslandArea=16]
 * @param {number}     [opts.bridgeWidth=4]
 * @returns {{ fragmentsRemoved: number, bridgesAdded: number }}
 */
export function autoFix(mask, width, height, opts = {}) {
  const { minIslandArea = 16, bridgeWidth = 4 } = opts;

  const fragmentsRemoved = removeMicroFragments(mask, width, height, minIslandArea);
  const bridgesAdded     = generateBridges(mask, width, height, bridgeWidth);

  return { fragmentsRemoved, bridgesAdded };
}

/**
 * Morphological closing operation: dilation followed by erosion.
 * Fills small holes and connects nearby regions for cleaner stencils.
 * @param {Uint8Array} mask - mutated in place
 * @param {number} width
 * @param {number} height
 * @param {number} radius - structuring element radius
 */
export function morphologicalClose(mask, width, height, radius = 1) {
  // First dilate
  const temp = new Uint8Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let hasNeighbor = false;
      
      for (let dy = -radius; dy <= radius; dy++) {
        if (hasNeighbor) break;
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (mask[ny * width + nx]) {
            hasNeighbor = true;
            break;
          }
        }
      }
      
      temp[idx] = hasNeighbor ? 1 : 0;
    }
  }
  
  // Then erode
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let allNeighbors = true;
      
      for (let dy = -radius; dy <= radius; dy++) {
        if (!allNeighbors) break;
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (!temp[ny * width + nx]) {
            allNeighbors = false;
            break;
          }
        }
      }
      
      mask[idx] = allNeighbors ? 1 : 0;
    }
  }
}
