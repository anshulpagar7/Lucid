import { describe, expect, it } from "vitest";
import { Tracker, iou, MAX_MISS_MS } from "../src/classroom/tracker";
import { faceSignals } from "../src/classroom/score";
import { aggregate, classMoments, type ClassPoint } from "../src/classroom/classMetrics";
import type { FaceObs } from "../src/classroom/types";

const face = (x: number, y: number, o: Partial<FaceObs> = {}, s = 0.08): FaceObs => ({
  box: [x, y, s, s * 1.2], center: [x + s / 2, y + s * 0.6], nose: [x + s / 2, y + s * 0.7],
  yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0, eyeClosure: 0.05, ...o,
});

describe("face signals", () => {
  it("facing forward is attentive; turned away / down / eyes closed are flagged", () => {
    expect(faceSignals(face(0, 0)).attention).toBeGreaterThan(0.95);
    const away = faceSignals(face(0, 0, { yaw: 45 }));
    expect(away.away).toBe(true);
    expect(away.attention).toBeLessThan(0.4);
    expect(faceSignals(face(0, 0, { pitch: 28 })).down).toBe(true);
    const closed = faceSignals(face(0, 0, { eyeClosure: 0.9 }));
    expect(closed.closed).toBe(true);
    expect(closed.attention).toBe(0);
  });
});

describe("tracker", () => {
  const run = (frames: number, gen: (i: number) => FaceObs[], tr = new Tracker(), t0 = 0) => {
    let out = tr.list;
    for (let i = 0; i < frames; i++) out = tr.update(t0 + i * 66, gen(i));
    return { tr, out };
  };

  it("iou basics", () => {
    expect(iou([0, 0, 1, 1], [0, 0, 1, 1])).toBe(1);
    expect(iou([0, 0, 1, 1], [2, 2, 1, 1])).toBe(0);
  });

  it("keeps stable IDs for moving students and assigns new IDs to newcomers", () => {
    const { tr, out } = run(60, (i) => [face(0.1 + i * 0.002, 0.2), face(0.5, 0.2 + i * 0.001), ...(i >= 30 ? [face(0.8, 0.6)] : [])]);
    expect(out.map((t) => t.id).sort()).toEqual([1, 2, 3]);
    const first = out.find((t) => t.id === 1)!;
    expect(first.box[0]).toBeGreaterThan(0.2); // followed the drift
    expect(tr.list.length).toBe(3);
  });

  it("needs a few hits before assigning an ID (no flicker IDs)", () => {
    const { out } = run(2, () => [face(0.3, 0.3)]);
    expect(out).toHaveLength(0);
    const { out: spurious } = run(20, (i) => [face(0.1, 0.1), ...(i === 5 ? [face(0.7, 0.7)] : [])]);
    expect(spurious.map((t) => t.id)).toEqual([1]);
  });

  it("survives brief occlusion with the same ID, drops after the grace period", () => {
    const tr = new Tracker();
    run(20, () => [face(0.4, 0.4)], tr, 0);
    const id = tr.list[0].id;
    run(15, () => [], tr, 20 * 66); // ~1 s hidden
    expect(tr.list[0].state).toBe("absent");
    const back = run(5, () => [face(0.41, 0.4)], tr, 35 * 66).out;
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(id);
    run(Math.ceil(MAX_MISS_MS / 66) + 3, () => [], tr, 40 * 66);
    expect(tr.list).toHaveLength(0);
  });

  it("does not swap IDs when two students are close", () => {
    const tr = new Tracker();
    run(10, () => [face(0.3, 0.3), face(0.4, 0.3)], tr);
    const ids = tr.list.map((t) => [t.id, t.box[0] < 0.35 ? "L" : "R"]);
    run(20, (i) => [face(0.3 + i * 0.001, 0.3), face(0.4 - i * 0.001, 0.3)], tr, 10 * 66);
    const after = tr.list.map((t) => [t.id, t.box[0] < 0.35 ? "L" : "R"]);
    expect(after).toEqual(ids);
  });

  it("smoothed state + per-student stats", () => {
    const { out } = run(90, (i) => [face(0.2, 0.2, i >= 45 ? { yaw: 50 } : {})]);
    expect(out[0].state).toBe("away");
    const st = out[0].stats;
    expect(st.focused / st.seen).toBeGreaterThan(0.35);
    expect(st.away / st.seen).toBeGreaterThan(0.3);
    expect(out[0].history.length).toBeGreaterThanOrEqual(4);
  });
});

describe("class aggregation + moments", () => {
  it("aggregates visible students only", () => {
    const tr = new Tracker();
    for (let i = 0; i < 30; i++) tr.update(i * 66, [face(0.1, 0.1), face(0.5, 0.1, { yaw: 50 }), face(0.8, 0.1, { pitch: 30 })]);
    const s = aggregate(tr.list);
    expect(s.n).toBe(3);
    expect(s.shares.focused).toBeCloseTo(1 / 3);
    expect(s.shares.away).toBeCloseTo(1 / 3);
    expect(s.shares.down).toBeCloseTo(1 / 3);
  });

  it("detects a class-wide dip and a looking-down period", () => {
    const pts: ClassPoint[] = Array.from({ length: 120 }, (_, t) => ({
      t, n: 8, attention: 0.8,
      focused: t >= 30 && t < 50 ? 0.3 : 0.85,
      down: t >= 70 && t < 90 ? 0.5 : 0.05,
      away: 0.05,
    }));
    const m = classMoments(pts);
    expect(m.map((x) => x.label)).toEqual(["Class attention dip", "Many looking down"]);
    expect(m[0].start).toBe(30);
  });
});

describe("ID ordering", () => {
  it("students confirmed together get IDs in reading order", () => {
    const tr = new Tracker();
    const seats = [face(0.7, 0.6), face(0.1, 0.6), face(0.7, 0.1), face(0.1, 0.1), face(0.4, 0.1)];
    for (let i = 0; i < 5; i++) tr.update(i * 66, seats);
    const byId = [...tr.list].sort((a, b) => a.id - b.id).map((t) => [Math.round(t.box[0] * 10), Math.round(t.box[1] * 10)]);
    expect(byId).toEqual([[1, 1], [4, 1], [7, 1], [1, 6], [7, 6]]);
  });
});
