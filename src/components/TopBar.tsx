import { useEffect, useState } from "react";
import { navigate } from "../nav";
import { ThemePicker } from "./ThemePicker";
import { useLucid, type View } from "../store";

const NAV: { label: string; view: View }[] = [
  { label: "Live", view: "live" },
  { label: "Study", view: "study" },
  { label: "Replay", view: "replay" },
  { label: "Classroom", view: "classroom" },
  { label: "Lab", view: "lab" },
];

export function TopBar() {
  const { status, fps, sessionStart, view } = useLucid();
  const running = status === "running";
  const cameraView = view === "live" || view === "study";

  return (
    <header className="vt-topbar sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md" style={{ viewTransitionName: "topbar" }}>
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
        <button className="flex items-center gap-2.5" onClick={() => navigate("home")} aria-label="Lucid home">
          <Logo />
          <span className="font-serif text-[22px] font-medium leading-none tracking-[-0.02em]">Lucid</span>
        </button>

        <nav className="hidden items-center rounded-full border border-line bg-panel/70 p-1 md:flex" aria-label="Sections">
          {NAV.map((n) => (
            <NavItem key={n.view} n={n} active={view === n.view} />
          ))}
        </nav>

        <div className="flex-1" />
        {cameraView && (
          <div className="flex items-center gap-5 text-[12.5px]">
            <Stat label="fps" value={running ? String(fps) : "–"} warn={running && fps < 20} />
            <Clock start={sessionStart} running={running} />
          </div>
        )}
        <ThemePicker />
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-2 md:hidden" aria-label="Sections">
        {NAV.map((n) => (
          <NavItem key={n.view} n={n} active={view === n.view} />
        ))}
      </nav>
    </header>
  );
}

function NavItem({ n, active }: { n: { label: string; view: View }; active: boolean }) {
  return (
    <button onClick={() => navigate(n.view)} aria-current={active ? "page" : undefined}
      className={`relative shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors ${active ? "text-accent-fg" : "text-muted hover:text-fg"}`}>
      {active && <span className="vt-pill absolute inset-0 rounded-full bg-accent" style={{ viewTransitionName: "nav-pill" }} />}
      <span className="relative">{n.label}</span>
    </button>
  );
}

function Stat({ label, value, warn, className = "" }: { label: string; value: string; warn: boolean; className?: string }) {
  return (
    <span className={`flex items-baseline gap-1.5 ${className}`}>
      <span className={`num text-[14px] font-medium ${value === "–" ? "text-faint" : warn ? "text-load" : "text-fg"}`}>{value}</span>
      <span className="text-faint">{label}</span>
    </span>
  );
}

function Clock({ start, running }: { start: number; running: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const s = running && start > 0 ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
  return (
    <span className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1">
      <span className={`h-1.5 w-1.5 rounded-full ${running ? "pulse-dot bg-pulse" : "bg-line-2"}`} />
      <span className="num text-[13px]">{`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`}</span>
    </span>
  );
}

/** A pen trace — the chart-recorder mark. */
function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke="var(--color-line-2)" />
      <path d="M5 19c3 0 3-7 6-7s3 10 6 10 3-13 6-13 3 6 4 6" fill="none" stroke="var(--color-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
