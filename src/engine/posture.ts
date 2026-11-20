// Posture engine: body-modality features from MediaPipe Pose landmarks.
// Pure TypeScript (no DOM) — runs in the worker, unit-testable in Node.
//
// All distances are computed in *pixel* space (normalized coords × frame size)
// so a 16:9 frame doesn't distort horizontal vs vertical measurements, and are
// then normalized by shoulder width so they're invariant to camera distance.

import { Ema } from "./features";

export interface PosePt {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export type PostureState = "upright" | "leaning-in" | "leaning-back" | "slouching" | "head-on-hand" | "unknown";

export interface PostureMetrics {
  /** Both shoulders confidently in frame */
  visible: boolean;
  /** -1..1, + = leaning toward the screen (relative to calibrated neutral) */
  lean: number;
  /** 0..1, head dropping toward shoulders vs neutral */
  slouch: number;
  /** degrees, + = right shoulder (subject's) higher */
  shoulderTilt: number;
  /** 0..1 proximity of nearest hand to the lower face */
  handNearFace: number;
  /** hand held at the face for >1.5 s */
  headOnHand: boolean;
  /** 0..1 upper-body motion energy (fidget proxy) */
  bodyMotion: number;
  /** 0..1 how "engaged" the posture looks — feeds the engagement score */
  score: number;
  state: PostureState;
  calibrating: boolean;
}

// MediaPipe Pose topology
const NOSE = 0, MOUTH_L = 9, MOUTH_R = 10, SH_L = 11, SH_R = 12, WR_L = 15, WR_R = 16;
const HAND_L = [15, 17, 19, 21];
const HAND_R = [16, 18, 20, 22];

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const NEUTRAL_FRAMES = 25;
const HEAD_ON_HAND_MS = 1500;

export class PostureEngine {
  private neutral = { width: 0, neck: 0 };
  private acc = { width: 0, neck: 0, n: 0 };
  private lastT = -1;
  private handSince: number | null = null;
  private prev: ({ x: number; y: number } | null)[] | null = null;
  private motionEma = new Ema(1_500);
  private leanEma = new Ema(800);
  private slouchEma = new Ema(1_200);
  private nearEma = new Ema(400);

  calibrate() {
    this.acc = { width: 0, neck: 0, n: 0 };
  }

  reset() {
    this.calibrate();
    this.neutral = { width: 0, neck: 0 };
    this.lastT = -1;
    this.handSince = null;
    this.prev = null;
    for (const e of [this.motionEma, this.leanEma, this.slouchEma, this.nearEma]) e.reset();
  }

  process(t: number, lm: PosePt[] | null, frameW: number, frameH: number): PostureMetrics {
    const dt = this.lastT < 0 ? 66 : t - this.lastT;
    this.lastT = t;
    const calibrating = this.acc.n < NEUTRAL_FRAMES;

    const P = (i: number) => ({ x: lm![i].x * frameW, y: lm![i].y * frameH });
    const vis = (i: number) => (lm ? lm[i].visibility ?? 0 : 0);
    const inFrame = (i: number) => lm![i].y > 0 && lm![i].y < 1.02 && lm![i].x > -0.02 && lm![i].x < 1.02;

    const visible = !!lm && vis(SH_L) > 0.6 && vis(SH_R) > 0.6 && vis(NOSE) > 0.6 && inFrame(SH_L) && inFrame(SH_R);
    if (!visible) {
      this.prev = null;
      this.handSince = null;
      return {
        visible: false, lean: 0, slouch: 0, shoulderTilt: 0, handNearFace: 0, headOnHand: false,
        bodyMotion: this.motionEma.push(0, dt), score: 0.5, state: "unknown", calibrating,
      };
    }

    const sl = P(SH_L), sr = P(SH_R), nose = P(NOSE);
    const width = Math.hypot(sl.x - sr.x, sl.y - sr.y) || 1;
    const midY = (sl.y + sr.y) / 2;
    // Vertical nose-above-shoulders distance, distance-invariant
    const neck = (midY - nose.y) / width;

    if (calibrating) {
      this.acc.width += width;
      this.acc.neck += neck;
      this.acc.n++;
      this.neutral = { width: this.acc.width / this.acc.n, neck: this.acc.neck / this.acc.n };
    }

    // Lean: moving toward the camera makes the shoulders appear wider.
    const lean = this.leanEma.push(clamp((width / this.neutral.width - 1) / 0.15, -1, 1), dt);
    // Slouch: head sinks toward the shoulder line.
    const slouch = this.slouchEma.push(
      this.neutral.neck > 0.05 ? clamp((this.neutral.neck - neck) / (0.35 * this.neutral.neck)) : 0,
      dt,
    );
    // Image y grows downward; subject's right shoulder is SH_R.
    const shoulderTilt = (Math.atan2(sl.y - sr.y, Math.abs(sl.x - sr.x)) * 180) / Math.PI;

    // Hand near lower face (mouth / chin region)
    const mouth = { x: (P(MOUTH_L).x + P(MOUTH_R).x) / 2, y: (P(MOUTH_L).y + P(MOUTH_R).y) / 2 };
    let nearest = Infinity;
    for (const hand of [HAND_L, HAND_R]) {
      for (const i of hand) {
        if (vis(i) < 0.5 || !inFrame(i)) continue;
        const p = P(i);
        nearest = Math.min(nearest, Math.hypot(p.x - mouth.x, p.y - mouth.y) / width);
      }
    }
    const handNearFace = this.nearEma.push(Number.isFinite(nearest) ? clamp(1 - nearest / 0.6) : 0, dt);
    if (handNearFace > 0.45) this.handSince ??= t;
    else this.handSince = null;
    const headOnHand = this.handSince !== null && t - this.handSince > HEAD_ON_HAND_MS;

    // Upper-body motion: shoulders + visible wrists, normalized by width, per second
    const pts = [sl, sr, vis(WR_L) > 0.5 ? P(WR_L) : null, vis(WR_R) > 0.5 ? P(WR_R) : null];
    let motionRaw = 0;
    if (this.prev) {
      let sum = 0, n = 0;
      pts.forEach((p, k) => {
        const q = this.prev![k];
        if (p && q) { sum += Math.hypot(p.x - q.x, p.y - q.y) / width; n++; }
      });
      if (n) motionRaw = (sum / n) * (1000 / Math.max(dt, 1));
    }
    this.prev = pts;
    const bodyMotion = clamp(this.motionEma.push(motionRaw, dt) / 1.5);

    let state: PostureState = "upright";
    if (headOnHand) state = "head-on-hand";
    else if (slouch > 0.5) state = "slouching";
    else if (lean < -0.4) state = "leaning-back";
    else if (lean > 0.4) state = "leaning-in";

    // Posture quality for engagement: upright / leaning in = good;
    // slouching, reclining, head propped on hand = disengaged cues.
    const score = clamp(
      1 - 0.55 * slouch - 0.35 * Math.max(0, -lean) + 0.1 * Math.max(0, lean) - (headOnHand ? 0.4 : 0) - 0.2 * Math.max(0, bodyMotion - 0.5),
    );

    return { visible: true, lean, slouch, shoulderTilt, handNearFace, headOnHand, bodyMotion, score, state, calibrating };
  }
}
