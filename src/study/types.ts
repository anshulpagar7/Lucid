import type { BlockScore, NLevel, Response, TlxRatings, Trial } from "./protocol";
import type { Row } from "./schema";

export interface TrialEvent {
  trial: number;
  /** stimulus onset, ms since study start */
  onset: number;
}

export interface BlockRecord {
  index: number;
  n: NLevel;
  startMs: number;
  endMs: number;
  trials: Trial[];
  events: TrialEvent[];
  responses: Response[];
  score: BlockScore;
  tlx: TlxRatings | null;
  rawTlx: number | null;
}

export interface StudyRecord {
  id: string;
  participantId: string;
  protocol: "full" | "quick";
  startedAt: number; // epoch ms
  finishedAt: number | null;
  order: NLevel[];
  baseline: { startMs: number; endMs: number } | null;
  blocks: BlockRecord[];
  /** 10 Hz feature rows; columns in schema.COLUMNS */
  rows: Row[];
  columns: string[];
  env: { delegate: string | null; pose: boolean; rppg: boolean; userAgent: string };
  complete: boolean;
}
