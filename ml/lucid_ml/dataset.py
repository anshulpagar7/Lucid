"""Training CSV (from Lucid's Study mode) → labelled, baseline-normalised windows."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .features import FEATURES, baseline_vector, relative, segment_windows
from .schema import COLUMNS

CLASSES = ["low", "medium", "high"]  # 0/1-back, 2-back, 3-back


@dataclass
class Dataset:
    X: np.ndarray  # (windows, features) baseline-relative
    y: np.ndarray  # class index into CLASSES
    groups: np.ndarray  # participant id per window
    session: np.ndarray
    block: np.ndarray
    n_level: np.ndarray
    tlx: np.ndarray
    h_load: np.ndarray  # heuristic v0 load (for the baseline comparison)
    quality: pd.DataFrame  # per-window modality coverage
    skipped: list[str] = field(default_factory=list)

    @property
    def participants(self) -> list[str]:
        return sorted(set(self.groups.tolist()))


def load_csv(paths: list[str]) -> pd.DataFrame:
    df = pd.concat([pd.read_csv(p, low_memory=False) for p in paths], ignore_index=True)
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"CSV is missing {len(missing)} schema columns (e.g. {missing[:3]}). Export it from Lucid's Study tab.")
    return df.drop_duplicates()


def _arrays(seg: pd.DataFrame) -> dict[str, np.ndarray]:
    return {c: pd.to_numeric(seg[c], errors="coerce").to_numpy(dtype=float) for c in COLUMNS if c != "phase"}


def build(df: pd.DataFrame) -> Dataset:
    rows: dict[str, list] = {k: [] for k in ["X", "y", "g", "s", "b", "n", "tlx", "h", "q"]}
    skipped: list[str] = []
    for sid, sess in df.groupby("session", sort=False):
        sess = sess.sort_values("t_ms")
        pid = str(sess["participant"].iloc[0])
        base_w = segment_windows(_arrays(sess[sess["phase"] == "baseline"]))
        if len(base_w) < 3:
            skipped.append(f"{pid}/{sid}: baseline too short or face not visible ({len(base_w)} windows)")
            continue
        base = baseline_vector(base_w)
        blocks = sess[(sess["phase"] == "block") & (sess["block"] >= 0)]
        for b, seg in blocks.groupby("block", sort=True):
            cls = str(seg["load_class"].iloc[0])
            if cls not in CLASSES:
                continue
            tlx = pd.to_numeric(seg["tlx_raw"], errors="coerce").iloc[0]
            n = int(seg["n_level"].iloc[0])
            for w in segment_windows(_arrays(seg)):
                rows["X"].append(relative(w, base))
                rows["y"].append(CLASSES.index(cls))
                rows["g"].append(pid)
                rows["s"].append(sid)
                rows["b"].append(int(b))
                rows["n"].append(n)
                rows["tlx"].append(tlx)
                rows["h"].append(w["_h_load"])
                rows["q"].append({"face": w["_face_frac"], "pose": w["_pose_frac"], "hr": w["_hr_frac"]})
    if not rows["X"]:
        raise ValueError("No usable windows. Check that sessions are complete and the face was visible.")
    return Dataset(
        X=np.vstack(rows["X"]), y=np.array(rows["y"]), groups=np.array(rows["g"]), session=np.array(rows["s"]),
        block=np.array(rows["b"]), n_level=np.array(rows["n"]), tlx=np.array(rows["tlx"], dtype=float),
        h_load=np.array(rows["h"], dtype=float), quality=pd.DataFrame(rows["q"]), skipped=skipped,
    )


def feature_index(names: list[str]) -> list[int]:
    return [FEATURES.index(f) for f in names]
