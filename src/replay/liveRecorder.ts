// Records a Live session for Replay: the same 10 Hz feature rows as Study
// mode (shared toRow), plus learned-model load and calibrated screen gaze.

import { session } from "../engine/session";
import { Ema } from "../engine/features";
import { Sampler } from "../engine/sampler";
import { saveSession } from "../study/db";
import { COLUMNS, toRow, type Row } from "../study/schema";
import { useLucid } from "../store";
import { applyGaze } from "./gaze";
import type { LiveRecord } from "./types";
import { fmtTime } from "./signals";

const MIN_ROWS = 50; // < 5 s isn't worth keeping

class LiveRecorder {
  private rows: Row[] = [];
  private modelLoad: (number | null)[] = [];
  private gaze: ([number, number] | null)[] = [];
  private t0 = 0;
  private sampler = new Sampler();
  private last = -Infinity;
  private unsub: (() => void) | null = null;
  private smooth = { gx: new Ema(150), gy: new Ema(150), yaw: new Ema(150), pitch: new Ema(150) };

  constructor() {
    session.onStop(() => void this.stop());
  }

  get active() {
    return this.unsub !== null;
  }

  start() {
    if (this.active || !session.isRunning) return;
    this.rows = [];
    this.modelLoad = [];
    this.gaze = [];
    this.t0 = performance.now();
    this.last = -Infinity;
    this.sampler.reset();
    Object.values(this.smooth).forEach((e) => e.reset());
    this.unsub = session.onMetrics((m) => {
      if (!this.sampler.take(m.t)) return;
      const dt = this.last === -Infinity ? 100 : m.t - this.last;
      this.last = m.t;
      const st = useLucid.getState();
      this.rows.push(toRow(m, { phase: "other", block: -1, n: -1, trial: -1 }, m.t - this.t0));
      this.modelLoad.push(st.model.status === "ready" ? st.model.load : null);
      let g: [number, number] | null = null;
      if (st.gaze && m.facePresent) {
        const s = this.smooth;
        g = applyGaze(st.gaze, { gx: s.gx.push(m.gazeX, dt), gy: s.gy.push(m.gazeY, dt), yaw: s.yaw.push(m.yaw, dt), pitch: s.pitch.push(m.pitch, dt) });
        g = [Math.round(g[0] * 1000) / 1000, Math.round(g[1] * 1000) / 1000];
      }
      this.gaze.push(g);
    });
    useLucid.getState().set({ recording: Date.now() });
  }

  async stop(): Promise<LiveRecord | null> {
    if (!this.unsub) return null;
    this.unsub();
    this.unsub = null;
    const st = useLucid.getState();
    st.set({ recording: null });
    if (this.rows.length < MIN_ROWS) {
      st.set({ toast: { msg: "Recording too short to save (under 5 s)" } });
      return null;
    }
    const started = Date.now() - (performance.now() - this.t0);
    const rec: LiveRecord = {
      id: crypto.randomUUID(),
      kind: "live",
      name: `Session · ${new Date(started).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      startedAt: started,
      endedAt: Date.now(),
      columns: [...COLUMNS],
      rows: this.rows,
      modelLoad: this.modelLoad,
      gaze: this.gaze,
      calibration: st.gaze,
      model: st.model.info ? { synthetic: st.model.info.synthetic, macroF1: st.model.info.macroF1 } : null,
    };
    try {
      await saveSession(rec);
      st.set({ toast: { msg: `Recording saved · ${fmtTime(((this.rows[this.rows.length - 1][0] as number) - (this.rows[0][0] as number)) / 1000)}`, action: { label: "Open in Replay", view: "replay" } }, replayId: rec.id });
    } catch (e) {
      console.error("[lucid] failed to save recording", e);
      st.set({ toast: { msg: "Couldn't save the recording (storage full?)" } });
    }
    return rec;
  }
}

export const liveRecorder = new LiveRecorder();
