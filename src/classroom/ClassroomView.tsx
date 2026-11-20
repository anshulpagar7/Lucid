import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { AXIS, INK, useTheme } from "../theme";
import { download } from "../study/export";
import { fmtTime } from "../replay/signals";
import { classroom } from "./controller";
import { STATE_META, type StudentState } from "./score";
import { useClass } from "./store";
import type { Track } from "./tracker";
import type { SourceKind } from "./types";

const STATES: Exclude<StudentState, "absent">[] = ["focused", "drifting", "down", "away", "closed"];

export function ClassroomView() {
  const status = useClass((s) => s.status);
  const running = status === "running" || status === "starting";
  return (
    <>
      <section className="flex min-w-0 flex-col gap-4 lg:col-span-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[34px] leading-tight tracking-[-0.02em]">Classroom</h1>
            <p className="text-[13px] text-muted">Many students at once · anonymous IDs · nothing stored but numbers.</p>
          </div>
          {running && <SourceBar />}
        </div>
        <Stage />
        <ClassTimeline />
      </section>
      <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4 lg:pt-[60px]">
        <ClassGauge />
        <Moments />
        <Privacy />
      </aside>
      <section className="lg:col-span-12">
        <Students />
      </section>
    </>
  );
}

// ───────── source selection ─────────

function useStart() {
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (k: SourceKind) => (k === "file" ? fileRef.current?.click() : void classroom.start(k));
  const input = (
    <input ref={fileRef} type="file" accept="video/*" className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void classroom.start("file", f);
        e.target.value = "";
      }} />
  );
  return { pick, input };
}

const SOURCES: { k: SourceKind; label: string; sub: string; icon: string }[] = [
  { k: "screen", label: "Share a screen", sub: "Online class gallery (Meet / Zoom / Teams)", icon: "M3 5h18v11H3zM8 20h8M12 16v4" },
  { k: "file", label: "Video file", sub: "A recorded classroom clip", icon: "M4 5h16v14H4zM10 9l5 3-5 3z" },
  { k: "camera", label: "Webcam", sub: "A small group facing the camera", icon: "M15 10l5-3v10l-5-3M3 7h12v10H3z" },
];

function SourceBar() {
  const { pick, input } = useStart();
  const { source, sourceLabel, maxFaces, status, fps, inferMs, delegate, startedAt } = useClass();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {input}
      <span className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px]">
        <span className={`h-1.5 w-1.5 rounded-full ${status === "running" ? "pulse-dot bg-bad" : "bg-load"}`} />
        <span className="max-w-[160px] truncate">{sourceLabel || source}</span>
        <span className="num text-faint">{status === "running" ? `${fps} fps · ${inferMs.toFixed(0)} ms · ${delegate}` : "starting…"}</span>
        <Elapsed since={startedAt} />
      </span>
      <select value={maxFaces} onChange={(e) => classroom.setMaxFaces(Number(e.target.value))}
        className="h-[34px] rounded-[9px] border border-line-2 bg-panel-2 px-2 text-[12.5px] text-fg outline-none" title="Maximum faces analysed per frame">
        {[4, 8, 12, 16].map((n) => <option key={n} value={n}>up to {n} faces</option>)}
      </select>
      <button className="btn" onClick={() => pick(source === "file" ? "file" : source ?? "screen")}>Switch</button>
      <button className="btn" onClick={() => classroom.stop()}><span className="h-2 w-2 rounded-[2px] bg-bad" /> Stop</button>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const id = setInterval(() => ref.current && (ref.current.textContent = fmtTime((Date.now() - since) / 1000)), 500);
    return () => clearInterval(id);
  }, [since]);
  return <span ref={ref} className="num text-muted" />;
}

// ───────── stage ─────────

function Stage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { status, stage, error } = useClass();
  const { pick, input } = useStart();
  const live = status === "running" || status === "starting";

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = INK.screen;
      ctx.fillRect(0, 0, W, H);
      const st = useClass.getState();
      if (st.status !== "running") return;

      // contain-fit the source
      const v = classroom.video;
      const vw = v?.videoWidth || 1920, vh = v?.videoHeight || 1080;
      const s = Math.min(W / vw, H / vh);
      const dw = vw * s, dh = vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
      if (v && v.readyState >= 2) ctx.drawImage(v, ox, oy, dw, dh);
      else {
        ctx.strokeStyle = "#2a2620";
        for (let x = ox; x <= ox + dw; x += dw / 12) { ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + dh); ctx.stroke(); }
        for (let y = oy; y <= oy + dh; y += dh / 6.75) { ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + dw, y); ctx.stroke(); }
      }
      const X = (x: number) => ox + x * dw, Y = (y: number) => oy + y * dh;

      for (const tr of classroom.tracks) {
        if (!tr.obs) continue;
        const [bx, by, bw, bh] = tr.box;
        const pad = 0.15;
        const x = X(bx - bw * pad), y = Y(by - bh * pad), w = bw * (1 + 2 * pad) * dw, h = bh * (1 + 2 * pad) * dh;
        if (st.blurFaces && v && v.readyState >= 2) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, 10);
          ctx.clip();
          ctx.filter = "blur(14px)";
          ctx.drawImage(v, ox, oy, dw, dh);
          ctx.restore();
        }
        const color = STATE_META[tr.state].color;
        if (!st.showIndividuals) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x + w / 2, y - 6, 4, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 10);
        ctx.stroke();
        // head-direction ray
        const cx = X(tr.obs.center[0]), cy = Y(tr.obs.center[1]), nx = X(tr.obs.nose[0]), ny = Y(tr.obs.nose[1]);
        const g = ctx.createLinearGradient(nx, ny, nx + (nx - cx) * 4, ny + (ny - cy) * 4);
        g.addColorStop(0, color);
        g.addColorStop(1, "transparent");
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + (nx - cx) * 4, ny + (ny - cy) * 4);
        ctx.stroke();
        // label chip
        const label = `S${tr.id} · ${Math.round(tr.attention * 100)}`;
        ctx.font = "500 12px IBM Plex Sans, system-ui, sans-serif";
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = "rgba(25,23,20,0.82)";
        ctx.beginPath();
        ctx.roundRect(x, y - 20, tw, 17, 5);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.fillText(label, x + 6, y - 7.5);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="panel overflow-hidden">
      {input}
      <div className="relative aspect-video w-full">
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-panel-2 p-6">
            {status === "error" && <p className="max-w-md text-center text-[13px] text-bad">{error}</p>}
            <div className="text-center">
              <h2 className="text-xl font-medium tracking-tight">Choose a classroom source</h2>
              <p className="mt-1 text-[13px] text-muted">Analysed in this browser. No video or faces leave the device or get saved.</p>
            </div>
            <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
              {SOURCES.map((s) => (
                <button key={s.k} onClick={() => pick(s.k)}
                  className="group flex flex-col items-start rounded-xl border border-line-2 bg-panel p-4 text-left transition-colors hover:border-fg/40 hover:bg-white">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="text-muted group-hover:text-fg">
                    <path d={s.icon} />
                  </svg>
                  <div className="mt-3 text-[13.5px] font-medium">{s.label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-faint">{s.sub}</div>
                </button>
              ))}
            </div>
            <p className="max-w-lg text-center text-[11px] leading-relaxed text-faint">
              Works best for up to ~16 faces at 1–3 m or an online gallery view. In large lecture halls back-row faces are too small for the
              on-device face detector.
            </p>
          </div>
        )}
        {status === "starting" && <div className="absolute inset-0 flex items-center justify-center"><span className="label">{stage || "Starting"}…</span></div>}
      </div>
    </div>
  );
}

// ───────── class gauge ─────────

function ClassGauge() {
  const snap = useClass((s) => s.snapshot);
  const tracks = useClass((s) => s.tracks);
  const att = snap && Number.isFinite(snap.attention) ? snap.attention : 0;
  const R = 52, C = 2 * Math.PI * R, arc = 0.75;
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Class right now</span>
        <span className="num text-[11px] text-muted">{snap?.n ?? 0} in view, {tracks.length} tracked</span>
      </div>
      <div className="flex items-center gap-5">
        <div className="relative shrink-0">
          <svg width="132" height="132" viewBox="0 0 132 132" className="rotate-[135deg]">
            <circle cx="66" cy="66" r={R} fill="none" stroke="var(--color-line)" strokeWidth="8" strokeDasharray={`${C * arc} ${C}`} strokeLinecap="round" />
            <circle cx="66" cy="66" r={R} fill="none" stroke="var(--color-att)" strokeWidth="8" strokeLinecap="round" opacity={snap?.n ? 1 : 0}
              strokeDasharray={`${C * arc * att} ${C}`} style={{ transition: "stroke-dasharray .4s" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="num font-serif text-[38px] font-medium leading-none">{snap?.n ? Math.round(att * 100) : "—"}</span>
            <span className="mt-1 text-[11.5px] text-muted">class attention</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {STATES.map((k) => {
            const v = snap?.shares[k] ?? 0;
            return (
              <div key={k} className="grid grid-cols-[96px_1fr_34px] items-center gap-2">
                <span className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATE_META[k].color }} />
                  {STATE_META[k].label}
                </span>
                <div className="h-1.5 rounded-full bg-line">
                  <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${v * 100}%`, background: STATE_META[k].color }} />
                </div>
                <span className="num text-right text-[11px]">{snap?.n ? `${Math.round(v * 100)}%` : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────── class timeline ─────────

function ClassTimeline() {
  const host = useRef<HTMLDivElement>(null);
  const theme = useTheme((t) => t.id);
  useEffect(() => {
    const el = host.current!;
    const axis = { ...AXIS };
    const data = (): uPlot.AlignedData => {
      const tl = classroom.timeline;
      return [tl.map((p) => p.t), tl.map((p) => (p.n ? p.attention : null)), tl.map((p) => (p.n ? p.focused : null))];
    };
    const plot = new uPlot({
      width: el.clientWidth, height: 170, pxAlign: false, legend: { show: false }, cursor: { show: false },
      scales: { x: { time: false, range: (_u, a, b) => [a, Math.max(b, a + 60)] }, y: { range: [0, 1] } },
      axes: [
        { ...axis, values: (_u, v) => v.map((s) => fmtTime(s)) },
        { ...axis, size: 34, splits: () => [0, 0.5, 1], values: (_u, v) => v.map((x) => String(Math.round(x * 100))) },
      ],
      series: [
        {},
        { stroke: INK.att, width: 1.6, points: { show: false } },
        { stroke: INK.ok, width: 1.4, points: { show: false }, dash: [4, 3] },
      ],
    }, data(), el);
    let seen = -1;
    const id = setInterval(() => {
      if (classroom.timelineVersion !== seen) {
        seen = classroom.timelineVersion;
        plot.setData(data());
      }
    }, 500);
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: 170 }));
    ro.observe(el);
    return () => {
      clearInterval(id);
      ro.disconnect();
      plot.destroy();
    };
  }, [theme]);
  return (
    <div className="panel px-4 pb-2 pt-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="label">Class timeline</span>
        <div className="flex gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-[3px] w-3 rounded-full bg-att" />Class attention</span>
          <span className="flex items-center gap-1.5"><span className="h-[3px] w-3 rounded-full" style={{ background: "repeating-linear-gradient(90deg,var(--color-ok) 0 3px,transparent 3px 5px)" }} />Share focused</span>
        </div>
      </div>
      <div ref={host} className="w-full" />
    </div>
  );
}

// ───────── moments ─────────

function Moments() {
  const moments = useClass((s) => s.moments);
  return (
    <div className="panel p-4">
      <div className="label mb-3">Class moments ({moments.length})</div>
      {moments.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-faint">Class-wide dips, heads-down and look-away periods appear here.</p>
      ) : (
        <div className="max-h-[220px] space-y-1 overflow-y-auto">
          {moments.map((m) => (
            <div key={m.label + m.start} className="flex items-start gap-2.5 rounded-md px-1 py-1.5">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
              <span className="num w-[40px] shrink-0 pt-px text-[11px] text-muted">{fmtTime(m.start)}</span>
              <span className="min-w-0">
                <span className="block text-[12.5px]">{m.label}</span>
                <span className="block text-[10.5px] text-faint">{m.detail}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── privacy + export ─────────

function Privacy() {
  const { showIndividuals, blurFaces, set, tracks } = useClass();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const timelineCsv = () =>
    ["t_s,students_in_view,class_attention,share_focused,share_looking_down,share_looking_away",
      ...classroom.timeline.map((p) => [p.t, p.n, p.n ? p.attention.toFixed(3) : "", p.focused.toFixed(3), p.down.toFixed(3), p.away.toFixed(3)].join(","))].join("\n");
  const studentsCsv = () =>
    ["student,seconds_in_view,mean_attention,share_focused,share_looking_down,share_looking_away,share_eyes_closed",
      ...classroom.tracks.map((t) => {
        const s = t.stats, d = s.seen || 1;
        return [`S${t.id}`, (s.seen / 1000).toFixed(0), (s.attSum / d).toFixed(3), (s.focused / d).toFixed(3), (s.down / d).toFixed(3), (s.away / d).toFixed(3), (s.closed / d).toFixed(3)].join(",");
      })].join("\n");
  return (
    <div className="panel p-4">
      <div className="label mb-3">Privacy and export</div>
      <Toggle on={showIndividuals} onChange={(v) => set({ showIndividuals: v })} label="Show individual students" sub="Off = class-level only (recommended when projected)" />
      <Toggle on={blurFaces} onChange={(v) => set({ blurFaces: v })} label="Blur faces on screen" sub="Display only — analysis is unaffected" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn justify-center" disabled={!classroom.timeline.length} onClick={() => download(`lucid_class_timeline_${stamp}.csv`, timelineCsv())}>Timeline CSV</button>
        <button className="btn justify-center" disabled={!tracks.length} onClick={() => download(`lucid_class_students_${stamp}.csv`, studentsCsv())}>Students CSV</button>
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
        IDs are anonymous and reset every session — Lucid never recognises who anyone is. Indicators describe the class, not individual ability; don't use them for grading or discipline.
      </p>
    </div>
  );
}

function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub: string }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left hover:bg-panel-2/60">
      <span>
        <span className="block text-[12.5px]">{label}</span>
        <span className="block text-[10.5px] text-faint">{sub}</span>
      </span>
      <span role="switch" aria-checked={on} className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${on ? "border-fg bg-fg" : "border-line-2 bg-panel-2"}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${on ? "left-[18px] bg-panel" : "left-0.5 bg-faint"}`} />
      </span>
    </button>
  );
}

// ───────── student tiles ─────────

function Students() {
  const tracks = useClass((s) => s.tracks);
  const show = useClass((s) => s.showIndividuals);
  if (!tracks.length) return null;
  if (!show)
    return (
      <div className="panel flex items-center justify-between px-4 py-3 text-[12.5px] text-muted">
        <span>Individual view is off — showing class-level indicators only.</span>
        <span className="num text-faint">{tracks.length} anonymous students tracked</span>
      </div>
    );
  return (
    <div>
      <div className="label mb-2.5">Students ({tracks.length})</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {[...tracks].sort((a, b) => a.id - b.id).map((t) => <Tile key={t.id} t={t} />)}
      </div>
    </div>
  );
}

function Tile({ t }: { t: Track }) {
  const meta = STATE_META[t.state];
  const s = t.stats, focused = s.seen ? s.focused / s.seen : 0;
  const pts = t.history.slice(-90);
  const W = 140, H = 34;
  let d = "", pen = false;
  pts.forEach((v, i) => {
    if (Number.isNaN(v)) return void (pen = false);
    d += `${pen ? "L" : "M"}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)} ${(H - 2 - v * (H - 4)).toFixed(1)}`;
    pen = true;
  });
  return (
    <div className={`panel p-3 transition-opacity ${t.obs ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between">
        <span className="num text-[13px] font-medium">S{t.id}</span>
        <span className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10.5px]" style={{ color: meta.color, background: meta.color + "1a" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="num font-serif text-[28px] font-medium leading-none" style={{ color: t.obs ? "var(--color-fg)" : undefined }}>{t.obs ? Math.round(t.attention * 100) : "—"}</span>
        <span className="num text-[10px] text-faint">{Math.round(focused * 100)}% focused</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[34px] w-full" preserveAspectRatio="none">
        <line x1="0" x2={W} y1={H - 2 - 0.6 * (H - 4)} y2={H - 2 - 0.6 * (H - 4)} stroke="var(--color-line-2)" strokeDasharray="2 3" />
        <path d={d} fill="none" stroke="var(--color-att)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="num mt-1 text-[10px] text-faint">in view {fmtTime(s.seen / 1000)}</div>
    </div>
  );
}
