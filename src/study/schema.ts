// Recording schema: one row per 100 ms (10 Hz). Stored as compact arrays
// with a fixed column list; labels are joined at export time.

import type { FrameMetrics } from "../engine/types";

/** MediaPipe face blendshape names (ARKit-compatible), fixed order. */
export const BLENDSHAPES = [
  "_neutral", "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "eyeBlinkLeft", "eyeBlinkRight",
  "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft",
  "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen", "jawRight", "mouthClose",
  "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
  "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight",
  "mouthPucker", "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower",
  "mouthShrugUpper", "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
  "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight",
] as const;

export type Phase = "baseline" | "block" | "tlx" | "rest" | "practice" | "other";

export interface RowContext {
  phase: Phase;
  block: number; // block index, -1 outside blocks
  n: number; // n-level, -1 outside blocks
  trial: number; // current trial index, -1 if none
}

/** Context columns, then numeric feature columns. */
export const CONTEXT_COLUMNS = ["t_ms", "phase", "block", "n_level", "trial"] as const;

export const FEATURE_COLUMNS = [
  "face_present", "yaw", "pitch", "roll", "gaze_x", "gaze_y", "ear", "eye_closure",
  "blink_rate", "perclos", "brow_down", "jaw_open", "head_motion",
  "pose_visible", "lean", "slouch", "shoulder_tilt", "hand_near_face", "head_on_hand", "body_motion", "posture_score",
  "hr_bpm", "hr_quality", "hr_snr", "hr_valid", "hr_baseline", "hrv_rmssd",
  "h_attention", "h_engagement", "h_load",
  ...BLENDSHAPES.map((b) => `bs_${b}`),
] as const;

export const COLUMNS = [...CONTEXT_COLUMNS, ...FEATURE_COLUMNS];

export type Cell = number | string | null;
export type Row = Cell[];

const r4 = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 1e4) / 1e4;
const b = (v: boolean | undefined) => (v ? 1 : 0);

export function toRow(m: FrameMetrics, ctx: RowContext, tMs: number): Row {
  const p = m.posture;
  const h = m.rppg;
  const bs = m.blendshapes;
  return [
    Math.round(tMs), ctx.phase, ctx.block, ctx.n, ctx.trial,
    b(m.facePresent), r4(m.yaw), r4(m.pitch), r4(m.roll), r4(m.gazeX), r4(m.gazeY), r4(m.ear), r4(m.eyeClosure),
    r4(m.blinkRate), r4(m.perclos), r4(m.browDown), r4(m.jawOpen), r4(m.motion),
    b(p?.visible), r4(p?.visible ? p.lean : null), r4(p?.visible ? p.slouch : null), r4(p?.visible ? p.shoulderTilt : null),
    r4(p?.visible ? p.handNearFace : null), p?.visible ? b(p.headOnHand) : null, r4(p?.visible ? p.bodyMotion : null), r4(p?.visible ? p.score : null),
    r4(h?.bpm), r4(h?.quality), r4(h && Number.isFinite(h.snr) ? h.snr : null), b(h?.valid), r4(h?.baselineBpm), r4(h?.rmssd),
    r4(m.attention), r4(m.engagement), r4(m.load),
    ...BLENDSHAPES.map((k) => r4(bs ? bs[k] ?? null : null)),
  ];
}
