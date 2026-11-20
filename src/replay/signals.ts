// Turns a stored record (Live or Study) into aligned series for replay.

import type { StudyRecord } from "../study/types";
import type { Row } from "../study/schema";
import type { GazeCalibration, LiveRecord } from "./types";

export interface Segment {
  start: number;
  end: number;
  label: string;
  tone: string;
}

export interface Replayable {
  id: string;
  kind: "live" | "study";
  title: string;
  startedAt: number;
  duration: number;
  /** seconds from start, per row */
  t: Float64Array;
  rows: Row[];
  columns: string[];
  attention: Float64Array;
  engagement: Float64Array;
  /** NaN where unavailable */
  load: Float64Array;
  loadSource: "model" | "heuristic";
  gaze: ([number, number] | null)[] | null;
  calibration: GazeCalibration | null;
  /** labelled background spans (study blocks) */
  segments: Segment[];
  /** rows where events should be detected (study: blocks + baseline only) */
  eventMask: Uint8Array;
  model: LiveRecord["model"];
}

export function col(r: { rows: Row[]; columns: string[] }, name: string): Float64Array {
  const j = r.columns.indexOf(name);
  const out = new Float64Array(r.rows.length);
  for (let i = 0; i < r.rows.length; i++) {
    const v = j >= 0 ? r.rows[i][j] : null;
    out[i] = typeof v === "number" ? v : NaN;
  }
  return out;
}

/** n-back difficulty is ordered, so it gets a single-hue ochre ramp (light → dark). */
export const N_TONE = ["#c9a35c", "#b5730a", "#8f5a08", "#6a4206"];

export function fromLive(r: LiveRecord): Replayable {
  const tms = col(r, "t_ms");
  const t0 = tms[0] ?? 0;
  const t = tms.map((v) => (v - t0) / 1000);
  const ml = r.modelLoad;
  const useModel = ml.filter((v) => v != null).length >= ml.length * 0.5 && ml.length > 0;
  const load = useModel ? Float64Array.from(ml, (v) => (v == null ? NaN : v)) : col(r, "h_load");
  return {
    id: r.id, kind: "live", title: r.name, startedAt: r.startedAt,
    duration: t.length ? t[t.length - 1] : 0, t, rows: r.rows, columns: r.columns,
    attention: col(r, "h_attention"), engagement: col(r, "h_engagement"), load, loadSource: useModel ? "model" : "heuristic",
    gaze: r.gaze.some(Boolean) ? r.gaze : null, calibration: r.calibration, segments: [],
    eventMask: new Uint8Array(r.rows.length).fill(1), model: r.model,
  };
}

export function fromStudy(s: StudyRecord): Replayable {
  const tms = col(s, "t_ms");
  const t0 = tms[0] ?? 0;
  const t = tms.map((v) => (v - t0) / 1000);
  const phaseIdx = s.columns.indexOf("phase");
  const mask = new Uint8Array(s.rows.length);
  s.rows.forEach((r, i) => (mask[i] = r[phaseIdx] === "block" || r[phaseIdx] === "baseline" ? 1 : 0));

  const segments: Segment[] = [];
  if (s.baseline && s.baseline.endMs > 0) {
    segments.push({ start: (s.baseline.startMs - t0) / 1000, end: (s.baseline.endMs - t0) / 1000, label: "Rest", tone: "#0083a3" });
  }
  for (const b of s.blocks) {
    segments.push({ start: (b.startMs - t0) / 1000, end: (b.endMs - t0) / 1000, label: `${b.n}-back`, tone: N_TONE[b.n] ?? "#9c9282" });
  }
  return {
    id: s.id, kind: "study", title: `${s.participantId} · n-back study`, startedAt: s.startedAt,
    duration: t.length ? t[t.length - 1] : 0, t, rows: s.rows, columns: s.columns,
    attention: col(s, "h_attention"), engagement: col(s, "h_engagement"), load: col(s, "h_load"), loadSource: "heuristic",
    gaze: null, calibration: null, segments, eventMask: mask, model: null,
  };
}

/** Index of the last row with t <= time (binary search). */
export function rowAt(t: Float64Array, time: number): number {
  let lo = 0, hi = t.length - 1;
  if (hi < 0) return -1;
  if (time <= t[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const fmtTime = (s: number) => {
  const sec = Math.max(0, Math.floor(s));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
};
