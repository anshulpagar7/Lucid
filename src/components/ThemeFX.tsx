import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useLucid } from "../store";
import { useTheme, type ThemeId } from "../theme";

// ───────── Theme effects ─────────
// One full-screen canvas above the page (pointer-events: none). Each theme has
// an intro (plays when you switch to it), a click effect, and an occasional
// ambient event. The loop only runs while something is on screen.
// Off during Study (it would disturb the experiment) and with reduced motion.

const KEY = "lucid.fx";
export const useFx = create<{ on: boolean; toggle: () => void }>((set, get) => ({
  on: (() => {
    try {
      return localStorage.getItem(KEY) !== "off";
    } catch {
      return true;
    }
  })(),
  toggle: () => {
    const on = !get().on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      /* ignore */
    }
    set({ on });
  },
}));

type Fx = { step: (dt: number) => boolean; draw: (c: CanvasRenderingContext2D) => void };
type Ctx = { W: number; H: number; add: (f: Fx) => void };
type Kit = {
  intro?: (k: Ctx) => void;
  click?: (k: Ctx, x: number, y: number) => void;
  ambient?: { every: [number, number]; run: (k: Ctx) => void };
};

const R = (a: number, b: number) => a + Math.random() * (b - a);
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

// ───────── shared particles ─────────

function sparks(k: Ctx, x: number, y: number, n: number, colors: string[], o: { speed?: number; up?: number; g?: number; size?: [number, number]; life?: [number, number] } = {}) {
  const ps = Array.from({ length: n }, () => {
    const a = R(0, Math.PI * 2), v = R(0.3, 1) * (o.speed ?? 260);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up ?? 120), life: R(...(o.life ?? [0.6, 1.2])), age: 0, s: R(...(o.size ?? [1.2, 2.8])), c: colors[(Math.random() * colors.length) | 0] };
  });
  k.add({
    step(dt) {
      let alive = false;
      for (const p of ps) {
        p.age += dt;
        p.vy += (o.g ?? 520) * dt;
        p.vx *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.age < p.life) alive = true;
      }
      return alive;
    },
    draw(c) {
      for (const p of ps) {
        const a = 1 - p.age / p.life;
        if (a <= 0) continue;
        c.globalAlpha = a;
        c.fillStyle = p.c;
        c.beginPath();
        c.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    },
  });
}

function ring(k: Ctx, x: number, y: number, r: number, color: string, life = 0.7, width = 2.5) {
  let t = 0;
  k.add({
    step: (dt) => (t += dt) < life,
    draw(c) {
      const p = t / life;
      c.globalAlpha = (1 - p) * 0.9;
      c.strokeStyle = color;
      c.lineWidth = width * (1 - p) + 0.5;
      c.beginPath();
      c.arc(x, y, ease(p) * r, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    },
  });
}

function flash(k: Ctx, color: string, peak: number, life = 0.35) {
  let t = 0;
  k.add({
    step: (dt) => (t += dt) < life,
    draw(c) {
      const p = t / life;
      // a quick double flicker
      const f = p < 0.15 ? 1 : p < 0.3 ? 0.25 : p < 0.45 ? 0.8 : 1 - (p - 0.45) / 0.55;
      c.globalAlpha = peak * Math.max(0, f);
      c.fillStyle = color;
      c.fillRect(0, 0, k.W, k.H);
      c.globalAlpha = 1;
    },
  });
}

// ───────── Nightwatch: bats ─────────

function bat(c: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number, ang: number) {
  const w = Math.sin(flap);
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(s, s);
  c.beginPath();
  for (const d of [-1, 1]) {
    c.moveTo(d * 1.2, -1.5);
    c.quadraticCurveTo(d * 6, -5 - w * 6, d * 13, -2.5 - w * 8);
    c.quadraticCurveTo(d * 11.5, 0.5 - w * 4, d * 9.5, 1 - w * 3);
    c.quadraticCurveTo(d * 8, -0.5 - w * 2, d * 6.2, 2.4 - w * 1.5);
    c.quadraticCurveTo(d * 4.5, 1, d * 1.2, 2.6);
  }
  c.moveTo(0, -4.4);
  c.lineTo(-1.6, -3.2);
  c.lineTo(-1.9, 2.2);
  c.quadraticCurveTo(0, 4.4, 1.9, 2.2);
  c.lineTo(1.6, -3.2);
  c.closePath();
  c.fillStyle = "#050608";
  c.fill();
  c.lineWidth = 0.9 / s;
  c.strokeStyle = "rgba(242,194,48,0.55)";
  c.stroke();
  c.restore();
}

function bats(k: Ctx, list: { x: number; y: number; vx: number; vy: number; s: number }[], life: number) {
  const bs = list.map((b) => ({ ...b, f: R(0, 6), fr: R(16, 24), t: 0, wob: R(0, 6) }));
  let t = 0;
  k.add({
    step(dt) {
      t += dt;
      for (const b of bs) {
        b.f += b.fr * dt;
        b.x += b.vx * dt;
        b.y += (b.vy + Math.sin(t * 5 + b.wob) * 40) * dt;
      }
      return t < life;
    },
    draw(c) {
      const fade = Math.min(1, (life - t) / 0.4);
      c.globalAlpha = Math.max(0, fade);
      for (const b of bs) bat(c, b.x, b.y, b.s, b.f, Math.atan2(b.vy, b.vx) * 0.25);
      c.globalAlpha = 1;
    },
  });
}

const night: Kit = {
  intro(k) {
    const cx = k.W / 2, cy = k.H + 30;
    bats(k, Array.from({ length: 34 }, () => {
      const a = R(-Math.PI * 0.92, -Math.PI * 0.08), v = R(380, 780);
      return { x: cx + R(-60, 60), y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: R(1.1, 2.6) };
    }), 2.2);
  },
  click(k, x, y) {
    bats(k, Array.from({ length: 5 }, () => {
      const a = R(-Math.PI * 0.95, -Math.PI * 0.05), v = R(260, 480);
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: R(0.9, 1.5) };
    }), 1.6);
  },
  ambient: {
    every: [14000, 26000],
    run(k) {
      const ltr = Math.random() < 0.5;
      bats(k, Array.from({ length: (Math.random() * 3 + 1) | 0 }, (_, i) => ({ x: ltr ? -40 - i * 50 : k.W + 40 + i * 50, y: R(70, k.H * 0.4), vx: (ltr ? 1 : -1) * R(220, 320), vy: R(-20, 20), s: R(1, 1.6) })), (k.W + 300) / 220);
    },
  },
};

// ───────── Crimson: webs ─────────

function webSplat(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  const spokes = 9;
  const pts = Array.from({ length: spokes }, (_, i) => rot + (i / spokes) * Math.PI * 2 + Math.sin(i * 7.3) * 0.12);
  c.beginPath();
  for (const a of pts) {
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  for (const f of [0.35, 0.62, 0.9]) {
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % spokes];
      const ax = x + Math.cos(a) * r * f, ay = y + Math.sin(a) * r * f;
      const bx = x + Math.cos(b) * r * f, by = y + Math.sin(b) * r * f;
      const mx = x + Math.cos((a + b) / 2 + (i === spokes - 1 ? Math.PI : 0)) * r * f * 0.82;
      const my = y + Math.sin((a + b) / 2 + (i === spokes - 1 ? Math.PI : 0)) * r * f * 0.82;
      c.moveTo(ax, ay);
      c.quadraticCurveTo(mx, my, bx, by);
    });
  }
  c.stroke();
}

function shootWeb(k: Ctx, x: number, y: number, delay = 0, big = false) {
  const fromLeft = x > k.W / 2 ? Math.random() < 0.25 : Math.random() < 0.75;
  const ax = fromLeft ? R(-20, k.W * 0.15) : R(k.W * 0.85, k.W + 20), ay = -20;
  const shot = 0.16, hold = 1.1, fade = 0.6, r = big ? R(44, 60) : R(22, 30), rot = R(0, 6);
  let t = -delay;
  k.add({
    step: (dt) => (t += dt) < shot + hold + fade,
    draw(c) {
      if (t < 0) return;
      const p = Math.min(1, t / shot);
      const a = t > shot + hold ? 1 - (t - shot - hold) / fade : 1;
      const ex = ax + (x - ax) * p, ey = ay + (y - ay) * p;
      c.globalAlpha = a * 0.9;
      c.strokeStyle = "#f3f1f5";
      c.lineWidth = 1.6;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(ax, ay);
      // a slight sag once it lands
      const sag = p >= 1 ? Math.min(1, (t - shot) / 0.25) * 30 : 0;
      c.quadraticCurveTo((ax + ex) / 2, (ay + ey) / 2 + sag, ex, ey);
      c.stroke();
      if (p >= 1) {
        const pop = ease(Math.min(1, (t - shot) / 0.14));
        c.lineWidth = 1.1;
        webSplat(c, x, y, r * pop, rot);
      }
      c.globalAlpha = 1;
    },
  });
}

const crimson: Kit = {
  intro(k) {
    const spots: [number, number][] = [[0.22, 0.32], [0.78, 0.28], [0.36, 0.7], [0.66, 0.66], [0.5, 0.46]];
    spots.forEach(([fx, fy], i) => shootWeb(k, fx * k.W + R(-40, 40), fy * k.H + R(-30, 30), i * 0.12, true));
  },
  click(k, x, y) {
    shootWeb(k, x, y);
  },
};

// ───────── Storm: lightning ─────────

function boltPath(x0: number, y0: number, x1: number, y1: number, rough: number): [number, number][] {
  let pts: [number, number][] = [[x0, y0], [x1, y1]];
  let off = Math.hypot(x1 - x0, y1 - y0) * rough;
  for (let d = 0; d < 7; d++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const nx = -(by - ay), ny = bx - ax, l = Math.hypot(nx, ny) || 1;
      const o = R(-off, off);
      next.push([(ax + bx) / 2 + (nx / l) * o, (ay + by) / 2 + (ny / l) * o], pts[i + 1]);
    }
    pts = next;
    off /= 2;
  }
  return pts;
}

function bolt(k: Ctx, x: number, y: number, o: { width?: number; alpha?: number; flashPeak?: number; branches?: number } = {}) {
  const main = boltPath(x + R(-140, 140), -20, x, y, 0.16);
  const branches = Array.from({ length: o.branches ?? 3 }, () => {
    const i = ((main.length * R(0.2, 0.75)) | 0);
    const [bx, by] = main[i];
    const len = R(60, 180), a = Math.atan2(y - by, x - bx) + R(-0.9, 0.9);
    return boltPath(bx, by, bx + Math.cos(a) * len, by + Math.sin(a) * len, 0.22);
  });
  const life = 0.5;
  let t = 0;
  const strokeAll = (c: CanvasRenderingContext2D, w: number) => {
    for (const [pts, ww] of [[main, w], ...branches.map((b) => [b, w * 0.45] as const)] as const) {
      c.lineWidth = ww;
      c.beginPath();
      pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      c.stroke();
    }
  };
  if (o.flashPeak) flash(k, "#cfe8ff", o.flashPeak, 0.45);
  if ((o.width ?? 2.4) > 1.5) sparks(k, x, y, 14, ["#e8f6ff", "#8fd3ff"], { speed: 240, up: 60, life: [0.25, 0.6], size: [0.8, 1.8] });
  k.add({
    step: (dt) => (t += dt) < life,
    draw(c) {
      const p = t / life;
      const f = (p < 0.12 ? 1 : p < 0.22 ? 0.3 : p < 0.36 ? 0.95 : 1 - (p - 0.36) / 0.64) * (o.alpha ?? 1);
      c.globalAlpha = Math.max(0, f);
      c.lineJoin = "round";
      c.lineCap = "round";
      c.shadowColor = "#8fd3ff";
      c.shadowBlur = 22;
      c.strokeStyle = "rgba(143,211,255,0.9)";
      strokeAll(c, (o.width ?? 2.4) * 2.2);
      c.shadowBlur = 0;
      c.strokeStyle = "#ffffff";
      strokeAll(c, o.width ?? 2.4);
      c.globalAlpha = 1;
    },
  });
}

const storm: Kit = {
  intro(k) {
    bolt(k, k.W * R(0.4, 0.6), k.H * 0.72, { width: 3.4, flashPeak: 0.22, branches: 5 });
    setTimeout(() => bolt(k, k.W * R(0.15, 0.3), k.H * 0.5, { width: 2, alpha: 0.8, branches: 2 }), 260);
  },
  click(k, x, y) {
    bolt(k, x, y, { width: 2.2, flashPeak: 0.07, branches: 2 });
  },
  ambient: {
    every: [9000, 20000],
    run(k) {
      bolt(k, R(k.W * 0.05, k.W * 0.95), R(k.H * 0.2, k.H * 0.45), { width: 1.2, alpha: 0.45, flashPeak: 0.05, branches: 2 });
    },
  },
};

// ───────── Ember: meteors and impacts ─────────

function cracks(k: Ctx, x: number, y: number, size: number) {
  const lines = Array.from({ length: 7 }, () => {
    let a = R(0, Math.PI * 2), px = x, py = y;
    const pts: [number, number][] = [[px, py]];
    const n = 6, len = size * R(0.5, 1);
    for (let i = 0; i < n; i++) {
      a += R(-0.5, 0.5);
      px += Math.cos(a) * (len / n);
      py += Math.sin(a) * (len / n);
      pts.push([px, py]);
    }
    return pts;
  });
  const life = 1.4;
  let t = 0;
  k.add({
    step: (dt) => (t += dt) < life,
    draw(c) {
      const grow = ease(Math.min(1, t / 0.18)), a = 1 - t / life;
      c.globalAlpha = a;
      c.strokeStyle = "#ffb547";
      c.shadowColor = "#ff6a2b";
      c.shadowBlur = 12;
      c.lineWidth = 2;
      c.lineCap = "round";
      for (const pts of lines) {
        const m = Math.max(1, Math.round((pts.length - 1) * grow));
        c.beginPath();
        for (let i = 0; i <= m; i++) (i ? c.lineTo : c.moveTo).call(c, pts[i][0], pts[i][1]);
        c.stroke();
      }
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    },
  });
}

function impact(k: Ctx, x: number, y: number, big: boolean) {
  ring(k, x, y, big ? 320 : 120, "#ff6a2b", big ? 0.9 : 0.6, big ? 5 : 3);
  if (big) ring(k, x, y, 200, "#ffb547", 0.7, 3);
  sparks(k, x, y, big ? 60 : 18, ["#ffb547", "#ff6a2b", "#ffd28a"], { speed: big ? 520 : 260, up: big ? 260 : 140, size: [1.2, big ? 3.4 : 2.4] });
  cracks(k, x, y, big ? 150 : 60);
  if (big) flash(k, "#ff8a3d", 0.12, 0.4);
}

function meteor(k: Ctx, x: number, y: number, o: { big?: boolean; hit?: boolean; faint?: boolean; done?: () => void }) {
  const sx = x + k.H * 0.75, sy = -60, dur = o.big ? 0.65 : 0.9;
  let t = 0, hit = false;
  k.add({
    step(dt) {
      t += dt;
      if (t >= dur && !hit) {
        hit = true;
        if (o.hit) impact(k, x, y, !!o.big);
        o.done?.();
      }
      return t < dur;
    },
    draw(c) {
      const p = Math.min(1, t / dur);
      const hx = sx + (x - sx) * p, hy = sy + (y - sy) * p;
      const tx = hx + (sx - x) * 0.22, ty = hy + (sy - y) * 0.22;
      const g = c.createLinearGradient(hx, hy, tx, ty);
      g.addColorStop(0, o.faint ? "rgba(255,181,71,0.55)" : "rgba(255,214,150,1)");
      g.addColorStop(0.3, o.faint ? "rgba(255,106,43,0.3)" : "rgba(255,106,43,0.7)");
      g.addColorStop(1, "rgba(255,106,43,0)");
      c.strokeStyle = g;
      c.lineCap = "round";
      c.lineWidth = o.big ? 9 : o.faint ? 2.5 : 5;
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo(tx, ty);
      c.stroke();
      c.fillStyle = o.faint ? "rgba(255,214,150,0.6)" : "#fff1d6";
      c.shadowColor = "#ff6a2b";
      c.shadowBlur = o.faint ? 8 : 24;
      c.beginPath();
      c.arc(hx, hy, o.big ? 6 : o.faint ? 2 : 3.5, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    },
  });
}

const ember: Kit = {
  intro(k) {
    meteor(k, k.W * 0.5, k.H * 0.62, { big: true, hit: true });
  },
  click(k, x, y) {
    impact(k, x, y, false);
  },
  ambient: {
    every: [12000, 24000],
    run(k) {
      meteor(k, R(-k.W * 0.1, k.W * 0.6), k.H + 80, { faint: true });
    },
  },
};

// ───────── Speedway: a race car ─────────

function car(c: CanvasRenderingContext2D, x: number, y: number, s: number, spin: number) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  // speed lines
  c.strokeStyle = "rgba(212,42,28,0.45)";
  c.lineWidth = 2;
  c.lineCap = "round";
  for (const [ly, l] of [[-22, 70], [-12, 110], [-4, 60]] as const) {
    c.beginPath();
    c.moveTo(-70 - l, ly);
    c.lineTo(-74, ly);
    c.stroke();
  }
  // body: low wedge with a cockpit bubble and rear wing (original design)
  c.fillStyle = "#d42a1c";
  c.beginPath();
  c.moveTo(-62, -6);
  c.lineTo(-60, -22);
  c.lineTo(-30, -26);
  c.quadraticCurveTo(-12, -42, 14, -36);
  c.quadraticCurveTo(30, -32, 40, -24);
  c.lineTo(66, -16);
  c.quadraticCurveTo(72, -12, 70, -4);
  c.lineTo(-62, -4);
  c.closePath();
  c.fill();
  // rear wing
  c.fillRect(-70, -34, 18, 4);
  c.fillRect(-62, -31, 4, 9);
  // window
  c.fillStyle = "#1b2a3a";
  c.beginPath();
  c.moveTo(-18, -28);
  c.quadraticCurveTo(-6, -38, 12, -34);
  c.quadraticCurveTo(24, -31, 30, -26);
  c.closePath();
  c.fill();
  // stripe + number disc
  c.fillStyle = "#ffffff";
  c.fillRect(-56, -15, 112, 2.4);
  c.beginPath();
  c.arc(-26, -14, 6.5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#231a13";
  c.font = "700 8px 'Russo One', sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("7", -26, -13.6);
  // wheels
  for (const wx of [-38, 44]) {
    c.fillStyle = "#1a1410";
    c.beginPath();
    c.arc(wx, -2, 11, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#c9c2b8";
    c.lineWidth = 1.6;
    c.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * Math.PI * 2) / 3;
      c.moveTo(wx, -2);
      c.lineTo(wx + Math.cos(a) * 6, -2 + Math.sin(a) * 6);
    }
    c.stroke();
  }
  c.restore();
}

function puffs(k: Ctx, x: number, y: number, n: number, spread = 1) {
  const ps = Array.from({ length: n }, () => ({ x: x + R(-10, 10), y: y + R(-6, 6), vx: R(-60, 60) * spread, vy: R(-50, -10), r: R(5, 10), life: R(0.6, 1.1), t: 0 }));
  k.add({
    step(dt) {
      let alive = false;
      for (const p of ps) {
        p.t += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += 22 * dt;
        if (p.t < p.life) alive = true;
      }
      return alive;
    },
    draw(c) {
      for (const p of ps) {
        const a = 1 - p.t / p.life;
        if (a <= 0) continue;
        c.globalAlpha = a * 0.35;
        c.fillStyle = "#b9a58c";
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    },
  });
}

function driveBy(k: Ctx, s: number, dur: number) {
  const y = k.H - 26 * s;
  let t = 0, lastPuff = 0;
  k.add({
    step(dt) {
      t += dt;
      if (t - lastPuff > 0.08) {
        lastPuff = t;
        const x = -120 * s + (k.W + 240 * s) * ease(t / dur);
        puffs(k, x - 66 * s, y, 1);
      }
      return t < dur;
    },
    draw(c) {
      const p = t / dur, x = -120 * s + (k.W + 240 * s) * ease(p);
      car(c, x, y, s, t * 40);
    },
  });
}

function checkers(k: Ctx) {
  const sz = 18, cols = Math.ceil(k.W / sz) + 2, life = 1.2;
  let t = 0;
  k.add({
    step: (dt) => (t += dt) < life,
    draw(c) {
      const p = t / life;
      c.globalAlpha = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
      for (let row = 0; row < 2; row++)
        for (let i = 0; i < cols; i++) {
          if ((i + row) % 2) continue;
          const wave = Math.sin(i * 0.35 - t * 9) * 6;
          c.fillStyle = "#231a13";
          c.fillRect(i * sz - (t * 260) % (sz * 2), 70 + row * sz + wave, sz, sz);
        }
      c.globalAlpha = 1;
    },
  });
}

const speedway: Kit = {
  intro(k) {
    checkers(k);
    driveBy(k, 1.5, 1.6);
  },
  click(k, x, y) {
    puffs(k, x, y, 9, 2.2);
    ring(k, x, y, 46, "rgba(212,42,28,0.7)", 0.45, 2);
  },
  ambient: {
    every: [22000, 40000],
    run(k) {
      driveBy(k, 0.9, 2.2);
    },
  },
};

// ───────── Paper: ink drops ─────────

const paper: Kit = {
  click(k, x, y) {
    ring(k, x, y, 34, "rgba(30,27,22,0.35)", 0.6, 1.5);
    setTimeout(() => ring(k, x, y, 20, "rgba(0,131,163,0.4)", 0.5, 1.2), 90);
  },
};

const KITS: Record<ThemeId, Kit> = { paper, night, crimson, storm, ember, speedway };

// ───────── the canvas ─────────

export function ThemeFX() {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useTheme((t) => t.id);
  const on = useFx((s) => s.on);
  const view = useLucid((s) => s.view);
  const kitRef = useRef<Kit>(KITS[theme]);
  const ctxRef = useRef<Ctx | null>(null);
  const first = useRef(true);

  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const active = on && !reduce && view !== "study";

  // engine
  useEffect(() => {
    if (!active) return;
    const cv = ref.current!;
    const c = cv.getContext("2d")!;
    const fx: Fx[] = [];
    let raf = 0, last = 0;
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      k.W = innerWidth;
      k.H = innerHeight;
    };
    const frame = (now: number) => {
      // rAF timestamps can be a touch earlier than performance.now(), so never step backwards
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = Math.max(last, now);
      c.clearRect(0, 0, k.W, k.H);
      for (let i = fx.length - 1; i >= 0; i--) {
        let alive = false;
        try {
          alive = fx[i].step(dt);
        } catch {
          /* drop a broken effect rather than the loop */
        }
        if (!alive) fx.splice(i, 1);
      }
      for (const f of fx) {
        c.save();
        try {
          f.draw(c);
        } catch {
          /* ignore */
        }
        c.restore();
      }
      raf = fx.length ? requestAnimationFrame(frame) : 0;
      if (!raf) c.clearRect(0, 0, k.W, k.H);
    };
    const k: Ctx = {
      W: innerWidth,
      H: innerHeight,
      add(f) {
        fx.push(f);
        if (!raf) {
          last = performance.now();
          raf = requestAnimationFrame(frame);
        }
      },
    };
    size();
    ctxRef.current = k;
    addEventListener("resize", size);

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || document.hidden) return;
      const el = e.target as Element | null;
      if (el?.closest("input, textarea, select, [role=menu], [data-nofx]")) return;
      kitRef.current.click?.(k, e.clientX, e.clientY);
    };
    addEventListener("pointerdown", onDown);

    // ambient events
    let timer = 0;
    const schedule = () => {
      const a = kitRef.current.ambient;
      if (!a) {
        timer = window.setTimeout(schedule, 5000);
        return;
      }
      timer = window.setTimeout(() => {
        if (!document.hidden) kitRef.current.ambient?.run(k);
        schedule();
      }, R(...a.every));
    };
    schedule();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      removeEventListener("resize", size);
      removeEventListener("pointerdown", onDown);
      ctxRef.current = null;
      c.clearRect(0, 0, cv.width, cv.height);
    };
  }, [active]);

  // intro when the theme changes (and once on the home page at load)
  useEffect(() => {
    kitRef.current = KITS[theme];
    const isFirst = first.current;
    first.current = false;
    if (!active || (isFirst && view !== "home")) return;
    const id = setTimeout(() => ctxRef.current && KITS[theme].intro?.(ctxRef.current), isFirst ? 600 : 280);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, active]);

  if (!active) return null;
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[55] h-full w-full" />;
}
