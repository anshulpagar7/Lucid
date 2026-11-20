// Study protocol: n-back working-memory task + NASA-TLX.
//
// Cognitive load is *induced* by n-back difficulty (0/1/2/3-back) and
// *measured* subjectively with NASA-TLX after every block — two independent
// ground-truth labels for training. Pure TypeScript, unit-tested.
//
// References: Kirchner (1958) n-back; Owen et al. (2005) meta-analysis;
// Hart & Staveland (1988) NASA-TLX; Hart (2006) Raw-TLX.

export type NLevel = 0 | 1 | 2 | 3;

export interface ProtocolConfig {
  name: string;
  baselineS: number;
  /** trials per block */
  trials: number;
  restS: number;
  stimMs: number;
  /** stimulus onset asynchrony (stim + blank) */
  soaMs: number;
  targetRate: number;
  practiceTrials: number;
}

export const PROTOCOLS: Record<"full" | "quick", ProtocolConfig> = {
  // ≈ 12 min — use for real data collection
  full: { name: "Full study", baselineS: 60, trials: 36, restS: 20, stimMs: 500, soaMs: 2500, targetRate: 0.3, practiceTrials: 12 },
  // ≈ 4 min — demos / viva
  quick: { name: "Quick demo", baselineS: 20, trials: 12, restS: 8, stimMs: 500, soaMs: 2500, targetRate: 0.33, practiceTrials: 6 },
};

/** Balanced Latin square for 4 conditions: each level appears once in each
 *  position, and each level precedes every other level exactly once. */
export const LATIN_SQUARE: NLevel[][] = [
  [0, 1, 3, 2],
  [1, 2, 0, 3],
  [2, 3, 1, 0],
  [3, 0, 2, 1],
];

/** Block order for a participant, e.g. "P07" → row 7 % 4. */
export function blockOrder(participantId: string): NLevel[] {
  const num = parseInt(participantId.replace(/\D/g, ""), 10);
  const row = Number.isFinite(num) ? num % 4 : hash(participantId) % 4;
  return LATIN_SQUARE[row];
}

// Consonants only — avoids pronounceable words that aid rehearsal.
export const LETTERS = "BCDFGHJKLMNPQRSTVWXZ".split("");
export const ZERO_BACK_TARGET = "X";

export interface Trial {
  index: number;
  letter: string;
  isTarget: boolean;
}

/** Seeded PRNG (mulberry32) so sequences are reproducible per participant/block. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Generate an n-back sequence with an exact target count.
 * 0-back: target = the letter X. n-back: target = same letter as n trials ago.
 * Non-targets never accidentally match (no unintended targets).
 */
export function generateSequence(n: NLevel, trials: number, targetRate: number, seed: number): Trial[] {
  const rnd = prng(seed);
  const eligible = n === 0 ? trials : trials - n;
  const nTargets = Math.round(eligible * targetRate);
  // choose target positions among eligible trials
  const positions = Array.from({ length: eligible }, (_, i) => i + (n === 0 ? 0 : n));
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const targetSet = new Set(positions.slice(0, nTargets));

  const pool = n === 0 ? LETTERS.filter((l) => l !== ZERO_BACK_TARGET) : LETTERS;
  const pick = (exclude: string[]) => {
    const opts = pool.filter((l) => !exclude.includes(l));
    return opts[Math.floor(rnd() * opts.length)];
  };

  const seq: Trial[] = [];
  for (let i = 0; i < trials; i++) {
    const isTarget = targetSet.has(i);
    let letter: string;
    if (n === 0) letter = isTarget ? ZERO_BACK_TARGET : pick([]);
    else if (isTarget) letter = seq[i - n].letter;
    else {
      // avoid an accidental n-back match, and immediate repeats (lures)
      const ex: string[] = [];
      if (i - n >= 0) ex.push(seq[i - n].letter);
      if (i - 1 >= 0) ex.push(seq[i - 1].letter);
      letter = pick(ex);
    }
    seq.push({ index: i, letter, isTarget });
  }
  return seq;
}

export interface Response {
  trial: number;
  /** ms from stimulus onset, or null for no response */
  rt: number | null;
}

export interface BlockScore {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  accuracy: number;
  /** sensitivity index d′ (log-linear corrected) */
  dPrime: number;
  /** mean RT on hits, ms */
  meanRt: number | null;
}

/** Inverse standard-normal CDF (Acklam's rational approximation, |ε| < 1.2e-9). */
export function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > hi) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function scoreBlock(trials: Trial[], responses: Response[], skipFirst = 0): BlockScore {
  const byTrial = new Map(responses.map((r) => [r.trial, r]));
  let hits = 0, misses = 0, fa = 0, cr = 0;
  const rts: number[] = [];
  for (const t of trials) {
    if (t.index < skipFirst) continue; // first n trials can't be targets
    const r = byTrial.get(t.index);
    const responded = r?.rt != null;
    if (t.isTarget) {
      if (responded) {
        hits++;
        rts.push(r!.rt!);
      } else misses++;
    } else if (responded) fa++;
    else cr++;
  }
  const total = hits + misses + fa + cr;
  // log-linear correction (Hautus, 1995): avoids infinite d′ at 0% / 100%
  const hr = (hits + 0.5) / (hits + misses + 1);
  const far = (fa + 0.5) / (fa + cr + 1);
  return {
    hits, misses, falseAlarms: fa, correctRejections: cr,
    accuracy: total ? (hits + cr) / total : 0,
    dPrime: probit(hr) - probit(far),
    meanRt: rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : null,
  };
}

// ---- NASA-TLX (raw / unweighted) ----

export const TLX_SCALES = [
  { key: "mental", label: "Mental demand", q: "How mentally demanding was the task?", lo: "Very low", hi: "Very high" },
  { key: "physical", label: "Physical demand", q: "How physically demanding was the task?", lo: "Very low", hi: "Very high" },
  { key: "temporal", label: "Temporal demand", q: "How hurried or rushed was the pace?", lo: "Very low", hi: "Very high" },
  { key: "performance", label: "Performance", q: "How successful were you in doing what you were asked?", lo: "Perfect", hi: "Failure" },
  { key: "effort", label: "Effort", q: "How hard did you have to work to reach your level of performance?", lo: "Very low", hi: "Very high" },
  { key: "frustration", label: "Frustration", q: "How insecure, discouraged, irritated, stressed or annoyed were you?", lo: "Very low", hi: "Very high" },
] as const;

export type TlxKey = (typeof TLX_SCALES)[number]["key"];
export type TlxRatings = Record<TlxKey, number>;

/** Raw-TLX: unweighted mean of the six 0–100 subscales (performance is
 *  already oriented so that higher = worse, i.e. higher workload). */
export function rawTlx(r: TlxRatings): number {
  return TLX_SCALES.reduce((s, sc) => s + r[sc.key], 0) / TLX_SCALES.length;
}

/** Discrete load class from task difficulty. */
export function loadClass(n: NLevel): "low" | "medium" | "high" {
  return n <= 1 ? "low" : n === 2 ? "medium" : "high";
}

/** Pearson correlation (for manipulation checks in the summary). */
export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy || 1e-12);
}
