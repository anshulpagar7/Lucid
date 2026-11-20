"""Window features — the contract shared with src/model/features.ts.

Any change here MUST be mirrored in TypeScript; tests/test_parity.py and
tests/model.test.ts check both against the same fixture.

Rows are the 10 Hz recording rows (see src/study/schema.ts). A window is
WINDOW_ROWS consecutive rows (~10 s); windows advance by HOP_ROWS (~2 s).
Statistics use population std (ddof=0). Missing values are NaN.
"""
from __future__ import annotations

import numpy as np

WINDOW_ROWS = 100
HOP_ROWS = 20
SKIP_MS = 3000  # drop the start of each segment (task onset transient)
MIN_FACE_FRAC = 0.8

MODALITIES: dict[str, list[str]] = {
    "eyes": ["eye_closure_mean", "eye_closure_std", "blink_rate_win", "perclos_win"],
    "gaze": ["gaze_x_std", "gaze_y_std", "gaze_speed"],
    "head": ["yaw_std", "pitch_std", "roll_std", "pitch_mean", "head_motion_mean"],
    "expression": [
        "brow_down", "brow_inner_up", "eye_squint", "eye_wide", "jaw_open",
        "mouth_press", "mouth_frown", "mouth_roll", "cheek_squint", "nose_sneer",
    ],
    "posture": ["lean_mean", "slouch_mean", "body_motion_mean", "hand_near_face_mean"],
    "cardiac": ["hr_mean"],
}
MODALITY_LABELS = {
    "eyes": "Eyes & blinks", "gaze": "Gaze dynamics", "head": "Head movement",
    "expression": "Facial expression", "posture": "Posture", "cardiac": "Heart rate",
}
FEATURES: list[str] = [f for fs in MODALITIES.values() for f in fs]

# blendshape pairs averaged into one expression feature
_EXPR = {
    "brow_down": ["browDownLeft", "browDownRight"],
    "brow_inner_up": ["browInnerUp"],
    "eye_squint": ["eyeSquintLeft", "eyeSquintRight"],
    "eye_wide": ["eyeWideLeft", "eyeWideRight"],
    "jaw_open": ["jawOpen"],
    "mouth_press": ["mouthPressLeft", "mouthPressRight"],
    "mouth_frown": ["mouthFrownLeft", "mouthFrownRight"],
    "mouth_roll": ["mouthRollLower", "mouthRollUpper"],
    "cheek_squint": ["cheekSquintLeft", "cheekSquintRight"],
    "nose_sneer": ["noseSneerLeft", "noseSneerRight"],
}


def _mean(x: np.ndarray) -> float:
    x = x[~np.isnan(x)]
    return float(x.mean()) if x.size else float("nan")


def _std(x: np.ndarray) -> float:
    x = x[~np.isnan(x)]
    return float(x.std()) if x.size else float("nan")


def window_features(w: dict[str, np.ndarray]) -> dict[str, float]:
    """Features for one window. `w` maps column name → float array (NaN = missing)."""
    n = len(w["face_present"])
    face = w["face_present"] == 1
    m = lambda col: np.where(face, w[col], np.nan)  # noqa: E731 — face-masked column

    out: dict[str, float] = {}
    ec = m("eye_closure")
    out["eye_closure_mean"] = _mean(ec)
    out["eye_closure_std"] = _std(ec)
    blinks = 0
    for i in range(1, n):
        if face[i] and face[i - 1] and ec[i - 1] <= 0.5 and ec[i] > 0.5:
            blinks += 1
    out["blink_rate_win"] = blinks * 600.0 / n
    valid_ec = ec[~np.isnan(ec)]
    out["perclos_win"] = float((valid_ec >= 0.7).mean()) if valid_ec.size else float("nan")

    gx, gy = m("gaze_x"), m("gaze_y")
    out["gaze_x_std"] = _std(gx)
    out["gaze_y_std"] = _std(gy)
    out["gaze_speed"] = _mean(np.hypot(np.diff(gx), np.diff(gy)))

    out["yaw_std"] = _std(m("yaw"))
    out["pitch_std"] = _std(m("pitch"))
    out["roll_std"] = _std(m("roll"))
    out["pitch_mean"] = _mean(m("pitch"))
    out["head_motion_mean"] = _mean(m("head_motion"))

    for name, parts in _EXPR.items():
        out[name] = _mean(sum(m(f"bs_{p}") for p in parts) / len(parts))

    pose = w["pose_visible"] == 1
    pm = lambda col: np.where(pose, w[col], np.nan)  # noqa: E731
    out["lean_mean"] = _mean(pm("lean"))
    out["slouch_mean"] = _mean(pm("slouch"))
    out["body_motion_mean"] = _mean(pm("body_motion"))
    out["hand_near_face_mean"] = _mean(pm("hand_near_face"))

    hr_ok = w["hr_valid"] == 1
    out["hr_mean"] = _mean(np.where(hr_ok, w["hr_bpm"], np.nan))

    # diagnostics (not model inputs)
    out["_face_frac"] = float(face.mean())
    out["_pose_frac"] = float(pose.mean())
    out["_hr_frac"] = float(hr_ok.mean())
    out["_h_load"] = _mean(w["h_load"])
    return out


def segment_windows(seg: dict[str, np.ndarray]) -> list[dict[str, float]]:
    """All valid windows of one contiguous segment (a block, or the baseline)."""
    t = seg["t_ms"]
    if len(t) == 0:
        return []
    start = int(np.searchsorted(t, t[0] + SKIP_MS))
    out = []
    for i in range(start, len(t) - WINDOW_ROWS + 1, HOP_ROWS):
        w = {k: v[i : i + WINDOW_ROWS] for k, v in seg.items()}
        f = window_features(w)
        if f["_face_frac"] >= MIN_FACE_FRAC:
            f["_t0"] = float(t[i])
            out.append(f)
    return out


def baseline_vector(baseline_windows: list[dict[str, float]]) -> dict[str, float]:
    """Per-person resting reference: mean of each feature over baseline windows."""
    return {f: _mean(np.array([w[f] for w in baseline_windows], dtype=float)) for f in FEATURES}


def relative(window: dict[str, float], base: dict[str, float]) -> np.ndarray:
    """Baseline-relative feature vector; missing → 0 (= 'no change from rest')."""
    v = np.array([window[f] - base[f] for f in FEATURES], dtype=float)
    return np.where(np.isnan(v), 0.0, v)
