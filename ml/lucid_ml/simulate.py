"""Synthetic study data in Lucid's exact training-CSV format.

Purpose: prove the pipeline end-to-end before real participants exist, and
give tests a reproducible fixture. NOT evidence that the model works on
people — models trained on this are marked `synthetic: true` and the app
badges them DEMO.

Design: each simulated person has their own resting levels and their own
(sometimes near-zero) reactivity to load, plus fatigue drift, sensor noise,
face dropouts, missing body (20%) and poor pulse signal (15%). Effects are
deliberately modest so the task is realistically hard.
"""
from __future__ import annotations

import uuid

import numpy as np
import pandas as pd

from .schema import BLENDSHAPES, COLUMNS, LABEL_COLUMNS

LATIN = [[0, 1, 3, 2], [1, 2, 0, 3], [2, 3, 1, 0], [3, 0, 2, 1]]
HZ = 10


def _ar1(rng, n, sd, phi=0.9):
    x = np.zeros(n)
    e = rng.normal(0, sd * np.sqrt(1 - phi**2), n)
    for i in range(1, n):
        x[i] = phi * x[i - 1] + e[i]
    return x


def _traits(rng):
    return {
        "hr0": rng.normal(72, 8), "hr_k": max(0.0, rng.normal(1.8, 1.2)), "hr_bad": rng.random() < 0.15,
        "blink0": rng.uniform(10, 22), "blink_k": max(0.0, rng.normal(0.11, 0.07)),
        "brow0": rng.uniform(0.04, 0.2), "brow_k": rng.normal(0.025, 0.02),
        "gaze0": rng.uniform(0.07, 0.15), "gaze_k": max(0.0, rng.normal(0.01, 0.008)),
        "head0": rng.uniform(0.07, 0.2), "head_k": max(0.0, rng.normal(0.008, 0.008)),
        "lean_k": rng.normal(0.05, 0.06), "pose_off": rng.random() < 0.2,
        "press_k": rng.normal(0.012, 0.012), "squint_k": rng.normal(0.008, 0.01),
        "tlx_off": rng.normal(0, 10), "skill": rng.normal(0, 0.05),
    }


def _segment(rng, tr, n_rows, level, drift):
    """Feature rows for a segment at a given load level (−0.6 = rest)."""
    lv = np.full(n_rows, level, dtype=float)
    face = (rng.random(n_rows) > 0.02).astype(float)

    # blinks: Poisson onsets, each closing the eyes for 2–3 rows
    rate = max(2.0, tr["blink0"] * (1 - tr["blink_k"] * max(level, -0.6) - 0.03 * drift))
    ec = np.clip(0.05 + rng.normal(0, 0.025, n_rows), 0, 1)
    for i in np.flatnonzero(rng.random(n_rows) < rate / 60 / HZ):
        ec[i : i + rng.integers(2, 4)] = rng.uniform(0.75, 0.95)

    gsd = max(0.02, tr["gaze0"] - tr["gaze_k"] * level)
    hsd = max(0.02, tr["head0"] - tr["head_k"] * level)
    out = {
        "face_present": face,
        "yaw": _ar1(rng, n_rows, 4 * hsd / 0.12), "pitch": _ar1(rng, n_rows, 3 * hsd / 0.12) - 1.5 * drift,
        "roll": _ar1(rng, n_rows, 1.5),
        "gaze_x": _ar1(rng, n_rows, gsd, 0.8), "gaze_y": _ar1(rng, n_rows, gsd * 0.8, 0.8),
        "ear": 0.3 - 0.25 * ec + rng.normal(0, 0.01, n_rows), "eye_closure": ec,
        "blink_rate": np.full(n_rows, rate) + rng.normal(0, 1.5, n_rows),
        "perclos": np.clip(0.01 + 0.02 * drift + rng.normal(0, 0.005, n_rows), 0, 1),
        "brow_down": np.clip(tr["brow0"] + tr["brow_k"] * lv + 0.02 * drift + _ar1(rng, n_rows, 0.03), 0, 1),
        "jaw_open": np.clip(0.03 + _ar1(rng, n_rows, 0.02), 0, 1),
        "head_motion": np.abs(hsd + _ar1(rng, n_rows, 0.03)),
    }
    for k in ["yaw", "pitch", "roll", "gaze_x", "gaze_y"]:
        out[k] = out[k] * face

    pose_ok = not tr["pose_off"]
    vis = np.full(n_rows, 1.0 if pose_ok else 0.0)
    out.update({
        "pose_visible": vis,
        "lean": np.where(vis == 1, tr["lean_k"] * lv + _ar1(rng, n_rows, 0.05), np.nan),
        "slouch": np.where(vis == 1, np.clip(0.1 + 0.05 * drift + _ar1(rng, n_rows, 0.04), 0, 1), np.nan),
        "shoulder_tilt": np.where(vis == 1, _ar1(rng, n_rows, 2), np.nan),
        "hand_near_face": np.where(vis == 1, np.clip(0.05 + 0.04 * drift + _ar1(rng, n_rows, 0.05), 0, 1), np.nan),
        "head_on_hand": np.where(vis == 1, 0.0, np.nan),
        "body_motion": np.where(vis == 1, np.abs(0.12 - 0.01 * lv + _ar1(rng, n_rows, 0.04)), np.nan),
        "posture_score": np.where(vis == 1, 0.9, np.nan),
    })

    hr = tr["hr0"] + tr["hr_k"] * lv + 1.5 * drift + _ar1(rng, n_rows, 2.0, 0.95)
    p_valid = 0.25 if tr["hr_bad"] else 0.85
    valid = (np.repeat(rng.random(n_rows // 20 + 1) < p_valid, 20)[:n_rows]).astype(float)
    out.update({
        "hr_bpm": np.where(valid == 1, hr + rng.normal(0, 3 if tr["hr_bad"] else 1.5, n_rows), np.nan),
        "hr_quality": np.where(valid == 1, rng.uniform(0.5, 0.95, n_rows), rng.uniform(0, 0.4, n_rows)),
        "hr_snr": rng.normal(1, 2, n_rows), "hr_valid": valid, "hr_baseline": np.full(n_rows, tr["hr0"]),
        "hrv_rmssd": np.full(n_rows, np.nan),
        "h_attention": np.clip(0.85 + rng.normal(0, 0.05, n_rows), 0, 1),
        "h_engagement": np.clip(0.8 + rng.normal(0, 0.05, n_rows), 0, 1),
    })
    out["h_load"] = np.clip(0.2 + 0.9 * out["brow_down"] + 0.01 * (15 - out["blink_rate"]) + rng.normal(0, 0.05, n_rows), 0, 1)

    # blendshapes: small resting noise, a few carry (person-specific) load effects
    bs = {b: np.clip(0.02 + np.abs(_ar1(rng, n_rows, 0.015)), 0, 1) for b in BLENDSHAPES}
    bs["browDownLeft"] = bs["browDownRight"] = out["brow_down"]
    bs["eyeBlinkLeft"] = bs["eyeBlinkRight"] = ec
    bs["jawOpen"] = out["jaw_open"]
    for side in ["Left", "Right"]:
        bs[f"mouthPress{side}"] = np.clip(0.05 + tr["press_k"] * lv + _ar1(rng, n_rows, 0.02), 0, 1)
        bs[f"eyeSquint{side}"] = np.clip(0.08 + tr["squint_k"] * lv + _ar1(rng, n_rows, 0.02), 0, 1)
    for b in BLENDSHAPES:
        out[f"bs_{b}"] = np.where(face == 1, bs[b], np.nan)
    return out


def simulate_participant(pid: str, seed: int, quick: bool = False) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    tr = _traits(rng)
    sid = str(uuid.UUID(int=int(rng.integers(0, 2**63)) << 64 | seed))
    order = LATIN[int("".join(c for c in pid if c.isdigit())) % 4]
    block_s = 30 if quick else 90

    plan = [("practice", -1, -1, 15, -0.3), ("baseline", -1, -1, 30 if quick else 60, -0.6)]
    for i, n in enumerate(order):
        plan += [("other", -1, -1, 3, 0.0), ("block", i, n, block_s, float(n)), ("tlx", i, n, 25, n * 0.4)]
        if i < len(order) - 1:
            plan.append(("rest", -1, -1, 20, -0.4))

    frames, t = [], 0.0
    elapsed_total = sum(p[3] for p in plan)
    tlx = {}
    for phase, b, n, secs, level in plan:
        nr = int(secs * HZ)
        drift = t / 1000 / elapsed_total  # 0 → 1 fatigue over the session
        seg = _segment(rng, tr, nr, level, drift)
        seg["t_ms"] = t + np.arange(nr) * 100 + rng.normal(0, 3, nr).round()
        seg.update({"phase": phase, "block": b, "n_level": n, "trial": -1})
        if phase == "block":
            seg["trial"] = np.minimum(np.arange(nr) // 25, int(block_s / 2.5) - 1)
            raw = float(np.clip(18 + 17 * n + tr["tlx_off"] + rng.normal(0, 7), 0, 100))
            acc = float(np.clip(0.97 - 0.09 * n + tr["skill"] + rng.normal(0, 0.03), 0.3, 1))
            tlx[b] = (raw, float(np.clip(raw + rng.normal(8, 6), 0, 100)), acc, 3.5 * acc - 1.2)
        frames.append(pd.DataFrame(seg))
        t += secs * 1000
    df = pd.concat(frames, ignore_index=True)

    df["participant"], df["session"] = pid, sid
    cls = {0: "low", 1: "low", 2: "medium", 3: "high"}
    df["load_class"] = np.where(df["phase"] == "baseline", "rest", np.where(df["phase"] == "block", df["n_level"].map(cls), ""))
    lab = df["block"].map(lambda b: tlx.get(b, (np.nan,) * 4))
    df["tlx_raw"] = [x[0] for x in lab]
    df["tlx_mental"] = [x[1] for x in lab]
    df["block_accuracy"] = [x[2] for x in lab]
    df["block_dprime"] = [x[3] for x in lab]
    df.loc[df["block"] < 0, ["tlx_raw", "tlx_mental", "block_accuracy", "block_dprime"]] = np.nan

    df["t_ms"] = df["t_ms"].astype(int)
    num = [c for c in COLUMNS if c not in ("t_ms", "phase", "block", "n_level", "trial")]
    df[num] = df[num].astype(float).round(4)
    return df[LABEL_COLUMNS + COLUMNS]


def simulate(n_participants: int = 20, seed: int = 0, quick: bool = False) -> pd.DataFrame:
    return pd.concat(
        [simulate_participant(f"P{i:02d}", seed * 1000 + i, quick) for i in range(1, n_participants + 1)],
        ignore_index=True,
    )
