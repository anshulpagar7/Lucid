"""Reference runtime for an exported model JSON — the spec src/model/fusion.ts mirrors.

Used to (1) verify an export reproduces sklearn exactly, and (2) generate
expected outputs for the TypeScript parity tests.
"""
from __future__ import annotations

import math

import numpy as np

NODE = 7  # feature, threshold, left, right, value, leaf, missing_left


def tree_value(flat: list[float], x: list[float]) -> float:
    i = 0
    while True:
        b = i * NODE
        if flat[b + 5]:
            return flat[b + 4]
        v = x[int(flat[b])]
        if math.isnan(v):
            i = int(flat[b + 2]) if flat[b + 6] else int(flat[b + 3])
        else:
            i = int(flat[b + 2]) if v <= flat[b + 1] else int(flat[b + 3])


def _log_softmax(z: list[float]) -> list[float]:
    m = max(z)
    s = math.log(sum(math.exp(v - m) for v in z))
    return [v - m - s for v in z]


def modality_outputs(model: dict, rel: list[float]) -> list[float]:
    """Concatenated per-modality log-probabilities (meta-model input)."""
    feats = model["features"]
    out: list[float] = []
    for mod in model["modalities"]:
        x = [rel[feats.index(f)] for f in mod["features"]]
        raw = list(mod["baseline"])
        for per_class in mod["trees"]:
            for k, flat in enumerate(per_class):
                raw[k] += tree_value(flat, x)
        out += _log_softmax(raw)
    return out


def predict(model: dict, rel: list[float]) -> dict:
    s = modality_outputs(model, rel)
    W, b = model["meta"]["coef"], model["meta"]["intercept"]
    z = [b[c] + sum(W[c][j] * s[j] for j in range(len(s))) for c in range(len(b))]
    m = max(z)
    e = [math.exp(v - m) for v in z]
    p = [v / sum(e) for v in e]
    load = sum(pi * li for pi, li in zip(p, model["class_load"]))
    k = len(model["classes"])
    hi, lo = k - 1, 0
    contrib = {}
    for i, mod in enumerate(model["modalities"]):
        contrib[mod["name"]] = sum((W[hi][i * k + j] - W[lo][i * k + j]) * s[i * k + j] for j in range(k))
    return {"proba": p, "load": load, "contributions": contrib}


def verify(model: dict, est, X: np.ndarray, tol: float = 1e-9) -> float:
    """Max |Δp| between the exported JSON and the fitted sklearn model. Raises if > tol."""
    ref = est.predict_proba(X)
    worst = 0.0
    for i in range(len(X)):
        p = predict(model, X[i].tolist())["proba"]
        worst = max(worst, float(np.max(np.abs(np.array(p) - ref[i]))))
    if worst > tol:
        raise RuntimeError(f"exported model disagrees with sklearn (max |Δp| = {worst:.2e}); check the sklearn version")
    return worst
