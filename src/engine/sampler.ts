// Shared 10 Hz sampler. A naive "≥100 ms since last row" gate drifts to ~8.5 Hz
// with 30 fps camera jitter (a 99.x ms frame gap skips to the next frame). This
// schedules against a fixed 100 ms grid instead, so the long-run rate is exactly
// 10 Hz — every recorder and the live model use it, keeping train/infer identical.

export const SAMPLE_MS = 100;

export class Sampler {
  private next = -Infinity;

  /** true if a row should be emitted for a frame at time t (ms). */
  take(t: number): boolean {
    if (t < this.next) return false;
    // stay on the grid; if we fell far behind (tab hidden, stall), re-anchor
    this.next = t - this.next > SAMPLE_MS * 3 ? t + SAMPLE_MS : this.next + SAMPLE_MS;
    return true;
  }

  reset() {
    this.next = -Infinity;
  }
}
