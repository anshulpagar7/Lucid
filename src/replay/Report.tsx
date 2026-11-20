import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { EVENT_META, RULES, type ReplayEvent } from "./events";
import { accuracyLabel, fmtAccuracy } from "./gaze";
import { accumulate, paint } from "./heatmap";
import { fmtTime, type Replayable } from "./signals";
import type { Summary } from "./stats";

const C = { att: "#0083a3", eng: "#5a45b0", load: "#b5730a", ink: "#1e1b16", muted: "#6a6155", faint: "#9c9282", line: "#e5ddcd" };

/** Print-ready session report (browser "Save as PDF"). Light theme so it prints well. */
export function Report({ r, events, summary: s, onClose }: { r: Replayable; events: ReplayEvent[]; summary: Summary; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.classList.add("printing-report");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("printing-report");
    };
  }, [onClose]);

  const heatUrl = useMemo(() => {
    if (!r.gaze) return null;
    const h = accumulate(r.gaze);
    if (!h.n) return null;
    const c = document.createElement("canvas");
    paint(c, h);
    return { url: c.toDataURL("image/png"), regions: h.regions };
  }, [r]);

  const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");
  const counts = Object.entries(s.events) as [keyof typeof EVENT_META, number][];
  const cal = r.calibration;

  return createPortal(
    <div className="print-root fixed inset-0 z-[70] overflow-y-auto bg-[#2b2620]/80 backdrop-blur-sm">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg px-5 py-3">
        <span className="text-[13px] text-muted">Report preview · use “Save as PDF” in the print dialog</span>
        <div className="flex gap-2">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => window.print()}>Print / Save PDF</button>
        </div>
      </div>

      <article className="paper force-paper mx-auto my-8 w-[820px] max-w-[calc(100vw-32px)] bg-white px-12 py-10 text-[12.5px] leading-relaxed shadow-2xl" style={{ color: C.ink, fontFamily: "var(--font-sans)" }}>
        <header className="flex items-start justify-between border-b pb-5" style={{ borderColor: C.line }}>
          <div>
            <div className="text-[12px] font-medium" style={{ color: C.muted }}>Lucid session report</div>
            <h1 className="mt-1 text-[28px] tracking-tight">{r.title}</h1>
            <div className="mt-1" style={{ color: C.muted }}>
              {new Date(r.startedAt).toLocaleString([], { dateStyle: "full", timeStyle: "short" })} · {fmtTime(r.duration)} · {r.kind === "live" ? "Live recording" : "n-back study"}
            </div>
          </div>
          <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
            <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke={C.line} />
            <path d="M5 19c3 0 3-7 6-7s3 10 6 10 3-13 6-13 3 6 4 6" fill="none" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </header>

        <section className="mt-6 grid grid-cols-5 gap-3">
          {[
            ["Focused time", pct(s.focused), "attention ≥ 70"],
            ["Mean attention", Number.isFinite(s.attention) ? String(Math.round(s.attention * 100)) : "—", "0–100"],
            ["Mean load", Number.isFinite(s.load) ? String(Math.round(s.load * 100)) : "—", r.loadSource === "model" ? "learned model" : "heuristic"],
            ["Heart rate", Number.isFinite(s.hr) ? `${Math.round(s.hr)} bpm` : "—", `${pct(s.hrCoverage)} locked`],
            ["Face in view", pct(s.faceCoverage), "data coverage"],
          ].map(([k, v, sub]) => (
            <div key={k} className="rounded-lg border px-3 py-2.5" style={{ borderColor: C.line }}>
              <div className="text-[10.5px]" style={{ color: C.muted }}>{k}</div>
              <div className="num text-[19px] font-medium">{v}</div>
              <div className="text-[10px]" style={{ color: C.faint }}>{sub}</div>
            </div>
          ))}
        </section>

        <section className="mt-7 avoid-break">
          <H>Timeline</H>
          <TimelineSvg r={r} events={events} />
          <div className="mt-2 flex gap-5 text-[10.5px]" style={{ color: C.muted }}>
            <Key c={C.att}>Attention</Key><Key c={C.eng}>Engagement</Key><Key c={C.load} dash={r.loadSource !== "model"}>Cognitive load ({r.loadSource === "model" ? "learned" : "heuristic"})</Key>
          </div>
        </section>

        <section className="mt-7 grid grid-cols-2 gap-8 avoid-break">
          <div>
            <H>Cognitive load distribution</H>
            <div className="flex h-3 overflow-hidden rounded-full" style={{ background: C.line }}>
              {s.loadBands.map((b, i) => <div key={i} style={{ width: `${b * 100}%`, background: ["#c9a35c", "#b5730a", "#6a4206"][i] }} />)}
            </div>
            <div className="num mt-1.5 grid grid-cols-3 text-[11px]" style={{ color: C.muted }}>
              <span>Low {pct(s.loadBands[0])}</span><span className="text-center">Medium {pct(s.loadBands[1])}</span><span className="text-right">High {pct(s.loadBands[2])}</span>
            </div>
            <H className="mt-6">Moments by type</H>
            {counts.length ? (
              <table className="w-full text-[11.5px]">
                <tbody>
                  {counts.map(([k, n]) => (
                    <tr key={k} className="border-b" style={{ borderColor: C.line }}>
                      <td className="py-1.5"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: EVENT_META[k].color }} />{EVENT_META[k].label}</td>
                      <td className="num py-1.5 text-right">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p style={{ color: C.muted }}>No notable moments.</p>}
          </div>
          <div>
            <H>Gaze heatmap</H>
            {heatUrl ? (
              <>
                <div className="relative overflow-hidden rounded-md" style={{ aspectRatio: String(cal?.aspect ?? 16 / 9), background: "#f5f0e6" }}>
                  <img src={heatUrl.url} alt="Gaze heatmap" className="absolute inset-0 h-full w-full" style={{ filter: "blur(2px)" }} />
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {heatUrl.regions.map((v, i) => (
                      <div key={i} className="flex items-end justify-end border border-[#e5ddcd] p-1">
                        <span className="num rounded bg-white/85 px-1 text-[9px] text-[#6a6155]">{Math.round(v * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                {cal && <p className="mt-1.5 text-[10.5px]" style={{ color: C.muted }}>Calibrated accuracy {fmtAccuracy(cal.valError)} of screen width ({accuracyLabel(cal.valError).label.toLowerCase()}), measured on 4 held-out points.</p>}
              </>
            ) : <p style={{ color: C.muted }}>No gaze calibration for this session.</p>}
          </div>
        </section>

        <section className="mt-7">
          <H>Auto-detected moments</H>
          {events.length ? (
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-left text-[11px]" style={{ color: C.faint }}>
                  <th className="pb-1.5 font-medium">Time</th><th className="pb-1.5 font-medium">Moment</th><th className="pb-1.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.type + e.start} className="border-t align-top" style={{ borderColor: C.line }}>
                    <td className="num py-1.5 pr-4">{fmtTime(e.start)}–{fmtTime(e.end)}</td>
                    <td className="py-1.5 pr-4"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: EVENT_META[e.type].color }} />{e.label}</td>
                    <td className="py-1.5" style={{ color: C.muted }}>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: C.muted }}>None — a steady session.</p>}
        </section>

        <section className="mt-8 border-t pt-4 text-[10.5px] leading-relaxed avoid-break" style={{ borderColor: C.line, color: C.muted }}>
          <p>
            <b style={{ color: C.ink }}>Method.</b> On-device computer vision (MediaPipe face + pose), remote photoplethysmography (POS) for heart rate, sampled at 10 Hz.
            Attention and engagement are transparent heuristics; cognitive load is {r.loadSource === "model" ? `a model trained on n-back data, evaluated leave-one-participant-out (macro-F1 ${r.model?.macroF1.toFixed(2)})${r.model?.synthetic ? " — DEMO model trained on synthetic data, not validated on people" : ""}` : "a transparent heuristic"}.
            Moments: lapse = attention &lt; {RULES.lapse.below * 100} for ≥ {RULES.lapse.minS} s; high load ≥ {RULES.loadHigh.above * 100} for ≥ {RULES.loadHigh.minS} s;
            heart rate ≥ +{RULES.hrUp.delta} bpm over resting for ≥ {RULES.hrUp.minS} s; eyes closed ≥ {RULES.eyesClosed.minS} s; head on hand ≥ {RULES.headOnHand.minS} s.
          </p>
          <p className="mt-2">
            <b style={{ color: C.ink }}>Interpretation.</b> These are estimated indicators, not diagnoses or measures of ability. Use them to reflect on a session, never to grade or discipline a student.
            <b style={{ color: C.ink }}> Privacy.</b> No video or images were stored — only numeric features, kept on this device.
          </p>
          <p className="mt-2" style={{ color: C.faint }}>Generated by Lucid · {new Date().toLocaleString()}</p>
        </section>
      </article>
    </div>,
    document.body,
  );
}

function H({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`mb-2.5 font-serif text-[16px] font-medium ${className}`} style={{ color: C.ink }}>{children}</h3>;
}

function Key({ c, children, dash = false }: { c: string; children: React.ReactNode; dash?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke={c} strokeWidth="2" strokeDasharray={dash ? "3 2" : undefined} /></svg>
      {children}
    </span>
  );
}

function TimelineSvg({ r, events }: { r: Replayable; events: ReplayEvent[] }) {
  const W = 724, H = 150, top = 12, bottom = 18;
  const x = (t: number) => (r.duration ? (t / r.duration) * W : 0);
  const y = (v: number) => top + (1 - v) * (H - top - bottom);
  const path = (a: Float64Array) => {
    const n = a.length, step = Math.max(1, Math.ceil(n / 700));
    let d = "", pen = false;
    for (let i = 0; i < n; i += step) {
      let s = 0, c = 0;
      for (let j = i; j < Math.min(n, i + step); j++) if (!Number.isNaN(a[j])) { s += a[j]; c++; }
      if (!c) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(r.t[i]).toFixed(1)} ${y(s / c).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const ticks = Array.from({ length: 6 }, (_, i) => (r.duration * i) / 5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {r.segments.map((s) => (
        <g key={s.start}>
          <rect x={x(s.start)} y={top} width={Math.max(1, x(s.end) - x(s.start))} height={H - top - bottom} fill={s.tone} opacity="0.08" />
          <text x={x(s.start) + 3} y={top + 10} fontSize="8.5" fill={s.tone} fontFamily="var(--font-sans)">{s.label}</text>
        </g>
      ))}
      {[0, 0.5, 1].map((g) => <line key={g} x1="0" x2={W} y1={y(g)} y2={y(g)} stroke={C.line} />)}
      {events.map((e) => (
        <rect key={e.type + e.start} x={x(e.start)} y={2} width={Math.max(2, x(e.end) - x(e.start))} height="5" rx="1" fill={EVENT_META[e.type].color} />
      ))}
      <path d={path(r.attention)} fill="none" stroke={C.att} strokeWidth="1.3" />
      <path d={path(r.engagement)} fill="none" stroke={C.eng} strokeWidth="1.3" />
      <path d={path(r.load)} fill="none" stroke={C.load} strokeWidth="1.5" strokeDasharray={r.loadSource === "model" ? undefined : "4 2"} />
      {ticks.map((t, i) => (
        <text key={i} x={Math.min(W - 18, Math.max(0, x(t) - (i ? 10 : 0)))} y={H - 4} fontSize="8.5" fill={C.faint} fontFamily="var(--font-sans)">{fmtTime(t)}</text>
      ))}
    </svg>
  );
}
