import { useLucid } from "../store";

type Cell = { label: string; value: string; unit?: string; bar?: number; tone?: string };

export function Telemetry() {
  const m = useLucid((s) => s.metrics);
  const f = (v: number | undefined, d = 1) => (m && v !== undefined ? v.toFixed(d) : "—");
  const signed = (v: number | undefined) => (m && v !== undefined ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : "—");

  const cells: Cell[] = [
    { label: "Yaw", value: signed(m?.yaw), unit: "°", bar: m ? Math.min(1, Math.abs(m.yaw) / 40) : 0 },
    { label: "Pitch", value: signed(m?.pitch), unit: "°", bar: m ? Math.min(1, Math.abs(m.pitch) / 30) : 0 },
    { label: "Roll", value: signed(m?.roll), unit: "°", bar: m ? Math.min(1, Math.abs(m.roll) / 30) : 0 },
    { label: "Gaze X", value: signed(m?.gazeX), bar: m ? Math.min(1, Math.abs(m.gazeX)) : 0, tone: "var(--color-eng)" },
    { label: "Gaze Y", value: signed(m?.gazeY), bar: m ? Math.min(1, Math.abs(m.gazeY)) : 0, tone: "var(--color-eng)" },
    { label: "EAR", value: f(m?.ear, 3), bar: m ? Math.min(1, m.ear / 0.4) : 0 },
    { label: "Blink rate", value: f(m?.blinkRate, 0), unit: "/min", bar: m ? Math.min(1, m.blinkRate / 30) : 0, tone: "var(--color-load)" },
    { label: "Blinks", value: m ? String(m.blinks) : "—" },
    { label: "PERCLOS", value: m ? (m.perclos * 100).toFixed(1) : "—", unit: "%", bar: m ? Math.min(1, m.perclos * 4) : 0, tone: "var(--color-bad)" },
    { label: "Brow (AU4)", value: f(m?.browDown, 2), bar: m?.browDown ?? 0, tone: "var(--color-load)" },
    { label: "Jaw open", value: f(m?.jawOpen, 2), bar: m?.jawOpen ?? 0 },
    { label: "Motion", value: f(m?.motion, 2), bar: m?.motion ?? 0 },
  ];

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Raw signals</span>
        <span className="text-[12px] text-faint">updated every frame</span>
      </div>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {cells.map((c) => (
          <div key={c.label} className="bg-panel px-3 py-2.5">
            <div className="text-[10.5px] text-faint">{c.label}</div>
            <div className="num mt-0.5 text-[15px]">
              {c.value}
              {c.unit && c.value !== "—" && <span className="ml-0.5 text-[11px] text-muted">{c.unit}</span>}
            </div>
            {c.bar !== undefined && (
              <div className="mt-1.5 h-[2px] rounded-full bg-line">
                <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${c.bar * 100}%`, background: c.tone ?? "var(--color-att)" }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
