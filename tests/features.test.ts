import { describe, expect, it } from "vitest";
import { FeatureEngine, headPoseFromMatrix, gazeFromBlendshapes } from "../src/engine/features";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rotY = (deg: number) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; // column-major
};
const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
lm[33] = { x: 0.4, y: 0.45, z: 0 };
lm[263] = { x: 0.6, y: 0.45, z: 0 };

describe("geometry", () => {
  it("recovers yaw from the transform matrix", () => expect(headPoseFromMatrix(rotY(20)).yaw).toBeCloseTo(20, 5));
  it("maps iris blendshapes to gaze", () => expect(gazeFromBlendshapes({ eyeLookOutLeft: 0.6, eyeLookInRight: 0.6 }).x).toBeCloseTo(0.6));
});

describe("feature engine", () => {
  it("counts blinks: one every 4 s → 15/min", () => {
    const e = new FeatureEngine();
    let m;
    for (let i = 0; i < 1800; i++) {
      const blink = i % 120 < 4;
      m = e.process({ t: i * 33.3, landmarks: lm, blendshapes: { eyeBlinkLeft: blink ? 0.9 : 0.05, eyeBlinkRight: blink ? 0.9 : 0.05 }, matrix: I });
    }
    expect(m!.blinkRate).toBeCloseTo(15, 0);
  });

  it("attention collapses when looking away", () => {
    const e = new FeatureEngine();
    let m;
    for (let i = 0; i < 300; i++) m = e.process({ t: i * 33.3, landmarks: lm, blendshapes: {}, matrix: I });
    expect(m!.attention).toBeGreaterThan(0.9);
    for (let i = 300; i < 450; i++) m = e.process({ t: i * 33.3, landmarks: lm, blendshapes: { eyeLookOutLeft: 0.8, eyeLookInRight: 0.8 }, matrix: rotY(40) });
    expect(m!.attention).toBeLessThan(0.1);
  });

  it("score weights always sum to 1, with or without optional modalities", () => {
    const cases = [
      [null, null],
      [{ visible: true, score: 1 }, null],
      [{ visible: true, score: 1 }, { valid: true, bpm: 80, baselineBpm: 70 }],
    ] as const;
    for (const [posture, rppg] of cases) {
      const e = new FeatureEngine();
      const m = e.process({ t: 0, landmarks: lm, blendshapes: {}, matrix: I }, posture as never, rppg as never);
      for (const k of ["attention", "engagement", "load"] as const) {
        const ws = m.why[k].reduce((a, c) => a + c.weight, 0);
        if (k !== "attention") expect(ws).toBeCloseTo(1, 5);
      }
    }
  });

  it("raises load when heart rate climbs above resting baseline", () => {
    const run = (bpm: number) => {
      const e = new FeatureEngine();
      let m;
      for (let i = 0; i < 600; i++) m = e.process({ t: i * 33.3, landmarks: lm, blendshapes: {}, matrix: I }, null, { valid: true, bpm, baselineBpm: 70 } as never);
      return m!.load;
    };
    expect(run(85)).toBeGreaterThan(run(70) + 0.1);
  });
});
