import { TopBar } from "./components/TopBar";
import { VideoStage } from "./components/VideoStage";
import { Gauges } from "./components/Gauges";
import { Timeline } from "./components/Timeline";
import { WhyPanel } from "./components/WhyPanel";
import { Telemetry } from "./components/Telemetry";
import { PosturePanel } from "./components/PosturePanel";
import { CardiacPanel } from "./components/CardiacPanel";
import { StudyView } from "./study/StudyView";
import { ReplayView } from "./replay/ReplayView";
import { ClassroomView } from "./classroom/ClassroomView";
import { LabView } from "./lab/LabView";
import { Landing } from "./home/Landing";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useEffect, useState } from "react";
import { Toast } from "./components/Toast";
import { ThemeFX } from "./components/ThemeFX";
import { useLucid } from "./store";

const TITLES: Record<string, string> = {
  home: "Lucid — attention, engagement & cognitive load",
  live: "Live · Lucid", study: "Study · Lucid", replay: "Replay · Lucid", classroom: "Classroom · Lucid", lab: "Lab · Lucid",
};

export default function App() {
  const view = useLucid((s) => s.view);
  useEffect(() => {
    document.title = TITLES[view] ?? "Lucid";
  }, [view]);
  return (
    <div className="relative z-10 min-h-full">
      <div className="ambient" aria-hidden />
      <TopBar />
      <main className="mx-auto grid max-w-[1440px] gap-4 px-4 py-5 sm:px-6 lg:grid-cols-12">
        <ErrorBoundary key={view}>
          {view === "home" ? <Landing /> : view === "study" ? <StudyView /> : view === "replay" ? <ReplayView /> : view === "classroom" ? <ClassroomView /> : view === "lab" ? <LabView /> : <LiveView />}
        </ErrorBoundary>
      </main>
      <Toast />
      <ThemeFX />
    </div>
  );
}

function LiveView() {
  const [more, setMore] = useState(() => {
    try {
      return localStorage.getItem("lucid.liveDetail") === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setMore((m) => {
      try {
        localStorage.setItem("lucid.liveDetail", m ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !m;
    });
  };
  return (
    <>
      <section className="flex min-w-0 flex-col gap-4 lg:col-span-8">
        <div>
          <h1 className="text-[34px] leading-tight tracking-[-0.02em]">Live session</h1>
          <p className="text-[13px] text-muted">Turn on the camera and watch your three scores update.</p>
        </div>
        <VideoStage />
        <Timeline />
      </section>
      <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4 lg:pt-[60px]">
        <Gauges />
        <CardiacPanel />
      </aside>

      <div className="lg:col-span-12">
        <button onClick={toggle} aria-expanded={more}
          className="flex w-full items-center justify-between rounded-2xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:bg-panel-2">
          <span>
            <span className="block text-[14px] font-medium">{more ? "Hide the details" : "Show the details"}</span>
            <span className="block text-[12.5px] text-muted">What's driving each score, posture, and the raw face signals</span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`text-muted transition-transform duration-300 ${more ? "rotate-180" : ""}`} aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      {more && (
        <div className="fade-in grid gap-4 lg:col-span-12 lg:grid-cols-3">
          <WhyPanel />
          <PosturePanel />
          <Telemetry />
        </div>
      )}
    </>
  );
}
