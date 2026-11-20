import { useEffect, useState } from "react";

/** Fixation cross with a countdown ring — used for baseline and rest. */
export function Fixation({ seconds, title, note, onDone }: { seconds: number; title: string; note: string; onDone: () => void }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const end = performance.now() + seconds * 1000;
    const id = setInterval(() => {
      const l = Math.max(0, (end - performance.now()) / 1000);
      setLeft(l);
      if (l <= 0) {
        clearInterval(id);
        onDone();
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  const R = 104, C = 2 * Math.PI * R;
  return (
    <div className="flex flex-col items-center">
      <div className="label mb-8">{title}</div>
      <div className="relative h-[240px] w-[240px]">
        <svg viewBox="0 0 240 240" className="absolute inset-0 -rotate-90">
          <circle cx="120" cy="120" r={R} fill="none" stroke="var(--color-line)" strokeWidth="2" />
          <circle cx="120" cy="120" r={R} fill="none" stroke="var(--color-att)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={`${C * (1 - left / seconds)} ${C}`} style={{ transition: "stroke-dasharray 0.1s linear" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[56px] font-light leading-none text-fg/90">+</span>
        </div>
      </div>
      <p className="mt-8 max-w-sm text-center text-[13px] text-muted">{note}</p>
      <div className="num mt-2 text-[12px] text-faint">{Math.ceil(left)} s</div>
    </div>
  );
}
