import { useEffect, useRef } from "react";
import uPlot from "uplot";
import { AXIS, INK, useTheme } from "../theme";
import "uplot/dist/uPlot.min.css";
import { useClock } from "./clock";
import { EVENT_META, type ReplayEvent } from "./events";
import { fmtTime, type Replayable } from "./signals";

const MAX_POINTS = 3000;

/** Bucket-average to at most MAX_POINTS so hour-long sessions stay smooth. */
function downsample(r: Replayable): uPlot.AlignedData {
  const n = r.t.length, step = Math.max(1, Math.ceil(n / MAX_POINTS));
  const out: (number | null)[][] = [[], [], [], []];
  const src = [r.attention, r.engagement, r.load];
  for (let i = 0; i < n; i += step) {
    const e = Math.min(n, i + step);
    out[0].push(r.t[i]);
    src.forEach((a, k) => {
      let s = 0, c = 0;
      for (let j = i; j < e; j++) if (!Number.isNaN(a[j])) { s += a[j]; c++; }
      out[k + 1].push(c ? s / c : null);
    });
  }
  return out as uPlot.AlignedData;
}

export function ReplayTimeline({ r, events }: { r: Replayable; events: ReplayEvent[] }) {
  const host = useRef<HTMLDivElement>(null);

  const theme = useTheme((t) => t.id);
  useEffect(() => {
    const el = host.current!;
    const H = 230;
    const axis = { ...AXIS };
    const line = (c: string, dash?: number[]) => ({ stroke: c, width: 1.5, points: { show: false }, dash, spanGaps: false });

    const drawBands = (u: uPlot) => {
      const ctx = u.ctx, { top, height } = u.bbox, dpr = devicePixelRatio;
      ctx.save();
      for (const s of r.segments) {
        const x0 = u.valToPos(s.start, "x", true), x1 = u.valToPos(s.end, "x", true);
        ctx.fillStyle = s.tone + "14";
        ctx.fillRect(x0, top, x1 - x0, height);
      }
      // event lane: thin bars at the top + faint full-height wash
      for (const e of events) {
        const x0 = u.valToPos(e.start, "x", true), x1 = Math.max(x0 + 2 * dpr, u.valToPos(e.end, "x", true));
        const c = EVENT_META[e.type].color;
        ctx.fillStyle = c + "10";
        ctx.fillRect(x0, top, x1 - x0, height);
        ctx.fillStyle = c;
        ctx.fillRect(x0, top + 2 * dpr, x1 - x0, 5 * dpr);
      }
      ctx.restore();
    };

    const plot = new uPlot(
      {
        width: el.clientWidth, height: H, pxAlign: false, legend: { show: false },
        cursor: { y: false, points: { show: false }, drag: { x: false, y: false }, x: true },
        scales: { x: { time: false }, y: { range: [0, 1] } },
        axes: [
          { ...axis, values: (_u, v) => v.map((s) => fmtTime(s)) },
          { ...axis, size: 34, splits: () => [0, 0.25, 0.5, 0.75, 1], values: (_u, v) => v.map((x) => String(Math.round(x * 100))) },
        ],
        series: [{}, line(INK.att), line(INK.eng), line(INK.load, r.loadSource === "model" ? undefined : [4, 3])],
        hooks: { drawClear: [drawBands] },
      },
      downsample(r),
      el,
    );

    // playhead + click/drag to seek
    const head = document.createElement("div");
    head.className = "pointer-events-none absolute top-0 h-full w-[1.5px] bg-fg";
    head.style.boxShadow = "none";
    const knob = document.createElement("div");
    knob.className = "absolute -left-[4px] -top-[1px] h-[9px] w-[9px] rounded-full bg-fg";
    head.appendChild(knob);
    plot.over.appendChild(head);
    plot.over.style.cursor = "pointer";
    // segment labels (study blocks) as HTML so they match the UI typography
    const labels = r.segments.map((s) => {
      const d = document.createElement("div");
      d.className = "pointer-events-none absolute bottom-[4px] rounded-full border px-2 py-px text-[11px] font-medium leading-tight";
      d.style.color = s.tone;
      d.style.background = "var(--color-panel)";
      d.style.borderColor = s.tone + "55";
      d.textContent = s.label;
      plot.over.appendChild(d);
      return { d, s };
    });
    const placeLabels = () => labels.forEach(({ d, s }) => (d.style.left = `${plot.valToPos(s.start, "x") + 4}px`));
    placeLabels();
    const place = (t: number) => (head.style.left = `${plot.valToPos(t, "x")}px`);
    place(useClock.getState().time);
    const unsub = useClock.subscribe((s) => place(s.time));

    const seek = (e: PointerEvent) => {
      const t = plot.posToVal(e.offsetX, "x");
      useClock.getState().set({ time: Math.max(0, Math.min(r.duration, t)) });
    };
    const down = (e: PointerEvent) => {
      plot.over.setPointerCapture(e.pointerId);
      seek(e);
    };
    const move = (e: PointerEvent) => e.buttons && seek(e);
    plot.over.addEventListener("pointerdown", down);
    plot.over.addEventListener("pointermove", move);

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: el.clientWidth, height: H });
      place(useClock.getState().time);
      placeLabels();
    });
    ro.observe(el);
    return () => {
      unsub();
      ro.disconnect();
      plot.destroy();
    };
  }, [r, events, theme]);

  return (
    <div className="panel px-4 pb-2 pt-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="label">Timeline <span className="font-normal text-faint">— click or drag to move through the session</span></span>
        <div className="flex gap-4">
          {[["Attention", INK.att, false], ["Engagement", INK.eng, false], [r.loadSource === "model" ? "Load (learned)" : "Load (heuristic)", INK.load, r.loadSource !== "model"]].map(([l, c, dash]) => (
            <span key={l as string} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-[3px] w-3 rounded-full" style={{ background: dash ? `repeating-linear-gradient(90deg, ${c} 0 3px, transparent 3px 5px)` : (c as string) }} />
              {l}
            </span>
          ))}
        </div>
      </div>
      <div ref={host} className="relative w-full" />
    </div>
  );
}
