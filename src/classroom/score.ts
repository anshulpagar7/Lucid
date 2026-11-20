// Per-face attention for classroom use. Unlike the single-student Live mode
// there's no per-person neutral calibration: the camera is assumed to sit near
// the board / screen, so "facing the camera" ≈ "facing the lesson".

import type { FaceObs } from "./types";

/**
 * MediaPipe's face transform: positive pitch = head tilted down (y up, z toward
 * camera, right-handed). If "Looking down" fires when students look UP on your
 * setup, flip this to −1.
 */
export const PITCH_DOWN_SIGN = 1;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface FaceSignals {
  attention: number;
  down: boolean;
  away: boolean;
  closed: boolean;
}

export function faceSignals(o: FaceObs): FaceSignals {
  const pitchDown = PITCH_DOWN_SIGN * o.pitch;
  const yawOff = Math.max(0, Math.abs(o.yaw) - 20) / 25;
  const pitchOff = Math.max(0, pitchDown - 15) / 20 + Math.max(0, -pitchDown - 20) / 20;
  const headOff = clamp01(yawOff + pitchOff);
  const gazeOff = clamp01(Math.max(0, Math.abs(o.gazeX) - 0.4) / 0.4 + Math.max(0, Math.abs(o.gazeY) - 0.45) / 0.4);
  const eyesOpen = clamp01(1 - (o.eyeClosure - 0.4) / 0.4);
  return {
    // head direction dominates at classroom distances (eyes are only a few pixels)
    attention: clamp01(1 - 0.7 * headOff - 0.3 * gazeOff) * eyesOpen,
    down: pitchDown > 18 || o.gazeY < -0.5,
    away: Math.abs(o.yaw) > 32,
    closed: o.eyeClosure > 0.6,
  };
}

export type StudentState = "focused" | "drifting" | "down" | "away" | "closed" | "absent";

/** Mid-tone inks: legible both on the dark camera view and on paper tiles. */
export const STATE_META: Record<StudentState, { label: string; color: string }> = {
  focused: { label: "Focused", color: "#2f9e63" },
  drifting: { label: "Drifting", color: "#1a8fb0" },
  down: { label: "Looking down", color: "#7b66d6" },
  away: { label: "Looking away", color: "#c98a14" },
  closed: { label: "Eyes closed", color: "#d0485e" },
  absent: { label: "Out of view", color: "#9c9282" },
};
