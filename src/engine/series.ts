// Fixed-size ring buffer for the live timeline. Written at full frame rate,
// read by uPlot on animation frames — never goes through React state.

export const WINDOW_S = 60;
const CAP = 60 * 40; // 60 s at up to 40 Hz

class Series {
  t = new Float64Array(CAP);
  att = new Float32Array(CAP);
  eng = new Float32Array(CAP);
  load = new Float32Array(CAP);
  private head = 0;
  private size = 0;
  version = 0;
  /** Learned-model load (when active) replaces the heuristic in the timeline. */
  overrideLoad: number | null = null;

  push(tSec: number, a: number, e: number, l: number) {
    const i = this.head;
    this.t[i] = tSec;
    this.att[i] = a;
    this.eng[i] = e;
    this.load[i] = l;
    this.head = (i + 1) % CAP;
    this.size = Math.min(this.size + 1, CAP);
    this.version++;
  }

  /** Ordered snapshot of the last WINDOW_S seconds, as uPlot AlignedData. */
  snapshot(): [number[], number[], number[], number[]] {
    const out: [number[], number[], number[], number[]] = [[], [], [], []];
    if (!this.size) return out;
    const start = (this.head - this.size + CAP) % CAP;
    const latest = this.t[(this.head - 1 + CAP) % CAP];
    for (let k = 0; k < this.size; k++) {
      const i = (start + k) % CAP;
      if (this.t[i] < latest - WINDOW_S) continue;
      out[0].push(this.t[i]);
      out[1].push(this.att[i]);
      out[2].push(this.eng[i]);
      out[3].push(this.load[i]);
    }
    return out;
  }

  clear() {
    this.head = 0;
    this.size = 0;
    this.version++;
  }
}

export const series = new Series();
