import type { Row } from "../study/schema";

/** Linear gaze → screen mapping learned from a 9-point calibration. */
export interface GazeCalibration {
  /** ridge coefficients over gazeFeatures() for screen x and y (0..1) */
  cx: number[];
  cy: number[];
  /** mean validation error, fraction of screen width (held-out points) */
  valError: number;
  samples: number;
  /** viewport width / height at calibration time */
  aspect: number;
  created: number;
}

/** A recorded Live session. Numbers only — never video. */
export interface LiveRecord {
  id: string;
  kind: "live";
  name: string;
  startedAt: number;
  endedAt: number;
  columns: string[];
  rows: Row[];
  /** parallel to rows: learned-model load 0..1, null before the model is ready */
  modelLoad: (number | null)[];
  /** parallel to rows: estimated gaze on screen (0..1), null when uncalibrated / no face */
  gaze: ([number, number] | null)[];
  calibration: GazeCalibration | null;
  model: { synthetic: boolean; macroF1: number } | null;
}
