"""Python-side checks: feature math, no cross-participant leakage, export fidelity."""
import sys
import warnings
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lucid_ml.dataset import build  # noqa: E402
from lucid_ml.features import FEATURES, WINDOW_ROWS, relative, segment_windows, window_features  # noqa: E402
from lucid_ml.models import LateFusion  # noqa: E402
from lucid_ml.runtime import predict, verify  # noqa: E402
from lucid_ml.schema import COLUMNS  # noqa: E402
from lucid_ml.simulate import simulate  # noqa: E402

warnings.filterwarnings("ignore")


def blank(n=WINDOW_ROWS):
    w = {c: np.zeros(n) for c in COLUMNS if c != "phase"}
    w["face_present"][:] = 1
    w["t_ms"] = np.arange(n) * 100.0
    return w


def test_blink_count_and_perclos():
    w = blank()
    w["eye_closure"][:] = 0.05
    for s in (10, 40, 70):  # three blinks, 2 rows each
        w["eye_closure"][s : s + 2] = 0.9
    f = window_features(w)
    assert f["blink_rate_win"] == pytest.approx(3 * 6)  # 3 per 10 s = 18 / min
    assert f["perclos_win"] == pytest.approx(6 / 100)


def test_face_absent_rows_are_ignored():
    w = blank()
    w["yaw"][:50] = 30.0
    w["face_present"][:50] = 0  # those yaw values are not real
    assert window_features(w)["yaw_std"] == pytest.approx(0.0)


def test_missing_modality_is_nan_then_zero():
    w = blank()
    w["hr_valid"][:] = 0
    f = window_features(w)
    assert np.isnan(f["hr_mean"])
    assert relative(f, {k: 0.0 for k in FEATURES})[FEATURES.index("hr_mean")] == 0.0


def test_windows_skip_onset_and_respect_face_threshold():
    w = blank(300)
    wins = segment_windows(w)
    assert all(x["_t0"] >= 3000 for x in wins)
    w["face_present"][150:] = 0
    assert all(x["_face_frac"] >= 0.8 for x in segment_windows(w))


@pytest.fixture(scope="module")
def small():
    return build(simulate(6, seed=3, quick=True))


def test_windows_never_cross_participants_or_blocks(small):
    for s in set(small.session):
        assert len(set(small.groups[small.session == s])) == 1


def test_export_reproduces_sklearn_exactly(small):
    est = LateFusion().fit(small.X, small.y, groups=small.groups)
    model = {"features": FEATURES, "classes": ["low", "medium", "high"], "class_load": [0, 0.5, 1], **est.export()}
    assert verify(model, est, small.X) < 1e-9
    p = predict(model, small.X[0].tolist())
    assert sum(p["proba"]) == pytest.approx(1.0)
    assert 0 <= p["load"] <= 1


def test_lopo_holds_out_the_whole_participant(small):
    from sklearn.model_selection import LeaveOneGroupOut

    for tr, te in LeaveOneGroupOut().split(small.X, small.y, small.groups):
        assert not set(small.groups[tr]) & set(small.groups[te])
