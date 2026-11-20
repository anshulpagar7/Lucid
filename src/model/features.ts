// Window features — exact mirror of ml/lucid_ml/features.py.
// Parity is enforced by tests/model.test.ts against Python-generated fixtures:
// change one side and the test fails until the other matches.

import { COLUMNS, type Row } from "../study/schema";

export const WINDOW_ROWS = 100;
export const HOP_ROWS = 20;
export const SKIP_MS = 3000;
export const MIN_FACE_FRAC = 0.8;

export const MODALITIES = {
  eyes: ["eye_closure_mean", "eye_closure_std", "blink_rate_win", "perclos_win"],
  gaze: ["gaze_x_std", "gaze_y_std", "gaze_speed"],
  head: ["yaw_std", "pitch_std", "roll_std", "pitch_mean", "head_motion_mean"],
  expression: ["brow_down", "brow_inner_up", "eye_squint", "eye_wide", "jaw_open", "mouth_press", "mouth_frown", "mouth_roll", "cheek_squint", "nose_sneer"],
  posture: ["lean_mean", "slouch_mean", "body_motion_mean", "hand_near_face_mean"],
  cardiac: ["hr_mean"],
} as const;
export const FEATURES: string[] = Object.values(MODALITIES).flat();

const EXPR: Record<string, string[]> = {
  brow_down: ["browDownLeft", "browDownRight"],
  brow_inner_up: ["browInnerUp"],
  eye_squint: ["eyeSquintLeft", "eyeSquintRight"],
  eye_wide: ["eyeWideLeft", "eyeWideRight"],
  jaw_open: ["jawOpen"],
  mouth_press: ["mouthPressLeft", "mouthPressRight"],
  mouth_frown: ["mouthFrownLeft", "mouthFrownRight"],
  mouth_roll: ["mouthRollLower", "mouthRollUpper"],
  cheek_squint: ["cheekSquintLeft", "cheekSquintRight"],
  nose_sneer: ["noseSneerLeft", "noseSneerRight"],
};

const IDX: Record<string, number> = Object.fromEntries(COLUMNS.map((c, i) => [c, i]));

export type Features = Record<string, number>;

/** Column → Float64Array (null / non-numeric → NaN). */
export function columns(rows: Row[], names: readonly string[]) {
  const out: Record<string, Float64Array> = {};
  for (const name of names) {
    const j = IDX[name];
    const a = new Float64Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][j];
      a[i] = typeof v === "number" ? v : NaN;
    }
    out[name] = a;
  }
  return out;
}

const NEEDED = [
  "t_ms", "face_present", "eye_closure", "gaze_x", "gaze_y", "yaw", "pitch", "roll", "head_motion",
  "pose_visible", "lean", "slouch", "body_motion", "hand_near_face", "hr_valid", "hr_bpm", "h_load",
  ...new Set(Object.values(EXPR).flat().map((b) => `bs_${b}`)),
];

function mean(x: ArrayLike<number>) {
  let s = 0, n = 0;
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) { s += x[i]; n++; }
  return n ? s / n : NaN;
}
function std(x: ArrayLike<number>) {
  const m = mean(x);
  if (Number.isNaN(m)) return NaN;
  let s = 0, n = 0;
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) { s += (x[i] - m) ** 2; n++; }
  return Math.sqrt(s / n);
}
const masked = (mask: boolean[], x: Float64Array) => x.map((v, i) => (mask[i] ? v : NaN));

/** Features for one window of rows (any length; WINDOW_ROWS live/in training). */
export function windowFeatures(rows: Row[]): Features {
  const w = columns(rows, NEEDED);
  const n = rows.length;
  const face = Array.from(w.face_present, (v) => v === 1);
  const m = (c: string) => masked(face, w[c]);
  const out: Features = {};

  const ec = m("eye_closure");
  out.eye_closure_mean = mean(ec);
  out.eye_closure_std = std(ec);
  let blinks = 0;
  for (let i = 1; i < n; i++) if (face[i] && face[i - 1] && ec[i - 1] <= 0.5 && ec[i] > 0.5) blinks++;
  out.blink_rate_win = (blinks * 600) / n;
  let valid = 0, closed = 0;
  for (const v of ec) if (!Number.isNaN(v)) { valid++; if (v >= 0.7) closed++; }
  out.perclos_win = valid ? closed / valid : NaN;

  const gx = m("gaze_x"), gy = m("gaze_y");
  out.gaze_x_std = std(gx);
  out.gaze_y_std = std(gy);
  const speed = new Float64Array(Math.max(0, n - 1));
  for (let i = 0; i < n - 1; i++) speed[i] = Math.hypot(gx[i + 1] - gx[i], gy[i + 1] - gy[i]);
  out.gaze_speed = mean(speed);

  out.yaw_std = std(m("yaw"));
  out.pitch_std = std(m("pitch"));
  out.roll_std = std(m("roll"));
  out.pitch_mean = mean(m("pitch"));
  out.head_motion_mean = mean(m("head_motion"));

  for (const [name, parts] of Object.entries(EXPR)) {
    const cols = parts.map((p) => m(`bs_${p}`));
    const avg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const c of cols) s += c[i];
      avg[i] = s / parts.length;
    }
    out[name] = mean(avg);
  }

  const pose = Array.from(w.pose_visible, (v) => v === 1);
  const pm = (c: string) => masked(pose, w[c]);
  out.lean_mean = mean(pm("lean"));
  out.slouch_mean = mean(pm("slouch"));
  out.body_motion_mean = mean(pm("body_motion"));
  out.hand_near_face_mean = mean(pm("hand_near_face"));

  const hrOk = Array.from(w.hr_valid, (v) => v === 1);
  out.hr_mean = mean(masked(hrOk, w.hr_bpm));

  out._face_frac = face.filter(Boolean).length / n;
  out._pose_frac = pose.filter(Boolean).length / n;
  out._hr_frac = hrOk.filter(Boolean).length / n;
  out._h_load = mean(w.h_load);
  return out;
}

/** All valid windows of one contiguous segment (mirrors segment_windows). */
export function segmentWindows(rows: Row[]): Features[] {
  if (!rows.length) return [];
  const t0 = rows[0][IDX.t_ms] as number;
  let start = rows.findIndex((r) => (r[IDX.t_ms] as number) >= t0 + SKIP_MS);
  if (start < 0) start = rows.length;
  const out: Features[] = [];
  for (let i = start; i + WINDOW_ROWS <= rows.length; i += HOP_ROWS) {
    const f = windowFeatures(rows.slice(i, i + WINDOW_ROWS));
    if (f._face_frac >= MIN_FACE_FRAC) out.push({ ...f, _t0: rows[i][IDX.t_ms] as number });
  }
  return out;
}

export function baselineVector(windows: Features[]): Features {
  const base: Features = {};
  for (const f of FEATURES) base[f] = mean(windows.map((w) => w[f]));
  return base;
}

/** Baseline-relative vector in FEATURES order; missing → 0 ("no change from rest"). */
export function relative(f: Features, base: Features): number[] {
  return FEATURES.map((k) => {
    const v = f[k] - base[k];
    return Number.isNaN(v) ? 0 : v;
  });
}
