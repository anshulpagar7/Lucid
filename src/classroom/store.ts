import { create } from "zustand";
import type { Delegate } from "../engine/types";
import type { ClassMoment, ClassSnapshot } from "./classMetrics";
import type { Track } from "./tracker";
import type { SourceKind } from "./types";

export interface ClassState {
  status: "idle" | "starting" | "running" | "error";
  stage: string;
  error: string | null;
  source: SourceKind | null;
  sourceLabel: string;
  delegate: Delegate | null;
  fps: number;
  inferMs: number;
  maxFaces: number;
  /** UI snapshot (~4 Hz) */
  tracks: Track[];
  snapshot: ClassSnapshot | null;
  moments: ClassMoment[];
  startedAt: number;
  showIndividuals: boolean;
  blurFaces: boolean;
  set: (p: Partial<ClassState>) => void;
}

export const useClass = create<ClassState>((set) => ({
  status: "idle", stage: "", error: null, source: null, sourceLabel: "", delegate: null, fps: 0, inferMs: 0,
  maxFaces: 12, tracks: [], snapshot: null, moments: [], startedAt: 0,
  showIndividuals: true, blurFaces: false,
  set: (p) => set(p),
}));
