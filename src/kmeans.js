/**
 * kmeans.js
 * K-Means++ clustering for 1-D grayscale values (0–1 range).
 */

/**
 * Run K-Means++ on an array of values.
 * @param {Float32Array} values   - input values in [0, 1]
 * @param {number}       k        - number of clusters
 * @param {number}       maxIter  - max iterations
 * @returns {{ centroids: Float64Array, assignments: Int32Array }}
 */
export function kmeans(values, k, maxIter = 50) {
  const n = values.length;
  k = Math.min(k, n);

  // ---- K-Means++ initialization ----
  const centroids = kmeansppInit(values, k);

  const assignments = new Int32Array(n);
  let changed = true;

  for (let iter = 0; iter < maxIter && changed; iter++) {
    changed = false;

    // Assignment step
    for (let i = 0; i < n; i++) {
      const v = values[i];
      let bestCluster = 0;
      let bestDist = Math.abs(v - centroids[0]);

      for (let c = 1; c < k; c++) {
        const d = Math.abs(v - centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestCluster = c;
        }
      }

      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    // Update step
    const sums   = new Float64Array(k);
    const counts = new Int32Array(k);

    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sums[c]   += values[i];
      counts[c] += 1;
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c] = sums[c] / counts[c];
      }
    }
  }

  // Sort clusters by centroid value (darkest → brightest)
  const order = Array.from({ length: k }, (_, i) => i)
    .sort((a, b) => centroids[a] - centroids[b]);

  const remap = new Int32Array(k);
  const sortedCentroids = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    remap[order[i]] = i;
    sortedCentroids[i] = centroids[order[i]];
  }

  const remapped = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    remapped[i] = remap[assignments[i]];
  }

  return { centroids: sortedCentroids, assignments: remapped };
}

/**
 * K-Means++ seeding: choose initial centroids with probability proportional
 * to squared distance from the nearest already-chosen centroid.
 * @param {Float32Array} values
 * @param {number}       k
 * @returns {Float64Array}
 */
function kmeansppInit(values, k) {
  const n = values.length;
  const centroids = new Float64Array(k);

  // Choose first centroid randomly
  centroids[0] = values[Math.floor(Math.random() * n)];

  const dists = new Float64Array(n).fill(Infinity);

  for (let c = 1; c < k; c++) {
    // Update distances to nearest centroid
    for (let i = 0; i < n; i++) {
      const d = Math.abs(values[i] - centroids[c - 1]);
      if (d < dists[i]) dists[i] = d;
    }

    // Weighted random choice
    let total = 0;
    for (let i = 0; i < n; i++) total += dists[i] * dists[i];

    let r = Math.random() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      r -= dists[i] * dists[i];
      if (r <= 0) { chosen = i; break; }
    }

    centroids[c] = values[chosen];
  }

  return centroids;
}

/**
 * Segment pixels using equal-width threshold bands (posterize / simple threshold).
 * @param {Float32Array} values - grayscale values in [0,1]
 * @param {number}       k      - number of segments
 * @returns {{ centroids: Float64Array, assignments: Int32Array }}
 */
export function posterize(values, k) {
  const n = values.length;
  const assignments = new Int32Array(n);
  const centroids   = new Float64Array(k);

  for (let c = 0; c < k; c++) {
    centroids[c] = (c + 0.5) / k;
  }

  for (let i = 0; i < n; i++) {
    assignments[i] = Math.min(k - 1, Math.floor(values[i] * k));
  }

  return { centroids, assignments };
}

/**
 * Adaptive threshold segmentation: divide the histogram into k equal-population bins.
 * Uses Otsu's method for optimal threshold selection when k=2.
 * @param {Float32Array} values
 * @param {number}       k
 * @returns {{ centroids: Float64Array, assignments: Int32Array }}
 */
export function adaptiveThreshold(values, k) {
  const n = values.length;
  
  // For binary (k=2), use Otsu's method for optimal threshold
  if (k === 2) {
    return otsuThreshold(values);
  }
  
  const sorted = Float32Array.from(values).sort();
  const binSize = Math.ceil(n / k);

  // Compute thresholds from sorted values with better distribution
  const thresholds = [];
  for (let c = 1; c < k; c++) {
    const idx = Math.min(c * binSize, n - 1);
    thresholds.push(sorted[idx]);
  }
  thresholds.push(1.1); // sentinel

  const assignments = new Int32Array(n);
  const centroids   = new Float64Array(k);
  const sums   = new Float64Array(k);
  const counts = new Int32Array(k);

  for (let i = 0; i < n; i++) {
    let c = 0;
    while (c < k - 1 && values[i] > thresholds[c]) c++;
    assignments[i] = c;
    sums[c]   += values[i];
    counts[c] += 1;
  }

  for (let c = 0; c < k; c++) {
    centroids[c] = counts[c] > 0 ? sums[c] / counts[c] : (c + 0.5) / k;
  }

  return { centroids, assignments };
}

/**
 * Otsu's method for optimal binary thresholding.
 * Maximizes inter-class variance to find the best threshold.
 * @param {Float32Array} values
 * @returns {{ centroids: Float64Array, assignments: Int32Array }}
 */
export function otsuThreshold(values) {
  const n = values.length;
  const numBins = 256;
  
  // Build histogram
  const histogram = new Int32Array(numBins);
  for (let i = 0; i < n; i++) {
    const bin = Math.min(numBins - 1, Math.floor(values[i] * numBins));
    histogram[bin]++;
  }
  
  // Compute total mean
  let sum = 0;
  for (let i = 0; i < numBins; i++) {
    sum += i * histogram[i];
  }
  const totalMean = sum / n;
  
  // Find threshold that maximizes inter-class variance
  let bestThreshold = 0;
  let maxVariance = 0;
  let sumB = 0;
  let countB = 0;
  
  for (let t = 0; t < numBins; t++) {
    countB += histogram[t];
    if (countB === 0) continue;
    
    const countF = n - countB;
    if (countF === 0) break;
    
    sumB += t * histogram[t];
    const meanB = sumB / countB;
    const meanF = (sum - sumB) / countF;
    
    // Inter-class variance
    const variance = countB * countF * (meanB - meanF) * (meanB - meanF);
    
    if (variance > maxVariance) {
      maxVariance = variance;
      bestThreshold = t;
    }
  }
  
  const threshold = bestThreshold / numBins;
  
  // Assign pixels
  const assignments = new Int32Array(n);
  const centroids = new Float64Array(2);
  let sum0 = 0, sum1 = 0, count0 = 0, count1 = 0;
  
  for (let i = 0; i < n; i++) {
    if (values[i] <= threshold) {
      assignments[i] = 0;
      sum0 += values[i];
      count0++;
    } else {
      assignments[i] = 1;
      sum1 += values[i];
      count1++;
    }
  }
  
  centroids[0] = count0 > 0 ? sum0 / count0 : 0.25;
  centroids[1] = count1 > 0 ? sum1 / count1 : 0.75;
  
  return { centroids, assignments };
}

/**
 * Convert grayscale to pure binary (black & white) using adaptive local thresholding.
 * Removes all mid-tones for clean stencil cuts.
 * @param {Float32Array} values - grayscale in [0,1]
 * @param {number} width
 * @param {number} height
 * @param {number} windowSize - local window size (default 15)
 * @returns {Uint8Array} binary mask (0 or 1)
 */
export function toBinaryMask(values, width, height, windowSize = 15) {
  const n = values.length;
  const mask = new Uint8Array(n);
  const halfWindow = Math.floor(windowSize / 2);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      // Compute local mean
      let sum = 0, count = 0;
      for (let dy = -halfWindow; dy <= halfWindow; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -halfWindow; dx <= halfWindow; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          sum += values[ny * width + nx];
          count++;
        }
      }
      
      const localMean = sum / count;
      // Add bias to favor darker regions (better for stencils)
      const threshold = localMean * 0.95;
      mask[idx] = values[idx] <= threshold ? 1 : 0;
    }
  }
  
  return mask;
}
