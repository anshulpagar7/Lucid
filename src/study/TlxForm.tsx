import { useState } from "react";
import { TLX_SCALES, rawTlx, type TlxRatings } from "./protocol";

/** NASA-TLX (raw). Every scale must be touched before submitting — an
 *  untouched default of 50 would silently bias the label. */
export function TlxForm({ title, onSubmit }: { title: string; onSubmit: (r: TlxRatings) => void }) {
  const [vals, setVals] = useState<Partial<TlxRatings>>({});
  const done = TLX_SCALES.every((s) => vals[s.key] !== undefined);

  return (
    <div className="w-full max-w-[640px]">
      <div className="label mb-1">Workload rating (NASA-TLX)</div>
      <h2 className="text-[22px] tracking-tight">{title}</h2>
      <p className="mt-1 text-[13px] text-muted">Rate the block you just finished. Drag or click each scale — there are no right answers.</p>

      <div className="mt-6 space-y-5">
        {TLX_SCALES.map((s) => {
          const v = vals[s.key];
          return (
            <div key={s.key}>
              <div className="flex items-baseline justify-between">
                <span className="text-[13.5px] font-medium">{s.label}</span>
                <span className={`num text-[12px] ${v === undefined ? "text-faint" : "text-fg"}`}>{v ?? "—"}</span>
              </div>
              <div className="mb-2 text-[12px] text-muted">{s.q}</div>
              <Scale value={v} onChange={(x) => setVals((p) => ({ ...p, [s.key]: x }))} />
              <div className="mt-1 flex justify-between text-[10.5px] text-faint">
                <span>{s.lo}</span>
                <span>{s.hi}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button className="btn btn-primary" disabled={!done} style={{ opacity: done ? 1 : 0.4 }} onClick={() => onSubmit(vals as TlxRatings)}>
          Submit ratings
        </button>
        <span className="text-[12px] text-faint">
          {done ? `Raw TLX ${rawTlx(vals as TlxRatings).toFixed(0)}` : `${TLX_SCALES.filter((s) => vals[s.key] === undefined).length} scale(s) left`}
        </span>
      </div>
    </div>
  );
}

/** 21-tick scale (0–100 in steps of 5), matching the paper TLX form. */
function Scale({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = Math.round((Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100) / 5) * 5;
    onChange(v);
  };
  return (
    <div
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onChange(Math.min(100, (value ?? 50) + 5));
        if (e.key === "ArrowLeft") onChange(Math.max(0, (value ?? 50) - 5));
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => e.buttons && set(e)}
      className="relative h-7 cursor-pointer touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-line-2"
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
      {Array.from({ length: 21 }, (_, i) => (
        <span key={i} className="absolute top-1/2 w-px -translate-y-1/2 bg-line-2" style={{ left: `${i * 5}%`, height: i % 10 === 0 ? 14 : 8 }} />
      ))}
      {value !== undefined && (
        <>
          <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-load/70" style={{ width: `${value}%` }} />
          <span
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-load bg-panel"
            style={{ left: `${value}%` }}
          />
        </>
      )}
    </div>
  );
}
