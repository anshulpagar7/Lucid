import { describe, expect, it } from "vitest";
import {
  LATIN_SQUARE, PROTOCOLS, ZERO_BACK_TARGET, blockOrder, generateSequence, pearson, probit, rawTlx, scoreBlock,
  type NLevel, type Response,
} from "../src/study/protocol";
import { trainingRows } from "../src/study/export";
import type { StudyRecord } from "../src/study/types";

describe("n-back sequences", () => {
  for (const n of [0, 1, 2, 3] as NLevel[]) {
    it(`${n}-back: exact target count, all targets valid, no accidental targets`, () => {
      for (let seed = 1; seed <= 50; seed++) {
        const seq = generateSequence(n, 36, 0.3, seed);
        const eligible = n === 0 ? 36 : 36 - n;
        expect(seq.filter((t) => t.isTarget).length).toBe(Math.round(eligible * 0.3));
        for (const t of seq) {
          const matches = n === 0 ? t.letter === ZERO_BACK_TARGET : t.index >= n && seq[t.index - n].letter === t.letter;
          expect(matches).toBe(t.isTarget);
        }
      }
    });
  }
  it("is reproducible for the same seed", () => {
    expect(generateSequence(2, 20, 0.3, 42)).toEqual(generateSequence(2, 20, 0.3, 42));
  });
});

describe("counterbalancing", () => {
  it("Latin square: each level once per row and per position", () => {
    for (let i = 0; i < 4; i++) {
      expect(new Set(LATIN_SQUARE[i]).size).toBe(4);
      expect(new Set(LATIN_SQUARE.map((r) => r[i])).size).toBe(4);
    }
  });
  it("balanced: every ordered pair of levels is adjacent exactly once", () => {
    const pairs = new Map<string, number>();
    for (const r of LATIN_SQUARE) for (let i = 0; i < 3; i++) pairs.set(`${r[i]}${r[i + 1]}`, (pairs.get(`${r[i]}${r[i + 1]}`) ?? 0) + 1);
    expect(pairs.size).toBe(12);
    for (const v of pairs.values()) expect(v).toBe(1);
  });
  it("participant number selects the row", () => {
    expect(blockOrder("P04")).toEqual(LATIN_SQUARE[0]);
    expect(blockOrder("P07")).toEqual(LATIN_SQUARE[3]);
  });
});

describe("scoring", () => {
  it("probit matches known quantiles", () => {
    expect(probit(0.5)).toBeCloseTo(0, 6);
    expect(probit(0.975)).toBeCloseTo(1.959964, 5);
    expect(probit(0.01)).toBeCloseTo(-2.326348, 5);
  });
  it("perfect performer: accuracy 1, high finite d′", () => {
    const seq = generateSequence(2, 36, 0.3, 3);
    const resp: Response[] = seq.map((t) => ({ trial: t.index, rt: t.isTarget ? 600 : null }));
    const s = scoreBlock(seq, resp, 2);
    expect(s.accuracy).toBe(1);
    expect(Number.isFinite(s.dPrime)).toBe(true);
    expect(s.dPrime).toBeGreaterThan(3);
    expect(s.meanRt).toBe(600);
  });
  it("random responder: d′ ≈ 0", () => {
    const seq = generateSequence(1, 400, 0.3, 9);
    let x = 1;
    const resp = seq.map((t) => ({ trial: t.index, rt: ((x = (x * 48271) % 2147483647) % 2 ? 500 : null) }));
    expect(Math.abs(scoreBlock(seq, resp, 1).dPrime)).toBeLessThan(0.35);
  });
  it("raw TLX is the mean of six subscales", () => {
    expect(rawTlx({ mental: 90, physical: 10, temporal: 60, performance: 40, effort: 80, frustration: 20 })).toBeCloseTo(50);
  });
  it("pearson", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });
  it("protocol timing: full study block ≈ 90 s", () => {
    expect((PROTOCOLS.full.trials * PROTOCOLS.full.soaMs) / 1000).toBe(90);
  });
});

describe("training export", () => {
  it("labels block rows with load class + that block's TLX, baseline as rest", () => {
    const study = {
      id: "s1", participantId: "P01", columns: ["t_ms", "phase", "block", "n_level", "trial", "h_load"],
      blocks: [{ index: 0, n: 3, rawTlx: 72.5, tlx: { mental: 90 }, score: { accuracy: 0.8, dPrime: 1.9 } }],
      rows: [[0, "baseline", -1, -1, -1, 0.1], [100, "block", 0, 3, 4, 0.6], [200, "tlx", 0, 3, -1, 0.5]],
    } as unknown as StudyRecord;
    const [base, blk, tlx] = trainingRows(study);
    expect(base.slice(0, 3)).toEqual(["P01", "s1", "rest"]);
    expect(blk.slice(2, 5)).toEqual(["high", 72.5, 90]);
    expect(tlx[2]).toBe(""); // questionnaire time is not a load sample
  });
});
