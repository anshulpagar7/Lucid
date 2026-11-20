// Micro-benchmarks of Lucid's own pipeline stages, measured on this machine.

import { RppgEngine } from "../engine/rppg";
import { Tracker } from "../classroom/tracker";
import type { FaceObs } from "../classroom/types";
import { COLUMNS, type Row } from "../study/schema";
import { FEATURES, windowFeatures, relative } from "../model/features";
import { predict } from "../model/fusion";
import { liveModel } from "../model/live";
import { detectEvents } from "../replay/events";
import { fromLive } from "../replay/signals";
import type { LiveRecord } from "../replay/types";
import { skinStream } from "./synth";

export interface Bench {
  name: string;
  what: string;
  ms: number;
  budget: string;
}

const time = (fn: () => void, reps: number) => {
  fn(); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return (performance.now() - t0) / reps;
};

function rows(n: number): Row[] {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) =>
    COLUMNS.map((c, j) => (c === "t_ms" ? i * 100 : c === "phase" ? "other" : c === "face_present" || c === "pose_visible" || c === "hr_valid" ? 1 : j < 5 ? -1 : r())),
  );
}

export function runBenchmarks(): Bench[] {
  const out: Bench[] = [];

  const e = new RppgEngine();
  for (const s of skinStream({ bpm: 72, seconds: 20 })) e.push(s.t, s.r, s.g, s.b);
  let t = 20_000;
  out.push({ name: "rPPG update", what: "POS + FFT + SNR on a 20 s buffer", ms: time(() => ((e as unknown as { lastUpdate: number }).lastUpdate = -Infinity, e.update((t += 1))), 40), budget: "runs 5×/s" });

  const win = rows(100);
  const m = liveModel.json;
  out.push({
    name: "Load model", what: "100-row window features + boosted fusion", budget: "runs every 2 s",
    ms: time(() => { const f = windowFeatures(win); if (m) predict(m, relative(f, Object.fromEntries(FEATURES.map((k) => [k, 0])))); }, 60),
  });

  const tr = new Tracker();
  const faces: FaceObs[] = Array.from({ length: 16 }, (_, i) => ({ box: [0.05 + (i % 8) * 0.11, 0.2 + Math.floor(i / 8) * 0.4, 0.08, 0.1], center: [0, 0], nose: [0, 0], yaw: 5, pitch: 2, roll: 0, gazeX: 0, gazeY: 0, eyeClosure: 0.05 }));
  faces.forEach((f) => (f.center = [f.box[0] + 0.04, f.box[1] + 0.05]));
  let k = 0;
  out.push({ name: "Classroom tracker", what: "associate + score 16 faces", ms: time(() => tr.update((k += 66), faces), 200), budget: "per frame" });

  const hour = rows(36_000);
  const rec: LiveRecord = { id: "b", kind: "live", name: "b", startedAt: 0, endedAt: 0, columns: [...COLUMNS], rows: hour, modelLoad: hour.map(() => null), gaze: hour.map(() => null), calibration: null, model: null };
  out.push({ name: "Replay analysis", what: "detect moments in a 1-hour recording", ms: time(() => detectEvents(fromLive(rec)), 3), budget: "once per open" });
  return out;
}
