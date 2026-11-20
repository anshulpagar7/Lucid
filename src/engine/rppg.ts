// rPPG engine — heart rate & HRV from facial skin colour.
//
// Pipeline (every UPDATE_MS):
//   raw (t, R, G, B) skin means ─▶ uniform resample @ FS
//   ─▶ POS projection (Wang et al., 2017, "Algorithmic Principles of Remote PPG")
//   ─▶ spectrum (Hann, zero-padded FFT) ─▶ peak in 45–180 bpm ─▶ parabolic refine
//   ─▶ SNR (de Haan & Jeanne, 2013) gates the estimate
//   ─▶ FFT band-pass waveform ─▶ beat peaks ─▶ inter-beat intervals ─▶ RMSSD
//
// Pure TypeScript (no DOM): runs in the worker, unit-tested in Node.

import { fft, mean, median, nextPow2, std } from "./dsp";

export const FS = 30; // Hz, resampling rate
const HR_WINDOW_S = 10; // spectrum window
const BUF_S = 20; // HRV needs a longer window
const MIN_S = 6; // first estimate after this much clean signal
const POS_WIN = Math.round(1.6 * FS); // POS temporal window (1.6 s)
const UPDATE_MS = 200;
const MAX_GAP_MS = 500; // face lost longer than this → restart signal
const F_LO = 0.75, F_HI = 3.0; // Hz band (45–180 bpm)
const BASELINE_ESTIMATES = 60; // ≈ 12 s of good estimates
const LOCK_UPDATES = 5; // 1 s of consecutive valid estimates
const STALE_MS = 3000;
const HRV_MIN_SNR = 3; // dB — below this, IBI jitter dominates RMSSD (validated in sim)

export interface PulseWave {
  /** time (worker clock, ms) of samples[0] */
  t0: number;
  /** ms between samples */
  dt: number;
  /** band-passed POS signal, unit variance */
  samples: Float32Array;
  /** beat peak times (ms, worker clock) inside the window */
  beats: number[];
}

export interface RppgMetrics {
  /** smoothed heart rate, bpm (null until enough clean signal) */
  bpm: number | null;
  /** latest raw spectral estimate, bpm */
  bpmRaw: number | null;
  /** signal-to-noise ratio, dB */
  snr: number;
  /** 0..1 confidence derived from SNR */
  quality: number;
  /** RMSSD, ms — EXPERIMENTAL: 30 fps webcam beat timing is noise-limited; telemetry only, never scored */
  rmssd: number | null;
  /** 0..1 progress to first estimate */
  warmup: number;
  baselineBpm: number | null;
  baselineRmssd: number | null;
  /** true if the latest estimate passed the quality gate */
  valid: boolean;
}

interface Sample {
  t: number;
  r: number;
  g: number;
  b: number;
}

export class RppgEngine {
  private raw: Sample[] = [];
  private lastUpdate = -Infinity;
  private estimates: number[] = [];
  /** every spectral estimate, gated or not — used for consistency */
  private history: number[] = [];
  private lastHistory = -Infinity;
  private validStreak = 0;
  private lastValidT = -Infinity;
  private locked = false;
  private baseBpm: number[] = [];
  private baseRmssd: number[] = [];
  private metrics: RppgMetrics = RppgEngine.empty();
  private wave: PulseWave | null = null;
  private waveFresh = false;

  static empty(): RppgMetrics {
    return { bpm: null, bpmRaw: null, snr: -Infinity, quality: 0, rmssd: null, warmup: 0, baselineBpm: null, baselineRmssd: null, valid: false };
  }

  reset() {
    this.raw = [];
    this.lastUpdate = -Infinity;
    this.estimates = [];
    this.history = [];
    this.lastHistory = -Infinity;
    this.locked = false;
    this.validStreak = 0;
    this.lastValidT = -Infinity;
    this.calibrate();
    this.metrics = RppgEngine.empty();
    this.wave = null;
  }

  /** Re-learn resting baseline (HR / HRV). */
  calibrate() {
    this.baseBpm = [];
    this.baseRmssd = [];
  }

  /** Feed one frame's mean skin colour (0..255). */
  push(t: number, r: number, g: number, b: number) {
    const last = this.raw[this.raw.length - 1];
    if (last && t - last.t > MAX_GAP_MS) {
      // signal broken (face lost / occluded) — start over, keep baseline
      this.raw = [];
      this.estimates = [];
      this.history = [];
      this.locked = false;
      this.validStreak = 0;
    }
    this.raw.push({ t, r, g, b });
    const cutoff = t - BUF_S * 1000 - 500;
    let drop = 0;
    while (drop < this.raw.length && this.raw[drop].t < cutoff) drop++;
    if (drop) this.raw.splice(0, drop);
  }

  /** Mark that no skin was visible this frame. */
  miss(t: number) {
    const last = this.raw[this.raw.length - 1];
    if (last && t - last.t > MAX_GAP_MS) {
      this.raw = [];
      this.estimates = [];
      this.history = [];
      this.locked = false;
      this.validStreak = 0;
      this.metrics = { ...this.metrics, valid: false, quality: 0, warmup: 0 };
    }
  }

  /** Returns current metrics; recomputes at most every UPDATE_MS. */
  update(t: number): RppgMetrics {
    if (t - this.lastUpdate < UPDATE_MS) return this.metrics;
    this.lastUpdate = t;

    const span = this.raw.length > 1 ? (this.raw[this.raw.length - 1].t - this.raw[0].t) / 1000 : 0;
    const warmup = Math.min(1, span / MIN_S);
    if (span < MIN_S) {
      this.metrics = { ...this.metrics, warmup, valid: false, bpm: this.estimates.length ? this.metrics.bpm : null };
      return this.metrics;
    }

    // 1. uniform resample (linear interpolation)
    const tEnd = this.raw[this.raw.length - 1].t;
    const n = Math.floor(Math.min(span, BUF_S) * FS);
    const t0 = tEnd - ((n - 1) * 1000) / FS;
    const R = new Float64Array(n), G = new Float64Array(n), B = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const ti = t0 + (i * 1000) / FS;
      while (j < this.raw.length - 2 && this.raw[j + 1].t < ti) j++;
      const a = this.raw[j], b = this.raw[j + 1];
      const u = b.t === a.t ? 0 : Math.min(1, Math.max(0, (ti - a.t) / (b.t - a.t)));
      R[i] = a.r + u * (b.r - a.r);
      G[i] = a.g + u * (b.g - a.g);
      B[i] = a.b + u * (b.b - a.b);
    }

    // 2. POS
    const H = pos(R, G, B);

    // 3. heart rate from the last HR_WINDOW_S of H
    const hrN = Math.min(n, HR_WINDOW_S * FS);
    const { f0, snr } = spectralPeak(H.subarray(n - hrN));
    const bpmRaw = f0 * 60;
    // Noise produces a peak too, but it wanders; a real pulse holds steady.
    // sampled once per second so overlapping windows can't fake stability
    if (t - this.lastHistory >= 1000) {
      this.lastHistory = t;
      this.history.push(bpmRaw);
      if (this.history.length > 8) this.history.shift();
    }
    const med = median(this.history);
    const spread = median(this.history.map((v) => Math.abs(v - med)));
    const consistency = this.history.length >= 4 ? clamp(1 - spread / 4) : 0;
    const snrQ = clamp((snr + 8) / 10);
    const quality = Math.sqrt(snrQ * consistency);
    const valid = quality >= 0.5 && snr > -2;

    // Publish only after a sustained lock (≥ LOCK_UPDATES valid updates in a
    // row); drop the reading if the signal stays invalid for STALE_MS.
    if (valid) {
      this.validStreak++;
      this.lastValidT = t;
      this.estimates.push(bpmRaw);
      if (this.estimates.length > 9) this.estimates.shift();
      if (this.validStreak >= LOCK_UPDATES) this.locked = true;
    } else {
      this.validStreak = 0;
      if (t - this.lastValidT > STALE_MS) {
        this.locked = false;
        this.estimates = [];
      }
    }
    const bpm = this.locked && this.estimates.length ? median(this.estimates) : null;

    // 4. waveform + beats + HRV
    const wave = bandpass(H, F_LO, F_HI);
    const s = std(wave) || 1;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = wave[i] / s;
    const beatIdx = findPeaks(samples, bpm ?? bpmRaw);
    const beats = beatIdx.map((k) => t0 + (k * 1000) / FS);
    // Beat timing at 30 fps is noise-limited: only trust HRV on a strong signal.
    const hrvOk = valid && this.locked && snr >= HRV_MIN_SNR && bpm !== null;
    const rmssd = hrvOk ? computeRmssd(beats, bpm!) : null;

    // 5. resting baseline (first good estimates of the session / after recalibrate)
    if (valid && bpm && this.baseBpm.length < BASELINE_ESTIMATES) {
      this.baseBpm.push(bpm);
      if (rmssd) this.baseRmssd.push(rmssd);
    }
    const ready = this.baseBpm.length >= BASELINE_ESTIMATES;

    this.wave = { t0, dt: 1000 / FS, samples, beats };
    this.waveFresh = true;
    this.metrics = {
      bpm, bpmRaw, snr, quality, rmssd, warmup, valid: valid && this.locked,
      baselineBpm: ready ? median(this.baseBpm) : null,
      baselineRmssd: ready && this.baseRmssd.length >= 10 ? median(this.baseRmssd) : null,
    };
    return this.metrics;
  }

  /** Latest waveform if it changed since the last call (for streaming to the UI). */
  takeWave(): PulseWave | null {
    if (!this.waveFresh) return null;
    this.waveFresh = false;
    return this.wave;
  }
}

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

/** Plane-Orthogonal-to-Skin projection with overlap-add. */
export function pos(R: Float64Array, G: Float64Array, B: Float64Array): Float64Array {
  const n = R.length;
  const H = new Float64Array(n);
  const l = Math.min(POS_WIN, n);
  const s1 = new Float64Array(l), s2 = new Float64Array(l);
  for (let m = 0; m + l <= n; m++) {
    const mr = mean(R, m, m + l) || 1, mg = mean(G, m, m + l) || 1, mb = mean(B, m, m + l) || 1;
    for (let k = 0; k < l; k++) {
      const r = R[m + k] / mr, g = G[m + k] / mg, b = B[m + k] / mb;
      s1[k] = g - b;
      s2[k] = g + b - 2 * r;
    }
    const alpha = std(s1) / (std(s2) || 1e-9);
    let hm = 0;
    for (let k = 0; k < l; k++) hm += s1[k] + alpha * s2[k];
    hm /= l;
    for (let k = 0; k < l; k++) H[m + k] += s1[k] + alpha * s2[k] - hm;
  }
  return H;
}

/** Dominant frequency in [F_LO, F_HI] with parabolic refinement + SNR in dB. */
export function spectralPeak(x: ArrayLike<number>): { f0: number; snr: number } {
  const n = x.length;
  const N = Math.max(1024, nextPow2(n * 4));
  const re = new Float64Array(N), im = new Float64Array(N);
  const m = mean(x);
  for (let i = 0; i < n; i++) re[i] = (x[i] - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const df = FS / N;
  const P = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];

  const kLo = Math.ceil(F_LO / df), kHi = Math.floor(F_HI / df);
  let kMax = kLo;
  for (let k = kLo; k <= kHi; k++) if (P[k] > P[kMax]) kMax = k;
  // parabolic interpolation on log power
  let delta = 0;
  if (kMax > kLo && kMax < kHi) {
    const a = Math.log(P[kMax - 1] + 1e-12), b = Math.log(P[kMax] + 1e-12), c = Math.log(P[kMax + 1] + 1e-12);
    const d = a - 2 * b + c;
    if (d < 0) delta = (0.5 * (a - c)) / d;
  }
  let f0 = (kMax + delta) * df;

  // Sub-harmonic check: PPG waveforms carry a strong 2nd harmonic (dicrotic
  // notch). If there's substantial power at f0/2 inside the band, the true
  // heart rate is the lower one.
  const kHalf = Math.round(kMax / 2);
  if (kHalf >= kLo) {
    let pHalf = 0;
    for (let k = Math.max(kLo, kHalf - 2); k <= kHalf + 2; k++) pHalf = Math.max(pHalf, P[k]);
    const isLocalMax = (k: number) => P[k] >= P[k - 1] && P[k] >= P[k + 1];
    let kPeak = -1;
    for (let k = Math.max(kLo + 1, kHalf - 2); k <= kHalf + 2; k++) if (isLocalMax(k) && (kPeak < 0 || P[k] > P[kPeak])) kPeak = k;
    if (kPeak > 0 && pHalf > 0.5 * P[kMax]) {
      let kh = Math.max(kLo, kHalf - 2);
      for (let k = kh; k <= kHalf + 2; k++) if (P[k] > P[kh]) kh = k;
      let dh = 0;
      if (kh > kLo) {
        const a = Math.log(P[kh - 1] + 1e-12), b = Math.log(P[kh] + 1e-12), c = Math.log(P[kh + 1] + 1e-12);
        const d = a - 2 * b + c;
        if (d < 0) dh = (0.5 * (a - c)) / d;
      }
      f0 = (kh + dh) * df;
    }
  }

  // SNR: energy near f0 and its first harmonic vs the rest of 0.6–4 Hz
  let sig = 0, noise = 0;
  const k06 = Math.ceil(0.6 / df), k4 = Math.min(N / 2 - 1, Math.floor(4 / df));
  for (let k = k06; k <= k4; k++) {
    const f = k * df;
    if (Math.abs(f - f0) <= 0.1 || Math.abs(f - 2 * f0) <= 0.2) sig += P[k];
    else noise += P[k];
  }
  const snr = 10 * Math.log10((sig + 1e-12) / (noise + 1e-12));
  return { f0, snr };
}

/** Zero-phase FFT band-pass with cosine-tapered band edges. */
export function bandpass(x: ArrayLike<number>, lo: number, hi: number): Float64Array {
  const n = x.length;
  const N = nextPow2(n * 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  const m = mean(x);
  // reflect-pad the tail to reduce wrap-around ringing at the newest samples
  for (let i = 0; i < N; i++) {
    const k = i < n ? i : Math.max(0, 2 * n - 2 - i);
    re[i] = (x[k] ?? x[n - 1]) - m;
  }
  fft(re, im);
  const df = FS / N, tw = 0.15;
  for (let k = 0; k < N; k++) {
    const f = (k <= N / 2 ? k : N - k) * df;
    let g = 0;
    if (f >= lo && f <= hi) g = 1;
    else if (f > lo - tw && f < lo) g = 0.5 - 0.5 * Math.cos((Math.PI * (f - (lo - tw))) / tw);
    else if (f > hi && f < hi + tw) g = 0.5 + 0.5 * Math.cos((Math.PI * (f - hi)) / tw);
    re[k] *= g;
    im[k] *= g;
  }
  fft(re, im, true);
  return re.subarray(0, n).slice();
}

/** Beat peaks (fractional sample indices) with a refractory period tied to HR. */
export function findPeaks(x: Float32Array, bpm: number): number[] {
  const minGap = Math.max(0.33, (60 / Math.max(45, Math.min(180, bpm || 75))) * 0.6) * FS;
  const peaks: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] <= 0.3 || x[i] < x[i - 1] || x[i] < x[i + 1]) continue;
    const a = x[i - 1], b = x[i], c = x[i + 1];
    const d = a - 2 * b + c;
    const p = i + (d < 0 ? (0.5 * (a - c)) / d : 0);
    const last = peaks[peaks.length - 1];
    if (last !== undefined && p - last < minGap) {
      if (b > x[Math.round(last)]) peaks[peaks.length - 1] = p;
    } else peaks.push(p);
  }
  return peaks;
}

/** RMSSD over successive inter-beat intervals, rejecting implausible ones. */
export function computeRmssd(beats: number[], bpm: number): number | null {
  const expected = 60_000 / bpm;
  const ibi: number[] = [];
  for (let i = 1; i < beats.length; i++) ibi.push(beats[i] - beats[i - 1]);
  const ok = ibi.map((v) => Math.abs(v - expected) / expected < 0.2);
  let sum = 0, cnt = 0;
  for (let i = 1; i < ibi.length; i++) {
    if (!ok[i] || !ok[i - 1]) continue;
    sum += (ibi[i] - ibi[i - 1]) ** 2;
    cnt++;
  }
  return cnt >= 6 ? Math.sqrt(sum / cnt) : null;
}

