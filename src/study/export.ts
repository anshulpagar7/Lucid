// Exports: labelled 10 Hz training CSV, per-block summary CSV, full JSON.

import { loadClass, type NLevel } from "./protocol";
import type { StudyRecord } from "./types";

export const LABEL_COLUMNS = ["participant", "session", "load_class", "tlx_raw", "tlx_mental", "block_accuracy", "block_dprime"];

const esc = (v: unknown) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One study → labelled rows. Labels come from the block the row belongs to. */
export function trainingRows(s: StudyRecord): unknown[][] {
  const iBlock = s.columns.indexOf("block");
  const iPhase = s.columns.indexOf("phase");
  return s.rows.map((r) => {
    const b = (r[iBlock] as number) >= 0 ? s.blocks.find((x) => x.index === r[iBlock]) : undefined;
    const phase = r[iPhase];
    const cls = phase === "baseline" ? "rest" : b && phase === "block" ? loadClass(b.n as NLevel) : "";
    return [s.participantId, s.id, cls, b?.rawTlx ?? "", b?.tlx?.mental ?? "", b ? round(b.score.accuracy) : "", b ? round(b.score.dPrime) : "", ...r];
  });
}

export function trainingCsv(studies: StudyRecord[]): string {
  const cols = studies[0]?.columns ?? [];
  const lines = [[...LABEL_COLUMNS, ...cols].join(",")];
  for (const s of studies) for (const r of trainingRows(s)) lines.push(r.map(esc).join(","));
  return lines.join("\n");
}

export function summaryCsv(studies: StudyRecord[]): string {
  const head = ["participant", "session", "block", "n_level", "position", "accuracy", "dprime", "hits", "misses", "false_alarms", "correct_rejections", "mean_rt_ms", "tlx_raw", "tlx_mental", "tlx_physical", "tlx_temporal", "tlx_performance", "tlx_effort", "tlx_frustration", "mean_hr", "mean_h_load", "mean_blink_rate"];
  const lines = [head.join(",")];
  for (const s of studies) {
    for (const b of s.blocks) {
      const m = blockMeans(s, b.index);
      lines.push([
        s.participantId, s.id, b.index, b.n, s.order.indexOf(b.n), round(b.score.accuracy), round(b.score.dPrime),
        b.score.hits, b.score.misses, b.score.falseAlarms, b.score.correctRejections, b.score.meanRt != null ? Math.round(b.score.meanRt) : "",
        b.rawTlx != null ? round(b.rawTlx) : "", b.tlx?.mental ?? "", b.tlx?.physical ?? "", b.tlx?.temporal ?? "", b.tlx?.performance ?? "", b.tlx?.effort ?? "", b.tlx?.frustration ?? "",
        round(m.hr), round(m.load), round(m.blink),
      ].map(esc).join(","));
    }
  }
  return lines.join("\n");
}

/** Mean of selected features over the rows of one block (phase = block). */
export function blockMeans(s: StudyRecord, block: number) {
  const c = (k: string) => s.columns.indexOf(k);
  const iB = c("block"), iP = c("phase"), iHr = c("hr_bpm"), iHv = c("hr_valid"), iL = c("h_load"), iBl = c("blink_rate");
  const acc = { hr: [] as number[], load: [] as number[], blink: [] as number[] };
  for (const r of s.rows) {
    if (r[iB] !== block || r[iP] !== "block") continue;
    if (r[iHv] === 1 && typeof r[iHr] === "number") acc.hr.push(r[iHr] as number);
    if (typeof r[iL] === "number") acc.load.push(r[iL] as number);
    if (typeof r[iBl] === "number") acc.blink.push(r[iBl] as number);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  return { hr: mean(acc.hr), load: mean(acc.load), blink: mean(acc.blink), samples: acc.load.length };
}

const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : "");

export function download(filename: string, content: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
