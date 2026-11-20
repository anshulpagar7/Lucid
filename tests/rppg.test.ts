import { describe, expect, it } from "vitest";
import { RppgEngine, findPeaks, computeRmssd, FS } from "../src/engine/rppg";
import { skinStream, type PulseOpts } from "./sim";

function run(o: PulseOpts) {
  const e = new RppgEngine();
  let m = RppgEngine.empty();
  for (const s of skinStream(o)) {
    e.push(s.t, s.r, s.g, s.b);
    m = e.update(s.t);
  }
  return m;
}

describe("rPPG heart rate (POS)", () => {
  it.each([50, 60, 72, 85, 100, 120, 150])("recovers %i bpm within ±4 bpm", (bpm) => {
    const m = run({ bpm, seconds: 15 });
    expect(m.valid).toBe(true);
    expect(Math.abs(m.bpm! - bpm)).toBeLessThan(4);
  });

  it("is not fooled by the PPG 2nd harmonic at 60 bpm", () => {
    const m = run({ bpm: 60, seconds: 15 });
    expect(m.bpm!).toBeLessThan(70);
  });

  it("survives a 2 s head-motion burst", () => {
    const m = run({ bpm: 80, seconds: 20, motionAt: 12_000 });
    expect(Math.abs(m.bpm! - 80)).toBeLessThan(4);
  });

  it("never publishes a heart rate from pure noise (10 seeds)", () => {
    for (let seed = 100; seed < 110; seed++) {
      const m = run({ bpm: 80, seconds: 20, amp: 0, noise: 0.5, seed });
      expect(m.bpm).toBeNull();
    }
  });

  it("refuses to lock on a signal buried in noise instead of guessing", () => {
    const m = run({ bpm: 150, seconds: 15, noise: 0.25 });
    expect(m.bpm === null || Math.abs(m.bpm - 150) < 5).toBe(true);
  });

  it("learns a resting baseline after ~12 s of good signal", () => {
    const m = run({ bpm: 68, seconds: 30 });
    expect(Math.abs(m.baselineBpm! - 68)).toBeLessThan(4);
  });
});

describe("beat detection + HRV", () => {
  it("times clean beats to within a few ms", () => {
    const n = 20 * FS, rr = 60_000 / 70;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ph = ((i * 1000) / FS % rr) / rr;
      x[i] = Math.exp(-((ph - 0.15) ** 2) / 0.008);
    }
    const beats = findPeaks(x, 70).map((k) => (k * 1000) / FS);
    const ibi = beats.slice(1).map((b, i) => b - beats[i]);
    for (const v of ibi) expect(Math.abs(v - rr)).toBeLessThan(5);
  });

  it("RMSSD ≈ 0 for a perfectly regular rhythm", () => {
    const beats = Array.from({ length: 20 }, (_, i) => i * 800);
    expect(computeRmssd(beats, 75)).toBeCloseTo(0, 5);
  });

  it("withholds HRV on weak signals (SNR gate)", () => {
    const m = run({ bpm: 70, seconds: 30, noise: 0.25 });
    expect(m.rmssd).toBeNull();
  });
});
