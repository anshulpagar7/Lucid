import { describe, expect, it } from "vitest";
import { pool, spearman } from "../src/lab/pooled";
import type { StudyRecord } from "../src/study/types";

describe("pooled study stats", () => {
  it("spearman handles ties and monotonic data", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([0, 0, 1, 1], [5, 6, 7, 8])).toBeCloseTo(0.894, 2);
  });
  it("pools complete sessions by n-level", () => {
    const mk = (pid: string, tlx: number[], complete = true) => ({
      participantId: pid, complete, rows: new Array(600).fill([]),
      blocks: tlx.map((v, n) => ({ n, rawTlx: v, score: { accuracy: 1 - n * 0.1, dPrime: 3 - n * 0.5, meanRt: 400 + n * 50 } })),
    }) as unknown as StudyRecord;
    const p = pool([mk("P01", [10, 30, 50, 70]), mk("P02", [20, 30, 60, 80]), mk("P03", [90, 90, 90, 90], false)]);
    expect(p.participants).toBe(2);
    expect(p.levels[3].tlx.mean).toBe(75);
    expect(p.levels[0].accuracy.mean).toBe(1);
    expect(p.rhoTlx).toBeGreaterThan(0.9);
    expect(p.orderedShare).toBe(1);
  });
});
