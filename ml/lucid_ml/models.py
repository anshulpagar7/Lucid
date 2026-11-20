"""Models compared under leave-one-participant-out (LOPO) cross-validation.

Shipped model — boosted late fusion:
  1. one small gradient-boosted classifier per modality (nonlinear within a
     modality, e.g. "exactly 0 = modality missing"),
  2. a meta logistic model over their log-probabilities, trained on
     *out-of-fold* modality outputs so it never sees overfit inputs.

Why: on the synthetic benchmark it matched the best early-fusion model while
staying explainable per modality and degrading gracefully when a modality is
missing. Exported as plain JSON trees + coefficients for the browser.
"""
from __future__ import annotations

import numpy as np
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .features import FEATURES, MODALITIES

N_CLASSES = 3


def _lr(C: float) -> LogisticRegression:
    return LogisticRegression(C=C, class_weight="balanced", max_iter=2000)


def _gbm(max_iter: int = 80) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=max_iter, max_depth=2, learning_rate=0.08, l2_regularization=1.0,
        early_stopping=False, class_weight="balanced", random_state=0,
    )


def _log_softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(1, keepdims=True)
    return z - np.log(np.exp(z).sum(1, keepdims=True))


class LateFusion(BaseEstimator, ClassifierMixin):
    """learner='gbm' (shipped) or 'linear' (logistic per modality, for comparison)."""

    def __init__(self, modalities: tuple[str, ...] = tuple(MODALITIES), learner: str = "gbm", C_meta: float = 1.0, inner_folds: int = 3):
        self.modalities = modalities
        self.learner = learner
        self.C_meta = C_meta
        self.inner_folds = inner_folds

    def _cols(self, m: str) -> list[int]:
        return [FEATURES.index(f) for f in MODALITIES[m]]

    def _fit_mod(self, X, y, m):
        est = _gbm() if self.learner == "gbm" else make_pipeline(StandardScaler(), _lr(0.3))
        return est.fit(X[:, self._cols(m)], y)

    def _mod_out(self, est, X) -> np.ndarray:
        if self.learner == "gbm":
            return _log_softmax(est._raw_predict(X))
        return est.decision_function(X)

    def _stack(self, mods: dict, X) -> np.ndarray:
        return np.hstack([self._mod_out(mods[m], X[:, self._cols(m)]) for m in self.modalities])

    def fit(self, X, y, groups=None):
        self.classes_ = np.arange(N_CLASSES)
        groups = np.arange(len(y)) if groups is None else np.asarray(groups)
        k = min(self.inner_folds, len(set(groups)))
        oof = np.zeros((len(y), N_CLASSES * len(self.modalities)))
        for tr, va in GroupKFold(n_splits=k).split(X, y, groups):
            mods = {m: self._fit_mod(X[tr], y[tr], m) for m in self.modalities}
            oof[va] = self._stack(mods, X[va])
        self.mods_ = {m: self._fit_mod(X, y, m) for m in self.modalities}
        self.meta_ = _lr(self.C_meta).fit(oof, y)
        return self

    def predict_proba(self, X):
        return self.meta_.predict_proba(self._stack(self.mods_, X))

    def predict(self, X):
        return self.predict_proba(X).argmax(1)

    def modality_importance(self) -> dict[str, float]:
        """Mean |meta weight| per modality, normalised to sum to 1."""
        W = np.abs(self.meta_.coef_)
        imp = {m: float(W[:, i * N_CLASSES : (i + 1) * N_CLASSES].mean()) for i, m in enumerate(self.modalities)}
        s = sum(imp.values()) or 1.0
        return {m: v / s for m, v in imp.items()}

    def export(self) -> dict:
        assert self.learner == "gbm", "only the boosted late-fusion model is exported"
        mods = []
        for m in self.modalities:
            est = self.mods_[m]
            mods.append({"name": m, "features": MODALITIES[m], "baseline": est._baseline_prediction.ravel().tolist(), "trees": _export_trees(est)})
        return {"modalities": mods, "meta": {"coef": self.meta_.coef_.tolist(), "intercept": self.meta_.intercept_.tolist()}}


def _export_trees(est: HistGradientBoostingClassifier) -> list[list[list[float]]]:
    """trees[iteration][class] = flat node list: [feature, threshold, left, right, value, leaf, missing_left] * nodes.

    Uses sklearn internals (`_predictors`); export() is verified against
    sklearn's own predictions by runtime.verify(), so an incompatible sklearn
    version fails loudly instead of shipping a wrong model.
    """
    out = []
    for per_class in est._predictors:
        row = []
        for tp in per_class:
            n = tp.nodes
            if n["is_categorical"].any():
                raise ValueError("categorical splits are not supported by the exporter")
            flat = []
            for i in range(len(n)):
                flat += [int(n["feature_idx"][i]), float(n["num_threshold"][i]), int(n["left"][i]), int(n["right"][i]),
                         float(n["value"][i]), int(n["is_leaf"][i]), int(n["missing_go_to_left"][i])]
            row.append(flat)
        out.append(row)
    return out


class HeuristicBaseline(BaseEstimator, ClassifierMixin):
    """Lucid's heuristic v0 load score, calibrated per training fold with a 1-D logistic model."""

    def fit(self, X, y, groups=None, h=None):
        self.lr_ = _lr(1.0).fit(np.nan_to_num(h).reshape(-1, 1), y)
        self.classes_ = self.lr_.classes_
        return self

    def predict_proba(self, X, h=None):
        return self.lr_.predict_proba(np.nan_to_num(h).reshape(-1, 1))


def candidates() -> dict:
    return {
        "Majority class": lambda: DummyClassifier(strategy="most_frequent"),
        "Heuristic v0 (calibrated)": HeuristicBaseline,
        "Early-fusion logistic": lambda: make_pipeline(StandardScaler(), _lr(0.1)),
        "Early-fusion boosted trees": lambda: _gbm(200),
        "Late fusion · linear": lambda: LateFusion(learner="linear"),
        "Late fusion · boosted (shipped)": LateFusion,
    }
