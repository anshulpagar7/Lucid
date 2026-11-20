// In-app self-check: re-runs the key validations from the test suite in the
// browser, on this machine, so they can be demonstrated live.

import { RppgEngine } from "../engine/rppg";
import { Sampler } from "../engine/sampler";
import { Tracker } from "../classroom/tracker";
import type { FaceObs } from "../classroom/types";
import { CALIB_POINTS, VALID_POINTS, fitGaze, validationError, type CalibSample } from "../replay/gaze";
import { FEATURES } from "../model/features";
import { predict } from "../model/fusion";
import { liveModel } from "../model/live";
import { skinStream } from "./synth";

export interface CheckResult {
  ok: boolean;
  value: string;
  detail: string;
}

export interface Check {
  id: string;
  name: string;
  claim: string;
  run: () => CheckResult;
}

function rppgRun(bpm: number, opts: Partial<Parameters<typeof skinStream>[0]> = {}) {
  const e = new RppgEngine();
  let m = RppgEngine.empty();
  for (const s of skinStream({ bpm, seconds: 15, ...opts })) {
    e.push(s.t, s.r, s.g, s.b);
    m = e.update(s.t);
  }
  return m;
}

export const CHECKS: Check[] = [
  {
    id: "rppg-accuracy",
    name: "Heart rate from skin colour",
    claim: "POS recovers 50–150 bpm within ±4 bpm",
    run: () => {
      const errs = [50, 60, 72, 85, 100, 120, 150].map((hr) => {
        const m = rppgRun(hr);
        return { hr, err: m.bpm == null ? Infinity : Math.abs(m.bpm - hr) };
      });
      const worst = Math.max(...errs.map((e) => e.err));
      return { ok: worst < 4, value: Number.isFinite(worst) ? `max ±${worst.toFixed(1)} bpm` : "no lock", detail: errs.map((e) => `${e.hr}→${Number.isFinite(e.err) ? `±${e.err.toFixed(1)}` : "✗"}`).join("  ") };
    },
  },
  {
    id: "rppg-noise",
    name: "No heart rate from noise",
    claim: "Pure noise never produces a reading",
    run: () => {
      let fp = 0;
      for (let seed = 100; seed < 106; seed++) if (rppgRun(80, { amp: 0, noise: 0.5, seed, seconds: 20 }).bpm != null) fp++;
      return { ok: fp === 0, value: `${fp}/6 false locks`, detail: "6 seeded pure-noise streams, 20 s each" };
    },
  },
  {
    id: "sampler",
    name: "Exact 10 Hz recording",
    claim: "Grid-locked sampling under 30 fps camera jitter",
    run: () => {
      const s = new Sampler();
      let t = 0, rows = 0, naive = 0, last = -Infinity, seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      while (t < 600_000) {
        if (s.take(t)) rows++;
        if (t - last >= 100) { naive++; last = t; }
        t += 33.3 + (rnd() - 0.5) * 8;
      }
      const hz = rows / 600;
      return { ok: Math.abs(hz - 10) < 0.05, value: `${hz.toFixed(2)} Hz`, detail: `naive gate would give ${(naive / 600).toFixed(2)} Hz` };
    },
  },
  {
    id: "tracker",
    name: "Classroom ID stability",
    claim: "10 drifting students keep their IDs through occlusion",
    run: () => {
      const tr = new Tracker();
      const seat = (i: number) => [0.08 + (i % 5) * 0.18, 0.18 + Math.floor(i / 5) * 0.42] as const;
      const mk = (x: number, y: number): FaceObs => ({ box: [x, y, 0.08, 0.1], center: [x + 0.04, y + 0.05], nose: [x + 0.04, y + 0.06], yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0, eyeClosure: 0.05 });
      const home = new Map<number, number>();
      let swaps = 0;
      for (let k = 0; k < 900; k++) {
        const faces = Array.from({ length: 10 }, (_, i) => i).filter((i) => !(i === 4 && k > 300 && k < 320)) // brief occlusion
          .map((i) => { const [x, y] = seat(i); return mk(x + Math.sin(k / 40 + i) * 0.01, y + Math.cos(k / 50 + i) * 0.006); });
        for (const t of tr.update(k * 66, faces)) {
          if (!t.obs) continue;
          const s = Math.round((t.box[0] - 0.08) / 0.18) + 5 * Math.round((t.box[1] - 0.18) / 0.42);
          if (!home.has(t.id)) home.set(t.id, s);
          else if (home.get(t.id) !== s) swaps++;
        }
      }
      const ids = tr.list.map((t) => t.id).sort((a, b) => a - b);
      const ok = swaps === 0 && ids.length === 10 && ids[9] === 10;
      return { ok, value: `${ids.length} IDs · ${swaps} swaps`, detail: "60 s, 15 fps, one student occluded for 1.3 s" };
    },
  },
  {
    id: "gaze",
    name: "Gaze calibration fit",
    claim: "Ridge mapping recovers a known gaze→screen map",
    run: () => {
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
      const make = (pts: [number, number][]): CalibSample[] =>
        pts.flatMap((p) => Array.from({ length: 30 }, () => ({ target: p, input: { gx: (0.5 - p[0]) * 1.2 + rnd() * 0.04, gy: (0.5 - p[1]) * 0.9 + rnd() * 0.04, yaw: rnd() * 2, pitch: rnd() * 2 } })));
      const err = validationError(fitGaze(make(CALIB_POINTS)), make(VALID_POINTS));
      return { ok: err < 0.03, value: `${(err * 100).toFixed(1)}% error`, detail: "9-point fit, 4 held-out points, simulated noisy gaze" };
    },
  },
  {
    id: "model",
    name: "Load-model runtime",
    claim: "Valid probabilities for any input; matches the feature spec",
    run: () => {
      const m = liveModel.json;
      if (!m) return { ok: false, value: "no model", detail: "No load_model.json or demo model was found" };
      const specOk = m.features.join() === FEATURES.join();
      let worst = 0, bad = 0, seed = 9;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
      const t0 = performance.now();
      for (let i = 0; i < 300; i++) {
        const p = predict(m, FEATURES.map(() => rnd() * 4));
        worst = Math.max(worst, Math.abs(p.proba.reduce((a, b) => a + b, 0) - 1));
        if (!(p.load >= 0 && p.load <= 1)) bad++;
      }
      const us = ((performance.now() - t0) / 300) * 1000;
      return { ok: specOk && worst < 1e-9 && !bad, value: `${us.toFixed(0)} µs / prediction`, detail: `${m.features.length} features · Σp error ${worst.toExponential(0)} · ${m.data.synthetic ? "demo model" : "trained model"}` };
    },
  },
];
