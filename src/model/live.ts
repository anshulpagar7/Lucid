// Live inference: same 10 Hz rows as Study-mode recording (shared toRow), a
// personal resting baseline, then a prediction every HOP_ROWS rows (~2 s).

import { session } from "../engine/session";
import { series } from "../engine/series";
import { COLUMNS, toRow, type Row } from "../study/schema";
import { useLucid, type ModelState } from "../store";
import { FEATURES, HOP_ROWS, MIN_FACE_FRAC, WINDOW_ROWS, baselineVector, relative, segmentWindows, windowFeatures, type Features } from "./features";
import { predict, type ModelJson } from "./fusion";
import { Sampler } from "../engine/sampler";

const MODEL_URLS = ["/models/load_model.json", "/models/load_model.demo.json"];
const BASELINE_MS = 30_000;
const MIN_BASELINE_WINDOWS = 3; // same as training
const SMOOTH_TAU_MS = 6_000;
const FACE = COLUMNS.indexOf("face_present");

const setModel = (p: Partial<ModelState>) => useLucid.getState().set({ model: { ...useLucid.getState().model, ...p } });

class LiveModel {
  private model: ModelJson | null = null;
  private rows: Row[] = [];
  private sampler = new Sampler();
  private baseRows: Row[] = [];
  private baseStart = -1;
  private base: Features | null = null;
  private sinceHop = 0;
  private smooth: number | null = null;
  /** latest raw prediction; the displayed value glides toward it every row */
  private target: number | null = null;
  private lastRowT = -Infinity;
  private t0 = performance.now();

  /** The loaded model JSON (null if none) — used by the Lab page. */
  get json(): ModelJson | null {
    return this.model;
  }

  async init() {
    for (const url of MODEL_URLS) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) continue;
        const json = (await res.json()) as ModelJson;
        if (!json.format?.startsWith("lucid-late-fusion/2")) continue;
        if (json.features.join() !== FEATURES.join()) {
          setModel({ status: "incompatible", message: `${url} was trained with a different feature spec — retrain it.` });
          return;
        }
        this.model = json;
        setModel({
          status: "baseline",
          info: {
            synthetic: json.data.synthetic, participants: json.data.participants, macroF1: json.eval.macro_f1,
            ci95: json.eval.ci95, created: json.created, importance: json.importance, labels: json.modality_labels,
          },
        });
        session.onReset(() => this.reset());
        session.onMetrics((m) => {
          if (!this.sampler.take(m.t)) return; // 10 Hz, identical to the recorders
          this.onRow(toRow(m, { phase: "other", block: -1, n: -1, trial: -1 }, m.t - this.t0));
        });
        return;
      } catch {
        /* try next */
      }
    }
    setModel({ status: "none" });
  }

  reset() {
    this.rows = [];
    this.baseRows = [];
    this.baseStart = -1;
    this.base = null;
    this.sinceHop = 0;
    this.smooth = null;
    this.target = null;
    series.overrideLoad = null;
    if (this.model) setModel({ status: "baseline", baseline: 0, proba: null, load: null, contributions: null });
  }

  private onRow(row: Row) {
    const t = row[0] as number;
    this.glide(t);
    this.rows.push(row);
    if (this.rows.length > WINDOW_ROWS * 3) this.rows.splice(0, this.rows.length - WINDOW_ROWS * 3);

    // 1) personal resting baseline
    if (!this.base) {
      if (this.baseStart < 0 && row[FACE] === 1) this.baseStart = t; // first row with a face
      if (this.baseStart < 0) return;
      this.baseRows.push(row);
      const progress = Math.min(1, (t - this.baseStart) / BASELINE_MS);
      if (progress < 1) {
        if (this.baseRows.length % 10 === 0) setModel({ baseline: progress });
        return;
      }
      const wins = segmentWindows(this.baseRows);
      if (wins.length < MIN_BASELINE_WINDOWS) {
        // not enough face-visible time — slide the baseline forward
        this.baseRows = this.baseRows.slice(-WINDOW_ROWS);
        this.baseStart = this.baseRows[0][0] as number;
        setModel({ baseline: 0.5, message: "Keep your face in view to finish calibration" });
        return;
      }
      this.base = baselineVector(wins);
      this.baseRows = [];
      this.sinceHop = HOP_ROWS; // predict as soon as a window is available
      setModel({ status: "no-face", baseline: 1, message: undefined });
    }

    // 2) predict every HOP_ROWS rows
    if (++this.sinceHop < HOP_ROWS || this.rows.length < WINDOW_ROWS) return;
    this.sinceHop = 0;
    const f = windowFeatures(this.rows.slice(-WINDOW_ROWS));
    if (f._face_frac < MIN_FACE_FRAC) {
      setModel({ status: "no-face" });
      return;
    }
    const p = predict(this.model!, relative(f, this.base));
    this.target = p.load;
    if (this.smooth == null) this.smooth = p.load;
    series.overrideLoad = this.smooth;
    setModel({ status: "ready", proba: p.proba, load: this.smooth, contributions: p.contributions });
  }

  /** Exponential glide toward the latest prediction at row rate (no 2 s stair-steps). */
  private glide(t: number) {
    if (this.target == null || this.smooth == null) {
      this.lastRowT = t;
      return;
    }
    const dt = Math.max(0, t - this.lastRowT);
    this.lastRowT = t;
    this.smooth += (1 - Math.exp(-dt / SMOOTH_TAU_MS)) * (this.target - this.smooth);
    series.overrideLoad = this.smooth;
    if (useLucid.getState().model.status === "ready") setModel({ load: this.smooth });
  }
}

export const liveModel = new LiveModel();
