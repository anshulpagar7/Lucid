import { useEffect, useRef } from "react";
import { session } from "../engine/session";
import { useLucid } from "../store";

/** Compact live monitor: camera preview + signal lock status. */
export function MiniMonitor() {
  const ref = useRef<HTMLVideoElement>(null);
  const status = useLucid((s) => s.status);
  const stage = useLucid((s) => s.stage);
  const error = useLucid((s) => s.error);
  const m = useLucid((s) => s.metrics);
  const fps = useLucid((s) => s.fps);
  const mods = useLucid((s) => s.modalities);

  useEffect(() => {
    const el = ref.current!;
    session.attachVideo(el);
    return () => session.detachVideo(el);
  }, []);

  const running = status === "running";
  const rows = [
    { k: "Face", ok: !!m?.facePresent, v: m?.facePresent ? (m.calibrating ? "calibrating" : "locked") : "searching" },
    { k: "Body", ok: !!m?.posture?.visible, v: !mods?.pose ? "off" : m?.posture?.visible ? m.posture.state : "out of frame", optional: true },
    { k: "Pulse", ok: !!m?.rppg?.valid, v: m?.rppg?.bpm != null ? `${Math.round(m.rppg.bpm)} bpm` : m?.rppg ? `acquiring ${Math.round(m.rppg.warmup * 100)}%` : "—", optional: true },
  ];

  return (
    <div className="panel overflow-hidden">
      <div className="screen relative aspect-video">
        <video ref={ref} className="h-full w-full -scale-x-100 object-cover" playsInline muted />
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-panel-2 p-4 text-center">
            {status === "error" ? (
              <>
                <span className="text-[14px] font-medium text-fg">The camera didn't start</span>
                <p className="max-w-[34ch] text-[12.5px] leading-relaxed text-muted">{error}</p>
              </>
            ) : (
              <span className="label">{status === "starting" ? `${stage || "Starting"}…` : "Camera off"}</span>
            )}
            {status !== "starting" && (
              <button className="btn btn-primary" onClick={() => session.start()}>{status === "error" ? "Retry" : "Turn on camera"}</button>
            )}
          </div>
        )}
        {running && <span className="num absolute right-2 top-2 rounded-full bg-screen/70 px-2 py-0.5 text-[11px] text-[#f1ebdf]">{fps} fps</span>}
      </div>
      <div className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between px-3 py-2 text-[12px]">
            <span className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${!running ? "bg-faint" : r.ok ? "bg-ok" : r.optional ? "bg-load" : "bg-bad"}`} />
              <span className="text-muted">{r.k}</span>
            </span>
            <span className="num text-[11.5px]">{running ? r.v : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
