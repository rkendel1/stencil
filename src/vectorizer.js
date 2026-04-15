/**
 * vectorizer.js
 * Converts a binary mask to SVG paths using the marching squares algorithm,
 * followed by Douglas-Peucker path simplification.
 */

// ---------------------------------------------------------------------------
// Marching squares lookup table
// Corner bit order: bit0=TL, bit1=TR, bit2=BR, bit3=BL
// Edge indices:     0=Left, 1=Top, 2=Right, 3=Bottom
// Each entry is a list of [edgeA, edgeB] segment pairs.
// ---------------------------------------------------------------------------
const MS_TABLE = [
  [],               // 0:  all outside
  [[0, 1]],         // 1:  TL
  [[1, 2]],         // 2:  TR
  [[0, 2]],         // 3:  TL+TR
  [[2, 3]],         // 4:  BR
  [[0, 1], [2, 3]], // 5:  TL+BR  (saddle)
  [[1, 3]],         // 6:  TR+BR
  [[0, 3]],         // 7:  TL+TR+BR
  [[3, 0]],         // 8:  BL
  [[3, 1]],         // 9:  TL+BL
  [[1, 2], [3, 0]], // 10: TR+BL  (saddle)
  [[3, 2]],         // 11: TL+TR+BL
  [[2, 0]],         // 12: BR+BL
  [[2, 1]],         // 13: TL+BR+BL
  [[0, 1]],         // 14: TR+BR+BL  (only TL outside → left↔top corner, reversed winding from case 1)
  [],               // 15: all inside
];

/**
 * Compute the midpoint coordinate for an edge of a cell.
 * @param {number} edge  - 0=Left, 1=Top, 2=Right, 3=Bottom
 * @param {number} col
 * @param {number} row
 * @returns {[number, number]}
 */
function edgeMid(edge, col, row) {
  switch (edge) {
    case 0: return [col,       row + 0.5]; // Left
    case 1: return [col + 0.5, row];       // Top
    case 2: return [col + 1,   row + 0.5]; // Right
    case 3: return [col + 0.5, row + 1];   // Bottom
    default: return [col, row];
  }
}

/**
 * Run marching squares on a binary mask.
 * @param {Uint8Array} mask   - 1 = inside, 0 = outside
 * @param {number}     width
 * @param {number}     height
 * @returns {Array<[[number,number],[number,number]]>} list of line segments
 */
export function marchingSquares(mask, width, height) {
  const segments = [];

  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const tl = mask[row       * width + col]     ? 1 : 0;
      const tr = mask[row       * width + col + 1] ? 1 : 0;
      const br = mask[(row + 1) * width + col + 1] ? 1 : 0;
      const bl = mask[(row + 1) * width + col]     ? 1 : 0;

      const caseIdx = tl | (tr << 1) | (br << 2) | (bl << 3);
      const segs = MS_TABLE[caseIdx];

      for (const [ea, eb] of segs) {
        segments.push([edgeMid(ea, col, row), edgeMid(eb, col, row)]);
      }
    }
  }

  return segments;
}

/**
 * Stitch raw segments into closed (or open) polyline contours.
 * @param {Array} segments
 * @returns {Array<Array<[number,number]>>} list of contours (arrays of points)
 */
export function stitchContours(segments) {
  if (!segments.length) return [];

  const fmt  = (p) => `${p[0] * 2},${p[1] * 2}`; // multiply to avoid float rounding
  const used = new Uint8Array(segments.length);

  // Build endpoint → [segmentIndex, otherEndpoint] map
  const adj = new Map();
  for (let i = 0; i < segments.length; i++) {
    const [p1, p2] = segments[i];
    const k1 = fmt(p1), k2 = fmt(p2);

    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);

    adj.get(k1).push({ segIdx: i, other: p2, otherKey: k2 });
    adj.get(k2).push({ segIdx: i, other: p1, otherKey: k1 });
  }

  const contours = [];

  for (let startIdx = 0; startIdx < segments.length; startIdx++) {
    if (used[startIdx]) continue;

    used[startIdx] = 1;
    const [startP1, startP2] = segments[startIdx];
    const contour = [startP1, startP2];

    let currentKey = fmt(startP2);
    const startKey = fmt(startP1);

    // Walk forward
    let stuck = false;
    while (!stuck) {
      const neighbors = adj.get(currentKey) || [];
      let moved = false;

      for (const { segIdx, other, otherKey } of neighbors) {
        if (used[segIdx]) continue;
        used[segIdx] = 1;
        contour.push(other);
        currentKey = otherKey;
        moved = true;
        break;
      }

      if (!moved) stuck = true;
      if (currentKey === startKey) break; // closed loop
    }

    if (contour.length >= 3) {
      contours.push(contour);
    }
  }

  return contours;
}

/**
 * Douglas-Peucker path simplification.
 * @param {Array<[number,number]>} points
 * @param {number}                 epsilon - max allowed deviation
 * @returns {Array<[number,number]>}
 */
export function douglasPeucker(points, epsilon) {
  if (points.length <= 2) return points;

  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);

  let maxDist = 0;
  let maxIdx  = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist = len === 0
      ? Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
      : Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;

    if (dist > maxDist) {
      maxDist = dist;
      maxIdx  = i;
    }
  }

  if (maxDist > epsilon) {
    const left  = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx),        epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[points.length - 1]];
}

/**
 * Calculate the signed area of a polygon using the shoelace formula.
 * Returns a positive value for counter-clockwise winding and negative for clockwise.
 * @param {Array<[number,number]>} points
 * @returns {number} absolute area in square pixels
 */
export function contourArea(points) {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Smooth a contour using Chaikin's corner-cutting algorithm.
 * Produces curves that are easier to cut cleanly than jagged pixel-aligned paths.
 * @param {Array<[number,number]>} points
 * @param {number}                 iterations - number of smoothing passes (1–3)
 * @returns {Array<[number,number]>}
 */
export function chaikinSmooth(points, iterations = 1) {
  if (points.length < 3) return points;

  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const smoothed = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % n];
      // Q = 3/4 of current + 1/4 of next
      // R = 1/4 of current + 3/4 of next
      smoothed.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      smoothed.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    pts = smoothed;
  }
  return pts;
}

/**
 * Convert a list of contours to an SVG path data string.
 * @param {Array<Array<[number,number]>>} contours
 * @param {number}                        scale     - multiply coords by this
 * @returns {string}
 */
export function contoursToSVGPath(contours, scale = 1) {
  return contours.map(pts => {
    if (!pts.length) return '';
    const [fx, fy] = pts[0];
    let d = `M ${(fx * scale).toFixed(2)} ${(fy * scale).toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${(pts[i][0] * scale).toFixed(2)} ${(pts[i][1] * scale).toFixed(2)}`;
    }
    return d + ' Z';
  }).join(' ');
}

/**
 * Full vectorization pipeline for a single binary mask.
 * Includes contour smoothing (Chaikin) and minimum-area filtering to produce
 * clean, cuttable paths suited for airbrush stencils.
 * @param {Uint8Array} mask
 * @param {number}     width
 * @param {number}     height
 * @param {number}     epsilon   - Douglas-Peucker tolerance
 * @param {number}     scale     - output coordinate scale factor
 * @returns {{ pathData: string, contours: Array }}
 */
export function vectorize(mask, width, height, epsilon = 1.0, scale = 1) {
  const segments = marchingSquares(mask, width, height);
  const contours = stitchContours(segments);

  // Minimum contour area in square pixels: removes micro-contours that are too
  // small to cut cleanly (roughly a 2×2 pixel minimum bounding area).
  const MIN_CONTOUR_AREA_SQ = 4;
  const MIN_AREA = Math.max(MIN_CONTOUR_AREA_SQ, epsilon * epsilon);

  const simplified = contours
    .map(c => douglasPeucker(c, epsilon))
    .filter(c => c.length >= 3)
    .filter(c => contourArea(c) >= MIN_AREA);

  // Apply one pass of Chaikin smoothing when simplification is low (detailed mode)
  // This rounds sharp pixel-corner jags into smooth curves for cleaner stencil cutting
  const smoothed = simplified.map(c => chaikinSmooth(c, epsilon <= 1.5 ? 1 : 0));

  const pathData = contoursToSVGPath(smoothed, scale);
  return { pathData, contours: smoothed };
}
