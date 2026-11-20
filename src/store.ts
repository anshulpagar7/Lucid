import { create } from "zustand";
import type { Delegate, FrameMetrics, Modalities } from "./engine/types";
import type { GazeCalibration } from "./replay/types";

export type ModelStatus = "loading" | "none" | "incompatible" | "baseline" | "ready" | "no-face";

export interface ModelInfo {
  synthetic: boolean;
  participants: number;
  macroF1: number;
  ci95: [number, number];
  created: string;
  importance: Record<string, number>;
  labels: Record<string, string>;
}

export interface ModelState {
  status: ModelStatus;
  info: ModelInfo | null;
  /** 0..1 progress of the personal resting baseline */
  baseline: number;
  proba: number[] | null;
  /** smoothed expected load 0..1 */
  load: number | null;
  contributions: Record<string, number> | null;
  message?: string;
}

export type Status = "idle" | "starting" | "running" | "error";
export type View = "home" | "live" | "study" | "replay" | "classroom" | "lab";

interface LucidState {
  status: Status;
  stage: string;
  error: string | null;
  delegate: Delegate | null;
  modalities: Modalities | null;
  initMs: number;
  fps: number;
  latencyMs: number;
  inferMs: number;
  metrics: FrameMetrics | null;
  overlay: boolean;
  view: View;
  model: ModelState;
  gaze: GazeCalibration | null;
  /** epoch ms when the current Live recording started, null if not recording */
  recording: number | null;
  toast: { msg: string; action?: { label: string; view: View } } | null;
  /** session to open when switching to Replay */
  replayId: string | null;
  sessionStart: number;
  set: (p: Partial<LucidState>) => void;
}

export const useLucid = create<LucidState>((set) => ({
  status: "idle",
  stage: "",
  error: null,
  delegate: null,
  modalities: null,
  initMs: 0,
  fps: 0,
  latencyMs: 0,
  inferMs: 0,
  metrics: null,
  overlay: true,
  view: "home",
  model: { status: "loading", info: null, baseline: 0, proba: null, load: null, contributions: null },
  gaze: null,
  recording: null,
  toast: null,
  replayId: null,
  sessionStart: 0,
  set: (p) => set(p),
}));
