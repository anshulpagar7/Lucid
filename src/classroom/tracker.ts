// Multi-face tracker: greedy IoU association with a centre-distance fallback,
// confirmation after a few hits (no flicker IDs) and a grace period so a
// student who briefly turns or is occluded keeps their ID.

import { Ema } from "../engine/features";
import { faceSignals, type StudentState } from "./score";
import type { FaceObs } from "./types";

export const CONFIRM_HITS = 3;
export const MAX_MISS_MS = 2500;
export const HISTORY_S = 180;

type Box = FaceObs["box"];

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const u = a[2] * a[3] + b[2] * b[3] - inter;
  return u > 0 ? inter / u : 0;
}

export interface TrackStats {
  /** ms visible */
  seen: number;
  focused: number;
  down: number;
  away: number;
  closed: number;
  attSum: number;
}

export interface Track {
  id: number;
  box: Box;
  obs: FaceObs | null; // null when not matched this frame
  hits: number;
  firstSeen: number;
  lastSeen: number;
  confirmed: boolean;
  attention: number; // smoothed
  state: StudentState;
  stats: TrackStats;
  /** attention once per second (NaN when absent) */
  history: number[];
}

interface Internal extends Track {
  ema: { att: Ema; closed: Ema; down: Ema; away: Ema };
  lastHist: number;
}

export class Tracker {
  private tracks: Internal[] = [];
  private nextId = 1;
  private lastT = -1;
  /** confirmed this frame, awaiting an ID */
  private pending: Internal[] = [];

  reset() {
    this.tracks = [];
    this.nextId = 1;
    this.lastT = -1;
    this.pending = [];
  }

  /** Confirmed tracks (visible or within the grace period). */
  get list(): Track[] {
    return this.tracks.filter((t) => t.confirmed);
  }

  update(t: number, faces: FaceObs[]): Track[] {
    const dt = this.lastT < 0 ? 33 : Math.min(500, t - this.lastT);
    this.lastT = t;

    // candidate pairs, best first
    const pairs: { ti: number; fi: number; score: number }[] = [];
    this.tracks.forEach((tr, ti) =>
      faces.forEach((f, fi) => {
        const ov = iou(tr.box, f.box);
        const size = Math.max(tr.box[2], tr.box[3]);
        const d = Math.hypot(tr.box[0] + tr.box[2] / 2 - f.center[0], tr.box[1] + tr.box[3] / 2 - f.center[1]);
        const score = ov >= 0.15 ? 1 + ov : d < 0.6 * size ? 1 - d / (0.6 * size) : -1;
        if (score > 0) pairs.push({ ti, fi, score });
      }),
    );
    pairs.sort((a, b) => b.score - a.score);
    const usedT = new Set<number>(), usedF = new Set<number>();
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedF.has(p.fi)) continue;
      usedT.add(p.ti);
      usedF.add(p.fi);
      this.observe(this.tracks[p.ti], faces[p.fi], t, dt);
    }
    this.tracks.forEach((tr, ti) => {
      if (!usedT.has(ti)) {
        tr.obs = null;
        tr.state = "absent";
      }
    });
    faces.forEach((f, fi) => {
      if (usedF.has(fi)) return;
      const tr: Internal = {
        id: 0, box: [...f.box], obs: null, hits: 0, firstSeen: t, lastSeen: t, confirmed: false, attention: 0, state: "absent",
        stats: { seen: 0, focused: 0, down: 0, away: 0, closed: 0, attSum: 0 }, history: [],
        ema: { att: new Ema(1500), closed: new Ema(800), down: new Ema(1200), away: new Ema(1200) }, lastHist: t,
      };
      this.tracks.push(tr);
      this.observe(tr, f, t, dt);
    });

    // IDs in reading order (row by row, left to right) among students confirmed together
    const row = (b: Box) => Math.round((b[1] + b[3] / 2) / Math.max(0.05, b[3] * 1.5));
    this.pending.sort((a, b) => row(a.box) - row(b.box) || a.box[0] - b.box[0]);
    for (const tr of this.pending) tr.id = this.nextId++;
    this.pending = [];

    // drop stale tracks; unconfirmed ones go fast so flickers never get an ID
    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= (tr.confirmed ? MAX_MISS_MS : 300));

    // 1 Hz attention history for sparklines
    for (const tr of this.tracks) {
      if (!tr.confirmed) continue;
      while (t - tr.lastHist >= 1000) {
        tr.lastHist += 1000;
        tr.history.push(tr.obs ? tr.attention : NaN);
        if (tr.history.length > HISTORY_S) tr.history.shift();
      }
    }
    return this.list;
  }

  private observe(tr: Internal, f: FaceObs, t: number, dt: number) {
    const k = 0.6; // box smoothing
    tr.box = tr.box.map((v, i) => v + k * (f.box[i] - v)) as Box;
    tr.obs = f;
    tr.hits++;
    tr.lastSeen = t;
    if (!tr.confirmed && tr.hits >= CONFIRM_HITS) {
      tr.confirmed = true;
      tr.lastHist = t;
      this.pending.push(tr);
    }
    const s = faceSignals(f);
    tr.attention = tr.ema.att.push(s.attention, dt);
    const closed = tr.ema.closed.push(s.closed ? 1 : 0, dt) > 0.6;
    const away = tr.ema.away.push(s.away ? 1 : 0, dt) > 0.5;
    const down = tr.ema.down.push(s.down ? 1 : 0, dt) > 0.5;
    tr.state = closed ? "closed" : away ? "away" : down ? "down" : tr.attention >= 0.6 ? "focused" : "drifting";
    if (tr.confirmed) {
      const st = tr.stats;
      st.seen += dt;
      st.attSum += tr.attention * dt;
      if (tr.state === "focused") st.focused += dt;
      if (tr.state === "down") st.down += dt;
      if (tr.state === "away") st.away += dt;
      if (tr.state === "closed") st.closed += dt;
    }
  }
}
