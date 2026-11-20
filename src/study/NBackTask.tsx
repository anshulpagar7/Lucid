import { useEffect, useRef, useState } from "react";
import type { NLevel, Response, Trial } from "./protocol";
import type { TrialEvent } from "./types";

interface Props {
  n: NLevel;
  trials: Trial[];
  stimMs: number;
  soaMs: number;
  /** show hit/miss feedback (practice only) */
  feedback?: boolean;
  /** ms-since-study-start clock (shared with the recorder) */
  clock: () => number;
  onTrial: (index: number) => void;
  onDone: (responses: Response[], events: TrialEvent[]) => void;
}

type Flash = "hit" | "miss" | "fa" | null;

/**
 * n-back runner. Onsets are stamped on the animation frame where the letter
 * actually paints; reaction times use the key event's own high-res timestamp.
 * One response per trial (the first press counts).
 */
export function NBackTask({ n, trials, stimMs, soaMs, feedback = false, clock, onTrial, onDone }: Props) {
  const [idx, setIdx] = useState(-1);
  const [visible, setVisible] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [pressed, setPressed] = useState(false);

  const onsetPerf = useRef(0); // performance.now() of current onset
  const responses = useRef<Response[]>([]);
  const events = useRef<TrialEvent[]>([]);
  const answered = useRef(false);
  const cbs = useRef({ onTrial, onDone, clock });
  cbs.current = { onTrial, onDone, clock };

  // trial scheduler (drift-corrected against a fixed start time)
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const startAt = performance.now() + 600; // short lead-in
    const at = (t: number, fn: () => void) => timers.push(window.setTimeout(() => !cancelled && fn(), Math.max(0, t - performance.now())));

    trials.forEach((_trial, i) => {
      const onset = startAt + i * soaMs;
      at(onset, () => {
        // close out previous trial (feedback)
        if (i > 0) settle(i - 1);
        answered.current = false;
        setPressed(false);
        setIdx(i);
        setVisible(true);
        requestAnimationFrame((ts) => {
          onsetPerf.current = ts;
          events.current.push({ trial: i, onset: cbs.current.clock() - (performance.now() - ts) });
          cbs.current.onTrial(i);
        });
      });
      at(onset + stimMs, () => setVisible(false));
    });
    at(startAt + trials.length * soaMs, () => {
      settle(trials.length - 1);
      cbs.current.onDone(responses.current, events.current);
    });

    function settle(i: number) {
      if (!responses.current.some((r) => r.trial === i)) responses.current.push({ trial: i, rt: null });
      if (feedback && trials[i].isTarget && !answered.current) show("miss");
    }
    function show(f: Flash) {
      setFlash(f);
      timers.push(window.setTimeout(() => setFlash(null), 350));
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  const respond = (ts: number) => {
    if (idx < 0 || answered.current) return;
    answered.current = true;
    setPressed(true);
    const rt = ts - onsetPerf.current;
    responses.current = responses.current.filter((r) => r.trial !== idx);
    responses.current.push({ trial: idx, rt });
    if (feedback) {
      const f: Flash = trials[idx].isTarget ? "hit" : "fa";
      setFlash(f);
      window.setTimeout(() => setFlash(null), 350);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      e.preventDefault();
      respond(e.timeStamp);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const t = idx >= 0 ? trials[idx] : null;
  const ring =
    flash === "hit" ? "var(--color-ok)" : flash === "fa" || flash === "miss" ? "var(--color-bad)" : pressed ? "var(--color-fg)" : "var(--color-line-2)";

  return (
    <div className="flex flex-col items-center">
      <div className="label mb-8">
        {n === 0 ? "0-back · press space when you see X" : `${n}-back · press space when the letter matches ${n} step${n > 1 ? "s" : ""} back`}
      </div>

      <div
        className="relative flex h-[220px] w-[220px] items-center justify-center rounded-full border-2 transition-colors duration-150"
        style={{ borderColor: ring, background: flash ? `color-mix(in srgb, ${ring} 8%, var(--color-panel))` : "var(--color-panel)" }}
      >
        <span className="select-none font-serif text-[120px] font-medium leading-none" style={{ opacity: visible && t ? 1 : 0 }}>
          {t?.letter}
        </span>
        {!visible && <span className="absolute h-1.5 w-1.5 rounded-full bg-faint" />}
      </div>

      <button
        onPointerDown={(e) => respond(e.timeStamp)}
        className="mt-10 h-12 w-64 rounded-xl border border-line-2 bg-panel-2 text-[13px] text-muted transition-colors active:bg-line-2"
      >
        Match <kbd className="ml-2 rounded border border-line-2 px-1.5 py-0.5 text-[11px]">Space</kbd>
      </button>

      <div className="mt-8 h-[2px] w-64 rounded-full bg-line">
        <div className="h-full rounded-full bg-fg/70 transition-[width] duration-300" style={{ width: `${((idx + 1) / trials.length) * 100}%` }} />
      </div>
      <div className="num mt-2 text-[11px] text-faint">
        {Math.max(0, idx + 1)} / {trials.length}
      </div>
    </div>
  );
}
