// Gaze heatmap: Gaussian splat accumulation on a coarse grid (pure).

export interface Heat {
  w: number;
  h: number;
  grid: Float32Array;
  max: number;
  /** 3×3 region shares, row-major (top-left → bottom-right) */
  regions: number[];
  n: number;
}

export function accumulate(points: ([number, number] | null)[], w = 96, h = 54, sigma = 2.2): Heat {
  const grid = new Float32Array(w * h);
  const regions = new Array(9).fill(0);
  const R = Math.ceil(sigma * 3);
  const k: number[] = [];
  for (let d = -R; d <= R; d++) k.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
  let n = 0;
  for (const p of points) {
    if (!p) continue;
    n++;
    const [x, y] = p;
    regions[Math.min(2, Math.floor(y * 3)) * 3 + Math.min(2, Math.floor(x * 3))]++;
    const cx = Math.round(x * (w - 1)), cy = Math.round(y * (h - 1));
    for (let dy = -R; dy <= R; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= w) continue;
        grid[yy * w + xx] += k[dx + R] * k[dy + R];
      }
    }
  }
  let max = 0;
  for (const v of grid) if (v > max) max = v;
  return { w, h, grid, max, regions: n ? regions.map((r) => r / n) : regions, n };
}

// paper → indigo wash → ochre → deep umber (reads on cream, prints well)
const STOPS: [number, [number, number, number, number]][] = [
  [0, [245, 240, 230, 0]],
  [0.15, [90, 69, 176, 60]],
  [0.45, [90, 69, 176, 140]],
  [0.75, [181, 115, 10, 205]],
  [1, [106, 66, 6, 255]],
];

export function colorAt(v: number): [number, number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    if (v <= p1) {
      const [p0, c0] = STOPS[i - 1];
      const u = (v - p0) / (p1 - p0);
      return c0.map((c, j) => Math.round(c + u * (c1[j] - c))) as [number, number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Render to a canvas (sqrt scaling so brief glances stay visible). */
export function paint(canvas: HTMLCanvasElement, heat: Heat) {
  canvas.width = heat.w;
  canvas.height = heat.h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(heat.w, heat.h);
  for (let i = 0; i < heat.grid.length; i++) {
    const c = colorAt(heat.max ? Math.sqrt(heat.grid[i] / heat.max) : 0);
    img.data.set(c, i * 4);
  }
  ctx.putImageData(img, 0, 0);
}
