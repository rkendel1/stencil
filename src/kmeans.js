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
 * @param {Float32Array} values
 * @param {number}       k
 * @returns {{ centroids: Float64Array, assignments: Int32Array }}
 */
export function adaptiveThreshold(values, k) {
  const n = values.length;
  const sorted = Float32Array.from(values).sort();
  const binSize = Math.ceil(n / k);

  // Compute thresholds from sorted values
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
