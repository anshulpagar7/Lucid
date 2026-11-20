#!/usr/bin/env python3
"""Generate tests/fixtures/parity.json: Python's outputs on real-format rows,
which tests/model.test.ts must reproduce exactly in TypeScript."""
import json
import sys
import warnings
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lucid_ml.dataset import _arrays, build  # noqa: E402
from lucid_ml.features import FEATURES, baseline_vector, relative, segment_windows  # noqa: E402
from lucid_ml.models import LateFusion  # noqa: E402
from lucid_ml.runtime import predict, verify  # noqa: E402
from lucid_ml.schema import COLUMNS  # noqa: E402
from lucid_ml.simulate import simulate  # noqa: E402

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent


def clean(v):
    return None if isinstance(v, float) and np.isnan(v) else v


df = simulate(6, seed=7, quick=True)
ds = build(df)
model_est = LateFusion().fit(ds.X, ds.y, groups=ds.groups)
model = {"features": FEATURES, "classes": ["low", "medium", "high"], "class_load": [0.0, 0.5, 1.0], **model_est.export()}
verify(model, model_est, ds.X)

# one participant: baseline segment + one block segment, raw rows exactly as exported
p = df[df["participant"] == "P01"].sort_values("t_ms")
segs = {"baseline": p[p["phase"] == "baseline"], "block": p[(p["phase"] == "block") & (p["block"] == 0)]}
out = {"columns": COLUMNS, "segments": {}, "model": model}
base = None
for name, seg in segs.items():
    rows = [[clean(v) if not isinstance(v, (np.integer, np.floating)) else clean(float(v)) for v in r] for r in seg[COLUMNS].itertuples(index=False)]
    wins = segment_windows(_arrays(seg))
    out["segments"][name] = {"rows": rows, "windows": [{k: clean(v) for k, v in w.items()} for w in wins]}
    if name == "baseline":
        base = baseline_vector(wins)
        out["baseline_vector"] = {k: clean(v) for k, v in base.items()}
    else:
        rel = [relative(w, base).tolist() for w in wins]
        out["relative"] = rel
        out["predictions"] = [predict(model, r) for r in rel]

dst = ROOT / "tests" / "fixtures" / "parity.json"
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps(out, separators=(",", ":")))
print(f"wrote {dst.relative_to(ROOT)} ({dst.stat().st_size / 1e6:.2f} MB): "
      f"{len(out['segments']['baseline']['windows'])} baseline + {len(out['segments']['block']['windows'])} block windows")
