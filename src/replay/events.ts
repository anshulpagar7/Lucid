import { INK } from "../theme";
// Auto-detected moments: pure functions over the 10 Hz replay series.

import { col, type Replayable } from "./signals";

export type EventType = "lapse" | "away" | "eyes-closed" | "drowsy" | "head-on-hand" | "load-high" | "hr-up";

export interface ReplayEvent {
  type: EventType;
  start: number;
  end: number;
  label: string;
  detail: string;
}

const meta = (label: string, ink: "att" | "faint" | "bad" | "eng" | "load" | "pulse") => ({
  label,
  get color() {
    return INK[ink];
  },
});

/** Colours are getters so they follow the current theme. */
export const EVENT_META: Record<EventType, { label: string; readonly color: string }> = {
  lapse: meta("Attention lapse", "att"),
  away: meta("Face not visible", "faint"),
  "eyes-closed": meta("Eyes closed", "bad"),
  drowsy: meta("Drowsiness", "bad"),
  "head-on-hand": meta("Head on hand", "eng"),
  "load-high": meta("High cognitive load", "load"),
  "hr-up": meta("Heart rate up", "pulse"),
};

/** Thresholds — exported so the report can state them. */
export const RULES = {
  lapse: { below: 0.35, minS: 4 },
  away: { minS: 3 },
  eyesClosed: { above: 0.7, minS: 1.5 },
  drowsy: { perclos: 0.15, minS: 10 },
  headOnHand: { minS: 5 },
  loadHigh: { above: 0.66, minS: 8 },
  hrUp: { delta: 12, minS: 10 },
};

/**
 * Time spans where `on(i)` holds for at least `minDur` seconds. Off-samples
 * shorter than `maxGap` seconds inside a span are bridged (blinks, jitter).
 */
export function runs(t: ArrayLike<number>, on: (i: number) => boolean, minDur: number, maxGap = 1.0): [number, number][] {
  const out: [number, number][] = [];
  let s = -1, e = -1;
  for (let i = 0; i < t.length; i++) {
    if (!on(i)) continue;
    if (s < 0) {
      s = e = t[i];
      continue;
    }
    if (t[i] - e > maxGap) {
      if (e - s >= minDur) out.push([s, e]);
      s = t[i];
    }
    e = t[i];
  }
  if (s >= 0 && e - s >= minDur) out.push([s, e]);
  return out;
}

const mean = (a: Float64Array, t: Float64Array, s: number, e: number) => {
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (t[i] >= s && t[i] <= e && !Number.isNaN(a[i])) { sum += a[i]; n++; }
  return n ? sum / n : NaN;
};

export function detectEvents(r: Replayable): ReplayEvent[] {
  const { t, eventMask: m } = r;
  const face = col(r, "face_present");
  const ec = col(r, "eye_closure");
  const perclos = col(r, "perclos");
  const hoh = col(r, "head_on_hand");
  const hr = col(r, "hr_bpm"), hrBase = col(r, "hr_baseline"), hrOk = col(r, "hr_valid");
  const ev: ReplayEvent[] = [];
  const push = (type: EventType, spans: [number, number][], detail: (s: number, e: number) => string) => {
    for (const [s, e] of spans) ev.push({ type, start: s, end: e, label: EVENT_META[type].label, detail: detail(s, e) });
  };
  const dur = (s: number, e: number) => `${(e - s).toFixed(e - s < 10 ? 1 : 0)} s`;

  push("away", runs(t, (i) => !!m[i] && face[i] === 0, RULES.away.minS, 0.5), (s, e) => `Out of view for ${dur(s, e)}`);
  push("lapse", runs(t, (i) => !!m[i] && face[i] === 1 && r.attention[i] < RULES.lapse.below, RULES.lapse.minS), (s, e) =>
    `Attention ${Math.round(mean(r.attention, t, s, e) * 100)} for ${dur(s, e)}`);
  push("eyes-closed", runs(t, (i) => !!m[i] && face[i] === 1 && ec[i] >= RULES.eyesClosed.above, RULES.eyesClosed.minS, 0.3), (s, e) => `Closed ${dur(s, e)}`);
  push("drowsy", runs(t, (i) => !!m[i] && perclos[i] >= RULES.drowsy.perclos, RULES.drowsy.minS), (s, e) =>
    `PERCLOS ${Math.round(mean(perclos, t, s, e) * 100)}% for ${dur(s, e)}`);
  push("head-on-hand", runs(t, (i) => !!m[i] && hoh[i] === 1, RULES.headOnHand.minS), (s, e) => `Propped for ${dur(s, e)}`);
  push("load-high", runs(t, (i) => !!m[i] && r.load[i] >= RULES.loadHigh.above, RULES.loadHigh.minS, 2.5), (s, e) =>
    `Load ${Math.round(mean(r.load, t, s, e) * 100)} for ${dur(s, e)}`);
  const delta = Float64Array.from(hr, (v, i) => (hrOk[i] === 1 ? v - hrBase[i] : NaN));
  push("hr-up", runs(t, (i) => !!m[i] && delta[i] >= RULES.hrUp.delta, RULES.hrUp.minS, 2), (s, e) =>
    `+${Math.round(mean(delta, t, s, e))} bpm over resting for ${dur(s, e)}`);

  return ev.sort((a, b) => a.start - b.start);
}
