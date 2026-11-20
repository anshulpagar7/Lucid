import { useEffect, useRef } from "react";
import { INK, rgb } from "../theme";

type P3 = [number, number, number];

/** Generic procedural face point cloud (not a real person). */
function buildMesh() {
  const pts: { p: P3; kind: 0 | 1 | 2 }[] = [];
  const N = 1000, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (z < -0.2) continue;
    const Y = y * 1.28, X = x * 0.95;
    let Z = z * 0.85;
    Z += 0.24 * Math.exp(-(X * X) / 0.018 - ((Y + 0.05) ** 2) / 0.09);
    for (const ex of [-0.34, 0.34]) Z -= 0.09 * Math.exp(-((X - ex) ** 2) / 0.02 - ((Y - 0.22) ** 2) / 0.01);
    pts.push({ p: [X, Y, Z], kind: 0 });
  }
  const ring = (cx: number, cy: number, rx: number, ry: number, z: number, n: number, kind: 1 | 2) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ p: [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z], kind });
    }
  };
  for (const ex of [-0.34, 0.34]) {
    ring(ex, 0.22, 0.15, 0.065, 0.72, 36, 1);
    ring(ex, 0.22, 0.05, 0.05, 0.74, 18, 2);
  }
  for (let i = 0; i <= 32; i++) {
    const u = i / 32 - 0.5;
    pts.push({ p: [u * 0.46, -0.52 - 0.05 * Math.cos(u * Math.PI), 0.7], kind: 1 });
    for (const ex of [-0.34, 0.34]) pts.push({ p: [ex + u * 0.34, 0.42 + 0.04 * Math.cos(u * Math.PI * 1.6), 0.7], kind: 1 });
  }
  return pts;
}

const PENS = [
  { key: "att", label: "Attention" },
  { key: "eng", label: "Engagement" },
  { key: "load", label: "Cognitive load" },
] as const;

/**
 * Hero instrument: an ink face mesh above a chart-recorder strip. The traces
 * are driven by the mesh — when the head turns away, the attention pen dips.
 * Illustrative only; it is not reading the camera.
 */
export function Recorder() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const mesh = buildMesh();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const HIST = 360; // samples across the strip
    const hist: [number, number, number][] = [];
    let mx = 0, raf = 0, yawS = 0, pitchS = 0, att = 0.85, eng = 0.75, load = 0.4, last = performance.now(), acc = 0;
    const t0 = performance.now();
    const onMove = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      mx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    };
    window.addEventListener("pointermove", onMove);

    const step = (t: number) => {
      // head motion: a slow look-around, occasionally turning away
      const away = Math.max(0, Math.sin(t / 5.3) - 0.72) * 3.2;
      const yawT = 0.22 * Math.sin(t / 2.9) + away * 0.55 * Math.sign(Math.sin(t / 11)) + mx * 0.18;
      yawS += (yawT - yawS) * 0.08;
      pitchS += (0.08 * Math.sin(t / 3.7) - pitchS) * 0.08;
      const attT = Math.max(0.08, 0.92 - 1.5 * Math.max(0, Math.abs(yawS) - 0.24));
      att += (attT - att) * 0.12;
      eng += ((0.62 + 0.25 * att + 0.04 * Math.sin(t / 1.7)) - eng) * 0.04;
      load += ((0.42 + 0.2 * Math.sin(t / 6.1) + 0.08 * Math.sin(t / 1.3)) - load) * 0.05;
      hist.push([att, eng, load]);
      if (hist.length > HIST) hist.shift();
    };
    // pre-fill so the strip isn't empty, but reveal it with a draw-in on load
    for (let i = 0; i < HIST; i++) step(i / 30 - HIST / 30);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(devicePixelRatio || 1, 2), W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const t = (now - t0) / 1000;
      if (!reduce) {
        acc += Math.min(0.1, (now - last) / 1000);
        while (acc > 1 / 30) {
          acc -= 1 / 30;
          step(t);
        }
      }
      last = now;
      const reveal = reduce ? 1 : Math.min(1, t / 1.6); // one orchestrated draw-in
      const ease = 1 - Math.pow(1 - reveal, 3);

      // ── face mesh (top ~60%) ──
      const meshH = H * 0.6;
      const S = Math.min(W, meshH) * 0.33, ox = W / 2, oy = meshH * 0.52;
      const cy = Math.cos(yawS), sy = Math.sin(yawS), cp = Math.cos(pitchS), sp = Math.sin(pitchS);
      const proj = ([x, y, z]: P3) => {
        const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const f = 3.2 / (3.2 - z2);
        return [ox + x1 * S * f, oy - y2 * S * f, z2] as const;
      };
      const ink = rgb(INK.fg);
      for (const { p, kind } of mesh) {
        const [x, y, z] = proj(p);
        const depth = (z + 1) / 2;
        if (kind === 0) {
          ctx.fillStyle = `rgba(${ink},${(0.1 + depth * 0.42) * ease})`;
          const s = 0.9 + depth * 1.1;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        } else {
          ctx.fillStyle = kind === 2 ? `rgba(${rgb(INK.eng)},${(0.65 + depth * 0.35) * ease})` : `rgba(${ink},${(0.55 + depth * 0.45) * ease})`;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
      // gaze ray
      const [ex, ey] = proj([0, 0.22, 0.75]);
      const [fx, fy] = proj([0, 0.22 - pitchS * 0.6, 2.4]);
      const g = ctx.createLinearGradient(ex, ey, fx, fy);
      g.addColorStop(0, `rgba(${rgb(INK.att)},${0.85 * ease})`);
      g.addColorStop(1, `rgba(${rgb(INK.att)},0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(fx, fy);
      ctx.stroke();

      // ── chart-recorder strip (bottom) ──
      const top = H * 0.64, bottom = H - 8, left = 0, labelW = 158, right = W - labelW;
      const sh = bottom - top;
      // graph paper
      ctx.strokeStyle = INK.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) {
        const yy = Math.round(top + (sh * k) / 4) + 0.5;
        ctx.moveTo(left, yy);
        ctx.lineTo(right, yy);
      }
      const scroll = reduce ? 0 : ((t * 30) % 24) * ((right - left) / HIST);
      for (let xx = right - scroll; xx > left; xx -= (24 * (right - left)) / HIST) {
        ctx.moveTo(Math.round(xx) + 0.5, top);
        ctx.lineTo(Math.round(xx) + 0.5, bottom);
      }
      ctx.stroke();

      const n = hist.length, shown = Math.floor(n * ease);
      const X = (i: number) => right - ((n - 1 - i) / (HIST - 1)) * (right - left);
      const Y = (v: number) => bottom - 6 - v * (sh - 12);
      PENS.forEach((pen, k) => {
        ctx.strokeStyle = INK[pen.key];
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = n - shown; i < n; i++) {
          const x = X(i), y = Y(hist[i][k]);
          i === n - shown ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (shown > 1) {
          const v = hist[n - 1][k], y = Y(v);
          // pen tip
          ctx.fillStyle = INK.card;
          ctx.beginPath();
          ctx.arc(right, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = INK[pen.key];
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
      // labels: text in ink, colour carried by the swatch (legible, not colour-alone)
      ctx.font = "500 12.5px IBM Plex Sans, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      PENS.forEach((pen, k) => {
        const v = hist[n - 1][k];
        const ly = top + 14 + k * 24;
        ctx.fillStyle = INK[pen.key];
        ctx.fillRect(right + 16, ly - 1, 10, 2.5);
        ctx.fillStyle = INK.muted;
        ctx.fillText(pen.label, right + 32, ly);
        ctx.fillStyle = INK.fg;
        ctx.textAlign = "right";
        ctx.fillText(String(Math.round(v * 100)), W - 2, ly);
        ctx.textAlign = "left";
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return <canvas ref={ref} className="h-full w-full" aria-label="Illustration: a face mesh with three live traces for attention, engagement and cognitive load" role="img" />;
}
