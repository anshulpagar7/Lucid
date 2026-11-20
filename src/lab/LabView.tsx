import { useEffect, useState } from "react";
import { liveModel } from "../model/live";
import type { ModelJson } from "../model/fusion";
import { useLucid } from "../store";
import { listStudies } from "../study/db";
import { runBenchmarks, type Bench } from "./bench";
import { pool, type Pooled } from "./pooled";
import { CHECKS, type CheckResult } from "./selfcheck";

// Pen inks, validated on the cream card surface (lightness band, chroma, CVD
// separation, contrast) with the dataviz palette validator.
const CH = { cyan: "var(--color-att)", violet: "var(--color-eng)", amber: "var(--color-load)", muted: "var(--color-line-2)" };

const fmt = (v: number | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));

export function LabView() {
  const status = useLucid((s) => s.model.status);
  const [model, setModel] = useState<ModelJson | null>(liveModel.json);
  useEffect(() => setModel(liveModel.json), [status]);

  return (
    <>
      <div className="lg:col-span-12">
        <h1 className="text-[34px] leading-tight tracking-[-0.02em]">Lab</h1>
        <p className="text-[13px] text-muted">How Lucid is evaluated, a self-check you can run now, performance on this machine, and its limits.</p>
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
        <ModelCard m={model} />
        <Ablation m={model} />
        <StudyData />
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
        <SelfCheck />
        <Performance />
      </div>
      <div className="lg:col-span-12">
        <Ethics />
      </div>
    </>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="label">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Kpi({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <div className="text-[10.5px] text-faint">{k}</div>
      <div className="num mt-0.5 text-[18px]">{v}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

// ───────── model evaluation ─────────

function ModelCard({ m }: { m: ModelJson | null }) {
  if (!m)
    return (
      <Card title="Cognitive-load model">
        <p className="py-6 text-center text-[12.5px] text-faint">No model loaded. Run <span className="font-mono text-muted">npm run train</span> on your study data (or <span className="font-mono text-muted">train:demo</span>).</p>
      </Card>
    );
  const e = m.eval;
  const rows = [...Object.entries(e.baselines).map(([k, v]) => ({ k, v, ci: e.baseline_ci95?.[k], ship: false })), { k: "Late fusion · boosted (shipped)", v: e.macro_f1, ci: e.ci95, ship: true }];
  return (
    <Card title="Cognitive-load model, tested on unseen participants"
      right={m.data.synthetic ? <span className="rounded-full bg-load/12 px-2.5 py-0.5 text-[12px] font-medium text-load">Demo model, synthetic data</span> : <span className="text-[12px] font-medium text-ok">Trained on real participants</span>}>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Kpi k="Macro-F1" v={fmt(e.macro_f1)} sub={`95% CI ${fmt(e.ci95[0])}–${fmt(e.ci95[1])}`} />
        <Kpi k="Balanced accuracy" v={fmt(e.balanced_accuracy)} sub="chance 0.33" />
        <Kpi k="Per-person F1" v={e.per_participant_f1 ? fmt(e.per_participant_f1.mean) : "—"} sub={e.per_participant_f1 ? `± ${fmt(e.per_participant_f1.sd)} sd` : "retrain to show"} />
        <Kpi k="ρ with NASA-TLX" v={fmt(e.block_spearman_tlx)} sub="block-level Spearman" />
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-[1fr_210px]">
        <div>
          <div className="mb-2 text-[11.5px] text-muted">Macro-F1 vs baselines <span className="text-faint">(whiskers = 95% CI over participants)</span></div>
          <Bars rows={rows} />
        </div>
        <div>
          <div className="mb-2 text-[11.5px] text-muted">Confusion <span className="text-faint">(row-normalised)</span></div>
          {e.confusion ? <Confusion cm={e.confusion} classes={m.classes} /> : <p className="text-[11px] text-faint">Retrain with v1.0 to include.</p>}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-faint">
        {m.data.participants} participants · {m.data.windows.toLocaleString()} windows (10 s) · every score is on people the model never saw. {m.data.synthetic && "Synthetic numbers demonstrate the pipeline only — not evidence about real students."}
      </p>
    </Card>
  );
}

function Bars({ rows }: { rows: { k: string; v: number; ci?: [number, number]; ship: boolean }[] }) {
  const W = 400, rowH = 26, L = 150, H = rows.length * rowH + 18;
  const x = (v: number) => L + v * (W - L - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Macro-F1 by model">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={x(g)} x2={x(g)} y1={0} y2={H - 16} stroke="var(--color-grid)" />
          <text x={x(g)} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--color-faint)" fontFamily="var(--font-sans)">{g}</text>
        </g>
      ))}
      <line x1={x(1 / 3)} x2={x(1 / 3)} y1={0} y2={H - 16} stroke="var(--color-faint)" strokeDasharray="3 3" />
      {rows.map((r, i) => {
        const y = i * rowH + 4;
        return (
          <g key={r.k}>
            <title>{`${r.k}: ${r.v.toFixed(3)}${r.ci ? ` (95% CI ${r.ci[0].toFixed(2)}–${r.ci[1].toFixed(2)})` : ""}`}</title>
            <text x={L - 8} y={y + 12} textAnchor="end" fontSize="9" fill={r.ship ? "var(--color-fg)" : "var(--color-muted)"} fontWeight={r.ship ? 600 : 400}>{r.k.replace(" (shipped)", "")}</text>
            <rect x={L} y={y + 3} width={Math.max(0, x(r.v) - L)} height={13} rx="3" fill={r.ship ? CH.amber : CH.muted} />
            {r.ci && <line x1={x(r.ci[0])} x2={x(r.ci[1])} y1={y + 9.5} y2={y + 9.5} stroke="var(--color-fg)" strokeOpacity="0.55" />}
            <text x={x(Math.max(r.v, r.ci?.[1] ?? 0)) + 5} y={y + 13} fontSize="8.5" fill="var(--color-muted)" fontFamily="var(--font-sans)">{r.v.toFixed(2)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Confusion({ cm, classes }: { cm: number[][]; classes: string[] }) {
  return (
    <div>
      <div className="grid grid-cols-[44px_repeat(3,1fr)] gap-[2px] text-center">
        <span />
        {classes.map((c) => <span key={c} className="pb-1 text-[9.5px] text-faint">{c}</span>)}
        {cm.map((row, i) => {
          const s = row.reduce((a, b) => a + b, 0) || 1;
          return [
            <span key={`l${i}`} className="self-center pr-1 text-right text-[9.5px] text-faint">{classes[i]}</span>,
            ...row.map((v, j) => (
              <div key={`${i}${j}`} title={`true ${classes[i]} → predicted ${classes[j]}: ${v} (${Math.round((v / s) * 100)}%)`}
                className="num flex aspect-square flex-col items-center justify-center rounded-[4px] text-[11px]"
                style={{ background: `color-mix(in srgb, ${CH.amber} ${Math.round((v / s) * 92)}%, var(--color-panel-2))`, color: v / s > 0.5 ? "var(--color-panel)" : "var(--color-fg)" }}>
                {Math.round((v / s) * 100)}
              </div>
            )),
          ];
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9.5px] text-faint"><span>↓ true</span><span>predicted →</span></div>
    </div>
  );
}

function Ablation({ m }: { m: ModelJson | null }) {
  const ab = m?.eval.ablation;
  if (!m) return null;
  const mods = Object.keys(m.importance).sort((a, b) => m.importance[b] - m.importance[a]);
  const maxDrop = ab ? Math.max(0.05, ...mods.map((k) => Math.abs(m.eval.macro_f1 - ab[k].without))) : 1;
  return (
    <Card title="What each signal is worth">
      {!ab ? (
        <p className="text-[12px] text-faint">Ablation results appear after training with v1.0 (not with <span className="font-mono">--fast</span>).</p>
      ) : (
        <>
          <div className="grid grid-cols-[120px_1fr_1fr_1fr] gap-x-4 border-b border-line pb-2 text-[10.5px] text-faint">
            <span>Modality</span><span>F1 alone</span><span>F1 change if removed</span><span>Learned weight</span>
          </div>
          {mods.map((k) => {
            const drop = m.eval.macro_f1 - ab[k].without; // + = removing it hurts
            return (
              <div key={k} className="grid grid-cols-[120px_1fr_1fr_1fr] items-center gap-x-4 border-b border-line/60 py-2 text-[12px]">
                <span>{m.modality_labels[k] ?? k}</span>
                <Meter v={ab[k].alone} color={CH.cyan} label={ab[k].alone.toFixed(2)} title={`${k} alone: macro-F1 ${ab[k].alone.toFixed(3)}`} />
                <span className="flex items-center gap-2" title={`Removing ${k}: macro-F1 ${ab[k].without.toFixed(3)} (${drop >= 0 ? "−" : "+"}${Math.abs(drop).toFixed(3)})`}>
                  <span className="relative h-2 flex-1 rounded-full bg-line">
                    <span className="absolute left-1/2 top-[-2px] h-3 w-px bg-line-2" />
                    <span className="absolute top-0 h-full rounded-full" style={{ left: drop >= 0 ? "50%" : `${50 - (Math.abs(drop) / maxDrop) * 50}%`, width: `${(Math.abs(drop) / maxDrop) * 50}%`, background: drop >= 0 ? CH.amber : CH.violet }} />
                  </span>
                  <span className="num w-[44px] text-right text-[11px] text-muted">{drop >= 0 ? "−" : "+"}{Math.abs(drop).toFixed(3)}</span>
                </span>
                <Meter v={m.importance[k] / Math.max(...Object.values(m.importance))} color={CH.violet} label={m.importance[k].toFixed(2)} title={`${k}: learned meta-model weight ${m.importance[k].toFixed(3)}`} />
              </div>
            );
          })}
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            "F1 alone" = a model using only that modality. "Change if removed" = how much the full model loses without it (amber = it was helping; violet = the model did slightly better without it on this data). Modalities that look weak alone can still add complementary information.
          </p>
        </>
      )}
    </Card>
  );
}

function Meter({ v, color, label, title }: { v: number; color: string; label: string; title: string }) {
  return (
    <span className="flex items-center gap-2" title={title}>
      <span className="h-2 flex-1 rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%`, background: color }} /></span>
      <span className="num w-[34px] text-right text-[11px] text-muted">{label}</span>
    </span>
  );
}

// ───────── self-check ─────────

function SelfCheck() {
  const [res, setRes] = useState<Record<string, (CheckResult & { ms: number }) | "running">>({});
  const [busy, setBusy] = useState(false);
  const runAll = async () => {
    setBusy(true);
    setRes({});
    for (const c of CHECKS) {
      setRes((r) => ({ ...r, [c.id]: "running" }));
      await new Promise((r) => setTimeout(r, 30)); // let the UI paint between checks
      const t0 = performance.now();
      let out: CheckResult;
      try {
        out = c.run();
      } catch (e) {
        out = { ok: false, value: "error", detail: String(e) };
      }
      const ms = performance.now() - t0;
      setRes((r) => ({ ...r, [c.id]: { ...out, ms } }));
    }
    setBusy(false);
  };
  const done = Object.values(res).filter((r) => r !== "running") as (CheckResult & { ms: number })[];
  const passed = done.filter((r) => r.ok).length;
  return (
    <Card title="Self-check" right={<button className="btn !h-8" disabled={busy} onClick={runAll}>{busy ? "Running…" : done.length ? "Run again" : "Run all checks"}</button>}>
      <p className="-mt-1 mb-3 text-[11.5px] text-faint">Re-runs the core validations from the test suite in this browser, right now.</p>
      <div className="space-y-1.5">
        {CHECKS.map((c) => {
          const r = res[c.id];
          const st = r === undefined ? "idle" : r === "running" ? "running" : r.ok ? "pass" : "fail";
          return (
            <div key={c.id} className="rounded-lg border border-line bg-panel-2 px-3 py-2">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] ${st === "pass" ? "border-ok bg-ok/15 text-ok" : st === "fail" ? "border-bad bg-bad/15 text-bad" : st === "running" ? "animate-spin border-line-2 border-t-att" : "border-line-2"}`}>
                  {st === "pass" ? "✓" : st === "fail" ? "✕" : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px]">{c.name}</span>
                  <span className="block truncate text-[10.5px] text-faint">{typeof r === "object" ? r.detail : c.claim}</span>
                </span>
                {typeof r === "object" && (
                  <span className="text-right">
                    <span className="num block text-[11.5px]">{r.value}</span>
                    <span className="num block text-[9.5px] text-faint">{r.ms < 1 ? "<1" : Math.round(r.ms)} ms</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {done.length === CHECKS.length && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${passed === CHECKS.length ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>
          {passed} of {CHECKS.length} checks passed. The full suites are <span className="font-mono">npm test</span> and <span className="font-mono">npm run test:ml</span>.
        </div>
      )}
    </Card>
  );
}

// ───────── performance ─────────

function Performance() {
  const { status, fps, inferMs, latencyMs, delegate } = useLucid();
  const [bench, setBench] = useState<Bench[] | null>(null);
  const [busy, setBusy] = useState(false);
  const live = status === "running";
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  return (
    <Card title="Performance on this machine" right={<button className="btn !h-8" disabled={busy} onClick={() => { setBusy(true); setTimeout(() => { setBench(runBenchmarks()); setBusy(false); }, 30); }}>{busy ? "Measuring…" : bench ? "Re-run" : "Run benchmarks"}</button>}>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
        <Kpi k="Live FPS" v={live ? String(fps) : "—"} sub={live ? "camera pipeline" : "start Live to measure"} />
        <Kpi k="Inference" v={live ? `${inferMs.toFixed(1)} ms` : "—"} sub={delegate ? `MediaPipe · ${delegate}` : "per frame"} />
        <Kpi k="Latency" v={live ? `${Math.round(latencyMs)} ms` : "—"} sub="frame → score" />
      </div>
      <div className="mt-3">
        {bench ? (
          <table className="w-full text-[12px]">
            <tbody>
              {bench.map((b) => (
                <tr key={b.name} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5"><span className="block">{b.name}</span><span className="block text-[10.5px] text-faint">{b.what}</span></td>
                  <td className="num py-1.5 text-right">{b.ms < 0.1 ? `${(b.ms * 1000).toFixed(0)} µs` : `${b.ms.toFixed(b.ms < 10 ? 2 : 0)} ms`}<span className="block text-[10px] text-faint">{b.budget}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-2 text-[11.5px] text-faint">Times Lucid's own stages (rPPG, load model, classroom tracker, replay analysis) on this CPU.</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[10.5px] text-faint">
        <span>{navigator.hardwareConcurrency ?? "?"} CPU threads</span>
        {nav.deviceMemory && <span>≥{nav.deviceMemory} GB RAM</span>}
        <span>WebGPU {nav.gpu ? "available" : "unavailable"}</span>
        <span>{/Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : /Firefox\//.test(navigator.userAgent) ? "Firefox" : "Browser"}</span>
      </div>
    </Card>
  );
}

// ───────── pooled study data ─────────

function StudyData() {
  const [p, setP] = useState<Pooled | null>(null);
  useEffect(() => void listStudies().then((s) => setP(pool(s))).catch(() => setP(null)), []);
  const has = p && p.sessions > 0;
  return (
    <Card title="Study data, all participants">
      {!has ? (
        <p className="py-4 text-center text-[12.5px] text-faint">No completed study sessions on this device yet. Run participants in the Study tab — pooled manipulation checks appear here.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
            <Kpi k="Participants" v={String(p.participants)} sub={`${p.sessions} complete sessions`} />
            <Kpi k="Recorded" v={`${p.hours.toFixed(1)} h`} sub="10 Hz feature rows" />
            <Kpi k="ρ(n-level, TLX)" v={fmt(p.rhoTlx)} sub="Spearman, all blocks" />
            <Kpi k="TLX 3-back > 0-back" v={Number.isFinite(p.orderedShare) ? `${Math.round(p.orderedShare * 100)}%` : "—"} sub="of participants" />
          </div>
          <LevelChart p={p} />
          {p.participants < 10 && <p className="mt-2 text-[11px] text-load">Only {p.participants} participant{p.participants === 1 ? "" : "s"} — aim for 15–25 before training the real model.</p>}
        </>
      )}
    </Card>
  );
}

function LevelChart({ p }: { p: Pooled }) {
  const W = 520, H = 170, L = 30, B = 22, T = 14;
  const gw = (W - L) / 4, bw = 22;
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const series = [
    { key: "tlx" as const, label: "Raw NASA-TLX", color: CH.amber, get: (l: Pooled["levels"][0]) => l.tlx },
    { key: "acc" as const, label: "Accuracy %", color: CH.cyan, get: (l: Pooled["levels"][0]) => ({ mean: l.accuracy.mean * 100, sd: l.accuracy.sd * 100 }) },
  ];
  return (
    <div className="mt-4">
      <div className="mb-1 flex gap-4 text-[11px] text-muted">
        {series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span>)}
        <span className="text-faint">· bars = mean, whiskers = ±1 sd</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="TLX and accuracy by n-back level">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={L} x2={W} y1={y(g)} y2={y(g)} stroke="var(--color-grid)" />
            <text x={L - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--color-faint)" fontFamily="var(--font-sans)">{g}</text>
          </g>
        ))}
        {p.levels.map((l, i) => {
          const cx = L + gw * i + gw / 2;
          return (
            <g key={l.n}>
              {series.map((s, k) => {
                const v = s.get(l);
                if (!Number.isFinite(v.mean)) return null;
                const x = cx + (k === 0 ? -bw - 1 : 1);
                return (
                  <g key={s.key}>
                    <title>{`${l.n}-back · ${s.label}: ${v.mean.toFixed(1)} ± ${fmt(v.sd, 1)} (${l.blocks} blocks)`}</title>
                    <rect x={x} y={y(v.mean)} width={bw} height={Math.max(0, y(0) - y(v.mean))} rx="3" fill={s.color} />
                    {Number.isFinite(v.sd) && <line x1={x + bw / 2} x2={x + bw / 2} y1={y(Math.min(100, v.mean + v.sd))} y2={y(Math.max(0, v.mean - v.sd))} stroke="var(--color-fg)" strokeOpacity="0.5" />}
                  </g>
                );
              })}
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-muted)" fontFamily="var(--font-sans)">{l.n}-back</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ───────── ethics ─────────

function Ethics() {
  const items = [
    ["Indicators, not verdicts", "Scores are estimates of observable behaviour. Never use them to grade, rank or discipline students."],
    ["Privacy by architecture", "All vision runs in the browser. No video or images are stored or sent — only numeric features, on this device."],
    ["Consent first", "Study mode requires recorded consent and pseudonymous IDs. Classroom IDs are anonymous and reset every session."],
    ["Known limits", "Webcam gaze is coarse (regions, not points). rPPG needs good light and stillness. HRV is experimental and never scored."],
    ["Generalisation", "The load model is validated on n-back working memory, leave-one-participant-out. Transfer to real lectures is untested."],
    ["Bias", "Face analysis can perform worse for some skin tones, glasses or lighting. Report per-participant F1 and check outliers."],
  ];
  return (
    <Card title="Ethics and limitations">
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-3">
        {items.map(([h, t]) => (
          <div key={h}>
            <div className="text-[12.5px] font-medium">{h}</div>
            <div className="text-[11.5px] leading-relaxed text-muted">{t}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
