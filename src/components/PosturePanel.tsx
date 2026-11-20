import { useLucid } from "../store";
import type { PostureMetrics, PostureState } from "../engine/posture";

const STATE: Record<PostureState, { label: string; note: string; tone: string }> = {
  upright: { label: "Upright", note: "Neutral, attentive posture", tone: "var(--color-ok)" },
  "leaning-in": { label: "Leaning in", note: "Moving toward the content", tone: "var(--color-att)" },
  "leaning-back": { label: "Leaning back", note: "Reclined — lower engagement cue", tone: "var(--color-load)" },
  slouching: { label: "Slouching", note: "Head dropping toward shoulders", tone: "var(--color-load)" },
  "head-on-hand": { label: "Head on hand", note: "Classic boredom / fatigue cue", tone: "var(--color-bad)" },
  unknown: { label: "Not in frame", note: "Sit back so both shoulders are visible", tone: "var(--color-faint)" },
};

export function PosturePanel() {
  const p = useLucid((s) => s.metrics?.posture ?? null);
  const modalities = useLucid((s) => s.modalities);
  const status = useLucid((s) => s.status);
  const running = status === "running";
  const poseOff = modalities !== null && !modalities.pose;
  const st = STATE[p?.state ?? "unknown"];

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Posture</span>
        <div className="flex items-center gap-3">
          <Modality name="Face" on={!!modalities?.face} />
          <Modality name="Pose" on={!!modalities?.pose} />
          <Modality name="rPPG" on={!!modalities?.rppg} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-panel-2 py-2">
          <Figure p={running ? p : null} tone={st.tone} />
          <div className="mt-1 text-center">
            <div className="text-[13px] font-medium" style={{ color: running && p ? st.tone : undefined }}>
              {poseOff ? "Pose unavailable" : running && p ? st.label : "—"}
            </div>
            <div className="mt-0.5 px-2 text-[10.5px] leading-snug text-faint">
              {poseOff ? "Face-only mode" : running && p ? st.note : "Starts with the session"}
            </div>
          </div>
        </div>

        <div className="space-y-2.5 self-center">
          <Row label="Lean" value={p?.visible ? signed(p.lean * 100, 0) : "—"} unit="%" bar={p?.visible ? p.lean : 0} centered />
          <Row label="Slouch" value={p?.visible ? (p.slouch * 100).toFixed(0) : "—"} unit="%" bar={p?.visible ? p.slouch : 0} tone="var(--color-load)" />
          <Row label="Shoulder tilt" value={p?.visible ? signed(p.shoulderTilt, 1) : "—"} unit="°" bar={p?.visible ? Math.max(-1, Math.min(1, p.shoulderTilt / 20)) : 0} centered />
          <Row label="Hand near face" value={p?.visible ? (p.handNearFace * 100).toFixed(0) : "—"} unit="%" bar={p?.visible ? p.handNearFace : 0} tone="var(--color-bad)" />
          <Row label="Body motion" value={p?.visible ? p.bodyMotion.toFixed(2) : "—"} bar={p?.visible ? p.bodyMotion : 0} />
          <Row label="Posture score" value={p?.visible ? (p.score * 100).toFixed(0) : "—"} bar={p?.visible ? p.score : 0} tone="var(--color-eng)" />
        </div>
      </div>
    </div>
  );
}

const signed = (v: number, d: number) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

function Modality({ name, on, soon = false }: { name: string; on: boolean; soon?: boolean }) {
  return (
    <span className="flex items-center gap-1.5" title={soon ? "Coming in week 3" : on ? "Active" : "Inactive"}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-ok" : soon ? "border border-faint" : "bg-faint"}`} />
      <span className={`text-[12px] ${on ? "text-fg" : "text-faint"}`}>{name}</span>
    </span>
  );
}

function Row({ label, value, unit, bar, tone = "var(--color-att)", centered = false }: {
  label: string; value: string; unit?: string; bar: number; tone?: string; centered?: boolean;
}) {
  const w = Math.min(1, Math.abs(bar)) * (centered ? 50 : 100);
  const left = centered ? (bar >= 0 ? 50 : 50 - w) : 0;
  return (
    <div className="grid grid-cols-[96px_1fr_52px] items-center gap-3">
      <span className="text-[11.5px] text-muted">{label}</span>
      <div className="relative h-1.5 rounded-full bg-line">
        {centered && <span className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-line-2" />}
        <div className="absolute top-0 h-full rounded-full transition-all duration-200" style={{ left: `${left}%`, width: `${w}%`, background: tone }} />
      </div>
      <span className="num text-right text-[12px]">
        {value}
        {unit && value !== "—" && <span className="text-[10.5px] text-muted">{unit}</span>}
      </span>
    </div>
  );
}

/** Live stick figure: shoulders widen with lean, head sinks with slouch, tilt rotates, a hand rises for head-on-hand. */
function Figure({ p, tone }: { p: PostureMetrics | null; tone: string }) {
  const visible = !!p?.visible;
  const lean = visible ? p!.lean : 0;
  const slouch = visible ? p!.slouch : 0;
  const tilt = visible ? Math.max(-20, Math.min(20, p!.shoulderTilt)) : 0;
  const hoh = visible && p!.headOnHand;

  const sc = 1 + lean * 0.14;
  const cx = 60, shY = 84;
  const half = 26 * sc;
  const neck = 30 * (1 - slouch * 0.5) * sc;
  const headR = 12 * sc;
  const headY = shY - neck;
  const stroke = visible ? tone : "var(--color-line-2)";
  const ease = { transition: "all 0.25s ease" } as const;

  return (
    <svg width="120" height="112" viewBox="0 0 120 112" aria-hidden>
      {/* floor/desk line */}
      <line x1="14" y1="108" x2="106" y2="108" stroke="var(--color-line)" />
      <g style={{ ...ease, transform: `rotate(${-tilt}deg)`, transformOrigin: `${cx}px ${shY}px` }}>
        {/* torso */}
        <path d={`M${cx - half} ${shY} L${cx - half * 0.8} 108 M${cx + half} ${shY} L${cx + half * 0.8} 108`} stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" style={ease} />
        <line x1={cx - half} y1={shY} x2={cx + half} y2={shY} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" style={ease} />
        {/* neck */}
        <line x1={cx} y1={shY} x2={cx} y2={headY + headR} stroke={stroke} strokeWidth="2" strokeDasharray="2 3" style={ease} />
        {/* head */}
        <circle cx={cx} cy={headY} r={headR} fill="var(--color-panel)" stroke={stroke} strokeWidth="2" style={ease} />
        {/* arms */}
        {hoh ? (
          <path d={`M${cx + half} ${shY} L${cx + half + 8} ${shY + 16} L${cx + headR * 0.6} ${headY + headR + 2}`} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" style={ease} />
        ) : (
          <path d={`M${cx + half} ${shY} L${cx + half + 6} 106`} stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" style={ease} />
        )}
        <path d={`M${cx - half} ${shY} L${cx - half - 6} 106`} stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" style={ease} />
        {/* joints */}
        {[cx - half, cx + half].map((x) => (
          <circle key={x} cx={x} cy={shY} r="3" fill="var(--color-bg)" stroke={stroke} strokeWidth="1.5" style={ease} />
        ))}
      </g>
    </svg>
  );
}
