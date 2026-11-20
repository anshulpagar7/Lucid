// Shared contract between the vision worker and the UI thread.

import type { PostureMetrics } from "./posture";
import type { PulseWave, RppgMetrics } from "./rppg";

export type Delegate = "GPU" | "CPU";

export interface Modalities {
  face: boolean;
  pose: boolean;
  rppg: boolean;
}

/** One weighted input to a score — powers the "Why?" panel. */
export interface Contribution {
  key: string;
  label: string;
  /** 0..1 normalized signal value */
  value: number;
  /** weight inside the score (sums to ~1 per score) */
  weight: number;
}

export interface FrameMetrics {
  t: number; // ms, performance.now() domain of the capturing thread
  facePresent: boolean;

  // Head pose (degrees, relative to calibrated neutral)
  yaw: number;
  pitch: number;
  roll: number;

  // Gaze (-1..1, from iris blendshapes). +x = subject's left, +y = up
  gazeX: number;
  gazeY: number;

  // Eyes
  ear: number; // eye aspect ratio from landmarks
  eyeClosure: number; // 0..1 blendshape
  blinkRate: number; // blinks / min (rolling 60s)
  perclos: number; // 0..1 fraction of time eyes ≥ 70% closed (rolling 60s)
  blinks: number; // total this session

  // Face / body proxies
  browDown: number; // AU4 proxy 0..1
  jawOpen: number; // yawn proxy 0..1
  motion: number; // head motion energy 0..1 (fidget proxy)

  // Scores (0..1) — heuristic v0, replaced by the trained fusion model later
  attention: number;
  engagement: number;
  load: number;

  why: {
    attention: Contribution[];
    engagement: Contribution[];
    load: Contribution[];
  };

  /** Body modality — null when the pose model isn't loaded */
  posture: PostureMetrics | null;

  /** All 52 face blendshape scores (ARKit names) — recorded for model training */
  blendshapes: Record<string, number> | null;

  /** Cardiac modality (remote photoplethysmography) */
  rppg: RppgMetrics | null;

  calibrating: boolean;
}

// ---- Worker protocol ----

export type ToWorker =
  | { type: "init"; wasmBase: string; modelUrls: { face: string[]; pose: string[] } }
  | { type: "frame"; bitmap: ImageBitmap; t: number }
  | { type: "calibrate" }
  | { type: "reset" };

export type FromWorker =
  | { type: "ready"; delegate: Delegate; initMs: number; modalities: Modalities }
  | { type: "progress"; stage: string }
  | {
      type: "result";
      t: number;
      inferMs: number;
      metrics: FrameMetrics;
      /** 478 * 3 normalized landmarks, or null when no face */
      landmarks: Float32Array | null;
      /** 33 * 4 (x, y, z, visibility) pose landmarks, or null */
      poseLandmarks: Float32Array | null;
      /** band-passed pulse waveform — only on frames where it was recomputed */
      pulse: PulseWave | null;
    }
  | { type: "error"; message: string };
