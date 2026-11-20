import { useState } from "react";
import { useLucid, type ModelState } from "../store";

const TABS = [
  { key: "attention", label: "Attention", color: "var(--color-att)" },
  { key: "engagement", label: "Engagement", color: "var(--color-eng)" },
  { key: "load", label: "Load", color: "var(--color-load)" },
] as const;

export function WhyPanel() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("attention");
  const m = useLucid((s) => s.metrics);
  const model = useLucid((s) => s.model);
  const active = TABS.find((t) => t.key === tab)!;
  const learned = tab === "load" && !!model.info;
  const rows = (m?.why[tab] ?? []).filter((c) => c.weight > 0);
  const total = rows.reduce((a, c) => a + c.value * c.weight, 0) || 1;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">What's driving the score</span>
        <div className="flex rounded-lg border border-line bg-panel-2 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] transition-colors ${tab === t.key ? "bg-line-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {learned ? (
        <ModelWhy model={model} hasMetrics={!!m} />
      ) : (
        <>
      <div className="space-y-3">
        {(rows.length ? rows : [{ key: "x", label: "Waiting for signal", value: 0, weight: 1 }]).map((c) => {
          const share = m ? (c.value * c.weight) / total : 0;
          return (
            <div key={c.key}>
              <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                <span className="text-fg/90">{c.label}</span>
                <span className="num text-[11.5px] text-muted">
                  {m ? `${Math.round(share * 100)}%` : "—"}
                  <span className="ml-2 text-faint">w {c.weight.toFixed(2)}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-line">
                <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${share * 100}%`, background: active.color }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        Heuristic engine v0. Weights become learned fusion-attention weights once the trained model lands.
      </p>
        </>
      )}
    </div>
  );
}

/** Load tab when a trained model is loaded: learned per-modality contributions + model card. */
function ModelWhy({ model, hasMetrics }: { model: ModelState; hasMetrics: boolean }) {
  const info = model.info!;
  const c = model.contributions;
  const order = Object.entries(info.importance).sort((a, b) => b[1] - a[1]);
  const maxAbs = c ? Math.max(0.5, ...Object.values(c).map(Math.abs)) : 1;
  const top = model.proba ? model.proba.indexOf(Math.max(...model.proba)) : -1;
  const CLASS = ["Low", "Medium", "High"];

  return (
    <div>
      {model.status === "baseline" && hasMetrics ? (
        <div className="rounded-lg border border-line bg-panel-2 px-3 py-3">
          <div className="flex items-center justify-between text-[12.5px]">
            <span>Learning your resting baseline</span>
            <span className="num text-muted">{Math.round(model.baseline * 100)}%</span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-line">
            <div className="h-full rounded-full bg-load transition-[width] duration-300" style={{ width: `${model.baseline * 100}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-faint">{model.message ?? "Sit naturally for ~30 s. Load is judged relative to your own resting state."}</p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between text-[11px] text-faint">
            <span>← lowers load</span>
            <span>{model.status === "ready" && top >= 0 ? <span className="text-fg">Predicted: {CLASS[top]} · {Math.round(model.proba![top] * 100)}%</span> : model.status === "no-face" ? "waiting for face…" : "—"}</span>
            <span>raises load →</span>
          </div>
          <div className="space-y-2">
            {order.map(([k, w]) => {
              const v = c?.[k] ?? 0;
              const pct = (Math.min(1, Math.abs(v) / maxAbs) * 50);
              return (
                <div key={k} className="grid grid-cols-[112px_1fr_40px] items-center gap-2">
                  <span className="truncate text-[12px] text-fg/90">{info.labels[k] ?? k}</span>
                  <div className="relative h-1.5 rounded-full bg-line">
                    <span className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-line-2" />
                    {c && (
                      <div className="absolute top-0 h-full rounded-full transition-all duration-500"
                        style={{ left: v >= 0 ? "50%" : `${50 - pct}%`, width: `${pct}%`, background: v >= 0 ? "var(--color-load)" : "var(--color-att)", opacity: model.status === "ready" ? 1 : 0.35 }} />
                    )}
                  </div>
                  <span className="num text-right text-[10.5px] text-faint" title="learned modality weight">w {w.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <div className="mt-4 space-y-1 border-t border-line pt-3 text-[11px] text-faint">
        <div className="flex items-center gap-2">
          {info.synthetic && <span className="rounded-full bg-load/12 px-2 py-0.5 text-[11px] font-medium text-load">Demo model</span>}
          <span>Boosted late fusion · {info.participants} participants</span>
        </div>
        <div className="num">Leave-one-participant-out macro-F1 {info.macroF1.toFixed(2)} [{info.ci95[0].toFixed(2)}–{info.ci95[1].toFixed(2)}]</div>
      </div>
    </div>
  );
}
