// Records 10 Hz feature rows tagged with the current protocol context.

import { session } from "../engine/session";
import { toRow, type Row, type RowContext } from "./schema";
import { Sampler } from "../engine/sampler";

export class Recorder {
  readonly rows: Row[] = [];
  readonly t0: number;
  private ctx: RowContext = { phase: "other", block: -1, n: -1, trial: -1 };
  private sampler = new Sampler();
  private unsub: (() => void) | null;

  constructor() {
    this.t0 = performance.now();
    this.unsub = session.onMetrics((m) => {
      if (!this.sampler.take(m.t)) return;
      this.rows.push(toRow(m, this.ctx, m.t - this.t0));
    });
  }

  /** ms since the study started, on the same clock as the rows. */
  now() {
    return performance.now() - this.t0;
  }

  set(ctx: Partial<RowContext>) {
    this.ctx = { ...this.ctx, ...ctx };
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
  }
}
