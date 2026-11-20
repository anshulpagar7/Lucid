import { useEffect, useMemo, useRef, useState } from "react";
import { useLucid } from "../store";
import { navigate } from "../nav";
import { deleteSession, deleteStudy, listSessions, listStudies } from "../study/db";
import type { StudyRecord } from "../study/types";
import { Avatar } from "./Avatar";
import { useClock } from "./clock";
import { EVENT_META, detectEvents, type ReplayEvent } from "./events";
import { accuracyLabel, fmtAccuracy } from "./gaze";
import { accumulate, paint } from "./heatmap";
import { Report } from "./Report";
import { ReplayTimeline } from "./ReplayTimeline";
import { fmtTime, fromLive, fromStudy, rowAt, type Replayable } from "./signals";
import { summarize, type Summary } from "./stats";
import type { LiveRecord } from "./types";

type Item = { kind: "live"; rec: LiveRecord } | { kind: "study"; rec: StudyRecord };
const SPEEDS = [1, 4, 16];

export function ReplayView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [sel, setSel] = useState<string | null>(useLucid.getState().replayId);
  const [report, setReport] = useState(false);

  const refresh = () =>
    Promise.all([listSessions(), listStudies()])
      .then(([l, s]) => {
        const all: Item[] = [...l.map((rec) => ({ kind: "live" as const, rec })), ...s.filter((x) => x.rows.length > 50).map((rec) => ({ kind: "study" as const, rec }))];
        all.sort((a, b) => b.rec.startedAt - a.rec.startedAt);
        setItems(all);
        setSel((cur) => (cur && all.some((i) => i.rec.id === cur) ? cur : all[0]?.rec.id ?? null));
      })
      .catch(() => setItems([]));
  useEffect(() => void refresh(), []);

  const item = items?.find((i) => i.rec.id === sel) ?? null;
  const r = useMemo<Replayable | null>(() => (item ? (item.kind === "live" ? fromLive(item.rec) : fromStudy(item.rec)) : null), [item]);
  const events = useMemo(() => (r ? detectEvents(r) : []), [r]);
  const summary = useMemo(() => (r ? summarize(r, events) : null), [r, events]);

  // reset the clock on a new session
  useEffect(() => useClock.getState().set({ time: 0, playing: false }), [r]);

  // playback loop
  const playing = useClock((s) => s.playing);
  useEffect(() => {
    if (!playing || !r) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const { time, speed, set } = useClock.getState();
      const next = time + ((now - last) / 1000) * speed;
      last = now;
      if (next >= r.duration) set({ time: r.duration, playing: false });
      else {
        set({ time: next });
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, r]);

  // keyboard: space play/pause, ←/→ ±5 s
  useEffect(() => {
    if (!r) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || report) return;
      const c = useClock.getState();
      if (e.code === "Space") {
        e.preventDefault();
        c.set({ playing: !c.playing, time: c.time >= r.duration ? 0 : c.time });
      } else if (e.key === "ArrowRight") c.set({ time: Math.min(r.duration, c.time + 5) });
      else if (e.key === "ArrowLeft") c.set({ time: Math.max(0, c.time - 5) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [r, report]);

  const remove = async () => {
    if (!item || !confirm(`Delete "${r?.title}" permanently?`)) return;
    await (item.kind === "live" ? deleteSession(item.rec.id) : deleteStudy(item.rec.id));
    setSel(null);
    refresh();
  };

  return (
    <>
      <aside className="flex min-w-0 flex-col gap-4 lg:col-span-3">
        <div>
          <h1 className="text-[34px] leading-tight tracking-[-0.02em]">Replay</h1>
          <p className="text-[13px] text-muted">Revisit any recorded session.</p>
        </div>
        <SessionList items={items} sel={sel} onSel={setSel} />
      </aside>

      <section className="flex min-w-0 flex-col gap-4 lg:col-span-9">
        {!items ? (
          <div className="panel p-10 text-center text-[13px] text-faint">Loading…</div>
        ) : !r || !summary ? (
          <Empty />
        ) : (
          <>
            <Header r={r} onReport={() => setReport(true)} onDelete={remove} />
            <div className="grid gap-4 md:grid-cols-[300px_1fr]">
              <Player r={r} />
              <Moment r={r} events={events} />
            </div>
            <ReplayTimeline r={r} events={events} />
            <div className="grid gap-4 xl:grid-cols-3">
              <Stats s={summary} r={r} />
              <EventList events={events} />
              <HeatmapCard r={r} />
            </div>
          </>
        )}
      </section>
      {report && r && summary && <Report r={r} events={events} summary={summary} onClose={() => setReport(false)} />}
    </>
  );
}

function Empty() {
  return (
    <div className="panel flex flex-col items-center px-6 py-16 text-center">
      <div className="label mb-3">Nothing to replay yet</div>
      <h2 className="text-[20px] tracking-tight">Record a session to see it here</h2>
      <p className="mt-2 max-w-md text-[13px] text-muted">
        On the Live tab, press <span className="text-fg">● Record</span> — optionally <span className="text-fg">Calibrate gaze</span> first for a heatmap.
        Completed Study sessions appear here automatically. Only numbers are stored, never video.
      </p>
      <button className="btn btn-primary mt-6" onClick={() => navigate("live")}>Go to Live</button>
    </div>
  );
}

function SessionList({ items, sel, onSel }: { items: Item[] | null; sel: string | null; onSel: (id: string) => void }) {
  return (
    <div className="panel p-2">
      <div className="label px-2 pb-2 pt-1.5">Recordings ({items?.length ?? 0})</div>
      <div className="max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto">
        {items?.map((it) => {
          const rec = it.rec;
          const dur = rec.rows.length > 1 ? ((rec.rows[rec.rows.length - 1][0] as number) - (rec.rows[0][0] as number)) / 1000 : 0;
          const title = it.kind === "live" ? it.rec.name : `${it.rec.participantId} · n-back study`;
          return (
            <button key={rec.id} onClick={() => onSel(rec.id)}
              className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${sel === rec.id ? "border-line-2 bg-panel-2" : "border-transparent hover:bg-panel-2/60"}`}>
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${it.kind === "live" ? "bg-att" : "bg-eng"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{title}</span>
                <span className="num block text-[10.5px] text-faint">
                  {it.kind === "live" ? "Live" : "Study"} · {fmtTime(dur)}
                  {it.kind === "live" && it.rec.calibration ? " · gaze" : ""}
                </span>
              </span>
            </button>
          );
        })}
        {items?.length === 0 && <p className="px-2 py-6 text-center text-[12px] text-faint">No recordings yet.</p>}
      </div>
    </div>
  );
}

function Header({ r, onReport, onDelete }: { r: Replayable; onReport: () => void; onDelete: () => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="label mb-1 flex items-center gap-2">
          {r.kind === "live" ? "Live recording" : "Study session"}
          {r.loadSource === "model" && r.model?.synthetic && <span className="rounded-full bg-load/12 px-2 py-px text-[11px] font-medium text-load">Demo model</span>}
        </div>
        <h2 className="truncate text-[20px] tracking-tight">{r.title}</h2>
        <p className="num text-[12px] text-muted">
          {new Date(r.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · {fmtTime(r.duration)} · {r.rows.length.toLocaleString()} samples
        </p>
      </div>
      <div className="flex gap-2">
        <button className="btn" onClick={onDelete} title="Delete recording">Delete</button>
        <button className="btn btn-primary" onClick={onReport}>Session report</button>
      </div>
    </div>
  );
}

function Player({ r }: { r: Replayable }) {
  const { time, playing, speed, set } = useClock();
  return (
    <div className="panel overflow-hidden">
      <div className="relative aspect-square w-full">
        <Avatar r={r} />
        <span className="absolute left-3 top-3 rounded-full bg-panel/80 px-2.5 py-0.5 text-[11.5px] text-muted">
          Re-enacted from numbers — no video stored
        </span>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <button className="btn !h-8 !w-8 !justify-center !p-0" aria-label={playing ? "Pause" : "Play"}
          onClick={() => set({ playing: !playing, time: time >= r.duration ? 0 : time })}>
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" rx="1" fill="currentColor" /><rect x="7" y="1" width="3" height="10" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
          )}
        </button>
        <span className="num text-[12px]">{fmtTime(time)} <span className="text-faint">/ {fmtTime(r.duration)}</span></span>
        <div className="ml-auto flex rounded-lg border border-line bg-panel-2 p-0.5">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => set({ speed: s })}
              className={`num rounded-md px-2 py-0.5 text-[11px] ${speed === s ? "bg-line-2 text-fg" : "text-muted hover:text-fg"}`}>{s}×</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Moment({ r, events }: { r: Replayable; events: ReplayEvent[] }) {
  const time = useClock((s) => s.time);
  const i = Math.max(0, rowAt(r.t, time));
  const hrJ = r.columns.indexOf("hr_bpm"), okJ = r.columns.indexOf("hr_valid");
  const hr = r.rows[i]?.[okJ] === 1 ? (r.rows[i][hrJ] as number) : null;
  const v = (name: string) => {
    const j = r.columns.indexOf(name);
    const x = j >= 0 ? r.rows[i]?.[j] : null;
    return typeof x === "number" ? x : NaN;
  };
  const posture = v("pose_visible") !== 1 ? "—" : v("head_on_hand") === 1 ? "Head on hand" : v("slouch") > 0.5 ? "Slouching" : v("lean") > 0.4 ? "Leaning in" : v("lean") < -0.4 ? "Leaning back" : "Upright";
  const g = r.gaze?.[i];
  const gazeRegion = !g ? "—" : `${["Top", "Middle", "Bottom"][Math.min(2, Math.floor(g[1] * 3))]}-${["left", "centre", "right"][Math.min(2, Math.floor(g[0] * 3))]}`.replace("Middle-centre", "Centre");
  const seg = r.segments.find((s) => time >= s.start && time <= s.end);
  const active = events.filter((e) => time >= e.start && time <= e.end);
  const metrics = [
    { k: "Attention", v: r.attention[i], c: "var(--color-att)" },
    { k: "Engagement", v: r.engagement[i], c: "var(--color-eng)" },
    { k: r.loadSource === "model" ? "Load · learned" : "Load · heuristic", v: r.load[i], c: "var(--color-load)" },
  ];
  return (
    <div className="panel flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">At {fmtTime(time)}</span>
        {seg && <span className="rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ color: seg.tone, background: seg.tone + "1f" }}>{seg.label}</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {metrics.map((m) => (
          <div key={m.k}>
            <div className="text-[11px] text-faint">{m.k}</div>
            <div className="num mt-0.5 text-[30px] font-medium leading-none" style={{ color: Number.isNaN(m.v) ? undefined : m.c }}>
              {Number.isNaN(m.v) ? "—" : Math.round(m.v * 100)}
            </div>
            <div className="mt-2 h-1 rounded-full bg-line">
              <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${Number.isNaN(m.v) ? 0 : m.v * 100}%`, background: m.c }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          ["Heart rate", hr != null ? `${Math.round(hr)} bpm` : "—"],
          ["Blink rate", Number.isFinite(v("blink_rate")) ? `${Math.round(v("blink_rate"))} /min` : "—"],
          ["Posture", posture],
          ["Gaze region", gazeRegion],
        ].map(([k, val]) => (
          <div key={k} className="bg-panel px-3 py-2">
            <div className="text-[10.5px] text-faint">{k}</div>
            <div className="num mt-0.5 truncate text-[13px]">{val}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto pt-4">
        <div className="label mb-2">Happening now</div>
        <div className="flex min-h-[28px] flex-wrap gap-1.5">
          {active.length ? active.map((e) => (
            <span key={e.type + e.start} className="fade-in flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]"
              style={{ borderColor: EVENT_META[e.type].color + "66", background: EVENT_META[e.type].color + "14" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: EVENT_META[e.type].color }} />
              {e.label}
            </span>
          )) : <span className="text-[12px] text-faint">Nothing notable</span>}
        </div>
      </div>
    </div>
  );
}

function Stats({ s, r }: { s: Summary; r: Replayable }) {
  const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");
  const cells = [
    { k: "Focused time", v: pct(s.focused), sub: "attention ≥ 70" },
    { k: "Mean load", v: Number.isFinite(s.load) ? String(Math.round(s.load * 100)) : "—", sub: r.loadSource === "model" ? "learned model" : "heuristic" },
    { k: "Face in view", v: pct(s.faceCoverage), sub: "data coverage" },
    { k: "Heart rate", v: Number.isFinite(s.hr) ? `${Math.round(s.hr)}` : "—", sub: `bpm · ${pct(s.hrCoverage)} locked` },
  ];
  return (
    <div className="panel p-4">
      <div className="label mb-3">Summary</div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {cells.map((c) => (
          <div key={c.k} className="bg-panel px-3 py-2.5">
            <div className="text-[10.5px] text-faint">{c.k}</div>
            <div className="num mt-0.5 text-[18px]">{c.v}</div>
            <div className="text-[10px] text-faint">{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-[11px] text-faint"><span>Time in load band</span><span>low · medium · high</span></div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
          {s.loadBands.map((b, i) => (
            <div key={i} style={{ width: `${b * 100}%`, background: ["#c9a35c", "#b5730a", "#6a4206"][i], marginRight: i < 2 ? 2 : 0 }} title={`${["Low", "Medium", "High"][i]} ${Math.round(b * 100)}%`} />
          ))}
        </div>
        <div className="num mt-1.5 flex justify-between text-[11px] text-muted">
          {s.loadBands.map((b, i) => <span key={i}>{Math.round(b * 100)}%</span>)}
        </div>
      </div>
    </div>
  );
}

function EventList({ events }: { events: ReplayEvent[] }) {
  const set = useClock((s) => s.set);
  return (
    <div className="panel flex flex-col p-4">
      <div className="label mb-3">Detected moments ({events.length})</div>
      {events.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-faint">No notable moments — a steady session.</p>
      ) : (
        <div className="-mx-1 max-h-[260px] space-y-0.5 overflow-y-auto px-1">
          {events.map((e) => (
            <button key={e.type + e.start} onClick={() => set({ time: Math.max(0, e.start - 2), playing: false })}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-panel-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: EVENT_META[e.type].color }} />
              <span className="num w-[42px] shrink-0 text-[11px] text-muted">{fmtTime(e.start)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px]">{e.label}</span>
                <span className="block truncate text-[10.5px] text-faint">{e.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HeatmapCard({ r }: { r: Replayable }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heat = useMemo(() => (r.gaze ? accumulate(r.gaze) : null), [r]);
  useEffect(() => {
    if (heat && canvas.current) paint(canvas.current, heat);
  }, [heat]);
  const cal = r.calibration;
  const acc = cal ? accuracyLabel(cal.valError) : null;
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Gaze heatmap</span>
        {cal && acc && <span className="text-[11px]" style={{ color: acc.tone }}>{fmtAccuracy(cal.valError)} · {acc.label}</span>}
      </div>
      {heat && heat.n > 0 ? (
        <>
          <div className="relative w-full overflow-hidden rounded-lg border border-line bg-panel-2" style={{ aspectRatio: String(cal?.aspect ?? 16 / 9) }}>
            <canvas ref={canvas} className="absolute inset-0 h-full w-full" style={{ imageRendering: "auto", filter: "blur(2px)" }} />
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
              {heat.regions.map((v, i) => (
                <div key={i} className="flex items-end justify-end border border-line/70 p-1">
                  <span className="num rounded bg-panel/85 px-1 text-[10.5px] text-muted">{Math.round(v * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">Screen regions where gaze landed. Webcam gaze is coarse — read it by region, not by point.</p>
        </>
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center rounded-md border border-dashed border-line-2 px-4 text-center">
          <span className="text-[12.5px] text-muted">{r.kind === "study" ? "Not recorded in Study mode" : "No gaze data"}</span>
          <span className="mt-1 text-[11px] text-faint">{r.kind === "live" ? "Calibrate gaze on the Live tab before recording." : "Use a Live recording with gaze calibration."}</span>
        </div>
      )}
    </div>
  );
}
