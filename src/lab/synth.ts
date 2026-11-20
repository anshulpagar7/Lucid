// Synthetic signal generators — shared by the test suite and the in-app self-check (seeded → reproducible).

export function rng(seed = 7) {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return { u, gauss: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}

export interface PulseOpts {
  bpm: number;
  seconds: number;
  /** per-channel sensor noise (0–255 scale) after ROI averaging */
  noise?: number;
  /** RR-interval jitter (ms) — produces HRV */
  hrvMs?: number;
  /** pulse amplitude; 0 = no heartbeat at all */
  amp?: number;
  /** start of a 2 s head-motion burst (ms), or -1 */
  motionAt?: number;
  seed?: number;
}

/** Skin-colour stream with a PPG pulse, illumination drift, motion and camera frame jitter. */
export function* skinStream(o: PulseOpts) {
  const { bpm, seconds, noise = 0.08, hrvMs = 30, amp = 0.35, motionAt = -1, seed = 7 } = o;
  const { gauss } = rng(seed);
  const rr0 = 60_000 / bpm;
  const beats: number[] = [];
  for (let tb = 0; tb < seconds * 1000 + 2000; tb += rr0 + gauss() * hrvMs * 0.7) beats.push(tb);
  let t = 0, bi = 0;
  while (t < seconds * 1000) {
    while (bi < beats.length - 1 && beats[bi + 1] <= t) bi++;
    const ph = (t - beats[bi]) / rr0;
    // systolic peak + dicrotic wave (gives the realistic 2nd harmonic)
    const p = Math.exp(-((ph - 0.15) ** 2) / 0.008) + 0.4 * Math.exp(-((ph - 0.45) ** 2) / 0.02);
    const light = 1 + 0.03 * Math.sin(t / 4000) + 0.01 * Math.sin(t / 900);
    const mot = motionAt >= 0 && t > motionAt && t < motionAt + 2000 ? 6 * Math.sin(t / 120) : 0;
    yield {
      t,
      r: (170 + amp * 0.3 * p) * light + mot + gauss() * noise,
      g: (120 - amp * p) * light + mot + gauss() * noise,
      b: (95 - amp * 0.15 * p) * light + mot + gauss() * noise,
    };
    t += 33.3 + gauss() * 4; // webcam frame-time jitter
  }
}
