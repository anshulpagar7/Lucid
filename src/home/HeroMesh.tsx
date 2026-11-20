import { useEffect, useRef } from "react";

type P3 = [number, number, number];

/** Procedural face-like point cloud (generic, not a real person). */
function buildMesh() {
  const pts: { p: P3; kind: 0 | 1 | 2 }[] = [];
  const N = 1100, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
    let x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (z < -0.25) continue; // front of the head only
    let Y = y * 1.28, X = x * 0.95, Z = z * 0.85;
    Z += 0.24 * Math.exp(-(X * X) / 0.018 - ((Y + 0.05) ** 2) / 0.09); // nose
    for (const ex of [-0.34, 0.34]) Z -= 0.09 * Math.exp(-((X - ex) ** 2) / 0.02 - ((Y - 0.22) ** 2) / 0.01); // eye sockets
    Z += 0.05 * Math.exp(-(X * X) / 0.05 - ((Y + 0.95) ** 2) / 0.03); // chin
    pts.push({ p: [X, Y, Z], kind: 0 });
  }
  const ring = (cx: number, cy: number, rx: number, ry: number, z: number, n: number, kind: 1 | 2) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ p: [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z], kind });
    }
  };
  for (const ex of [-0.34, 0.34]) {
    ring(ex, 0.22, 0.15, 0.065, 0.72, 34, 1); // eye contour
    ring(ex, 0.22, 0.05, 0.05, 0.74, 16, 2); // iris
  }
  for (let i = 0; i <= 30; i++) {
    const u = i / 30 - 0.5;
    pts.push({ p: [u * 0.46, -0.52 - 0.06 * Math.cos(u * Math.PI), 0.7], kind: 1 }); // mouth
    for (const ex of [-0.34, 0.34]) pts.push({ p: [ex + u * 0.34, 0.42 + 0.04 * Math.cos(u * Math.PI * 1.6), 0.7], kind: 1 }); // brows
  }
  return pts;
}

export function HeroMesh() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const mesh = buildMesh();
    let mx = 0, my = 0, raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      my = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let yawS = 0, pitchS = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(devicePixelRatio || 1, 2), W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const t = reduce ? 0 : now / 1000;
      yawS += ((0.55 * Math.sin(t / 3.2) + mx * 0.35) - yawS) * 0.06;
      pitchS += ((0.12 * Math.sin(t / 4.1) + my * 0.2) - pitchS) * 0.06;
      const cy = Math.cos(yawS), sy = Math.sin(yawS), cp = Math.cos(pitchS), sp = Math.sin(pitchS);
      const S = Math.min(W, H) * 0.27, ox = W / 2, oy = H / 2;
      const proj = ([x, y, z]: P3) => {
        const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const f = 3.2 / (3.2 - z2);
        return [ox + x1 * S * f, oy - y2 * S * f, z2] as const;
      };
      const scan = ((t * 0.35) % 1.6) - 0.8; // sweeping scan line in model space

      // orbit rings
      ctx.lineWidth = 1;
      // tilted halo rings around the head (not through it)
      const ringPt = (a: number, rr: number, tilt: number): P3 => {
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        return [x, -0.15 + z * Math.sin(tilt) * 0.55, z * Math.cos(tilt)];
      };
      for (const [rr, col, sp2, tilt] of [[1.18, "34,211,238", 0.25, 0.35], [1.3, "167,139,250", -0.18, -0.25], [1.42, "245,165,36", 0.12, 0.6]] as const) {
        ctx.beginPath();
        for (let i = 0; i <= 90; i++) {
          const [x, y] = proj(ringPt((i / 90) * Math.PI * 2, rr, tilt));
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = `rgba(${col},0.16)`;
        ctx.stroke();
        const a = t * sp2 + 1;
        const [bx, by] = proj(ringPt(a, rr, tilt));
        ctx.fillStyle = `rgba(${col},0.95)`;
        ctx.beginPath();
        ctx.arc(bx, by, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const { p, kind } of mesh) {
        const [x, y, z] = proj(p);
        const depth = (z + 1) / 2;
        const near = Math.exp(-((p[1] - scan * 1.3) ** 2) / 0.004);
        if (kind === 0) {
          ctx.fillStyle = `rgba(34,211,238,${0.16 + depth * 0.45 + near * 0.5})`;
          const s = 1 + depth * 1.1 + near * 1.2;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        } else {
          ctx.fillStyle = kind === 2 ? `rgba(167,139,250,${0.6 + depth * 0.4})` : `rgba(237,237,240,${0.35 + depth * 0.55})`;
          ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
        }
      }

      // gaze ray
      const [ex, ey] = proj([0, 0.22, 0.75]);
      const [fx, fy] = proj([0, 0.22 - pitchS * 0.6, 2.6]);
      const g = ctx.createLinearGradient(ex, ey, fx, fy);
      g.addColorStop(0, "rgba(34,211,238,0.9)");
      g.addColorStop(1, "rgba(34,211,238,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(fx, fy);
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return <canvas ref={ref} className="h-full w-full" aria-hidden />;
}
