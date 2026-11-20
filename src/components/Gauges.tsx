import { useLucid } from "../store";

const METRICS = [
  { key: "attention", label: "Attention", color: "var(--color-att)", hint: "on-screen focus" },
  { key: "engagement", label: "Engagement", color: "var(--color-eng)", hint: "sustained & alert" },
  { key: "load", label: "Cognitive load", color: "var(--color-load)", hint: "mental effort" },
] as const;

function band(v: number, key: string) {
  if (key === "load") return v > 0.66 ? "High" : v > 0.33 ? "Medium" : "Low";
  return v > 0.7 ? "High" : v > 0.4 ? "Moderate" : "Low";
}

export function Gauges() {
  const m = useLucid((s) => s.metrics);
  const model = useLucid((s) => s.model);
  return (
    <div className="panel grid grid-cols-3 divide-x divide-line">
      {METRICS.map((g) => {
        // Cognitive load comes from the trained model once it has a personal baseline.
        const learned = g.key === "load" && model.status === "ready" && model.load != null;
        const v = learned ? model.load! : m ? m[g.key] : 0;
        let hint: string = g.hint;
        if (g.key === "load" && model.info && m) {
          hint = model.status === "baseline" ? `calibrating ${Math.round(model.baseline * 100)}%` : learned ? (model.info.synthetic ? "demo model" : "learned model") : "heuristic";
        }
        return <Gauge key={g.key} value={v} color={g.color} label={g.label} hint={hint} band={m ? band(v, g.key) : "—"} />;
      })}
    </div>
  );
}

function Gauge({ value, color, label, hint, band }: { value: number; color: string; label: string; hint: string; band: string }) {
  const R = 38;
  const C = 2 * Math.PI * R;
  const arc = 0.75; // 270° sweep
  const filled = C * arc * Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center px-2 py-4">
      <div className="relative">
        <svg width="104" height="104" viewBox="0 0 100 100" className="rotate-[135deg]">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-line)" strokeWidth="5" strokeDasharray={`${C * arc} ${C}`} strokeLinecap="round" />
          <circle
            cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" opacity={value > 0.005 ? 1 : 0}
            strokeDasharray={`${filled} ${C}`}
            style={{ transition: "stroke-dasharray 0.35s cubic-bezier(.2,.7,.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num font-serif text-[30px] font-medium leading-none">{Math.round(value * 100)}</span>
          <span className="mt-1 text-[11.5px] font-medium" style={{ color }}>{band}</span>
        </div>
      </div>
      <div className="mt-1 text-center">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[11px] text-faint">{hint}</div>
      </div>
    </div>
  );
}
