// Feature engine: turns raw MediaPipe output into interpretable signals and
// heuristic v0 scores. Pure TypeScript, no DOM — runs inside the worker and
// can be unit-tested in Node.

import type { Contribution, FrameMetrics } from "./types";
import type { PostureMetrics } from "./posture";
import type { RppgMetrics } from "./rppg";

export interface Pt {
  x: number;
  y: number;
  z: number;
}

export type Blendshapes = Record<string, number>;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DEG = 180 / Math.PI;

// ---------- Geometry ----------

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

// MediaPipe Face Mesh eye indices: [p1, p2, p3, p4, p5, p6] (Soukupová & Čech EAR)
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

function eyeAspectRatio(lm: Pt[], idx: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = idx.map((i) => lm[i]);
  const horiz = dist(p1, p4);
  if (horiz < 1e-6) return 0;
  return (dist(p2, p6) + dist(p3, p5)) / (2 * horiz);
}

export function averageEAR(lm: Pt[]): number {
  return (eyeAspectRatio(lm, LEFT_EYE) + eyeAspectRatio(lm, RIGHT_EYE)) / 2;
}

/**
 * Euler angles (deg) from MediaPipe's 4x4 facial transformation matrix
 * (column-major). Returns yaw (left/right), pitch (up/down), roll (tilt).
 */
export function headPoseFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  // r(row, col) for column-major storage
  const r = (row: number, col: number) => m[col * 4 + row];
  const sy = Math.hypot(r(0, 0), r(1, 0));
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * DEG;
  const yaw = Math.atan2(-r(2, 0), sy) * DEG;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * DEG;
  return { yaw, pitch, roll };
}

/** Gaze from iris blendshapes. +x = subject's left, +y = up. Range ≈ -1..1 */
export function gazeFromBlendshapes(b: Blendshapes): { x: number; y: number } {
  const g = (k: string) => b[k] ?? 0;
  const x = (g("eyeLookOutLeft") - g("eyeLookInLeft") + g("eyeLookInRight") - g("eyeLookOutRight")) / 2;
  const y = (g("eyeLookUpLeft") + g("eyeLookUpRight") - g("eyeLookDownLeft") - g("eyeLookDownRight")) / 2;
  return { x, y };
}

// ---------- Temporal helpers ----------

/** Time-constant EMA: frame-rate independent smoothing. */
export class Ema {
  private v: number | null = null;
  constructor(private tauMs: number) {}
  push(x: number, dtMs: number): number {
    if (this.v === null) return (this.v = x);
    const a = 1 - Math.exp(-Math.max(dtMs, 0) / this.tauMs);
    this.v += a * (x - this.v);
    return this.v;
  }
  get value() {
    return this.v ?? 0;
  }
  reset() {
    this.v = null;
  }
}

/** Rolling time window of (t, value) samples. */
class Window {
  private ts: number[] = [];
  private vs: number[] = [];
  constructor(private spanMs: number) {}
  push(t: number, v: number) {
    this.ts.push(t);
    this.vs.push(v);
    const cutoff = t - this.spanMs;
    let drop = 0;
    while (drop < this.ts.length && this.ts[drop] < cutoff) drop++;
    if (drop) {
      this.ts.splice(0, drop);
      this.vs.splice(0, drop);
    }
  }
  /** Time-weighted mean of a predicate being true. */
  fractionWhere(pred: (v: number) => boolean): number {
    const n = this.ts.length;
    if (n < 2) return 0;
    let on = 0;
    for (let i = 1; i < n; i++) if (pred(this.vs[i])) on += this.ts[i] - this.ts[i - 1];
    return on / (this.ts[n - 1] - this.ts[0]);
  }
  std(): number {
    const n = this.vs.length;
    if (n < 2) return 0;
    let m = 0;
    for (const v of this.vs) m += v;
    m /= n;
    let s = 0;
    for (const v of this.vs) s += (v - m) ** 2;
    return Math.sqrt(s / n);
  }
  get duration() {
    return this.ts.length > 1 ? this.ts[this.ts.length - 1] - this.ts[0] : 0;
  }
  clear() {
    this.ts = [];
    this.vs = [];
  }
}

/** Hysteresis blink detector on the eye-closure blendshape. */
class BlinkDetector {
  private closedAt: number | null = null;
  readonly times: number[] = [];
  total = 0;
  push(t: number, closure: number) {
    if (this.closedAt === null && closure > 0.5) this.closedAt = t;
    else if (this.closedAt !== null && closure < 0.35) {
      const dur = t - this.closedAt;
      // 50–500 ms = blink. Longer closures are drowsiness (captured by PERCLOS).
      if (dur >= 50 && dur <= 500) {
        this.times.push(t);
        this.total++;
      }
      this.closedAt = null;
    }
    while (this.times.length && this.times[0] < t - 60_000) this.times.shift();
  }
  /** Blinks per minute; extrapolated during the first minute. */
  rate(t: number, sessionStart: number): number {
    const span = Math.min(60_000, Math.max(t - sessionStart, 10_000));
    return (this.times.length * 60_000) / span;
  }
  reset() {
    this.closedAt = null;
    this.times.length = 0;
    this.total = 0;
  }
}

// ---------- Engine ----------

export interface RawFrame {
  t: number;
  landmarks: Pt[] | null;
  blendshapes: Blendshapes | null;
  matrix: ArrayLike<number> | null;
}

const NEUTRAL_FRAMES = 45; // ~1.5 s of frames to learn neutral head pose
const TYPICAL_BLINK_RATE = 15; // resting adult, blinks/min

export class FeatureEngine {
  private sessionStart = -1;
  private lastT = -1;

  // Neutral head pose (auto-calibrated)
  private neutral = { yaw: 0, pitch: 0, roll: 0 };
  private neutralAcc = { yaw: 0, pitch: 0, roll: 0, n: 0 };

  private blinks = new BlinkDetector();
  private closureWin = new Window(60_000);
  private gazeXWin = new Window(8_000);
  private gazeYWin = new Window(8_000);

  private attFast = new Ema(1_200);
  private attSlow = new Ema(10_000);
  private browEma = new Ema(3_000);
  private jawEma = new Ema(2_000);
  private motionEma = new Ema(1_500);
  private engEma = new Ema(4_000);
  private loadEma = new Ema(6_000);

  private prevNose: Pt | null = null;

  calibrate() {
    this.neutralAcc = { yaw: 0, pitch: 0, roll: 0, n: 0 };
  }

  reset() {
    this.sessionStart = -1;
    this.lastT = -1;
    this.neutral = { yaw: 0, pitch: 0, roll: 0 };
    this.calibrate();
    this.blinks.reset();
    for (const w of [this.closureWin, this.gazeXWin, this.gazeYWin]) w.clear();
    for (const e of [this.attFast, this.attSlow, this.browEma, this.jawEma, this.motionEma, this.engEma, this.loadEma]) e.reset();
    this.prevNose = null;
  }

  process(f: RawFrame, posture: PostureMetrics | null = null, rppg: RppgMetrics | null = null): FrameMetrics {
    const { t } = f;
    if (this.sessionStart < 0) this.sessionStart = t;
    const dt = this.lastT < 0 ? 33 : t - this.lastT;
    this.lastT = t;

    const facePresent = !!(f.landmarks && f.blendshapes && f.matrix);
    const calibrating = this.neutralAcc.n < NEUTRAL_FRAMES;

    let yaw = 0, pitch = 0, roll = 0, gazeX = 0, gazeY = 0, ear = 0, eyeClosure = 0;
    let browDownRaw = 0, jawRaw = 0, motionRaw = 0;

    if (facePresent) {
      const lm = f.landmarks!;
      const b = f.blendshapes!;
      const pose = headPoseFromMatrix(f.matrix!);

      if (calibrating) {
        const a = this.neutralAcc;
        a.yaw += pose.yaw; a.pitch += pose.pitch; a.roll += pose.roll; a.n++;
        this.neutral = { yaw: a.yaw / a.n, pitch: a.pitch / a.n, roll: a.roll / a.n };
      }
      yaw = pose.yaw - this.neutral.yaw;
      pitch = pose.pitch - this.neutral.pitch;
      roll = pose.roll - this.neutral.roll;

      const g = gazeFromBlendshapes(b);
      gazeX = g.x;
      gazeY = g.y;
      ear = averageEAR(lm);
      eyeClosure = ((b.eyeBlinkLeft ?? 0) + (b.eyeBlinkRight ?? 0)) / 2;
      browDownRaw = ((b.browDownLeft ?? 0) + (b.browDownRight ?? 0)) / 2;
      jawRaw = b.jawOpen ?? 0;

      // Motion: nose-tip displacement normalized by inter-ocular distance, per second
      const nose = lm[1];
      const iod = dist(lm[33], lm[263]) || 1;
      if (this.prevNose) motionRaw = (dist(nose, this.prevNose) / iod) * (1000 / Math.max(dt, 1));
      this.prevNose = nose;

      this.blinks.push(t, eyeClosure);
      this.closureWin.push(t, eyeClosure);
      this.gazeXWin.push(t, gazeX);
      this.gazeYWin.push(t, gazeY);
    } else {
      this.prevNose = null;
    }

    const blinkRate = this.blinks.rate(t, this.sessionStart);
    const perclos = this.closureWin.fractionWhere((v) => v >= 0.7);
    const browDown = this.browEma.push(browDownRaw, dt);
    const jawOpen = this.jawEma.push(jawRaw, dt);
    const motion = clamp01(this.motionEma.push(motionRaw, dt) / 2.5);

    // ---- Attention (instantaneous on-task gaze) ----
    const headOff = clamp01(Math.max(0, Math.abs(yaw) - 15) / 25 + Math.max(0, Math.abs(pitch) - 12) / 20);
    const gazeOff = clamp01(Math.max(0, Math.abs(gazeX) - 0.35) / 0.4 + Math.max(0, Math.abs(gazeY) - 0.4) / 0.4);
    const eyesOpen = clamp01(1 - (eyeClosure - 0.4) / 0.4);
    const attInstant = facePresent ? clamp01(1 - 0.65 * headOff - 0.35 * gazeOff) * eyesOpen : 0;
    const attention = this.attFast.push(attInstant, dt);
    const attSustained = this.attSlow.push(attInstant, dt);

    const whyAtt: Contribution[] = [
      { key: "face", label: "Face in view", value: facePresent ? 1 : 0, weight: 0 },
      { key: "head", label: "Head toward screen", value: 1 - headOff, weight: 0.65 },
      { key: "gaze", label: "Gaze on screen", value: 1 - gazeOff, weight: 0.35 },
      { key: "eyes", label: "Eyes open", value: eyesOpen, weight: 0 },
    ];

    // ---- Engagement (sustained attention, alertness, posture, natural activity) ----
    const drowsy = clamp01(perclos * 4 + Math.max(0, jawOpen - 0.35) * 1.5);
    // Engaged learners show *some* micro-movement; frozen or restless both score lower.
    const activity = clamp01(1 - Math.abs(motion - 0.18) / 0.5);
    // Posture only counts when the body is actually in frame; otherwise its
    // weight is redistributed so face-only framing isn't penalised.
    const hasPose = !!posture?.visible;
    const wPose = hasPose ? 0.15 : 0;
    const wSus = 0.5 + (0.15 - wPose) * 0.6;
    const wAlert = 0.25 + (0.15 - wPose) * 0.4;
    const postureScore = hasPose ? posture!.score : 0;
    const engRaw = wSus * attSustained + wAlert * (1 - drowsy) + wPose * postureScore + 0.1 * activity;
    const engagement = this.engEma.push(facePresent ? engRaw : engRaw * 0.5, dt);

    const whyEng: Contribution[] = [
      { key: "sustained", label: "Sustained attention", value: attSustained, weight: wSus },
      { key: "alert", label: "Alertness (low PERCLOS)", value: 1 - drowsy, weight: wAlert },
      { key: "posture", label: "Posture (body)", value: postureScore, weight: wPose },
      { key: "activity", label: "Natural micro-movement", value: activity, weight: 0.1 },
    ];

    // ---- Cognitive load (brow lowering, blink inhibition, gaze fixation, cardiac arousal) ----
    const brow = clamp01(browDown / 0.45);
    const blinkSuppression = clamp01((TYPICAL_BLINK_RATE - blinkRate) / TYPICAL_BLINK_RATE);
    const dispersion = Math.hypot(this.gazeXWin.std(), this.gazeYWin.std());
    const fixation = clamp01(1 - dispersion / 0.25);
    const hasHistory = t - this.sessionStart > 10_000;
    // Heart rate above the person's own resting baseline (+15 bpm saturates).
    // Only used once rPPG has a locked estimate AND a learned baseline; HRV is
    // deliberately not scored (webcam beat timing is too noisy to trust).
    const hasCardio = !!(rppg?.valid && rppg.bpm !== null && rppg.baselineBpm !== null);
    const cardio = hasCardio ? clamp01((rppg!.bpm! - rppg!.baselineBpm!) / 15) : 0;
    const w = hasCardio
      ? { brow: 0.35, blink: 0.25, fix: 0.2, cardio: 0.2 }
      : { brow: 0.45, blink: 0.3, fix: 0.25, cardio: 0 };
    const loadRaw = w.brow * brow + w.blink * (hasHistory ? blinkSuppression : 0.3) + w.fix * fixation + w.cardio * cardio;
    const load = this.loadEma.push(facePresent ? loadRaw : this.loadEma.value, dt);

    const whyLoad: Contribution[] = [
      { key: "brow", label: "Brow lowering (AU4)", value: brow, weight: w.brow },
      { key: "blink", label: "Blink inhibition", value: blinkSuppression, weight: w.blink },
      { key: "fixation", label: "Gaze fixation", value: fixation, weight: w.fix },
      { key: "cardio", label: "Heart rate above baseline", value: cardio, weight: w.cardio },
    ];

    return {
      t,
      facePresent,
      yaw, pitch, roll,
      gazeX, gazeY,
      ear, eyeClosure,
      blinkRate,
      perclos,
      blinks: this.blinks.total,
      browDown, jawOpen, motion,
      attention, engagement, load,
      why: { attention: whyAtt, engagement: whyEng, load: whyLoad },
      posture,
      rppg,
      blendshapes: facePresent ? f.blendshapes : null,
      calibrating,
    };
  }
}
