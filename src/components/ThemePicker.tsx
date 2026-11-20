import { useEffect, useRef, useState } from "react";
import { setTheme, THEMES, useTheme, type Theme } from "../theme";
import { useFx } from "./ThemeFX";

/** Top-bar theme menu. Each option is previewed in its own colours and heading face. */
export function ThemePicker() {
  const id = useTheme((t) => t.id);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === id) ?? THEMES[0];
  const fx = useFx();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        className="flex h-9 items-center gap-2 rounded-full border border-line bg-panel/70 pl-1.5 pr-3 text-[13px] text-muted transition-colors hover:text-fg"
        aria-label={`Theme: ${current.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Swatch t={current} size={24} />
        <span className="hidden sm:inline">{current.name}</span>
      </button>

      {open && (
        <div role="menu" className="fade-in float absolute right-0 top-full z-50 mt-2 w-[290px] rounded-2xl border border-line bg-panel p-1.5">
          <div className="px-2.5 pb-1.5 pt-1 text-[12px] text-faint">Theme</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === id}
              onClick={(e) => {
                setOpen(false);
                if (t.id !== id) setTheme(t.id, { x: e.clientX, y: e.clientY });
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-panel-2 ${t.id === id ? "bg-panel-2" : ""}`}
            >
              <Swatch t={t} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-tight text-fg" style={{ fontFamily: t.display }}>
                  {t.name}
                </span>
                <span className="block truncate text-[12px] text-muted">{t.blurb}</span>
              </span>
              {t.id === id && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-fg" aria-hidden>
                  <path d="m5 12 5 5 9-10" />
                </svg>
              )}
            </button>
          ))}
          <div className="mx-1.5 mt-1.5 flex items-center justify-between border-t border-line px-1 pb-1 pt-2.5">
            <span className="text-[13px] text-muted">Animations</span>
            <button
              role="switch"
              aria-checked={fx.on}
              aria-label="Animations"
              onClick={fx.toggle}
              className={`relative h-5 w-9 rounded-full transition-colors ${fx.on ? "bg-accent" : "bg-line-2"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-panel transition-[left] ${fx.on ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A tiny card in the theme's own colours: background, accent, and the three pen traces. */
function Swatch({ t, size }: { t: Theme; size: number }) {
  const k = t.ink;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill={k.paper} stroke={k.line2} />
      <circle cx="24" cy="8.5" r="3.2" fill={k.accent} />
      <path d="M5 21c3 0 3-5 6-5s3 6 6 6 3-8 6-8 3 3 4 3" fill="none" stroke={k.att} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 25c4 0 5-3 9-3s5 2 8 2 4-2 5-2" fill="none" stroke={k.load} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
