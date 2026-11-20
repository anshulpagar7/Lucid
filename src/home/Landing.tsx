import { session } from "../engine/session";
import { navigate } from "../nav";
import type { View } from "../store";
import { Recorder } from "./Recorder";

const MODES: { view: View; title: string; text: string; action: string }[] = [
  { view: "live", title: "Live", text: "Watch one learner's attention, engagement and cognitive load from face, posture and heart rate — with the reason behind every score.", action: "Start a session" },
  { view: "study", title: "Study", text: "Run a short n-back memory task with NASA-TLX ratings and export labelled data that trains the cognitive-load model.", action: "Set up a study" },
  { view: "replay", title: "Replay", text: "Go back through a recorded session with a re-enacted avatar, detected moments, a gaze heatmap and a printable report.", action: "Open recordings" },
  { view: "classroom", title: "Classroom", text: "Follow a whole room or an online class gallery with anonymous IDs and class-level trends.", action: "Open classroom" },
];

const STEPS = [
  ["Camera", "Frames are read in the browser at up to 30 per second and never saved."],
  ["Landmarks", "MediaPipe finds 478 face points and 33 body points on your GPU."],
  ["Signals", "Gaze, blinks, expression, posture and pulse from skin colour."],
  ["Model", "A late-fusion model weighs each signal against your own resting baseline."],
  ["Scores", "Three indicators update a few times a second, each with its reasons."],
];

export function Landing() {
  return (
    <div className="lg:col-span-12">
      {/* hero */}
      <section className="grid items-center gap-10 pb-16 pt-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pt-14">
        <div>
          <h1 className="text-[44px] leading-[1.02] tracking-[-0.025em] text-fg sm:text-[64px]">
            Attention, engagement and cognitive load, read from an ordinary webcam.
          </h1>
          <p className="mt-6 max-w-[56ch] text-[16.5px] leading-[1.65] text-muted">
            Lucid watches face, gaze, posture and heart rate and turns them into three simple scores. It all runs in your browser, so
            video never leaves your device.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary !h-11 !px-5 !text-[14.5px]" onClick={() => { navigate("live"); void session.start(); }}>
              Start a live session
            </button>
            <button className="btn !h-11 !px-5 !text-[14.5px]" onClick={() => navigate("lab")}>
              See how it's evaluated
            </button>
          </div>
          <p className="mt-6 flex items-center gap-2 text-[13px] text-faint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Only numbers are kept, and only on this device.
          </p>
        </div>

        <figure className="panel relative overflow-hidden p-5 sm:p-6">
          <div className="flex items-center justify-between text-[12.5px] text-faint">
            <span>Illustration</span>
            <span className="flex items-center gap-1.5"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-pulse" />recording</span>
          </div>
          <div className="relative mt-2 aspect-[5/6] w-full sm:aspect-[6/6]">
            <Recorder />
          </div>
        </figure>
      </section>

      {/* modes */}
      <section className="border-t border-line">
        {MODES.map((m) => (
          <button key={m.view} onClick={() => navigate(m.view)}
            className="group grid w-full items-baseline gap-2 border-b border-line py-6 text-left transition-colors hover:bg-panel/60 sm:grid-cols-[220px_1fr_auto] sm:gap-8 sm:px-2">
            <span className="font-serif text-[30px] leading-none tracking-[-0.02em]">{m.title}</span>
            <span className="max-w-[62ch] text-[14.5px] leading-relaxed text-muted">{m.text}</span>
            <span className="text-[13.5px] font-medium text-fg underline decoration-line-2 underline-offset-4 transition-colors group-hover:decoration-fg">{m.action}</span>
          </button>
        ))}
      </section>

      {/* how it works — a genuine sequence */}
      <section className="py-16">
        <h2 className="text-[32px] leading-tight tracking-[-0.02em]">How a frame becomes a score</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-5 md:gap-4">
          {STEPS.map(([h, t], i) => (
            <li key={h} className="relative">
              <div className="flex items-center gap-3">
                <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-2 bg-panel text-[12.5px]">{i + 1}</span>
                {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-line-2 md:block" />}
              </div>
              <div className="mt-3 text-[15px] font-medium">{h}</div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{t}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[12.5px] text-faint">
        <span>Lucid — multi-modal student attention, engagement and cognitive load analysis using computer vision.</span>
        <span>React, TypeScript, MediaPipe and scikit-learn</span>
      </footer>
    </div>
  );
}
