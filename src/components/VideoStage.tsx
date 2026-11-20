import { useEffect, useRef, useState } from "react";
import { CameraPicker } from "./CameraPicker";
import { session } from "../engine/session";
import { useLucid } from "../store";
import { ROIS, convexHull } from "../engine/roi";
import { liveRecorder } from "../replay/liveRecorder";
import { GazeCalibration } from "../replay/GazeCalibration";
import { fmtAccuracy } from "../replay/gaze";
import { fmtTime } from "../replay/signals";

// Landmark groups (MediaPipe Face Mesh topology)
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const IRIS_L = [468, 469, 470, 471, 472];
const IRIS_R = [473, 474, 475, 476, 477];

const ATT = "34, 211, 238";
const ENG = "167, 139, 250";

// Upper-body skeleton (MediaPipe Pose topology)
const POSE_EDGES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [15, 19], [15, 21], [17, 19], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
];
const POSE_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24];

const POSTURE_LABEL: Record<string, string> = {
  "head-on-hand": "Head on hand",
  slouching: "Slouching",
  "leaning-back": "Leaning back",
  "leaning-in": "Leaning in",
};

export function VideoStage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const status = useLucid((s) => s.status);
  const stage = useLucid((s) => s.stage);
  const error = useLucid((s) => s.error);
  const overlay = useLucid((s) => s.overlay);
  const facePresent = useLucid((s) => s.metrics?.facePresent ?? false);
  const calibrating = useLucid((s) => s.metrics?.calibrating ?? false);
  const postureState = useLucid((s) => s.metrics?.posture?.state ?? null);
  const poseEnabled = useLucid((s) => s.modalities?.pose ?? false);
  const set = useLucid((s) => s.set);
  const recording = useLucid((s) => s.recording);
  const gaze = useLucid((s) => s.gaze);
  const [calibrating_, setCalibrating] = useState(false);

  useEffect(() => {
    const el = videoRef.current!;
    session.attachVideo(el);
    return () => session.detachVideo(el);
  }, []);

  // Overlay renderer — reads landmarks straight from the session on rAF.
  useEffect(() => {
    let raf = 0;
    let drawn = -1;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      const v = videoRef.current;
      if (!c || !v) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = c.clientWidth, ch = c.clientHeight;
      if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
        c.width = Math.round(cw * dpr);
        c.height = Math.round(ch * dpr);
        drawn = -1;
      }
      if (drawn === session.landmarksVersion) return;
      drawn = session.landmarksVersion;

      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const lm = session.landmarks;
      const pl = session.poseLandmarks;
      if ((!lm && !pl) || !useLucid.getState().overlay || !v.videoWidth) return;

      // object-fit: cover mapping
      const vw = v.videoWidth, vh = v.videoHeight;
      const s = Math.max(cw / vw, ch / vh);
      const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;

      // ── body skeleton (drawn first, under the face) ──
      if (pl) {
        const PX = (i: number) => pl[i * 4] * vw * s + ox;
        const PY = (i: number) => pl[i * 4 + 1] * vh * s + oy;
        const ok = (i: number) => pl[i * 4 + 3] > 0.5;
        ctx.lineCap = "round";
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(${ENG}, 0.55)`;
        ctx.beginPath();
        for (const [a, b] of POSE_EDGES) {
          if (!ok(a) || !ok(b)) continue;
          ctx.moveTo(PX(a), PY(a));
          ctx.lineTo(PX(b), PY(b));
        }
        ctx.stroke();
        // neck: shoulder midpoint → nose
        if (ok(11) && ok(12) && ok(0)) {
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = `rgba(${ENG}, 0.4)`;
          ctx.beginPath();
          ctx.moveTo((PX(11) + PX(12)) / 2, (PY(11) + PY(12)) / 2);
          ctx.lineTo(PX(0), PY(0));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        for (const j of POSE_JOINTS) {
          if (!ok(j)) continue;
          ctx.beginPath();
          ctx.arc(PX(j), PY(j), 3.5, 0, Math.PI * 2);
          ctx.fillStyle = "#191714";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = `rgba(${ENG}, 0.95)`;
          ctx.stroke();
        }
      }
      if (!lm) return;

      const X = (i: number) => lm[i * 3] * vw * s + ox;
      const Y = (i: number) => lm[i * 3 + 1] * vh * s + oy;
      const n = lm.length / 3;

      // mesh dots
      ctx.fillStyle = `rgba(${ATT}, 0.32)`;
      for (let i = 0; i < Math.min(n, 468); i++) ctx.fillRect(X(i) - 0.6, Y(i) - 0.6, 1.2, 1.2);

      const path = (idx: number[], close = true) => {
        ctx.beginPath();
        idx.forEach((i, k) => (k ? ctx.lineTo(X(i), Y(i)) : ctx.moveTo(X(i), Y(i))));
        if (close) ctx.closePath();
        ctx.stroke();
      };
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${ATT}, 0.25)`;
      path(FACE_OVAL);
      ctx.strokeStyle = `rgba(${ATT}, 0.8)`;
      path(LEFT_EYE);
      path(RIGHT_EYE);

      // rPPG skin ROIs (forehead + cheeks)
      if (useLucid.getState().modalities?.rppg && n >= 468) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(251, 113, 133, 0.55)";
        ctx.fillStyle = "rgba(251, 113, 133, 0.07)";
        for (const roi of ROIS) {
          const hull = convexHull(roi.map((i) => ({ x: X(i), y: Y(i) })));
          ctx.beginPath();
          hull.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      // irises
      if (n >= 478) {
        for (const iris of [IRIS_L, IRIS_R]) {
          const cx = X(iris[0]), cy = Y(iris[0]);
          const r = Math.hypot(X(iris[1]) - cx, Y(iris[1]) - cy);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(167, 139, 250, 0.95)";
          ctx.stroke();
          ctx.fillStyle = "rgba(167, 139, 250, 0.9)";
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }
      }

      // head-direction ray: from face centre through the nose tip
      const fcx = (X(33) + X(263) + X(152) + X(10)) / 4;
      const fcy = (Y(33) + Y(263) + Y(152) + Y(10)) / 4;
      const nx = X(1), ny = Y(1);
      const k = 5;
      const g = ctx.createLinearGradient(nx, ny, fcx + (nx - fcx) * k, fcy + (ny - fcy) * k);
      g.addColorStop(0, `rgba(${ATT}, 0.95)`);
      g.addColorStop(1, `rgba(${ATT}, 0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(fcx + (nx - fcx) * k, fcy + (ny - fcy) * k);
      ctx.stroke();

      // HUD brackets around the face
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const i of FACE_OVAL) {
        minX = Math.min(minX, X(i)); maxX = Math.max(maxX, X(i));
        minY = Math.min(minY, Y(i)); maxY = Math.max(maxY, Y(i));
      }
      const pad = 14, L = 16;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      ctx.strokeStyle = "rgba(237, 237, 240, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(minX, minY + L); ctx.lineTo(minX, minY); ctx.lineTo(minX + L, minY);
      ctx.moveTo(maxX - L, minY); ctx.lineTo(maxX, minY); ctx.lineTo(maxX, minY + L);
      ctx.moveTo(maxX, maxY - L); ctx.lineTo(maxX, maxY); ctx.lineTo(maxX - L, maxY);
      ctx.moveTo(minX + L, maxY); ctx.lineTo(minX, maxY); ctx.lineTo(minX, maxY - L);
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const running = status === "running";

  return (
    <div className="panel overflow-hidden">
      <div className={`relative aspect-video w-full ${running ? "screen" : "bg-panel-2"}`}>
        <div className={`absolute inset-0 -scale-x-100 ${running ? "" : "invisible"}`}>
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>

        {running && <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(25,23,20,0.45))]" />}

        {/* status chips */}
        {running && (
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            <Chip tone={facePresent ? "ok" : "bad"}>{facePresent ? "Face found" : "No face in view"}</Chip>
            {calibrating && facePresent && <Chip tone="att">Calibrating — look at the screen</Chip>}
            {postureState && POSTURE_LABEL[postureState] && <Chip tone="eng">{POSTURE_LABEL[postureState]}</Chip>}
            {poseEnabled && postureState === "unknown" && !calibrating && <Chip tone="muted">Shoulders out of frame</Chip>}
          </div>
        )}
        {running && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-screen/70 px-2.5 py-1 text-[12px] text-[#f1ebdf] backdrop-blur">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#f2788b]" />
            Live, on this device
          </div>
        )}
        {running && error && (
          <div className="fade-in absolute inset-x-3 bottom-3 rounded-xl bg-screen/85 px-4 py-3 text-[13px] leading-snug text-[#f1ebdf] backdrop-blur">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#f0b24a]" />
            {error}
          </div>
        )}

        {/* idle / starting / error states (on paper) */}
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6 text-center">
            <Corners />
            <Reticle spinning={status === "starting"} />
            {status === "error" ? (
              <>
                <div>
                  <h2 className="text-[24px] leading-tight">The camera didn't start</h2>
                  <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">{error}</p>
                </div>
                <button className="btn btn-primary" onClick={() => session.start()}>Retry</button>
                <CameraPicker />
              </>
            ) : status === "starting" ? (
              <p className="text-[14px] text-muted">{stage || "Starting"}…</p>
            ) : (
              <>
                <div>
                  <h2 className="text-[26px] leading-tight">Start a live session</h2>
                  <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
                    Lucid reads the camera in this browser. Video is never saved or sent anywhere.
                  </p>
                </div>
                <button className="btn btn-primary" onClick={() => session.start()}>
                  <CamIcon /> Turn on camera
                </button>
                <CameraPicker />
              </>
            )}
          </div>
        )}
      </div>

      {/* control bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
        {running ? (
          <button className="btn" onClick={() => session.stop()}>
            <span className="h-2 w-2 rounded-[2px] bg-fg" /> End session
          </button>
        ) : (
          <button className="btn btn-primary" disabled={status === "starting"} onClick={() => session.start()}>
            <CamIcon /> Start
          </button>
        )}
        <button className="btn" disabled={!running} onClick={() => session.calibrate()} title="Re-learn your neutral head pose and resting heart rate">
          Recalibrate
        </button>
        <button className="btn" disabled={!running || !!recording} onClick={() => setCalibrating(true)} title="9-point calibration — enables the gaze heatmap in Replay">
          {gaze ? <><span className="h-1.5 w-1.5 rounded-full bg-ok" /> Gaze {fmtAccuracy(gaze.valError)}</> : "Calibrate gaze"}
        </button>
        {recording ? (
          <button className="btn !border-pulse/40 !bg-pulse/10" onClick={() => void liveRecorder.stop()}>
            <span className="h-2 w-2 rounded-[2px] bg-pulse" /> Stop recording <RecClock since={recording} />
          </button>
        ) : (
          <button className="btn" disabled={!running} onClick={() => liveRecorder.start()} title="Record numbers only (never video) for Replay">
            <span className="h-2 w-2 rounded-full bg-pulse" /> Record
          </button>
        )}
        {running && <CameraPicker />}
        {calibrating_ && <GazeCalibration onClose={() => setCalibrating(false)} />}
        <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-[13px] text-muted">
          <span>Face mesh</span>
          <button
            role="switch"
            aria-checked={overlay}
            onClick={() => set({ overlay: !overlay })}
            className={`relative h-5 w-9 rounded-full border transition-colors ${overlay ? "border-fg bg-fg" : "border-line-2 bg-panel-2"}`}
          >
            <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${overlay ? "left-[18px] bg-panel" : "left-0.5 bg-faint"}`} />
          </button>
        </label>
      </div>
    </div>
  );
}

const CHIP_TONE = { ok: "#6fd39a", bad: "#f2788b", att: "#5cc8e0", eng: "#a594f0", muted: "#b5ab9a" } as const;

function Chip({ children, tone }: { children: React.ReactNode; tone: keyof typeof CHIP_TONE }) {
  return (
    <span className="fade-in flex items-center gap-1.5 rounded-full bg-screen/70 px-2.5 py-1 text-[12px] text-[#f1ebdf] backdrop-blur">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: CHIP_TONE[tone] }} />
      {children}
    </span>
  );
}

/** Viewfinder corner marks on the idle paper state. */
function Corners() {
  const c = "absolute h-5 w-5 border-line-2";
  return (
    <>
      <span className={`${c} left-4 top-4 border-l border-t`} />
      <span className={`${c} right-4 top-4 border-r border-t`} />
      <span className={`${c} bottom-4 left-4 border-b border-l`} />
      <span className={`${c} bottom-4 right-4 border-b border-r`} />
    </>
  );
}

function Reticle({ spinning }: { spinning: boolean }) {
  return (
    <svg width="64" height="64" viewBox="0 0 76 76" className={spinning ? "animate-spin [animation-duration:2.4s]" : ""} aria-hidden>
      <circle cx="38" cy="38" r="34" fill="none" stroke="var(--color-line-2)" />
      <circle cx="38" cy="38" r="34" fill="none" stroke="var(--color-fg)" strokeWidth="1.5" strokeDasharray="40 174" strokeLinecap="round" />
      <circle cx="38" cy="38" r="5" fill="var(--color-fg)" />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 13 5.2 3.1a.5.5 0 0 0 .8-.4V8.3a.5.5 0 0 0-.8-.4L16 11" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

function RecClock({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);
  return <span className="num">{fmtTime((Date.now() - since) / 1000)}</span>;
}
