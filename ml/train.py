#!/usr/bin/env python3
"""Train + evaluate Lucid's cognitive-load model.

    python ml/train.py exports/lucid_training_*.csv            # real data → public/models/load_model.json
    python ml/train.py --simulate 20                            # synthetic demo → public/models/load_model.demo.json

Evaluation is leave-one-participant-out (LOPO): every reported number comes
from people the model never saw — the only honest test for a system meant to
work on new students.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr
from sklearn.metrics import balanced_accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import LeaveOneGroupOut

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lucid_ml.dataset import CLASSES, Dataset, build, load_csv  # noqa: E402
from lucid_ml.features import FEATURES, HOP_ROWS, MIN_FACE_FRAC, MODALITIES, MODALITY_LABELS, SKIP_MS, WINDOW_ROWS  # noqa: E402
from lucid_ml.models import HeuristicBaseline, LateFusion, candidates  # noqa: E402
from lucid_ml.runtime import verify  # noqa: E402
from joblib import Parallel, delayed  # noqa: E402

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)
ROOT = Path(__file__).resolve().parent.parent
CLASS_LOAD = np.array([0.0, 0.5, 1.0])


def _fold(ds: Dataset, make, tr, te):
    m = make()
    if isinstance(m, HeuristicBaseline):
        m.fit(None, ds.y[tr], h=ds.h_load[tr])
        p = m.predict_proba(None, h=ds.h_load[te])
    elif isinstance(m, LateFusion):
        p = m.fit(ds.X[tr], ds.y[tr], groups=ds.groups[tr]).predict_proba(ds.X[te])
    else:
        p = m.fit(ds.X[tr], ds.y[tr]).predict_proba(ds.X[te])
    full = np.zeros((len(te), 3))
    full[:, np.asarray(getattr(m, "classes_", np.arange(3)), dtype=int)] = p  # a fold may lack a class
    return te, full


def lopo(ds: Dataset, make) -> np.ndarray:
    """Out-of-participant class probabilities for every window (folds run in parallel)."""
    P = np.zeros((len(ds.y), 3))
    folds = LeaveOneGroupOut().split(ds.X, ds.y, ds.groups)
    for te, p in Parallel(n_jobs=-1)(delayed(_fold)(ds, make, tr, te) for tr, te in folds):
        P[te] = p
    return P


def metrics(ds: Dataset, P: np.ndarray, rng=np.random.default_rng(0)) -> dict:
    pred = P.argmax(1)
    people = ds.participants
    per = {}
    for p in people:
        m = ds.groups == p
        per[p] = f1_score(ds.y[m], pred[m], average="macro", labels=[0, 1, 2])
    # 95% CI by resampling participants (the unit of generalisation)
    boots = []
    idx = {p: np.flatnonzero(ds.groups == p) for p in people}
    for _ in range(1000):
        pick = np.concatenate([idx[p] for p in rng.choice(people, len(people))])
        boots.append(f1_score(ds.y[pick], pred[pick], average="macro", labels=[0, 1, 2]))
    # block level: mean expected load per block vs that block's NASA-TLX
    load = P @ CLASS_LOAD
    keys = sorted(set(zip(ds.session, ds.block)))
    bl = np.array([load[(ds.session == s) & (ds.block == b)].mean() for s, b in keys])
    bt = np.array([ds.tlx[(ds.session == s) & (ds.block == b)][0] for s, b in keys])
    ok = ~np.isnan(bt)
    rho = spearmanr(bl[ok], bt[ok]).statistic if ok.sum() > 3 else float("nan")
    return {
        "macro_f1": float(f1_score(ds.y, pred, average="macro")),
        "ci95": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
        "balanced_accuracy": float(balanced_accuracy_score(ds.y, pred)),
        "per_participant_f1": {"mean": float(np.mean(list(per.values()))), "sd": float(np.std(list(per.values()))), "values": per},
        "block_spearman_tlx": float(rho),
        "confusion": confusion_matrix(ds.y, pred, labels=[0, 1, 2]).tolist(),
    }


def charts(out: Path, results: dict, ablation: dict, ship: dict, synthetic: bool):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({
        "figure.facecolor": "#0a0a0b", "axes.facecolor": "#111113", "axes.edgecolor": "#2e2e36", "axes.labelcolor": "#8a8a96",
        "xtick.color": "#8a8a96", "ytick.color": "#8a8a96", "text.color": "#ededf0", "font.size": 10, "axes.titlesize": 11,
        "axes.spines.top": False, "axes.spines.right": False, "grid.color": "#1c1c22",
    })
    tag = "  ·  SYNTHETIC DATA (demo)" if synthetic else ""

    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    names = list(results)
    vals = [results[n]["macro_f1"] for n in names]
    err = np.array([[v - results[n]["ci95"][0], results[n]["ci95"][1] - v] for n, v in zip(names, vals)]).T
    colors = ["#f5a524" if "shipped" in n else "#3a3a44" for n in names]
    ax.barh(names, vals, xerr=err, color=colors, error_kw={"ecolor": "#8a8a96", "capsize": 3}, height=0.6)
    ax.axvline(1 / 3, color="#55555f", ls="--", lw=1)
    ax.text(1 / 3 + 0.005, len(names) - 0.4, "chance", color="#55555f", fontsize=8)
    ax.set_xlim(0, 1)
    ax.set_xlabel("LOPO macro-F1 (95% CI over participants)")
    ax.set_title(f"Model comparison{tag}", loc="left")
    ax.invert_yaxis()
    fig.tight_layout()
    fig.savefig(out / "comparison.png", dpi=160)
    plt.close(fig)

    cm = np.array(ship["confusion"], dtype=float)
    cmn = cm / cm.sum(1, keepdims=True)
    fig, ax = plt.subplots(figsize=(4.2, 3.8))
    ax.imshow(cmn, cmap="magma", vmin=0, vmax=1)
    for i in range(3):
        for j in range(3):
            ax.text(j, i, f"{cmn[i, j]:.2f}\n({int(cm[i, j])})", ha="center", va="center", color="#0a0a0b" if cmn[i, j] > 0.55 else "#ededf0", fontsize=9)
    ax.set_xticks(range(3), CLASSES)
    ax.set_yticks(range(3), CLASSES)
    ax.set_xlabel("predicted")
    ax.set_ylabel("true (n-back level)")
    ax.set_title("Boosted late fusion · LOPO", loc="left")
    fig.tight_layout()
    fig.savefig(out / "confusion.png", dpi=160)
    plt.close(fig)

    if ablation:
        fig, ax = plt.subplots(figsize=(7.5, 3.2))
        full = ship["macro_f1"]
        mods = list(MODALITIES)
        drop = [full - ablation[f"−{m}"]["macro_f1"] for m in mods]
        only = [ablation[f"only {m}"]["macro_f1"] for m in mods]
        x = np.arange(len(mods))
        ax.bar(x - 0.2, only, 0.38, color="#a78bfa", label="this modality alone")
        ax.bar(x + 0.2, drop, 0.38, color="#f5a524", label="F1 lost when removed")
        ax.axhline(0, color="#2e2e36")
        ax.set_xticks(x, [MODALITY_LABELS[m] for m in mods], fontsize=8.5)
        ax.set_ylabel("macro-F1")
        ax.set_title(f"Modality ablation{tag}", loc="left")
        ax.legend(frameon=False, fontsize=8.5)
        fig.tight_layout()
        fig.savefig(out / "ablation.png", dpi=160)
        plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="*", help="training CSV(s) exported from Lucid (Study → All · training)")
    ap.add_argument("--simulate", type=int, metavar="N", help="train on N synthetic participants instead (demo)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", help="model JSON path (default: public/models/load_model[.demo].json)")
    ap.add_argument("--report", default=None, help="report directory (default: ml/reports/<timestamp>)")
    ap.add_argument("--fast", action="store_true", help="skip modality ablations")
    a = ap.parse_args()
    if not a.csv and not a.simulate:
        ap.error("give training CSV(s), or --simulate N for a synthetic demo")

    t0 = time.time()
    synthetic = bool(a.simulate)
    if synthetic:
        from lucid_ml.simulate import simulate

        print(f"▸ simulating {a.simulate} participants (seed {a.seed}) — SYNTHETIC DEMO DATA")
        df = simulate(a.simulate, seed=a.seed)
        sources = [f"simulate(n={a.simulate}, seed={a.seed})"]
    else:
        df = load_csv(a.csv)
        sources = [Path(p).name for p in a.csv]
    ds = build(df)
    n_p = len(ds.participants)
    print(f"▸ {n_p} participants · {len(ds.y):,} windows · classes {dict(zip(CLASSES, np.bincount(ds.y, minlength=3).tolist()))}")
    for s in ds.skipped:
        print(f"  ! skipped {s}")
    if n_p < 3:
        sys.exit("✗ need at least 3 participants for leave-one-participant-out evaluation")
    if n_p < 10:
        print(f"  ! only {n_p} participants — results will be noisy; aim for 15–25")

    print("▸ LOPO evaluation")
    results = {}
    for name, make in candidates().items():
        results[name] = metrics(ds, lopo(ds, make))
        r = results[name]
        print(f"  {name:28s} macro-F1 {r['macro_f1']:.3f}  [{r['ci95'][0]:.2f}–{r['ci95'][1]:.2f}]  bal-acc {r['balanced_accuracy']:.3f}  ρ(TLX) {r['block_spearman_tlx']:+.2f}")
    SHIP = next(k for k in results if "shipped" in k)
    ship = results[SHIP]

    ablation = {}
    if not a.fast:
        print("▸ modality ablation")
        mods = tuple(MODALITIES)
        for m in mods:
            ablation[f"−{m}"] = metrics(ds, lopo(ds, lambda m=m: LateFusion(modalities=tuple(x for x in mods if x != m))))
            ablation[f"only {m}"] = metrics(ds, lopo(ds, lambda m=m: LateFusion(modalities=(m,))))
            print(f"  {MODALITY_LABELS[m]:18s} alone {ablation[f'only {m}']['macro_f1']:.3f}   without {ablation[f'−{m}']['macro_f1']:.3f}  (Δ {ship['macro_f1'] - ablation[f'−{m}']['macro_f1']:+.3f})")

    print("▸ fitting final model on all participants")
    final = LateFusion().fit(ds.X, ds.y, groups=ds.groups)
    importance = final.modality_importance()

    stamp = datetime.now(timezone.utc)
    print("▸ exporting + verifying against sklearn")
    exported = final.export()
    model = {
        "format": "lucid-late-fusion/2",
        "target": "cognitive_load",
        "classes": CLASSES,
        "class_load": CLASS_LOAD.tolist(),
        "window": {"rows": WINDOW_ROWS, "hop": HOP_ROWS, "skip_ms": SKIP_MS, "min_face_frac": MIN_FACE_FRAC},
        "features": FEATURES,
        "modality_labels": MODALITY_LABELS,
        **exported,
        "importance": importance,
        "eval": {
            "protocol": "leave-one-participant-out",
            "macro_f1": ship["macro_f1"], "ci95": ship["ci95"], "balanced_accuracy": ship["balanced_accuracy"],
            "block_spearman_tlx": ship["block_spearman_tlx"],
            "baselines": {k: round(v["macro_f1"], 4) for k, v in results.items() if "shipped" not in k},
            "baseline_ci95": {k: [round(c, 4) for c in v["ci95"]] for k, v in results.items() if "shipped" not in k},
            "confusion": ship["confusion"],
            "per_participant_f1": {"mean": ship["per_participant_f1"]["mean"], "sd": ship["per_participant_f1"]["sd"]},
            "ablation": {m: {"alone": round(ablation[f"only {m}"]["macro_f1"], 4), "without": round(ablation[f"−{m}"]["macro_f1"], 4)} for m in MODALITIES} if ablation else None,
        },
        "data": {"participants": n_p, "windows": int(len(ds.y)), "synthetic": synthetic, "sources": sources},
        "created": stamp.isoformat(timespec="seconds"),
    }
    worst = verify(model, final, ds.X[:: max(1, len(ds.X) // 400)])
    print(f"  export matches sklearn (max |Δp| = {worst:.1e})")
    out = Path(a.out) if a.out else ROOT / "public" / "models" / ("load_model.demo.json" if synthetic else "load_model.json")
    if synthetic and out.name == "load_model.json":
        sys.exit("✗ refusing to write a synthetic model to load_model.json (the real-model slot)")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(model, separators=(",", ":")))

    rep = Path(a.report) if a.report else ROOT / "ml" / "reports" / (stamp.strftime("%Y%m%d-%H%M%S") + ("-synthetic" if synthetic else ""))
    rep.mkdir(parents=True, exist_ok=True)
    charts(rep, results, ablation, ship, synthetic)
    (rep / "metrics.json").write_text(json.dumps({"results": results, "ablation": ablation, "importance": importance, "data": model["data"]}, indent=2))
    write_report(rep, model, results, ablation, ds)

    print(f"✓ model  → {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")
    print(f"✓ report → {rep.relative_to(ROOT) if rep.is_relative_to(ROOT) else rep}/report.md   ({time.time() - t0:.0f}s)")


def write_report(rep: Path, model: dict, results: dict, ablation: dict, ds: Dataset):
    e, d = model["eval"], model["data"]
    L = [f"# Lucid · cognitive-load model report", ""]
    if d["synthetic"]:
        L += ["> **⚠ SYNTHETIC DATA — pipeline demonstration only.** These numbers say nothing about real people.", ""]
    L += [
        f"- **Data:** {d['participants']} participants · {d['windows']:,} windows ({model['window']['rows'] / 10:.0f} s, hop {model['window']['hop'] / 10:.0f} s) · sources: {', '.join(d['sources'])}",
        f"- **Target:** n-back load class — low (0/1-back), medium (2-back), high (3-back); features baseline-relative per person",
        f"- **Evaluation:** leave-one-participant-out — every number below is on people the model never saw",
        "",
        "## Results",
        "",
        "| Model | macro-F1 | 95% CI | balanced acc. | per-person F1 (mean ± sd) | ρ(load, TLX) |",
        "|---|---|---|---|---|---|",
    ]
    for n, r in results.items():
        pp = r["per_participant_f1"]
        L.append(f"| {'**' + n + '**' if 'shipped' in n else n} | {r['macro_f1']:.3f} | {r['ci95'][0]:.2f}–{r['ci95'][1]:.2f} | {r['balanced_accuracy']:.3f} | {pp['mean']:.2f} ± {pp['sd']:.2f} | {r['block_spearman_tlx']:+.2f} |")
    L += ["", "Chance macro-F1 for 3 classes ≈ 0.33. ρ is Spearman correlation between the model's mean expected load per block and that block's NASA-TLX.", "", "![comparison](comparison.png)", "", "![confusion](confusion.png)", ""]
    if ablation:
        L += ["## Modality ablation", "", "| Modality | alone | without it | Δ when removed | learned weight |", "|---|---|---|---|---|"]
        for m in MODALITIES:
            L.append(f"| {MODALITY_LABELS[m]} | {ablation[f'only {m}']['macro_f1']:.3f} | {ablation[f'−{m}']['macro_f1']:.3f} | {e['macro_f1'] - ablation[f'−{m}']['macro_f1']:+.3f} | {model['importance'][m]:.2f} |")
        L += ["", "![ablation](ablation.png)", ""]
    L += [
        "## Why boosted late fusion ships",
        "",
        "Each modality gets its own small boosted model, and a logistic meta-model weighs them. It is small enough to run in the browser, its per-modality contributions explain every prediction in the UI, and it degrades gracefully when a modality is missing (no body in frame, weak pulse). On the synthetic benchmark the purely linear late fusion did no better than the calibrated heuristic, which is why the per-modality learners are boosted. If early-fusion trees clearly beat it on real data, revisit the trade-off.",
        "",
        "## Limitations",
        "",
        "- n-back induces *working-memory* load in a controlled task; transfer to lectures is untested.",
        "- Labels are block-level: every window in a block shares its n-back level, though moment-to-moment load varies.",
        "- Small samples give wide confidence intervals — read the CI, not just the point estimate.",
    ]
    (rep / "report.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
