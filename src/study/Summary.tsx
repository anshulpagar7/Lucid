import { blockMeans, download, summaryCsv, trainingCsv } from "./export";
import { pearson } from "./protocol";
import type { StudyRecord } from "./types";

export function Summary({ study, onDone }: { study: StudyRecord; onDone: () => void }) {
  const blocks = [...study.blocks].sort((a, b) => a.n - b.n);
  const rows = blocks.map((b) => ({ ...b, means: blockMeans(study, b.index) }));
  const base = study.blocks.length ? baselineHr(study) : NaN;

  const withTlx = rows.filter((r) => r.rawTlx != null);
  const checks = [
    { label: "TLX rises with n", r: pearson(withTlx.map((r) => r.n), withTlx.map((r) => r.rawTlx!)), want: 1 },
    { label: "Accuracy falls with n", r: pearson(rows.map((r) => r.n), rows.map((r) => r.score.accuracy)), want: -1 },
    { label: "Lucid load tracks TLX", r: pearson(withTlx.map((r) => r.rawTlx!), withTlx.map((r) => r.means.load)), want: 1 },
  ];
  const stamp = new Date(study.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const base_ = `lucid_${study.participantId}_${stamp}`;

  return (
    <div className="fade-in space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label mb-1">{study.complete ? "Study complete" : "Partial study (aborted)"}</div>
          <h2 className="text-[22px] tracking-tight">Results for {study.participantId}</h2>
          <p className="text-[13px] text-muted">
            {study.rows.length.toLocaleString()} feature rows at 10 Hz · {study.blocks.length} block{study.blocks.length === 1 ? "" : "s"} · saved on this device
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => download(`${base_}_training.csv`, trainingCsv([study]))}>Training CSV</button>
          <button className="btn" onClick={() => download(`${base_}_blocks.csv`, summaryCsv([study]))}>Block summary</button>
          <button className="btn" onClick={() => download(`${base_}.json`, JSON.stringify(study), "application/json")}>Raw JSON</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel overflow-x-auto p-4">
          <div className="label mb-3">Each block, easiest first</div>
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[12px] text-faint">
                {["Level", "Accuracy", "d′", "RT", "Raw TLX", "HR Δ", "Lucid load"].map((h) => (
                  <th key={h} className="pb-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {rows.map((r) => (
                <tr key={r.index} className="border-t border-line">
                  <td className="py-2 font-sans font-medium">{r.n}-back</td>
                  <td>{(r.score.accuracy * 100).toFixed(0)}%</td>
                  <td>{r.score.dPrime.toFixed(2)}</td>
                  <td>{r.score.meanRt != null ? `${Math.round(r.score.meanRt)} ms` : "—"}</td>
                  <td className="text-load">{r.rawTlx != null ? r.rawTlx.toFixed(0) : "—"}</td>
                  <td>{Number.isFinite(r.means.hr) && Number.isFinite(base) ? `${r.means.hr - base >= 0 ? "+" : ""}${(r.means.hr - base).toFixed(1)}` : "—"}</td>
                  <td>{Number.isFinite(r.means.load) ? (r.means.load * 100).toFixed(0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Bars rows={rows.map((r) => ({ n: r.n, tlx: r.rawTlx, load: r.means.load, acc: r.score.accuracy }))} />
        </div>

        <div className="panel p-4">
          <div className="label mb-1">Manipulation checks</div>
          <p className="mb-4 text-[12px] text-faint">Pearson r across this participant's blocks. With 4 points these are indicative — pool participants for real statistics.</p>
          <div className="space-y-3">
            {checks.map((c) => {
              const ok = Number.isFinite(c.r) && Math.sign(c.r) === c.want && Math.abs(c.r) >= 0.5;
              return (
                <div key={c.label} className="flex items-center justify-between rounded-lg border border-line bg-panel-2 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-[13px]">
                    <span className={`h-1.5 w-1.5 rounded-full ${!Number.isFinite(c.r) ? "bg-faint" : ok ? "bg-ok" : "bg-load"}`} />
                    {c.label}
                  </span>
                  <span className="num text-[12.5px]">{Number.isFinite(c.r) ? `r = ${c.r.toFixed(2)}` : "n/a"}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
            The first two validate the <em>labels</em> (the task really induced load). The third tests the current heuristic engine against
            them — that's the gap the trained model in week 5 closes.
          </p>
          <button className="btn mt-4" onClick={onDone}>Back to study home</button>
        </div>
      </div>
    </div>
  );
}

function baselineHr(s: StudyRecord) {
  const iP = s.columns.indexOf("phase"), iH = s.columns.indexOf("hr_bpm"), iV = s.columns.indexOf("hr_valid");
  const v = s.rows.filter((r) => r[iP] === "baseline" && r[iV] === 1).map((r) => r[iH] as number);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

/** Grouped bars: TLX vs Lucid load per level, with accuracy dots. */
function Bars({ rows }: { rows: { n: number; tlx: number | null; load: number; acc: number }[] }) {
  if (!rows.length) return null;
  const W = 520, H = 150, pad = 28, gw = (W - pad) / rows.length, bw = 18;
  const y = (v: number) => H - 20 - (v / 100) * (H - 34);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full">
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={pad} x2={W} y1={y(g)} y2={y(g)} stroke="var(--color-line)" />
          <text x={pad - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--color-faint)" fontFamily="var(--font-sans)">{g}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cx = pad + gw * i + gw / 2;
        return (
          <g key={r.n}>
            {r.tlx != null && <rect x={cx - bw - 2} y={y(r.tlx)} width={bw} height={y(0) - y(r.tlx)} rx="3" fill="var(--color-load)" opacity="0.85" />}
            {Number.isFinite(r.load) && <rect x={cx + 2} y={y(r.load * 100)} width={bw} height={y(0) - y(r.load * 100)} rx="3" fill="var(--color-eng)" opacity="0.85" />}
            <circle cx={cx} cy={y(r.acc * 100)} r="3.5" fill="var(--color-bg)" stroke="var(--color-att)" strokeWidth="2" />
            <text x={cx} y={H - 5} textAnchor="middle" fontSize="10" fill="var(--color-muted)" fontFamily="var(--font-sans)">{r.n}-back</text>
          </g>
        );
      })}
      <g fontSize="9.5" fontFamily="var(--font-sans)" fill="var(--color-muted)">
        <rect x={pad} y="2" width="8" height="8" rx="2" fill="var(--color-load)" /><text x={pad + 12} y="9.5">Raw TLX</text>
        <rect x={pad + 70} y="2" width="8" height="8" rx="2" fill="var(--color-eng)" /><text x={pad + 82} y="9.5">Lucid load</text>
        <circle cx={pad + 160} cy="6" r="3.5" fill="none" stroke="var(--color-att)" strokeWidth="2" /><text x={pad + 168} y="9.5">Accuracy</text>
      </g>
    </svg>
  );
}
