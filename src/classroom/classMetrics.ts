import { INK } from "../theme";
// Class-level aggregation + 1 Hz class timeline + class moments (pure).

import { runs } from "../replay/events";
import type { StudentState } from "./score";
import type { Track } from "./tracker";

export interface ClassSnapshot {
  n: number;
  attention: number; // mean over visible students, NaN if none
  shares: Record<Exclude<StudentState, "absent">, number>;
}

export function aggregate(tracks: Track[]): ClassSnapshot {
  const vis = tracks.filter((t) => t.obs);
  const shares = { focused: 0, drifting: 0, down: 0, away: 0, closed: 0 };
  for (const t of vis) if (t.state !== "absent") shares[t.state]++;
  const n = vis.length;
  if (n) for (const k of Object.keys(shares) as (keyof typeof shares)[]) shares[k] /= n;
  return { n, attention: n ? vis.reduce((a, t) => a + t.attention, 0) / n : NaN, shares };
}

export interface ClassPoint {
  t: number; // seconds since start
  n: number;
  attention: number;
  focused: number;
  down: number;
  away: number;
}

export interface ClassMoment {
  start: number;
  end: number;
  label: string;
  detail: string;
  color: string;
}

export function classMoments(pts: ClassPoint[]): ClassMoment[] {
  const t = pts.map((p) => p.t);
  const ok = (i: number) => pts[i].n >= 2; // need a group to talk about "the class"
  const avg = (s: number, e: number, f: (p: ClassPoint) => number) => {
    const sel = pts.filter((p) => p.t >= s && p.t <= e && p.n >= 2);
    return sel.length ? sel.reduce((a, p) => a + f(p), 0) / sel.length : NaN;
  };
  const out: ClassMoment[] = [];
  for (const [s, e] of runs(t, (i) => ok(i) && pts[i].focused < 0.5, 10, 2))
    out.push({ start: s, end: e, label: "Class attention dip", detail: `${Math.round(avg(s, e, (p) => p.focused) * 100)}% focused for ${Math.round(e - s)} s`, color: INK.att });
  for (const [s, e] of runs(t, (i) => ok(i) && pts[i].down >= 0.4, 10, 2))
    out.push({ start: s, end: e, label: "Many looking down", detail: `${Math.round(avg(s, e, (p) => p.down) * 100)}% — note-taking or phones?`, color: INK.eng });
  for (const [s, e] of runs(t, (i) => ok(i) && pts[i].away >= 0.3, 8, 2))
    out.push({ start: s, end: e, label: "Many looking away", detail: `${Math.round(avg(s, e, (p) => p.away) * 100)}% turned away for ${Math.round(e - s)} s`, color: INK.load });
  return out.sort((a, b) => a.start - b.start);
}
