// Classroom mode: many faces per frame, analysed on-device.

import type { Delegate } from "../engine/types";

/** One detected face (normalized image coordinates). */
export interface FaceObs {
  /** x, y, w, h in 0..1 */
  box: [number, number, number, number];
  /** nose tip and face centre, for the head-direction ray */
  nose: [number, number];
  center: [number, number];
  yaw: number;
  pitch: number;
  roll: number;
  gazeX: number;
  gazeY: number;
  eyeClosure: number;
}

export type SourceKind = "camera" | "screen" | "file";

export type ToClassWorker =
  | { type: "init"; wasmBase: string; modelUrls: string[]; numFaces: number }
  | { type: "frame"; bitmap: ImageBitmap; t: number }
  | { type: "faces"; numFaces: number };

export type FromClassWorker =
  | { type: "ready"; delegate: Delegate }
  | { type: "progress"; stage: string }
  | { type: "result"; t: number; inferMs: number; faces: FaceObs[] }
  | { type: "error"; message: string };
