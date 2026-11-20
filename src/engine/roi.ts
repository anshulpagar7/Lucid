// Skin regions of interest for rPPG (MediaPipe Face Mesh indices).
// Forehead + both cheeks: well-perfused, few edges, rarely covered by hair or
// eyebrows. Shared by the worker (sampling) and the UI (overlay).

export const ROI_FOREHEAD = [67, 109, 10, 338, 297, 299, 337, 151, 108, 69];
export const ROI_CHEEK_R = [118, 119, 100, 126, 209, 49, 129, 203, 205, 50];
export const ROI_CHEEK_L = [347, 348, 329, 355, 429, 279, 358, 423, 425, 280];
export const ROIS = [ROI_FOREHEAD, ROI_CHEEK_R, ROI_CHEEK_L];

export interface XY {
  x: number;
  y: number;
}

/** Andrew's monotone-chain convex hull — robust to landmark ordering. */
export function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: XY[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: XY[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
