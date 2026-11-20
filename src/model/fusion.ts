// Runtime for the exported boosted late-fusion model — mirrors ml/lucid_ml/runtime.py.

export interface ModelJson {
  format: string;
  target: string;
  classes: string[];
  class_load: number[];
  window: { rows: number; hop: number; skip_ms: number; min_face_frac: number };
  features: string[];
  modality_labels: Record<string, string>;
  modalities: { name: string; features: string[]; baseline: number[]; trees: number[][][] }[];
  meta: { coef: number[][]; intercept: number[] };
  importance: Record<string, number>;
  eval: {
    protocol: string;
    macro_f1: number;
    ci95: [number, number];
    balanced_accuracy: number;
    block_spearman_tlx: number;
    baselines: Record<string, number>;
    /** added in v1.0 exports */
    baseline_ci95?: Record<string, [number, number]>;
    confusion?: number[][];
    per_participant_f1?: { mean: number; sd: number };
    ablation?: Record<string, { alone: number; without: number }> | null;
  };
  data: { participants: number; windows: number; synthetic: boolean; sources: string[] };
  created: string;
}

export interface Prediction {
  proba: number[];
  /** expected load 0..1 (Σ p·class_load) */
  load: number;
  /** per-modality push toward high (+) or low (−) load, in meta-logit units */
  contributions: Record<string, number>;
}

const NODE = 7;

export function treeValue(flat: number[], x: number[]): number {
  let i = 0;
  for (;;) {
    const b = i * NODE;
    if (flat[b + 5]) return flat[b + 4];
    const v = x[flat[b]];
    if (Number.isNaN(v)) i = flat[b + 6] ? flat[b + 2] : flat[b + 3];
    else i = v <= flat[b + 1] ? flat[b + 2] : flat[b + 3];
  }
}

function logSoftmax(z: number[]) {
  const m = Math.max(...z);
  const s = Math.log(z.reduce((a, v) => a + Math.exp(v - m), 0));
  return z.map((v) => v - m - s);
}

export function predict(model: ModelJson, rel: number[]): Prediction {
  const fi: Record<string, number> = {};
  model.features.forEach((f, i) => (fi[f] = i));
  const s: number[] = [];
  for (const mod of model.modalities) {
    const x = mod.features.map((f) => rel[fi[f]]);
    const raw = [...mod.baseline];
    for (const perClass of mod.trees) perClass.forEach((flat, k) => (raw[k] += treeValue(flat, x)));
    s.push(...logSoftmax(raw));
  }
  const { coef: W, intercept: b } = model.meta;
  const z = b.map((bc, c) => bc + W[c].reduce((a, w, j) => a + w * s[j], 0));
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const sum = e.reduce((a, v) => a + v, 0);
  const proba = e.map((v) => v / sum);
  const load = proba.reduce((a, p, i) => a + p * model.class_load[i], 0);

  const k = model.classes.length, hi = k - 1, lo = 0;
  const contributions: Record<string, number> = {};
  model.modalities.forEach((mod, i) => {
    let c = 0;
    for (let j = 0; j < k; j++) c += (W[hi][i * k + j] - W[lo][i * k + j]) * s[i * k + j];
    contributions[mod.name] = c;
  });
  return { proba, load, contributions };
}
