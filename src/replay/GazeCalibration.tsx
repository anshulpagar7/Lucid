import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { session } from "../engine/session";
import { Ema } from "../engine/features";
import { useLucid } from "../store";
import { CALIB_POINTS, VALID_POINTS, accuracyLabel, applyGaze, fmtAccuracy, fitGaze, validationError, type CalibSample } from "./gaze";
import type { GazeCalibration as Calib } from "./types";

const SETTLE_MS = 650; // ignore the saccade onto the dot
const DWELL_MS = 1700;

type Phase = { k: "intro" } | { k: "run"; i: number } | { k: "result"; calib: Calib } | { k: "fail"; msg: string };

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Full-screen 9-point calibration + 4 held-out validation points. */
export function GazeCalibration({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ k: "intro" });
  const seq = useRef<{ p: [number, number]; valid: boolean }[]>([]);
  const samples = useRef<{ s: CalibSample; valid: boolean }[]>([]);
  const onset = useRef(0);

  const begin = () => {
    seq.current = [...shuffle(CALIB_POINTS).map((p) => ({ p, valid: false })), ...shuffle(VALID_POINTS).map((p) => ({ p, valid: true }))];
    samples.current = [];
    setPhase({ k: "run", i: 0 });
  };

  // collect samples for the current dot
  useEffect(() => {
    if (phase.k !== "run") return;
    const cur = seq.current[phase.i];
    onset.current = performance.now();
    const unsub = session.onMetrics((m) => {
      const dt = performance.now() - onset.current;
      if (dt < SETTLE_MS || !m.facePresent || m.eyeClosure > 0.5) return;
      samples.current.push({ s: { input: { gx: m.gazeX, gy: m.gazeY, yaw: m.yaw, pitch: m.pitch }, target: cur.p }, valid: cur.valid });
    });
    const id = window.setTimeout(() => {
      if (phase.i + 1 < seq.current.length) setPhase({ k: "run", i: phase.i + 1 });
      else finish();
    }, DWELL_MS);
    return () => {
      unsub();
      clearTimeout(id);
    };
  }, [phase]);

  const finish = () => {
    const cal = samples.current.filter((x) => !x.valid).map((x) => x.s);
    const val = samples.current.filter((x) => x.valid).map((x) => x.s);
    const perPoint = new Set(cal.map((s) => s.target.join())).size;
    if (perPoint < 8 || cal.length < 120 || val.length < 40) {
      setPhase({ k: "fail", msg: "Your face wasn't visible for enough of the calibration. Sit centred, face the light, and try again." });
      return;
    }
    const fit = fitGaze(cal);
    const aspect = window.innerWidth / window.innerHeight;
    setPhase({ k: "result", calib: { ...fit, valError: validationError(fit, val, aspect), samples: cal.length, aspect, created: Date.now() } });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.code === "Space" && phase.k === "intro") {
        e.preventDefault();
        begin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-bg">
      <button className="absolute right-5 top-4 z-10 text-[12px] text-faint hover:text-muted" onClick={onClose}>Esc · cancel</button>

      {phase.k === "intro" && (
        <Center>
          <div className="label mb-3">Gaze calibration, about 25 seconds</div>
          <h2 className="text-[26px] tracking-tight">Follow the dot with your eyes</h2>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-muted">
            13 dots will appear around the screen. Look straight at each one until it moves — keep your head natural and still.
            The last 4 dots measure how accurate the calibration is.
          </p>
          <button className="btn btn-primary mt-7" onClick={begin}>
            Start <kbd className="ml-1 rounded border border-white/25 px-1.5 py-0.5 text-[11px] font-normal">Space</kbd>
          </button>
        </Center>
      )}

      {phase.k === "run" && <Dot key={phase.i} p={seq.current[phase.i].p} valid={seq.current[phase.i].valid} />}
      {phase.k === "run" && (
        <div className="num absolute bottom-5 left-1/2 -translate-x-1/2 text-[11px] text-faint">
          {phase.i + 1} / {seq.current.length}{seq.current[phase.i].valid ? " · validation" : ""}
        </div>
      )}

      {phase.k === "fail" && (
        <Center>
          <h2 className="text-[22px] tracking-tight">Calibration didn't complete</h2>
          <p className="mx-auto mt-3 max-w-md text-[14px] text-muted">{phase.msg}</p>
          <div className="mt-6 flex justify-center gap-2">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={begin}>Try again</button>
          </div>
        </Center>
      )}

      {phase.k === "result" && <Result calib={phase.calib} onRetry={begin} onSave={() => { useLucid.getState().set({ gaze: phase.calib, toast: { msg: "Gaze calibrated — recordings will include a heatmap" } }); onClose(); }} />}
    </div>,
    document.body,
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center px-6 text-center fade-in">{children}</div>;
}

function Dot({ p, valid }: { p: [number, number]; valid: boolean }) {
  const c = valid ? "var(--color-eng)" : "var(--color-att)";
  return (
    <div className="absolute" style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}>
      <span className="absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 [animation:calShrink_0.65s_ease-out_both]" style={{ borderColor: c }} />
      <span className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: c }} />
    </div>
  );
}

function Result({ calib, onRetry, onSave }: { calib: Calib; onRetry: () => void; onSave: () => void }) {
  const acc = accuracyLabel(calib.valError);
  const dot = useRef<HTMLDivElement>(null);

  // live "test it" cursor
  useEffect(() => {
    const e = { gx: new Ema(150), gy: new Ema(150), yaw: new Ema(150), pitch: new Ema(150) };
    let last = performance.now();
    return session.onMetrics((m) => {
      const now = performance.now(), dt = now - last;
      last = now;
      if (!dot.current) return;
      if (!m.facePresent) {
        dot.current.style.opacity = "0";
        return;
      }
      const [x, y] = applyGaze(calib, { gx: e.gx.push(m.gazeX, dt), gy: e.gy.push(m.gazeY, dt), yaw: e.yaw.push(m.yaw, dt), pitch: e.pitch.push(m.pitch, dt) });
      dot.current.style.opacity = "1";
      dot.current.style.transform = `translate(${x * window.innerWidth}px, ${y * window.innerHeight}px)`;
    });
  }, [calib]);

  return (
    <>
      <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
        {Array.from({ length: 9 }, (_, i) => <div key={i} className="border border-line/60" />)}
      </div>
      <div ref={dot} className="pointer-events-none absolute left-0 top-0 transition-transform duration-75" style={{ opacity: 0 }}>
        <span className="absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-load/50 bg-load/10" />
        <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-load" />
      </div>
      <div className="absolute left-1/2 top-1/2 w-[400px] -translate-x-1/2 -translate-y-1/2">
        <div className="panel p-5 text-center">
          <div className="label">Calibration accuracy</div>
          <div className="mt-2 flex items-baseline justify-center gap-2">
            <span className="num text-[40px] font-medium leading-none">{fmtAccuracy(calib.valError)}</span>
            <span className="text-[13px] font-medium" style={{ color: acc.tone }}>{acc.label}</span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Average error on 4 held-out points, as a share of screen width. The amber dot is your estimated gaze — look around to test it.
            Webcam gaze is coarse: trust regions, not pixels.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn" onClick={onRetry}>Recalibrate</button>
            <button className="btn btn-primary" onClick={onSave}>Use this calibration</button>
          </div>
        </div>
      </div>
    </>
  );
}
