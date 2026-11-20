import { useClock } from "./clock";
import { rowAt, type Replayable } from "./signals";

const clamp = (v: number, lo = -1, hi = 1) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

/**
 * Privacy-preserving replay: a wireframe face re-enacted from recorded head
 * pose, gaze and blendshapes. No pixels of the person were ever stored.
 * Rendered mirrored, like the live view.
 */
export function Avatar({ r }: { r: Replayable }) {
  const time = useClock((s) => s.time);
  const i = rowAt(r.t, time);
  const row = i >= 0 ? r.rows[i] : null;
  const c = (name: string) => {
    const j = r.columns.indexOf(name);
    const v = row && j >= 0 ? row[j] : null;
    return typeof v === "number" ? v : NaN;
  };
  const face = c("face_present") === 1;
  const fx = clamp(-c("yaw") / 35) * 16, fy = clamp(c("pitch") / 30) * 10, roll = clamp(c("roll") / 40) * 40;
  const openL = 1 - clamp(c("bs_eyeBlinkLeft"), 0, 1), openR = 1 - clamp(c("bs_eyeBlinkRight"), 0, 1);
  const px = clamp(-c("gaze_x")) * 6, py = clamp(-c("gaze_y")) * 4;
  const browL = clamp(c("bs_browDownLeft"), 0, 1) * 7 - clamp(c("bs_browInnerUp"), 0, 1) * 7 - clamp(c("bs_browOuterUpLeft"), 0, 1) * 4;
  const browR = clamp(c("bs_browDownRight"), 0, 1) * 7 - clamp(c("bs_browInnerUp"), 0, 1) * 7 - clamp(c("bs_browOuterUpRight"), 0, 1) * 4;
  const jaw = clamp(c("bs_jawOpen"), 0, 1) * 18;
  const smile = ((clamp(c("bs_mouthSmileLeft"), 0, 1) + clamp(c("bs_mouthSmileRight"), 0, 1)) / 2) * 7;
  const load = clamp(r.load[i] ?? NaN, 0, 1);
  const pose = c("pose_visible") === 1;
  const tilt = clamp(c("shoulder_tilt") / 20) * 20, lean = clamp(c("lean"));

  const stroke = face ? "var(--color-fg)" : "var(--color-line-2)";
  const ex = (x: number) => x + fx;
  const ey = 98 + fy;
  const mx = 120 + fx, my = 146 + fy;

  return (
    <svg viewBox="0 0 240 240" className="h-full w-full">
      <defs>
        <radialGradient id="av-bg" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="var(--color-panel)" />
          <stop offset="100%" stopColor="var(--color-panel-2)" />
        </radialGradient>
        <clipPath id="eyeL"><ellipse cx={ex(98)} cy={ey} rx="13" ry={Math.max(0.6, 8 * openL)} /></clipPath>
        <clipPath id="eyeR"><ellipse cx={ex(142)} cy={ey} rx="13" ry={Math.max(0.6, 8 * openR)} /></clipPath>
      </defs>
      <rect width="240" height="240" fill="url(#av-bg)" />
      {/* load halo */}
      <ellipse cx="120" cy="108" rx="84" ry="98" fill="none" stroke="var(--color-load)" strokeWidth="2" opacity={face ? 0.08 + load * 0.55 : 0}
        style={{ filter: "blur(3px)", transition: "opacity .3s" }} />

      {pose && (
        <g transform={`rotate(${-tilt} 120 214)`} style={{ transition: "transform .2s" }}>
          <path d={`M${120 - 70 * (1 + lean * 0.12)} 236 Q 120 ${200 - lean * 4} ${120 + 70 * (1 + lean * 0.12)} 236`} fill="none" stroke="var(--color-eng)" strokeWidth="1.6" opacity="0.7" />
        </g>
      )}

      <g transform={`rotate(${-roll} 120 108)`} style={{ transition: "transform .12s" }}>
        <ellipse cx="120" cy="108" rx="62" ry="78" fill="var(--color-panel)" stroke={stroke} strokeWidth="1.6" strokeDasharray={face ? undefined : "4 5"} />
        {face && (
          <g style={{ transition: "transform .12s" }}>
            {/* mesh hint */}
            <path d={`M${ex(120)} 40 Q ${ex(120) + fx * 0.3} ${ey} ${ex(120)} ${my - 12}`} fill="none" stroke="var(--color-fg)" strokeOpacity="0.1" />
            <path d={`M${ex(62)} ${ey + 6} Q ${ex(120)} ${ey + 22} ${ex(178)} ${ey + 6}`} fill="none" stroke="var(--color-fg)" strokeOpacity="0.1" />
            {/* brows */}
            <path d={`M${ex(84)} ${ey - 17 + browL} Q ${ex(97)} ${ey - 22 + browL} ${ex(110)} ${ey - 18 + browL * 1.2}`} fill="none" stroke="var(--color-fg)" strokeWidth="2" strokeLinecap="round" />
            <path d={`M${ex(130)} ${ey - 18 + browR * 1.2} Q ${ex(143)} ${ey - 22 + browR} ${ex(156)} ${ey - 17 + browR}`} fill="none" stroke="var(--color-fg)" strokeWidth="2" strokeLinecap="round" />
            {/* eyes */}
            {[{ x: 98, open: openL, clip: "eyeL" }, { x: 142, open: openR, clip: "eyeR" }].map((e) => (
              <g key={e.x}>
                <ellipse cx={ex(e.x)} cy={ey} rx="13" ry={Math.max(0.6, 8 * e.open)} fill="#ffffff" stroke="var(--color-fg)" strokeWidth="1.3" />
                <g clipPath={`url(#${e.clip})`}>
                  <circle cx={ex(e.x) + px} cy={ey + py} r="4.6" fill="var(--color-eng)" />
                  <circle cx={ex(e.x) + px + 1.3} cy={ey + py - 1.3} r="1.1" fill="#fff" opacity="0.8" />
                </g>
              </g>
            ))}
            {/* nose */}
            <path d={`M${ex(120)} ${ey + 8} L ${ex(120) + fx * 0.25 - 5} ${ey + 30} L ${ex(120) + 3} ${ey + 31}`} fill="none" stroke="var(--color-fg)" strokeOpacity="0.5" strokeWidth="1.2" strokeLinejoin="round" />
            {/* mouth */}
            <path d={`M${mx - 18} ${my - smile} Q ${mx} ${my - 2} ${mx + 18} ${my - smile} Q ${mx} ${my + 3 + jaw} ${mx - 18} ${my - smile} Z`}
              fill={jaw > 3 ? "var(--color-fg)" : "none"} stroke="var(--color-fg)" strokeWidth="1.6" strokeLinejoin="round" />
          </g>
        )}
        {!face && <text x="120" y="112" textAnchor="middle" fontSize="12" fill="var(--color-faint)" fontFamily="var(--font-sans)">Face not visible</text>}
      </g>
    </svg>
  );
}
