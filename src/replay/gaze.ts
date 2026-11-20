// Gaze → screen calibration. Webcam blendshape gaze is coarse, so the model is
// deliberately simple (ridge regression on gaze + head pose) and its accuracy
// is always measured on held-out validation points, never assumed.

export interface GazeInput {
  gx: number;
  gy: number;
  yaw: number;
  pitch: number;
}

export const gazeFeatures = (s: GazeInput) => [1, s.gx, s.gy, s.yaw / 30, s.pitch / 30];

/** Solve (XᵀX + λI′) w = Xᵀy (intercept not regularised) by Gaussian elimination. */
export function fitRidge(X: number[][], y: number[], lambda = 1e-3): number[] {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    const x = X[r];
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) A[i][j] += x[i] * x[j];
      A[i][p] += x[i] * y[r];
    }
  }
  for (let i = 1; i < p; i++) A[i][i] += lambda * X.length;
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[p] / (A[i][i] || 1e-12));
}

export interface CalibSample {
  input: GazeInput;
  target: [number, number];
}

export function fitGaze(samples: CalibSample[]) {
  const X = samples.map((s) => gazeFeatures(s.input));
  return { cx: fitRidge(X, samples.map((s) => s.target[0])), cy: fitRidge(X, samples.map((s) => s.target[1])) };
}

export function applyGaze(c: { cx: number[]; cy: number[] }, s: GazeInput): [number, number] {
  const f = gazeFeatures(s);
  const dot = (w: number[]) => w.reduce((a, wi, i) => a + wi * f[i], 0);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [clamp(dot(c.cx)), clamp(dot(c.cy))];
}

/** Mean Euclidean error per target point (fraction of screen), averaging samples per point first. */
export function validationError(c: { cx: number[]; cy: number[] }, samples: CalibSample[], aspect = 16 / 9): number {
  const byTarget = new Map<string, { sx: number; sy: number; n: number; t: [number, number] }>();
  for (const s of samples) {
    const k = s.target.join();
    const [x, y] = applyGaze(c, s.input);
    const e = byTarget.get(k) ?? { sx: 0, sy: 0, n: 0, t: s.target };
    e.sx += x; e.sy += y; e.n++;
    byTarget.set(k, e);
  }
  let sum = 0;
  for (const e of byTarget.values()) {
    // error in units of screen width (y scaled by height/width)
    sum += Math.hypot(e.sx / e.n - e.t[0], (e.sy / e.n - e.t[1]) / aspect);
  }
  return byTarget.size ? sum / byTarget.size : NaN;
}

export const CALIB_POINTS: [number, number][] = [
  [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
  [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
  [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
];
export const VALID_POINTS: [number, number][] = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];

export function accuracyLabel(err: number): { label: string; tone: string } {
  if (!Number.isFinite(err)) return { label: "Unknown", tone: "var(--color-faint)" };
  if (err < 0.1) return { label: "Good", tone: "var(--color-ok)" };
  if (err < 0.18) return { label: "Fair", tone: "var(--color-load)" };
  return { label: "Poor", tone: "var(--color-bad)" };
}

/** "±7%" — never claims a perfect 0%. */
export const fmtAccuracy = (err: number) => (!Number.isFinite(err) ? "—" : err < 0.01 ? "<1%" : `±${Math.round(err * 100)}%`);
