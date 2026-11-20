import { describe, expect, it } from "vitest";
import { COLUMNS, type Row } from "../src/study/schema";
import { runs, detectEvents } from "../src/replay/events";
import { summarize } from "../src/replay/stats";
import { fromLive, rowAt, fmtTime } from "../src/replay/signals";
import { fitGaze, applyGaze, validationError, CALIB_POINTS, VALID_POINTS, type CalibSample } from "../src/replay/gaze";
import { accumulate } from "../src/replay/heatmap";
import type { LiveRecord } from "../src/replay/types";

const I = Object.fromEntries(COLUMNS.map((c, i) => [c, i]));

/** 10 Hz synthetic recording; `at(t)` returns overrides for that second. */
function record(seconds: number, at: (t: number) => Partial<Record<string, number>>, modelLoad?: (t: number) => number | null): LiveRecord {
  const rows: Row[] = [];
  const ml: (number | null)[] = [];
  for (let i = 0; i < seconds * 10; i++) {
    const t = i / 10;
    const r: Row = COLUMNS.map(() => null);
    Object.assign(r, { [I.t_ms]: 5000 + i * 100, [I.phase]: "other", [I.block]: -1, [I.n_level]: -1, [I.trial]: -1 });
    const base: Record<string, number> = {
      face_present: 1, h_attention: 0.9, h_engagement: 0.8, h_load: 0.3, eye_closure: 0.05, perclos: 0.01,
      head_on_hand: 0, hr_bpm: 70, hr_baseline: 70, hr_valid: 1, blink_rate: 15,
    };
    for (const [k, v] of Object.entries({ ...base, ...at(t) })) r[I[k]] = v as number;
    rows.push(r);
    ml.push(modelLoad ? modelLoad(t) : null);
  }
  return { id: "x", kind: "live", name: "test", startedAt: 0, endedAt: 0, columns: [...COLUMNS], rows, modelLoad: ml, gaze: rows.map(() => null), calibration: null, model: null };
}

describe("runs", () => {
  const t = Array.from({ length: 100 }, (_, i) => i / 10);
  it("finds a sustained span and respects minimum duration", () => {
    expect(runs(t, (i) => i >= 20 && i < 70, 4)).toEqual([[2, 6.9]]);
    expect(runs(t, (i) => i >= 20 && i < 40, 4)).toEqual([]);
  });
  it("bridges short gaps, splits long ones", () => {
    expect(runs(t, (i) => (i >= 10 && i < 40) || (i >= 45 && i < 80), 2, 1)).toHaveLength(1);
    expect(runs(t, (i) => (i >= 10 && i < 40) || (i >= 60 && i < 90), 2, 1)).toHaveLength(2);
  });
});

describe("event detection", () => {
  it("detects each event type at the right time and nothing on a calm session", () => {
    expect(detectEvents(fromLive(record(60, () => ({}))))).toEqual([]);
    const r = fromLive(record(120, (t) => ({
      ...(t >= 10 && t < 16 ? { h_attention: 0.2 } : {}),
      ...(t >= 25 && t < 30 ? { face_present: 0 } : {}),
      ...(t >= 40 && t < 42 ? { eye_closure: 0.9 } : {}),
      ...(t >= 50 && t < 57 ? { head_on_hand: 1 } : {}),
      ...(t >= 70 && t < 82 ? { hr_bpm: 86 } : {}),
      ...(t >= 90 && t < 105 ? { h_load: 0.8 } : {}),
    })));
    const ev = detectEvents(r);
    const find = (type: string) => ev.find((e) => e.type === type)!;
    expect(ev.map((e) => e.type)).toEqual(["lapse", "away", "eyes-closed", "head-on-hand", "hr-up", "load-high"]);
    expect(find("lapse").start).toBeCloseTo(10, 1);
    expect(find("hr-up").detail).toContain("+16 bpm");
  });

  it("prefers learned-model load when the model was ready for most of the session", () => {
    const r = fromLive(record(60, () => ({ h_load: 0.1 }), (t) => (t > 5 ? 0.9 : null)));
    expect(r.loadSource).toBe("model");
    expect(detectEvents(r).some((e) => e.type === "load-high")).toBe(true);
  });
});

describe("summary", () => {
  it("computes coverage, focus share and load bands", () => {
    const r = fromLive(record(100, (t) => ({
      ...(t < 10 ? { face_present: 0 } : {}),
      ...(t >= 50 ? { h_attention: 0.4 } : {}),
      h_load: t < 50 ? 0.2 : 0.8,
    })));
    const s = summarize(r, detectEvents(r));
    expect(s.faceCoverage).toBeCloseTo(0.9, 2);
    expect(s.focused).toBeCloseTo(40 / 90, 2);
    expect(s.loadBands[0]).toBeCloseTo(0.5, 2);
    expect(s.loadBands[2]).toBeCloseTo(0.5, 2);
  });
});

describe("gaze calibration", () => {
  it("recovers a known linear mapping and reports small validation error", () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const make = (pts: [number, number][]): CalibSample[] =>
      pts.flatMap((p) => Array.from({ length: 30 }, () => ({
        target: p,
        // pretend gaze blendshapes are a noisy linear function of where you look
        input: { gx: (0.5 - p[0]) * 1.2 + rnd() * 0.04, gy: (0.5 - p[1]) * 0.9 + rnd() * 0.04, yaw: rnd() * 2, pitch: rnd() * 2 },
      })));
    const c = fitGaze(make(CALIB_POINTS));
    const [x, y] = applyGaze(c, { gx: 0, gy: 0, yaw: 0, pitch: 0 });
    expect(x).toBeCloseTo(0.5, 1);
    expect(y).toBeCloseTo(0.5, 1);
    expect(validationError(c, make(VALID_POINTS))).toBeLessThan(0.03);
  });
});

describe("heatmap + helpers", () => {
  it("accumulates into the correct 3×3 regions", () => {
    const h = accumulate([[0.1, 0.1], [0.1, 0.1], [0.9, 0.9], null]);
    expect(h.n).toBe(3);
    expect(h.regions[0]).toBeCloseTo(2 / 3);
    expect(h.regions[8]).toBeCloseTo(1 / 3);
    expect(h.max).toBeGreaterThan(0);
  });
  it("rowAt binary search + time formatting", () => {
    const t = Float64Array.from([0, 0.1, 0.2, 0.3]);
    expect(rowAt(t, 0.25)).toBe(2);
    expect(rowAt(t, 99)).toBe(3);
    expect(fmtTime(3725)).toBe("1:02:05");
    expect(fmtTime(65)).toBe("1:05");
  });
});

import { Sampler } from "../src/engine/sampler";
describe("10 Hz sampler", () => {
  it("averages exactly 10 Hz under 30 fps camera jitter (the naive gate drifts to ~8.5 Hz)", () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const s = new Sampler();
    let t = 0, rows = 0, naive = 0, last = -Infinity;
    while (t < 600_000) {
      if (s.take(t)) rows++;
      if (t - last >= 100) { naive++; last = t; }
      t += 33.3 + (rnd() - 0.5) * 8;
    }
    expect(rows / 600).toBeCloseTo(10, 1);
    expect(naive / 600).toBeLessThan(9.2);
  });
  it("re-anchors after a stall instead of bursting", () => {
    const s = new Sampler();
    s.take(0);
    expect(s.take(5000)).toBe(true);
    expect(s.take(5033)).toBe(false);
  });
});
