import { useEffect, useRef } from "react";
import uPlot from "uplot";
import { AXIS, INK, useTheme } from "../theme";
import "uplot/dist/uPlot.min.css";
import { series, WINDOW_S } from "../engine/series";


export function Timeline() {
  const host = useRef<HTMLDivElement>(null);
  const theme = useTheme((t) => t.id);

  useEffect(() => {
    const el = host.current!;
    const axis = {
      stroke: AXIS.stroke,
      grid: AXIS.grid,
      ticks: AXIS.ticks,
      font: AXIS.font,
    };
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: 180,
      pxAlign: false,
      cursor: { show: false },
      legend: { show: false },
      scales: {
        x: {
          time: false,
          range: (_u, _min, max) => [Math.max(0, max - WINDOW_S), Math.max(WINDOW_S, max)],
        },
        y: { range: [0, 1] },
      },
      axes: [
        { ...axis, values: (_u, v) => v.map((s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`) },
        { ...axis, size: 34, splits: () => [0, 0.25, 0.5, 0.75, 1], values: (_u, v) => v.map((x) => String(Math.round(x * 100))) },
      ],
      series: [
        {},
        { stroke: INK.att, width: 1.6, points: { show: false } },
        { stroke: INK.eng, width: 1.6, points: { show: false } },
        { stroke: INK.load, width: 1.6, points: { show: false } },
      ],
    };
    const plot = new uPlot(opts, series.snapshot(), el);

    let raf = 0, seen = -1, last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (series.version === seen || now - last < 33) return; // ≤30 Hz redraw
      seen = series.version;
      last = now;
      plot.setData(series.snapshot());
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: 180 }));
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      plot.destroy();
    };
  }, [theme]);

  return (
    <div className="panel px-4 pb-2 pt-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Last 60 seconds</span>
        <div className="flex gap-4">
          {[["Attention", INK.att], ["Engagement", INK.eng], ["Load", INK.load]].map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-[3px] w-3 rounded-full" style={{ background: c }} />
              {l}
            </span>
          ))}
        </div>
      </div>
      <div ref={host} className="w-full" />
    </div>
  );
}
