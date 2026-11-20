import { useEffect, useState } from "react";
import { session } from "../engine/session";

/**
 * Camera chooser. Shown only when the machine has more than one camera —
 * Windows often makes a virtual camera (OBS, Snap, Teams) the default,
 * and that one delivers black frames or none at all.
 */
export function CameraPicker({ className = "" }: { className?: string }) {
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [current, setCurrent] = useState(session.cameraId ?? "");

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const refresh = () =>
      md
        .enumerateDevices()
        .then((d) => {
          setCams(d.filter((x) => x.kind === "videoinput" && x.deviceId));
          setCurrent(session.cameraId ?? "");
        })
        .catch(() => {});
    refresh();
    md.addEventListener("devicechange", refresh);
    // labels only appear after permission is granted, so refresh when a session starts
    const off = session.onReset(refresh);
    return () => {
      md.removeEventListener("devicechange", refresh);
      off();
    };
  }, []);

  if (cams.length < 2) return null;
  return (
    <label className={`flex items-center gap-2 text-[13px] text-muted ${className}`}>
      <span>Camera</span>
      <select
        value={current}
        onChange={(e) => {
          setCurrent(e.target.value);
          void session.useCamera(e.target.value);
        }}
        className="h-8 max-w-[220px] truncate rounded-lg border border-line-2 bg-panel px-2 text-[13px] text-fg outline-none focus:border-fg"
      >
        {!current && <option value="">Default</option>}
        {cams.map((c, i) => (
          <option key={c.deviceId} value={c.deviceId}>
            {c.label || `Camera ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
