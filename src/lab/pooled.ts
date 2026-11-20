// Pooled statistics across completed Study sessions (pure).

import type { StudyRecord } from "../study/types";

export interface LevelStat {
  n: number;
  blocks: number;
  tlx: { mean: number; sd: number };
  accuracy: { mean: number; sd: number };
  dPrime: { mean: number; sd: number };
  rt: { mean: number; sd: number };
}

export interface Pooled {
  participants: number;
  sessions: number;
  hours: number;
  levels: LevelStat[];
  /** Spearman ρ between n-level and raw TLX over all blocks */
  rhoTlx: number;
  /** share of participants whose 3-back TLX exceeded their 0-back TLX */
  orderedShare: number;
}

const ms = (a: number[]) => {
  const v = a.filter(Number.isFinite);
  if (!v.length) return { mean: NaN, sd: NaN };
  const m = v.reduce((x, y) => x + y, 0) / v.length;
  return { mean: m, sd: Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, v.length - 1)) };
};

function ranks(a: number[]) {
  const idx = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r as number[];
}

export function spearman(x: number[], y: number[]) {
  if (x.length < 3) return NaN;
  const rx = ranks(x), ry = ranks(y);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length, my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export function pool(studies: StudyRecord[]): Pooled {
  const done = studies.filter((s) => s.complete);
  const blocks = done.flatMap((s) => s.blocks.map((b) => ({ ...b, pid: s.participantId })));
  const levels = [0, 1, 2, 3].map((n) => {
    const bs = blocks.filter((b) => b.n === n);
    return {
      n, blocks: bs.length,
      tlx: ms(bs.map((b) => b.rawTlx ?? NaN)), accuracy: ms(bs.map((b) => b.score.accuracy)),
      dPrime: ms(bs.map((b) => b.score.dPrime)), rt: ms(bs.map((b) => b.score.meanRt ?? NaN)),
    };
  });
  const withTlx = blocks.filter((b) => b.rawTlx != null);
  const per = done.map((s) => {
    const t = (n: number) => s.blocks.find((b) => b.n === n)?.rawTlx;
    const a = t(0), b = t(3);
    return a != null && b != null ? (b > a ? 1 : 0) : null;
  }).filter((v): v is 0 | 1 => v !== null);
  const rowsTotal = done.reduce((a, s) => a + s.rows.length, 0);
  return {
    participants: new Set(done.map((s) => s.participantId)).size,
    sessions: done.length,
    hours: rowsTotal / 10 / 3600,
    levels,
    rhoTlx: spearman(withTlx.map((b) => b.n), withTlx.map((b) => b.rawTlx!)),
    orderedShare: per.length ? per.reduce<number>((a, b) => a + b, 0) / per.length : NaN,
  };
}
