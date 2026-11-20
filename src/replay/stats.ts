import { col, type Replayable } from "./signals";
import type { EventType, ReplayEvent } from "./events";

export interface Summary {
  duration: number;
  faceCoverage: number;
  attention: number;
  engagement: number;
  load: number;
  /** share of face-visible time with attention ≥ 0.7 */
  focused: number;
  /** share of time with load in low / medium / high bands */
  loadBands: [number, number, number];
  hr: number;
  hrCoverage: number;
  blinkRate: number;
  events: Partial<Record<EventType, number>>;
}

function meanWhere(a: Float64Array, keep: (i: number) => boolean) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (keep(i) && !Number.isNaN(a[i])) { s += a[i]; n++; }
  return n ? s / n : NaN;
}

export function summarize(r: Replayable, events: ReplayEvent[]): Summary {
  const face = col(r, "face_present");
  const hr = col(r, "hr_bpm"), ok = col(r, "hr_valid"), blink = col(r, "blink_rate");
  const m = (i: number) => !!r.eventMask[i];
  const fm = (i: number) => m(i) && face[i] === 1;
  const n = r.eventMask.reduce((a, v) => a + v, 0) || 1;
  let fv = 0, foc = 0, ln = 0;
  const bands: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < r.t.length; i++) {
    if (fm(i)) {
      fv++;
      if (r.attention[i] >= 0.7) foc++;
    }
    const l = r.load[i];
    if (m(i) && !Number.isNaN(l)) {
      ln++;
      bands[l > 0.66 ? 2 : l > 0.33 ? 1 : 0]++;
    }
  }
  let hrN = 0;
  for (let i = 0; i < ok.length; i++) if (m(i) && ok[i] === 1) hrN++;
  const counts: Partial<Record<EventType, number>> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return {
    duration: r.duration,
    faceCoverage: fv / n,
    attention: meanWhere(r.attention, fm),
    engagement: meanWhere(r.engagement, fm),
    load: meanWhere(r.load, m),
    focused: fv ? foc / fv : 0,
    loadBands: ln ? (bands.map((b) => b / ln) as [number, number, number]) : [0, 0, 0],
    hr: meanWhere(hr, (i) => m(i) && ok[i] === 1),
    hrCoverage: hrN / n,
    blinkRate: meanWhere(blink, fm),
    events: counts,
  };
}
